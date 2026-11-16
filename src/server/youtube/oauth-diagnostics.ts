/**
 * Secret-safe diagnostics for the YouTube OAuth link. Nothing here returns or logs a secret value:
 * findings are booleans/shapes only, plus the last 4 characters of the (public, non-secret) client
 * ID so the owner can tell which Google Cloud OAuth client the GitHub secrets point at.
 */

export type Finding = { ok: boolean; check: string; detail: string };

const CLIENT_ID_RE = /^(\d+)-([a-z0-9]+)\.apps\.googleusercontent\.com$/;

/** Removes whitespace and wrapping quotes that phone keyboards/copy-paste often add. */
export function cleanSecret(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function clientIdHint(clientId: string | undefined): string | null {
  const m = CLIENT_ID_RE.exec(cleanSecret(clientId) ?? "");
  return m ? `…${m[2].slice(-4)}.apps.googleusercontent.com` : null;
}

export function checkOAuthEnv(env: NodeJS.ProcessEnv): Finding[] {
  const out: Finding[] = [];
  const raw = { id: env.YT_CLIENT_ID, secret: env.YT_CLIENT_SECRET, rt: env.YT_REFRESH_TOKEN };
  for (const [name, v] of [["YT_CLIENT_ID", raw.id], ["YT_CLIENT_SECRET", raw.secret], ["YT_REFRESH_TOKEN", raw.rt]] as const) {
    if (!v) {
      out.push({ ok: false, check: `${name} present`, detail: "missing (empty secret)" });
      continue;
    }
    const cleaned = cleanSecret(v)!;
    out.push({
      ok: cleaned === v,
      check: `${name} has no extra spaces/quotes`,
      detail: cleaned === v ? "clean" : "had leading/trailing whitespace or quotes (ignored automatically)",
    });
  }
  const id = cleanSecret(raw.id);
  if (id) {
    const hint = clientIdHint(id);
    out.push({
      ok: Boolean(hint),
      check: "YT_CLIENT_ID looks like an OAuth client ID",
      detail: hint ? `ends with ${hint}` : "does not match <number>-<id>.apps.googleusercontent.com (Client ID and Client secret swapped?)",
    });
  }
  const secret = cleanSecret(raw.secret);
  if (secret) {
    const looksId = CLIENT_ID_RE.test(secret);
    out.push({
      ok: !looksId,
      check: "YT_CLIENT_SECRET is not a client ID",
      detail: looksId ? "YT_CLIENT_SECRET contains a client ID (secrets swapped?)" : secret.startsWith("GOCSPX-") ? "format GOCSPX-…" : "unusual format (older secrets may differ)",
    });
  }
  const rt = cleanSecret(raw.rt);
  if (rt) {
    const looksAccess = rt.startsWith("ya29.");
    out.push({
      ok: rt.startsWith("1//") && !looksAccess,
      check: "YT_REFRESH_TOKEN looks like a refresh token",
      detail: looksAccess
        ? "this is an ACCESS token (ya29.…, expires in 1 hour), not the Refresh token"
        : rt.startsWith("1//")
          ? "format 1//…"
          : "unexpected format (copied the authorization code or another field?)",
    });
  }
  return out;
}

/** Plain-language meaning of Google's token-endpoint errors for the refresh_token grant. */
export function explainTokenError(code: string): string {
  switch (code) {
    case "unauthorized_client":
      return (
        "Google accepted the Client ID + Client secret, but the refresh token was issued to a DIFFERENT OAuth client. " +
        "Almost always: OAuth Playground authorised with its own built-in client because 'Use your own OAuth credentials' " +
        "was not ticked (or not saved) before 'Authorize APIs'. Fix: re-authorise in Playground with that box ticked and the " +
        "same Client ID/secret; the Google consent screen must show YOUR app name, not 'Google OAuth 2.0 Playground'."
      );
    case "invalid_grant":
      return (
        "The refresh token is expired or revoked: the app is still in 'Testing' (tokens die after 7 days), access was " +
        "removed from the Google account, the password changed, or a newer token replaced it. Publish the app (Audience → " +
        "In production) and authorise again."
      );
    case "invalid_client":
      return "Google rejected the Client ID / Client secret pair: they do not belong together, or the client was deleted. Copy both again from the same OAuth client.";
    case "invalid_request":
      return "The token request was malformed: usually an empty or truncated secret.";
    default:
      return "Unexpected token error; see Google's error_description above.";
  }
}
