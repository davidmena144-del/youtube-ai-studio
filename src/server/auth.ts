import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db/client";
import { loginAttempts } from "./db/schema";
import { env } from "./env";
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
const MAX_FAILURES_GLOBAL = 50;

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, env().SESSION_SECRET);
}

/** Every server action and protected page calls this — never rely on the UI alone. */
export async function requireAdmin(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

async function clientHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${ip}|${env().SESSION_SECRET}`).digest("hex").slice(0, 32);
}

async function checkPassword(password: string) {
  const e = env();
  if (e.ADMIN_PASSWORD_HASH) return verifyPassword(password, e.ADMIN_PASSWORD_HASH);
  return safeEqual(password, e.ADMIN_PASSWORD ?? "");
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(password: string): Promise<LoginResult> {
  const db = getDb();
  const client = await clientHash();
  const since = new Date(Date.now() - WINDOW_MS);
  const [{ n: clientFailures }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.clientHash, client), eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
  const [{ n: globalFailures }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
  if (clientFailures >= MAX_FAILURES_PER_CLIENT || globalFailures >= MAX_FAILURES_GLOBAL) {
    return { ok: false, error: "محاولات كثيرة فاشلة. حاول بعد 15 دقيقة." };
  }

  const ok = password.length > 0 && password.length <= 256 && (await checkPassword(password));
  await db.insert(loginAttempts).values({ clientHash: client, succeeded: ok });
  if (!ok) {
    await recordHistory({ actor: "system", action: "auth.login_failed", level: "warn", message: "محاولة دخول فاشلة" });
    return { ok: false, error: "كلمة المرور غير صحيحة" };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken("admin", env().SESSION_SECRET), {
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
