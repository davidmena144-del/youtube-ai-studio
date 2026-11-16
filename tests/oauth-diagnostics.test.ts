import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YouTube, YouTubeApiError } from "@/server/youtube/client";
import { checkOAuthEnv, cleanSecret, clientIdHint, explainTokenError } from "@/server/youtube/oauth-diagnostics";
import { youtubeFromStore, ytConfigFromEnv } from "@/server/youtube/publish";
import { useTestDb } from "./helpers/db";

const ID = "123456789012-abcdefghijklmnopqrstuv0123456789.apps.googleusercontent.com";
const SECRET = "GOCSPX-supersecretvalue_ABC123";
const RT = "1//0gREFRESHTOKENVALUE-xyz";

describe("OAuth pre-checks never reveal secrets", () => {
  it("clean secrets pass and the output contains no secret value, only the client-ID tail", () => {
    const f = checkOAuthEnv({ YT_CLIENT_ID: ID, YT_CLIENT_SECRET: SECRET, YT_REFRESH_TOKEN: RT });
    expect(f.every((x) => x.ok)).toBe(true);
    const dump = JSON.stringify(f);
    for (const s of [SECRET, RT, "supersecret", "REFRESHTOKEN"]) expect(dump).not.toContain(s);
    expect(dump).toContain("…6789.apps.googleusercontent.com");
    expect(dump).not.toContain("123456789012");
  });

  it("flags pasted whitespace/quotes, swapped id/secret, and an access token in place of the refresh token", () => {
    const f = checkOAuthEnv({ YT_CLIENT_ID: ` ${ID}\n`, YT_CLIENT_SECRET: ID, YT_REFRESH_TOKEN: "ya29.a0AccessToken" });
    const bad = f.filter((x) => !x.ok).map((x) => x.check);
    expect(bad).toContain("YT_CLIENT_ID has no extra spaces/quotes");
    expect(bad).toContain("YT_CLIENT_SECRET is not a client ID");
    expect(f.find((x) => x.check.startsWith("YT_REFRESH_TOKEN looks"))!.detail).toMatch(/ACCESS token/);
    expect(checkOAuthEnv({}).filter((x) => !x.ok)).toHaveLength(3);
  });

  it("cleanSecret strips whitespace and wrapping quotes; config and token use the cleaned values", async () => {
    expect(cleanSecret(`  "${RT}"\n`)).toBe(RT);
    expect(clientIdHint("not-an-id")).toBeNull();
    const cfg = ytConfigFromEnv({ YT_CLIENT_ID: `${ID}\n`, YT_CLIENT_SECRET: ` ${SECRET} ` });
    expect(cfg.clientId).toBe(ID);
    expect(cfg.clientSecret).toBe(SECRET);
    const yt = await youtubeFromStore(cfg, { YT_REFRESH_TOKEN: `${RT}\n` });
    expect((yt as unknown as { tokens: { refresh_token: string } }).tokens.refresh_token).toBe(RT);
  });

  it("explains each Google token error in plain language", () => {
    expect(explainTokenError("unauthorized_client")).toMatch(/different OAuth client.*Use your own OAuth credentials/is);
    expect(explainTokenError("invalid_grant")).toMatch(/Testing/);
    expect(explainTokenError("invalid_client")).toMatch(/do not belong together/);
  });
});

describe("token refresh errors carry Google's code and description", () => {
  let t: Awaited<ReturnType<typeof useTestDb>>;
  beforeEach(async () => {
    t = await useTestDb(); // API calls meter quota in the database
  });
  afterEach(async () => {
    await t.close();
  });
  it("unauthorized_client → YouTubeApiError with reason and error_description, no secret in the message", async () => {
    let body = "";
    const server = http.createServer(async (req, res) => {
      for await (const c of req) body += c;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized_client", error_description: "Unauthorized" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const yt = new YouTube({ clientId: ID, clientSecret: SECRET, oauthBase: base, apiBase: base }, { access_token: "", refresh_token: RT, expires_at: 0 });
      const err = await yt.myChannel().catch((e) => e);
      expect(err).toBeInstanceOf(YouTubeApiError);
      expect(err.reason).toBe("unauthorized_client");
      expect(err.message).toBe("token refresh failed: unauthorized_client (Unauthorized)");
      expect(err.message).not.toContain(SECRET);
      const sent = new URLSearchParams(body);
      expect(sent.get("grant_type")).toBe("refresh_token");
      expect(sent.get("client_id")).toBe(ID); // the same client the token must have been issued to
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
