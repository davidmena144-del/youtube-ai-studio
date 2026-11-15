import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, type Executor } from "../db/client";
import { jobs, type Job } from "../db/schema";
import { errorMessage, NonRetryableError, RetryableError } from "./errors";

export type EnqueueInput = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  projectId?: string | null;
  maxAttempts?: number;
  runAt?: Date;
};

/** Default lease: a job running longer than this is assumed abandoned (worker crashed). */
export const LEASE_MS = 15 * 60 * 1000;

/**
 * Enqueue a job. Returns the existing job if one with the same idempotency key already exists,
 * so retried HTTP requests / double clicks never create duplicate work.
 */
export async function enqueue(input: EnqueueInput, executor?: Executor): Promise<{ job: Job; created: boolean }> {
  const db = executor ?? getDb();
  const inserted = await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      projectId: input.projectId ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      runAt: input.runAt ?? new Date(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey));
  return { job: existing, created: false };
}

/** Atomically claim the next due job. Safe with multiple concurrent workers. */
export async function claimNext(workerId: string, types?: string[]): Promise<Job | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const conditions = [eq(jobs.status, "queued"), lte(jobs.runAt, new Date())];
    if (types?.length) conditions.push(inArray(jobs.type, types));
    const [candidate] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(eq(jobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function markSucceeded(jobId: string) {
  await getDb()
    .update(jobs)
    .set({ status: "succeeded", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(jobs.id, jobId));
}

/** Exponential backoff with jitter: ~30s, ~60s, ~120s ... capped at 1h. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Record a failure. Returns the resulting status: "queued" (will retry) or "dead" (gave up).
 */
export async function markFailed(job: Job, err: unknown): Promise<"queued" | "dead"> {
  const message = errorMessage(err).slice(0, 4000);
  const permanent = err instanceof NonRetryableError;
  const exhausted = job.attempts >= job.maxAttempts;
  const db = getDb();
  if (permanent || exhausted) {
    await db
      .update(jobs)
      .set({ status: "dead", lastError: message, finishedAt: new Date(), lockedAt: null, lockedBy: null })
      .where(eq(jobs.id, job.id));
    return "dead";
  }
  const delay = err instanceof RetryableError && err.retryAfterMs ? err.retryAfterMs : backoffMs(job.attempts);
  await db
    .update(jobs)
    .set({ status: "queued", lastError: message, runAt: new Date(Date.now() + delay), lockedAt: null, lockedBy: null })
    .where(eq(jobs.id, job.id));
  return "queued";
}

/** Requeue jobs whose worker disappeared mid-run (lease expired). */
export async function recoverStaleJobs(leaseMs = LEASE_MS): Promise<number> {
  const rows = await getDb()
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: "Recovered after lease expiry" })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - leaseMs))))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Manually retry a dead job (from the UI): resets attempts and schedules it now. */
export async function retryJob(jobId: string): Promise<boolean> {
  const rows = await getDb()
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null, finishedAt: null })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["dead", "failed"])))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function cancelProjectJobs(projectId: string) {
  await getDb()
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(jobs.projectId, projectId), eq(jobs.status, "queued")));
}
