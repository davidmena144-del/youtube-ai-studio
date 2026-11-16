/**
 * Daily YouTube refresh-token check (run by .github/workflows/youtube-token-check.yml).
 *  - exchanges the refresh token for an access token at Google's token endpoint (no YouTube quota,
 *    nothing uploaded, nothing published);
 *  - records only a fingerprint + dates in settings['youtube.oauth_status'] (never the token);
 *  - exits 1 (GitHub marks the run failed and notifies the owner) from 2 days before the 7-day
 *    Testing-mode expiry, or when Google rejects the token. Reauthorisation: docs/YOUTUBE-REAUTH.md.
 * Optional: YT_TOKEN_ISSUED_AT (ISO time the owner created the token), YT_OAUTH_APP_STATUS=production.
 */
import { appendFileSync } from "node:fs";
import { recordQuota } from "../src/core/ops";
import { closeDb } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { YouTube, YouTubeApiError } from "../src/server/youtube/client";
import { cleanSecret, explainTokenError } from "../src/server/youtube/oauth-diagnostics";
import { ytConfigFromEnv } from "../src/server/youtube/publish";
import { appStatusFromEnv, assess, noteToken, ownerMessage } from "../src/server/youtube/token-status";

const WARN_DAYS = Number(process.env.YT_TOKEN_WARN_DAYS ?? 2);

function summary(lines: string[]) {
  for (const l of lines) console.log(l);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

async function main() {
  workerEnv();
  const refresh = cleanSecret(process.env.YT_REFRESH_TOKEN);
  if (!refresh) {
    summary(["YouTube token check: YT_REFRESH_TOKEN is not set — nothing to check (see docs/SETUP.md)."]);
    return;
  }
  const issuedRaw = cleanSecret(process.env.YT_TOKEN_ISSUED_AT);
  const issuedAt = issuedRaw ? new Date(issuedRaw) : undefined;

  let result = "ok";
  let errMsg = "";
  try {
    await new YouTube(ytConfigFromEnv(), { access_token: "", refresh_token: refresh, expires_at: 0 }).refreshNow();
  } catch (e) {
    result = e instanceof YouTubeApiError ? e.reason : "error";
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const status = await noteToken(refresh, { issuedAt, appStatus: appStatusFromEnv(process.env), result });
  const a = assess(status, new Date(), WARN_DAYS);
  await recordQuota("gha.minutes", "month", 1, 1_000_000).catch(() => {});

  summary([
    "### YouTube token check (no secret values shown)",
    `- token refresh: ${result === "ok" ? "OK" : `FAIL — ${errMsg}`}`,
    ...(result !== "ok" ? [`- meaning: ${explainTokenError(result)}`] : []),
    `- app status: ${a.app_status}`,
    `- token issued (${status.issued_at_source === "owner" ? "as given by owner" : "first seen by a check"}): ${a.issued_at}`,
    `- expires (estimate): ${a.expires_at ?? "no 7-day limit"}${a.days_left !== null ? ` — ${a.days_left} days left` : ""}`,
    `- level: ${a.level.toUpperCase()}`,
    "",
    ownerMessage(a),
  ]);
  if (a.level === "warn" || a.level === "expired") {
    summary(["", "Reauthorise: docs/YOUTUBE-REAUTH.md"]);
    process.exitCode = 1; // a failed run makes GitHub notify the owner
  }
}

main()
  .catch((e) => {
    console.error("youtube-token-check failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
