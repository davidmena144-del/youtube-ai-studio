import { one, rows, sql } from "../db/client";
import type { Job } from "../db/schema";
import { errorMessage, NonRetryableError, RetryableError } from "./errors";

/**
 * Job queue over Postgres, implemented by the app.* SQL functions (drizzle/0002_functions.sql).
 * Each call is a single statement, so it works over Neon HTTP. Semantics carried over from PR #1:
 * idempotent enqueue, SKIP LOCKED claiming, lease fencing, bounded attempts, stale recovery.
 */

export type JobKind = "cognitive" | "media" | "system";

export type EnqueueInput = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  projectId?: string | null;
  kind?: JobKind;
  assignee?: string | null;
  dependsOn?: string[];
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
  channelId?: string | null;
  parentJobId?: string | null;
  createdBy?: string | null;
};

/** Default lease: a running job not heartbeated for this long is assumed abandoned. */
export const LEASE_MS = 15 * 60 * 1000;
/** How often a running job refreshes its lease. Must be well below LEASE_MS. */
export const HEARTBEAT_MS = 60 * 1000;

/** Functions return snake_case columns; map to the drizzle Job shape. */
export function toJob(r: Record<string, unknown>): Job {
  const d = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  return {
    id: r.id as string,
    type: r.type as string,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    status: r.status as Job["status"],
    projectId: (r.project_id ?? null) as string | null,
    idempotencyKey: r.idempotency_key as string,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    runAt: d(r.run_at) as Date,
    lockedAt: d(r.locked_at),
    lockedBy: (r.locked_by ?? null) as string | null,
    lastError: (r.last_error ?? null) as string | null,
    finishedAt: d(r.finished_at),
    kind: r.kind as string,
    assignee: (r.assignee ?? null) as string | null,
    parentJobId: (r.parent_job_id ?? null) as string | null,
    dependsOn: (r.depends_on ?? []) as string[],
    priority: Number(r.priority),
    result: r.result ?? null,
    createdBy: (r.created_by ?? null) as string | null,
    channelId: (r.channel_id ?? null) as string | null,
    createdAt: d(r.created_at) as Date,
    updatedAt: d(r.updated_at) as Date,
  };
}

export function uuidArray(ids: string[] | undefined) {
  return ids && ids.length ? sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]` : sql`'{}'::uuid[]`;
}

function textArray(values: string[] | undefined) {
  return values && values.length ? sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]` : sql`NULL::text[]`;
}

export async function getJob(id: string): Promise<Job | undefined> {
  const r = await one(sql`SELECT * FROM jobs WHERE id = ${id}`);
  return r ? toJob(r) : undefined;
}

export class ProjectClosedError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} is cancelled or published; it accepts no new jobs`);
    this.name = "ProjectClosedError";
  }
}

/** The driver wraps Postgres errors ("Failed query: …"); the original is in `cause`. */
function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
}

/** Idempotent: enqueueing the same key twice returns the existing job. */
export async function enqueue(input: EnqueueInput): Promise<{ job: Job; created: boolean }> {
  try {
    return await enqueueRaw(input);
  } catch (err) {
    if (input.projectId && pgMessage(err).includes("project_closed")) throw new ProjectClosedError(input.projectId);
    throw err;
  }
}

async function enqueueRaw(input: EnqueueInput): Promise<{ job: Job; created: boolean }> {
  const r = await one<{ job_id: string; created: boolean }>(sql`
    SELECT * FROM app.enqueue_job(
      ${input.type}, ${JSON.stringify(input.payload)}::jsonb, ${input.idempotencyKey},
      ${input.projectId ?? null}::uuid, ${input.kind ?? "cognitive"}, ${input.assignee ?? null},
      ${uuidArray(input.dependsOn)}, ${input.priority ?? 100}::int, ${input.maxAttempts ?? 3}::int,
      ${(input.runAt ?? new Date()).toISOString()}::timestamptz, ${input.channelId ?? null}::uuid,
      ${input.parentJobId ?? null}::uuid, ${input.createdBy ?? null})`);
  const job = await getJob(r!.job_id);
  return { job: job!, created: Boolean(r!.created) };
}

export type ClaimFilter = { kinds?: JobKind[]; types?: string[]; assignee?: string };

export async function claimNext(workerId: string, filter: ClaimFilter = {}): Promise<Job | null> {
  const r = await one(sql`
    SELECT * FROM app.claim_job(${workerId}, ${textArray(filter.kinds)}, ${textArray(filter.types)}, ${filter.assignee ?? null})`);
  return r && r.id ? toJob(r) : null;
}

/** Returns false if the lease was lost (another worker took the job over). */
export async function markSucceeded(job: Pick<Job, "id" | "lockedBy">, result?: unknown): Promise<boolean> {
  const r = await one<{ ok: boolean }>(sql`
    SELECT app.complete_job(${job.id}, ${job.lockedBy ?? ""}, ${result === undefined ? null : JSON.stringify(result)}::jsonb) AS ok`);
  return Boolean(r?.ok);
}

export async function heartbeat(job: Pick<Job, "id" | "lockedBy">): Promise<boolean> {
  const r = await one<{ ok: boolean }>(sql`SELECT app.heartbeat_job(${job.id}, ${job.lockedBy ?? ""}) AS ok`);
  return Boolean(r?.ok);
}

/** Exponential backoff with jitter (mirrors app.fail_job): ~30s, ~60s, ~120s … capped at 1h. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** "queued" (retry scheduled), "dead" (gave up) or "lost" (lease no longer ours: changes nothing). */
export async function markFailed(job: Job, err: unknown): Promise<"queued" | "dead" | "lost"> {
  const retryable = !(err instanceof NonRetryableError);
  const retryAfter = err instanceof RetryableError && err.retryAfterMs ? err.retryAfterMs : null;
  const r = await one<{ outcome: "queued" | "dead" | "lost" }>(sql`
    SELECT app.fail_job(${job.id}, ${job.lockedBy ?? ""}, ${errorMessage(err)}, ${retryable}, ${retryAfter}::int) AS outcome`);
  return r!.outcome;
}

export async function recoverStaleJobs(leaseMs = LEASE_MS): Promise<{ requeued: string[]; dead: string[] }> {
  const res = await rows<{ job_id: string; outcome: string }>(sql`SELECT * FROM app.recover_stale_jobs(${leaseMs}::int)`);
  return {
    requeued: res.filter((r) => r.outcome === "queued").map((r) => r.job_id),
    dead: res.filter((r) => r.outcome === "dead").map((r) => r.job_id),
  };
}

export async function retryJob(jobId: string): Promise<boolean> {
  const r = await one<{ ok: boolean }>(sql`SELECT app.retry_job(${jobId}) AS ok`);
  return Boolean(r?.ok);
}
