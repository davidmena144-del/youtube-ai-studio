/**
 * Media/system worker entry point (GitHub Actions).
 *   npm run worker:once -- --check   prints "pending=N" (due media/system jobs) and exits; no heavy setup
 *   npm run worker:once              recover stale jobs, drain due jobs, record minutes used, exit
 * Free-tier guard: every run adds its minutes to quota_ledger ("gha.minutes", month); when the
 * policy budget (gha_monthly_minutes_budget, default 1700 of the free 2000) is reached, runs stop.
 */
import { activePolicy, getChannel } from "../src/core/channel";
import { quotaUsed, recordQuota } from "../src/core/ops";
import { closeDb, one, sql } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { recoverStaleJobs } from "../src/server/queue/queue";
import { registerProductionHandlers } from "../src/server/worker/handlers";
import { drain, newWorkerId, registerHandler } from "../src/server/worker/run";

const BUDGET_MS = Number(process.env.WORKER_TIME_BUDGET_MS ?? 20 * 60 * 1000);
const MIN_REMAINING_MS = Number(process.env.WORKER_MIN_REMAINING_MS ?? 12 * 60 * 1000);
const started = Date.now();

async function minutesBudget(): Promise<{ used: number; limit: number }> {
  const ch = await getChannel();
  const limit = ch ? (await activePolicy(ch.id)).policy.gha_monthly_minutes_budget : 1700;
  return { used: await quotaUsed("gha.minutes", "month"), limit };
}

async function pendingCount(): Promise<number> {
  const r = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM jobs j
    WHERE j.kind IN ('media','system') AND j.status = 'queued' AND j.run_at <= now()
      AND (j.channel_id IS NULL OR j.type LIKE 'analytics.%' OR NOT app.channel_paused(j.channel_id))`);
  return r?.n ?? 0;
}

async function main() {
  workerEnv(); // validates env and refuses paid-provider credentials
  const { used, limit } = await minutesBudget();
  if (process.argv.includes("--check")) {
    const n = used >= limit ? 0 : await pendingCount();
    console.log(`pending=${n}`);
    console.log(`[worker] free-minutes used this month: ${used}/${limit}${used >= limit ? " — budget reached, skipping" : ""}`);
    return;
  }
  if (used >= limit) {
    console.log(`[worker] monthly free-minutes budget reached (${used}/${limit}); not running`);
    return;
  }
  if (BUDGET_MS <= MIN_REMAINING_MS) throw new Error(`WORKER_TIME_BUDGET_MS (${BUDGET_MS}) must exceed WORKER_MIN_REMAINING_MS (${MIN_REMAINING_MS})`);
  const rec = await recoverStaleJobs();
  if (rec.requeued.length || rec.dead.length) console.log(`[worker] recovered stale jobs: requeued=${rec.requeued.length} dead=${rec.dead.length}`);
  // P7: once anything is live, pull analytics daily (idempotent per channel per day).
  const ch = await getChannel();
  if (ch) {
    const live = await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM publications pb JOIN projects p ON p.id = pb.project_id
      WHERE p.channel_id = ${ch.id}::uuid AND pb.mode = 'live' AND pb.status = 'succeeded'`);
    if ((live?.n ?? 0) > 0) await one(sql`SELECT app.enqueue_analytics(${ch.id}::uuid) AS id`);
  }
  registerHandler("system.noop", async (job) => ({ ok: true, echo: job.payload }));
  registerProductionHandlers();
  const workerId = newWorkerId("gha");
  const n = await drain({ workerId, kinds: ["media", "system"], deadlineMs: BUDGET_MS, minRemainingMs: MIN_REMAINING_MS, maxJobs: 50 });
  console.log(`[worker] ${workerId} processed ${n} job(s)`);
}

main()
  .catch((err) => {
    console.error("[worker] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!process.argv.includes("--check")) {
      // Setup steps before this process are counted by the workflow via WORKER_SETUP_MINUTES.
      const minutes = Math.ceil((Date.now() - started) / 60_000) + Number(process.env.WORKER_SETUP_MINUTES ?? 0);
      await recordQuota("gha.minutes", "month", minutes, 1_000_000).catch(() => {});
    }
    await closeDb().catch(() => {});
  });
