import { env } from "@/server/env";
import { safeEqual } from "@/server/security/password";
import { drain } from "@/server/worker/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Processes queued jobs within the function's time limit. For hosts without a long-running
 * worker: Vercel Cron, cron-job.org, or any scheduler sending `Authorization: Bearer <CRON_SECRET>`.
 *
 * Limitation: a single real Claude stage can take longer than 60 s. If the host kills the
 * function mid-job, the job is recovered after its lease and retried, and is marked dead after
 * maxAttempts — so it cannot loop forever, but it will not succeed either. For real Claude runs
 * use the GitHub Actions worker or a container worker (see docs/DEPLOYMENT.md).
 */
async function handle(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 404 });
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Start at most one job, and only at the beginning of the window.
  const processed = await drain({ maxJobs: 1, deadlineMs: 50_000, minRemainingMs: 40_000 });
  return Response.json({ ok: true, processed });
}

export const GET = handle;
export const POST = handle;
