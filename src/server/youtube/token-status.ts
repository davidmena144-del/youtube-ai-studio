import { createHash } from "node:crypto";
import { one, sql } from "../db/client";

/**
 * Tracks the YouTube OAuth refresh token's age so the owner is warned before Google expires it.
 * While the Google OAuth app is in "Testing", refresh tokens expire 7 days after consent.
 *
 * Stored in settings['youtube.oauth_status'] (never the token itself):
 *   fingerprint: first 16 hex chars of SHA-256(token) — tells "same token" from "new token", not reversible
 *   issued_at:   owner-supplied issue time, else when this token was first seen by a check (an upper bound,
 *                so the warning threshold leaves a margin)
 *   app_status:  "testing" (default) | "production" (no 7-day expiry)
 *   last_checked_at / last_result: last refresh attempt ("ok" or Google's error code)
 */
export const STATUS_KEY = "youtube.oauth_status";
export const TESTING_LIFETIME_DAYS = 7;

export type TokenStatus = {
  fingerprint: string;
  issued_at: string;
  issued_at_source: "owner" | "first_seen";
  app_status: "testing" | "production";
  last_checked_at?: string;
  last_result?: string;
};

export type Assessment = {
  level: "ok" | "warn" | "expired" | "unknown";
  app_status: "testing" | "production";
  issued_at: string | null;
  expires_at: string | null;
  days_left: number | null;
};

export function tokenFingerprint(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex").slice(0, 16);
}

export function appStatusFromEnv(env: NodeJS.ProcessEnv): "testing" | "production" {
  return (env.YT_OAUTH_APP_STATUS ?? "").trim().toLowerCase() === "production" ? "production" : "testing";
}

const FAIL_CODES = new Set(["invalid_grant", "unauthorized_client", "invalid_client"]);

/** Pure: same rules as SQL app.youtube_token_status(). */
export function assess(s: TokenStatus | null, now: Date, warnDays = 2): Assessment {
  if (!s) return { level: "unknown", app_status: "testing", issued_at: null, expires_at: null, days_left: null };
  const expires = s.app_status === "testing" ? new Date(new Date(s.issued_at).getTime() + TESTING_LIFETIME_DAYS * 86400_000) : null;
  const daysLeft = expires ? Math.round(((expires.getTime() - now.getTime()) / 86400_000) * 10) / 10 : null;
  let level: Assessment["level"] = "ok";
  if ((s.last_result && FAIL_CODES.has(s.last_result)) || (expires && expires.getTime() <= now.getTime())) level = "expired";
  else if (expires && expires.getTime() <= now.getTime() + warnDays * 86400_000) level = "warn";
  return { level, app_status: s.app_status, issued_at: s.issued_at, expires_at: expires?.toISOString() ?? null, days_left: daysLeft };
}

export async function readTokenStatus(): Promise<TokenStatus | null> {
  const r = await one<{ value: TokenStatus }>(sql`SELECT value FROM settings WHERE key = ${STATUS_KEY}`);
  return r?.value ?? null;
}

async function writeTokenStatus(s: TokenStatus) {
  await one(sql`INSERT INTO settings (key, value) VALUES (${STATUS_KEY}, ${JSON.stringify(s)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() RETURNING key`);
}

/**
 * Records that `refreshToken` is in use. A new fingerprint resets the clock (issued_at = owner-supplied
 * time if given, else now). The same token keeps its original issued_at unless the owner supplies one.
 */
export async function noteToken(
  refreshToken: string,
  opts: { now?: Date; issuedAt?: Date; appStatus?: "testing" | "production"; result?: string } = {},
): Promise<TokenStatus> {
  const now = opts.now ?? new Date();
  if (opts.issuedAt && (Number.isNaN(opts.issuedAt.getTime()) || opts.issuedAt.getTime() > now.getTime() + 60_000)) {
    throw new Error("issued_at must be a valid time that is not in the future");
  }
  const fp = tokenFingerprint(refreshToken);
  const prev = await readTokenStatus();
  const same = prev?.fingerprint === fp;
  const next: TokenStatus = {
    fingerprint: fp,
    issued_at: opts.issuedAt?.toISOString() ?? (same ? prev!.issued_at : now.toISOString()),
    issued_at_source: opts.issuedAt ? "owner" : same ? prev!.issued_at_source : "first_seen",
    app_status: opts.appStatus ?? "testing",
    last_checked_at: opts.result ? now.toISOString() : prev?.last_checked_at,
    last_result: opts.result ?? (same ? prev?.last_result : undefined),
  };
  await writeTokenStatus(next);
  return next;
}

/** Arabic owner message for the job summary / CLI. */
export function ownerMessage(a: Assessment): string {
  const when = a.expires_at ? new Date(a.expires_at).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
  switch (a.level) {
    case "ok":
      return a.app_status === "production"
        ? "ربط YouTube سليم. التطبيق في وضع In production، فلا انتهاء بعد 7 أيام."
        : `ربط YouTube سليم. ينتهي رمز التجديد تقريبًا في ${when} (متبقٍ ${a.days_left} يوم). سأنبهك قبلها بيومين.`;
    case "warn":
      return `تنبيه: رمز تجديد YouTube ينتهي خلال ${a.days_left} يوم (حوالي ${when}). جدّده الآن باتباع docs/YOUTUBE-REAUTH.md (5 دقائق من الهاتف).`;
    case "expired":
      return "رمز تجديد YouTube انتهى أو رُفض. الرفع والتحليلات متوقفة حتى تجدّده باتباع docs/YOUTUBE-REAUTH.md.";
    default:
      return "لا توجد بيانات عن رمز YouTube بعد. شغّل workflow ‏\"YouTube token check\".";
  }
}
