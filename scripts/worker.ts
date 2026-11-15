/**
 * Media/system worker entry point (GitHub Actions).
 *   npm run worker:once   — drain due jobs, then exit
 * Phase 1 registers only the built-in `system.noop` handler (used by tests and smoke runs);
 * media handlers arrive in Phase 4.
 */
import { workerEnv } from "../src/server/env";
import { drain, newWorkerId, registerHandler } from "../src/server/worker/run";

const BUDGET_MS = Number(process.env.WORKER_TIME_BUDGET_MS ?? 20 * 60 * 1000);
const MIN_REMAINING_MS = Number(process.env.WORKER_MIN_REMAINING_MS ?? 12 * 60 * 1000);

async function main() {
  workerEnv(); // validates env and refuses paid-provider credentials
  if (BUDGET_MS <= MIN_REMAINING_MS) {
    throw new Error(`WORKER_TIME_BUDGET_MS (${BUDGET_MS}) must exceed WORKER_MIN_REMAINING_MS (${MIN_REMAINING_MS})`);
  }
  registerHandler("system.noop", async (job) => ({ ok: true, echo: job.payload }));
  const workerId = newWorkerId("gha");
  const n = await drain({ workerId, kinds: ["media", "system"], deadlineMs: BUDGET_MS, minRemainingMs: MIN_REMAINING_MS, maxJobs: 500 });
  console.log(`[worker] ${workerId} processed ${n} job(s)`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
