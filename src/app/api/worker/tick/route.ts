import { env } from "@/server/env";
import { safeEqual } from "@/server/security/password";
import { drain } from "@/server/worker/run";

export const dynamic = "force-dynamic";
// Vercel Hobby allows up to 60s by default; keep the drain budget below it.
export const maxDuration = 60;

/**
 * Processes queued jobs for a limited time. For hosts without a long-running worker:
 * Vercel Cron, cron-job.org, or any scheduler sending `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 404 });
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const processed = await drain({ maxJobs: 10, deadlineMs: 45_000 });
  return Response.json({ ok: true, processed });
}

export const GET = handle;
export const POST = handle;
