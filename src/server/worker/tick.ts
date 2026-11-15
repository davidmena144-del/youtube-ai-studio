import { env } from "../env";
import { resolveLlmProviderId } from "../providers/llm";
import { safeEqual } from "../security/password";
import { drain } from "./run";

/**
 * Processes queued jobs within a serverless function's time limit (Vercel Cron, cron-job.org, …
 * sending `Authorization: Bearer <CRON_SECRET>`).
 *
 * Only usable with LLM_PROVIDER=mock: a real Claude stage can take minutes, and a function killed
 * at 60 s would pay for the call and lose the result. With LLM_PROVIDER=anthropic this endpoint
 * refuses to start work (409) — use the GitHub Actions worker or a container worker instead.
 */
export async function handleTick(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 404 });
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (resolveLlmProviderId() !== "mock") {
    return Response.json(
      { error: "This endpoint only runs mock jobs. Real Claude stages need the GitHub Actions or container worker." },
      { status: 409 },
    );
  }
  const processed = await drain({ maxJobs: 5, deadlineMs: 50_000, minRemainingMs: 20_000 });
  return Response.json({ ok: true, processed });
}

