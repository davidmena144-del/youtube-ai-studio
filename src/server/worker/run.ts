import { randomUUID } from "node:crypto";
import type { Job } from "../db/schema";
import { recordHistory } from "../history";
import { JOB_PUBLISH, JOB_STAGE, onJobDead, runPublishJob, runStageJob } from "../manager/manager";
import { errorMessage } from "../queue/errors";
import { claimNext, markFailed, markSucceeded, recoverStaleJobs } from "../queue/queue";

type Handler = (job: Job) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  [JOB_STAGE]: runStageJob,
  [JOB_PUBLISH]: runPublishJob,
};

export function newWorkerId(prefix = "worker") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Claim and process a single job. Returns false when the queue has nothing due. */
export async function processOne(workerId: string): Promise<boolean> {
  const job = await claimNext(workerId, Object.keys(HANDLERS));
  if (!job) return false;
  const handler = HANDLERS[job.type];
  try {
    await handler(job);
    await markSucceeded(job.id);
  } catch (err) {
    const outcome = await markFailed(job, err);
    await recordHistory({
      actor: "worker",
      action: outcome === "dead" ? "job.failed" : "job.retry_scheduled",
      level: outcome === "dead" ? "error" : "warn",
      projectId: job.projectId,
      entityType: "job",
      entityId: job.id,
      message:
        outcome === "dead"
          ? `فشلت المهمة نهائيًا: ${errorMessage(err)}`
          : `فشلت المحاولة ${job.attempts} من ${job.maxAttempts} — ستُعاد تلقائيًا: ${errorMessage(err)}`,
    });
    if (outcome === "dead") await onJobDead(job, err);
  }
  return true;
}

export type DrainOptions = { workerId?: string; maxJobs?: number; deadlineMs?: number };

/** Process jobs until the queue is idle, the job limit is reached, or the time budget is spent. */
export async function drain(opts: DrainOptions = {}): Promise<number> {
  const workerId = opts.workerId ?? newWorkerId();
  const deadline = Date.now() + (opts.deadlineMs ?? 10 * 60 * 1000);
  const maxJobs = opts.maxJobs ?? 100;
  await recoverStaleJobs();
  let processed = 0;
  while (processed < maxJobs && Date.now() < deadline) {
    const did = await processOne(workerId);
    if (!did) break;
    processed++;
  }
  return processed;
}
