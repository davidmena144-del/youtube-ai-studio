/**
 * Login decision logic, kept free of Next.js request APIs so it can be tested directly.
 *
 * Rules:
 * - A client (identified by a hash of its trusted IP) may make MAX_FAILURES_PER_CLIENT wrong
 *   guesses per window; after that its requests are refused WITHOUT verifying the password and
 *   WITHOUT writing anything (blocked requests cannot fill the database).
 * - There is no global hard lock: one attacker can never lock the real admin out. When many
 *   clients fail at once, wrong guesses are slowed down instead; a correct password always works.
 * - The attempt row is written before the password check (and removed again if over the limit),
 *   so parallel requests from one client cannot all slip under the limit.
 * - History records the first failure and the block of each client per window, not every request.
 * - Rows older than RETENTION_MS are pruned on every attempt.
 */
import { and, count, eq, gt, lt } from "drizzle-orm";
import { getDb } from "./db/client";
import { loginAttempts } from "./db/schema";
import { recordHistory } from "./history";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_CLIENT = 5;
export const GLOBAL_SLOWDOWN_THRESHOLD = 100;
export const SLOWDOWN_MS = 2000;
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export type LoginDecision = { ok: true } | { ok: false; reason: "blocked" | "invalid" };

type Deps = {
  verify: (password: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function failuresSince(since: Date, clientKey?: string) {
  const conditions = [eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)];
  if (clientKey) conditions.push(eq(loginAttempts.clientHash, clientKey));
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(...conditions));
  return n;
}

export async function attemptLogin(clientKey: string, password: string, deps: Deps): Promise<LoginDecision> {
  const db = getDb();
  const now = deps.now?.() ?? Date.now();
  const since = new Date(now - LOGIN_WINDOW_MS);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(now - RETENTION_MS)));

  // Cheap pre-check: an already-blocked client costs one SELECT and writes nothing.
  if ((await failuresSince(since, clientKey)) >= MAX_FAILURES_PER_CLIENT) return { ok: false, reason: "blocked" };

  // Reserve this attempt, then re-count: concurrent requests beyond the limit back out.
  const [attempt] = await db
    .insert(loginAttempts)
    .values({ clientHash: clientKey, succeeded: false })
    .returning({ id: loginAttempts.id });
  const clientFailures = await failuresSince(since, clientKey);
  if (clientFailures > MAX_FAILURES_PER_CLIENT) {
    await db.delete(loginAttempts).where(eq(loginAttempts.id, attempt.id));
    return { ok: false, reason: "blocked" };
  }

  const ok = password.length > 0 && password.length <= 256 && (await deps.verify(password));
  if (ok) {
    await db.update(loginAttempts).set({ succeeded: true }).where(eq(loginAttempts.id, attempt.id));
    return { ok: true };
  }

  const tag = clientKey.slice(0, 8);
  if (clientFailures === 1) {
    await recordHistory({ actor: "system", action: "auth.login_failed", level: "warn", message: "محاولة دخول فاشلة", data: { client: tag } });
  } else if (clientFailures === MAX_FAILURES_PER_CLIENT) {
    await recordHistory({
      actor: "system",
      action: "auth.client_blocked",
      level: "warn",
      message: `حُظر عميل بعد ${MAX_FAILURES_PER_CLIENT} محاولات فاشلة لمدة 15 دقيقة`,
      data: { client: tag },
    });
  }

  const globalFailures = await failuresSince(since);
  if (globalFailures > GLOBAL_SLOWDOWN_THRESHOLD) {
    if (globalFailures === GLOBAL_SLOWDOWN_THRESHOLD + 1) {
      await recordHistory({
        actor: "system",
        action: "auth.global_slowdown",
        level: "error",
        message: "محاولات دخول فاشلة كثيرة من عملاء متعددين — تم إبطاء الردود الخاطئة",
      });
    }
    await sleep(SLOWDOWN_MS);
  }
  return { ok: false, reason: "invalid" };
}

/**
 * Client IP for rate limiting. Only headers the host's edge sets (and overwrites) are trusted:
 * - TRUSTED_IP_HEADER, when configured (e.g. "fly-client-ip", "cf-connecting-ip", "x-real-ip");
 * - on Vercel (VERCEL=1), x-vercel-forwarded-for;
 * - otherwise the LAST X-Forwarded-For hop (appended by the nearest proxy, not by the client).
 * Headers a client can set itself are never trusted unless explicitly configured.
 */
export function resolveClientIp(
  getHeader: (name: string) => string | null,
  config: { trustedHeader?: string; onVercel?: boolean },
): string {
  const lastHop = (v: string | null) => {
    const parts = v?.split(",").map((s) => s.trim()).filter(Boolean);
    return parts?.length ? parts[parts.length - 1] : undefined;
  };
  const firstHop = (v: string | null) => v?.split(",")[0]?.trim() || undefined;
  const trusted = config.trustedHeader?.toLowerCase();
  if (trusted) {
    return (trusted === "x-forwarded-for" ? lastHop(getHeader(trusted)) : firstHop(getHeader(trusted))) ?? "unknown";
  }
  if (config.onVercel) return firstHop(getHeader("x-vercel-forwarded-for")) ?? lastHop(getHeader("x-forwarded-for")) ?? "unknown";
  return lastHop(getHeader("x-forwarded-for")) ?? "unknown";
}
