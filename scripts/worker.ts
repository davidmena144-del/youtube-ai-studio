/**
 * Worker entry point.
 *   npm run worker          — long-running loop (container hosts: Render, Fly, Railway, Docker)
 *   npm run worker:once     — drain the queue then exit (GitHub Actions / cron)
 */
import { closeDb } from "@/server/db/client";
import { drain, newWorkerId } from "@/server/worker/run";

const once = process.argv.includes("--once");
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const BUDGET_MS = Number(process.env.WORKER_TIME_BUDGET_MS ?? 20 * 60 * 1000);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received, finishing current job…`);
    stopping = true;
  });
}

async function main() {
  const workerId = newWorkerId(once ? "once" : "loop");
  console.log(`[worker] ${workerId} started (${once ? "drain once" : "loop"})`);
  if (once) {
    const n = await drain({ workerId, deadlineMs: BUDGET_MS, maxJobs: 500 });
    console.log(`[worker] processed ${n} job(s)`);
    return;
  }
  while (!stopping) {
    const n = await drain({ workerId, deadlineMs: 60_000, maxJobs: 50 });
    if (n) console.log(`[worker] processed ${n} job(s)`);
    if (!stopping) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main()
  .catch((err) => {
    console.error("[worker] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
