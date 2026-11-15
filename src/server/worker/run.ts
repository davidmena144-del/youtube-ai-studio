import { randomUUID } from "node:crypto";
import type { Job } from "../db/schema";
import { recordHistory } from "../history";
import { JOB_PUBLISH, JOB_STAGE, onJobDead, runPublishJob, runStageJob } from "../manager/manager";
import { errorMessage } from "../queue/errors";
import { claimNext, heartbeat, HEARTBEAT_MS, markFailed, markSucceeded, recoverStaleJobs } from "../queue/queue";

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
  // Keep the lease fresh while the (possibly long) handler runs.
  const beat = setInterval(() => {
    heartbeat(job).catch((err) => console.error("[worker] heartbeat failed:", errorMessage(err)));
  }, HEARTBEAT_MS);
  try {
    await handler(job);
    if (!(await markSucceeded(job))) {
      await recordHistory({
        actor: "worker",
        action: "job.lease_lost",
        level: "warn",
        projectId: job.projectId,
        entityType: "job",
        entityId: job.id,
        message: "انتهت مهلة المهمة وتسلمها worker آخر قبل اكتمالها",
      });
    }
  } catch (err) {
    const outcome = await markFailed(job, err);
    if (outcome === "lost") return true;
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
  } finally {
    clearInterval(beat);
  }
  return true;
}

export type DrainOptions = {
  workerId?: string;
  maxJobs?: number;
  /** Total time budget for this drain. */
  deadlineMs?: number;
  /**
   * Do not start a new job unless at least this much budget remains. Hosts that kill the
   * process at a hard limit (serverless functions) must set this to the longest expected job.
   */
  minRemainingMs?: number;
};

/** Process jobs until the queue is idle, the job limit is reached, or the time budget is spent. */
export async function drain(opts: DrainOptions = {}): Promise<number> {
  const workerId = opts.workerId ?? newWorkerId();
  const deadline = Date.now() + (opts.deadlineMs ?? 10 * 60 * 1000);
  const maxJobs = opts.maxJobs ?? 100;
  const minRemaining = opts.minRemainingMs ?? 0;

  const { dead } = await recoverStaleJobs();
  for (const job of dead) {
    await recordHistory({
      actor: "worker",
      action: "job.failed",
      level: "error",
      projectId: job.projectId,
      entityType: "job",
      entityId: job.id,
      message: `توقفت المهمة بعد ${job.attempts} محاولة انقطع فيها الـ worker`,
    });
    await onJobDead(job, new Error(job.lastError ?? "worker stopped responding"));
  }

  let processed = 0;
  while (processed < maxJobs && deadline - Date.now() > minRemaining) {
    const did = await processOne(workerId);
    if (!did) break;
    processed++;
  }
  return processed;
}
