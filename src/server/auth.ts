import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db/client";
import { loginAttempts, settings } from "./db/schema";
import { authEnv, env } from "./env";
import { recordHistory } from "./history";
import { safeEqual, verifyPassword } from "./security/password";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  verifySessionToken,
  type SessionPayload,
} from "./security/session-token";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 5;
const MAX_FAILURES_GLOBAL = 100;
const AUTH_STATE_KEY = "auth_state";

/** Sessions issued before this instant are rejected ("sign out everywhere"). */
async function sessionsValidAfter(): Promise<number> {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, AUTH_STATE_KEY));
  const v = (row?.value as { sessionsValidAfter?: number } | undefined)?.sessionsValidAfter;
  return typeof v === "number" ? v : 0;
}

/**
 * Full session check: signature, expiry AND server-side revocation.
 * (proxy.ts does the cheap signature/expiry check on every request; this adds the DB check.)
 */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token, authEnv().SESSION_SECRET);
  if (!payload) return null;
  if (payload.iat < (await sessionsValidAfter())) return null;
  return payload;
}

/** Every server action, page and query calls this — never rely on the UI alone. */
export async function requireAdmin(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/**
 * Client identity for rate limiting. Uses headers set by the hosting platform's edge
 * (not spoofable there); for a generic reverse proxy, the LAST X-Forwarded-For hop is the one
 * appended by the proxy itself, unlike the first hop which the client controls.
 */
async function clientHash() {
  const h = await headers();
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  const ip =
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("fly-client-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    xff?.[xff.length - 1] ||
    "unknown";
  return createHash("sha256").update(`${ip}|${authEnv().SESSION_SECRET}`).digest("hex").slice(0, 32);
}

async function checkPassword(password: string) {
  const a = authEnv();
  if (a.ADMIN_PASSWORD_HASH) return verifyPassword(password, a.ADMIN_PASSWORD_HASH);
  return safeEqual(password, a.ADMIN_PASSWORD ?? "");
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(password: string): Promise<LoginResult> {
  const db = getDb();
  const client = await clientHash();
  const since = new Date(Date.now() - WINDOW_MS);

  // Record the attempt as a failure BEFORE checking, so concurrent requests cannot all slip
  // under the limit (each one is counted before any password is verified).
  const [attempt] = await db.insert(loginAttempts).values({ clientHash: client, succeeded: false }).returning({ id: loginAttempts.id });
  const [{ n: clientFailures }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.clientHash, client), eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
  const [{ n: globalFailures }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
  if (clientFailures > MAX_FAILURES_PER_CLIENT || globalFailures > MAX_FAILURES_GLOBAL) {
    await recordHistory({ actor: "system", action: "auth.rate_limited", level: "warn", message: "تم رفض محاولة دخول بسبب كثرة المحاولات" });
    return { ok: false, error: "محاولات كثيرة فاشلة. حاول بعد 15 دقيقة." };
  }

  const ok = password.length > 0 && password.length <= 256 && (await checkPassword(password));
  if (!ok) {
    await recordHistory({ actor: "system", action: "auth.login_failed", level: "warn", message: "محاولة دخول فاشلة" });
    return { ok: false, error: "كلمة المرور غير صحيحة" };
  }
  await db.update(loginAttempts).set({ succeeded: true }).where(eq(loginAttempts.id, attempt.id));

  (await cookies()).set(SESSION_COOKIE, createSessionToken("admin", authEnv().SESSION_SECRET), {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  await recordHistory({ actor: "user", action: "auth.login", message: "تسجيل دخول" });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Invalidate every existing session, on every device (e.g. after a lost phone or password change). */
export async function revokeAllSessions() {
  const value = { sessionsValidAfter: Math.floor(Date.now() / 1000) + 1 };
  await getDb()
    .insert(settings)
    .values({ key: AUTH_STATE_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await recordHistory({ actor: "user", action: "auth.revoke_all", level: "warn", message: "تم تسجيل الخروج من جميع الأجهزة" });
  (await cookies()).delete(SESSION_COOKIE);
}
