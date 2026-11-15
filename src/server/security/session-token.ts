import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal signed session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Stateless, verified on every request (proxy + server actions).
 */
export type SessionPayload = { sub: string; iat: number; exp: number };

export const SESSION_COOKIE = "yts_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(sub: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const payload: SessionPayload = { sub, iat: nowSec, exp: nowSec + SESSION_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (typeof payload.sub !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
