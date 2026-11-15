import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
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

/** Only the worker that still holds the lease may finish a job (fencing against double runs). */
function ownedBy(job: Pick<Job, "id" | "lockedBy">) {
  return and(eq(jobs.id, job.id), eq(jobs.status, "running"), job.lockedBy ? eq(jobs.lockedBy, job.lockedBy) : sql`false`);
}

/** Returns false if the lease was lost (another worker took the job over). */
export async function markSucceeded(job: Pick<Job, "id" | "lockedBy">): Promise<boolean> {
  const rows = await getDb()
    .update(jobs)
    .set({ status: "succeeded", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
    .where(ownedBy(job))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** How often a running job refreshes its lease. Must be well below LEASE_MS. */
export const HEARTBEAT_MS = 60 * 1000;

/**
 * Refresh the lease of a job this worker is still running, so a long but healthy job is never
 * mistaken for an abandoned one and handed to a second worker. Returns false if the lease is lost.
 */
export async function heartbeat(job: Pick<Job, "id" | "lockedBy">): Promise<boolean> {
  const rows = await getDb().update(jobs).set({ lockedAt: new Date() }).where(ownedBy(job)).returning({ id: jobs.id });
  return rows.length > 0;
}

/** True while this worker still holds the job's lease (used before saving paid results). */
export async function stillOwns(job: Pick<Job, "id" | "lockedBy">, executor?: Executor): Promise<boolean> {
  const rows = await (executor ?? getDb()).select({ id: jobs.id }).from(jobs).where(ownedBy(job));
  return rows.length > 0;
}

/** Exponential backoff with jitter: ~30s, ~60s, ~120s ... capped at 1h. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Record a failure. Returns the resulting status: "queued" (will retry), "dead" (gave up),
 * or "lost" (this worker no longer owns the job, so it changes nothing).
 */
export async function markFailed(job: Job, err: unknown): Promise<"queued" | "dead" | "lost"> {
  const message = errorMessage(err).slice(0, 4000);
  const permanent = err instanceof NonRetryableError;
  const exhausted = job.attempts >= job.maxAttempts;
  const db = getDb();
  if (permanent || exhausted) {
    const rows = await db
      .update(jobs)
      .set({ status: "dead", lastError: message, finishedAt: new Date(), lockedAt: null, lockedBy: null })
      .where(ownedBy(job))
      .returning({ id: jobs.id });
    return rows.length ? "dead" : "lost";
  }
  const delay = err instanceof RetryableError && err.retryAfterMs ? err.retryAfterMs : backoffMs(job.attempts);
  const rows = await db
    .update(jobs)
    .set({ status: "queued", lastError: message, runAt: new Date(Date.now() + delay), lockedAt: null, lockedBy: null })
    .where(ownedBy(job))
    .returning({ id: jobs.id });
  return rows.length ? "queued" : "lost";
}

/**
 * Handle jobs whose worker disappeared mid-run (lease expired: crash, host timeout, kill).
 * Jobs with attempts left are requeued; jobs that already used every attempt are marked dead,
 * so a job that keeps getting killed cannot loop forever (and keep paying for LLM calls).
 */
export async function recoverStaleJobs(leaseMs = LEASE_MS): Promise<{ requeued: number; dead: Job[] }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - leaseMs);
  const stale = and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff));
  const dead = await db
    .update(jobs)
    .set({
      status: "dead",
      lockedAt: null,
      lockedBy: null,
      finishedAt: new Date(),
      lastError: "The worker stopped responding on every attempt (crash or host time limit)",
    })
    .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
    .returning();
  const requeued = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: "Recovered after lease expiry" })
    .where(stale)
    .returning({ id: jobs.id });
  return { requeued: requeued.length, dead };
}

/** Manually retry a dead job (from the UI): resets attempts and schedules it now. */
export async function retryJob(jobId: string, executor?: Executor): Promise<boolean> {
  const rows = await (executor ?? getDb())
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
