import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { attemptLogin, resolveClientIp } from "./auth-core";
import { getDb } from "./db/client";
import { settings } from "./db/schema";
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

/** Every server action and every data read made for a page calls this — never rely on the UI alone. */
export async function requireAdmin(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

async function clientKey() {
  const h = await headers();
  const e = env();
  const ip = resolveClientIp((n) => h.get(n), { trustedHeader: e.TRUSTED_IP_HEADER, onVercel: e.VERCEL === "1" });
  return createHash("sha256").update(`${ip}|${authEnv().SESSION_SECRET}`).digest("hex").slice(0, 32);
}

async function checkPassword(password: string) {
  const a = authEnv();
  if (a.ADMIN_PASSWORD_HASH) return verifyPassword(password, a.ADMIN_PASSWORD_HASH);
  return safeEqual(password, a.ADMIN_PASSWORD ?? "");
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(password: string): Promise<LoginResult> {
  const decision = await attemptLogin(await clientKey(), password, { verify: checkPassword });
  if (!decision.ok) {
    return {
      ok: false,
      error: decision.reason === "blocked" ? "محاولات كثيرة فاشلة من هذا الجهاز. حاول بعد 15 دقيقة." : "كلمة المرور غير صحيحة",
    };
  }
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
