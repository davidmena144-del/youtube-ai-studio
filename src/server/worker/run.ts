import { randomUUID } from "node:crypto";
import type { Job } from "../db/schema";
import { recordHistory } from "../history";
import { errorMessage } from "../queue/errors";
import { claimNext, heartbeat, HEARTBEAT_MS, markFailed, markSucceeded, recoverStaleJobs, type JobKind } from "../queue/queue";

/**
 * Generic job worker (runs in GitHub Actions for media/system jobs). Handlers are registered per
 * job type; Phase 4 adds the media handlers (TTS, render, upload…). The loop keeps PR #1's
 * guarantees: heartbeat while running, fenced completion, bounded retries, no job started when
 * the remaining time budget is too short.
 */
export type Handler = (job: Job) => Promise<unknown>;

const handlers = new Map<string, Handler>();

export function registerHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export function clearHandlers() {
  handlers.clear();
}

export function newWorkerId(prefix = "worker") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Claim and process one job. Returns false when nothing is due. */
export async function processOne(workerId: string, kinds: JobKind[] = ["media", "system"]): Promise<boolean> {
  const types = [...handlers.keys()];
  if (!types.length) return false;
  const job = await claimNext(workerId, { kinds, types });
  if (!job) return false;
  const handler = handlers.get(job.type)!;
  const beat = setInterval(() => {
    heartbeat(job).catch((err) => console.error("[worker] heartbeat failed:", errorMessage(err)));
  }, HEARTBEAT_MS);
  try {
    const result = await handler(job);
    if (!(await markSucceeded(job, result))) {
      await recordHistory({
        actor: "worker",
        action: "job.lease_lost",
        level: "warn",
        projectId: job.projectId,
        entityType: "job",
        entityId: job.id,
        message: "Lease expired; another worker took over this job before it finished",
      });
    }
  } catch (err) {
    const outcome = await markFailed(job, err);
    if (outcome !== "lost") {
      await recordHistory({
        actor: "worker",
        action: outcome === "dead" ? "job.failed" : "job.retry_scheduled",
        level: outcome === "dead" ? "error" : "warn",
        projectId: job.projectId,
        entityType: "job",
        entityId: job.id,
        message: `${job.type} attempt ${job.attempts}/${job.maxAttempts} failed: ${errorMessage(err)}`,
      });
    }
  } finally {
    clearInterval(beat);
  }
  return true;
}

export type DrainOptions = {
  workerId?: string;
  kinds?: JobKind[];
  maxJobs?: number;
  deadlineMs?: number;
  /** Do not start a job unless at least this much time budget remains (host time limits). */
  minRemainingMs?: number;
};

export async function drain(opts: DrainOptions = {}): Promise<number> {
  const workerId = opts.workerId ?? newWorkerId();
  const deadline = Date.now() + (opts.deadlineMs ?? 10 * 60 * 1000);
  const maxJobs = opts.maxJobs ?? 100;
  const minRemaining = opts.minRemainingMs ?? 0;
  const { dead } = await recoverStaleJobs();
  for (const id of dead) {
    await recordHistory({ actor: "worker", action: "job.failed", level: "error", entityType: "job", entityId: id, message: "Job dead after repeated worker loss" });
  }
  let processed = 0;
  while (processed < maxJobs && deadline - Date.now() > minRemaining) {
    if (!(await processOne(workerId, opts.kinds))) break;
    processed++;
  }
  return processed;
}
