import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "@/cli/studio";
import { one, sql } from "@/server/db/client";
import { YouTube } from "@/server/youtube/client";
import { appStatusFromEnv, assess, noteToken, ownerMessage, readTokenStatus, tokenFingerprint, type TokenStatus } from "@/server/youtube/token-status";
import { startFakeYouTube } from "./helpers/fake-youtube";
import { useTestDb } from "./helpers/db";

const DAY = 86400_000;
const T0 = new Date("2026-11-16T12:40:00Z");
const st = (o: Partial<TokenStatus> = {}): TokenStatus => ({
  fingerprint: "f", issued_at: T0.toISOString(), issued_at_source: "owner", app_status: "testing", ...o,
});

describe("token expiry assessment (pure)", () => {
  it("Testing mode: ok → warn 2 days before day 7 → expired; Google rejection = expired; production never expires", () => {
    expect(assess(st(), new Date(T0.getTime() + 1 * DAY))).toMatchObject({ level: "ok", days_left: 6, expires_at: "2026-11-23T12:40:00.000Z" });
    expect(assess(st(), new Date(T0.getTime() + 5.5 * DAY))).toMatchObject({ level: "warn", days_left: 1.5 });
    expect(assess(st(), new Date(T0.getTime() + 7 * DAY + 1))).toMatchObject({ level: "expired" });
    expect(assess(st({ last_result: "invalid_grant" }), T0).level).toBe("expired");
    expect(assess(st({ app_status: "production" }), new Date(T0.getTime() + 300 * DAY))).toMatchObject({ level: "ok", expires_at: null, days_left: null });
    expect(assess(null, T0).level).toBe("unknown");
    expect(appStatusFromEnv({ YT_OAUTH_APP_STATUS: "Production" })).toBe("production");
    expect(appStatusFromEnv({})).toBe("testing");
    expect(ownerMessage(assess(st(), new Date(T0.getTime() + 5.5 * DAY)))).toMatch(/docs\/YOUTUBE-REAUTH\.md/);
  });
});

describe("token tracking in the database", () => {
  let t: Awaited<ReturnType<typeof useTestDb>>;
  beforeEach(async () => {
    t = await useTestDb();
  });
  afterEach(async () => {
    await t.client.exec("RESET ROLE");
    await t.close();
  });

  it("stores only a fingerprint; same token keeps its clock, a new token restarts it, owner time wins", async () => {
    const rt = "1//0gSECRET-refresh-token-value";
    const a = await noteToken(rt, { now: T0 });
    expect(a).toMatchObject({ fingerprint: tokenFingerprint(rt), issued_at: T0.toISOString(), issued_at_source: "first_seen" });
    const raw = JSON.stringify((await one<{ value: unknown }>(sql`SELECT value FROM settings WHERE key = 'youtube.oauth_status'`))!.value);
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain(rt);

    const later = new Date(T0.getTime() + 3 * DAY);
    expect((await noteToken(rt, { now: later, result: "ok" })).issued_at).toBe(T0.toISOString()); // same token
    const b = await noteToken("1//0gANOTHER-token", { now: later });
    expect(b.issued_at).toBe(later.toISOString()); // new token → new clock
    expect(b.last_result).toBeUndefined();
    const owner = new Date(later.getTime() - 3600_000);
    expect((await noteToken("1//0gANOTHER-token", { now: later, issuedAt: owner })).issued_at_source).toBe("owner");
    await expect(noteToken(rt, { now: T0, issuedAt: new Date(T0.getTime() + DAY) })).rejects.toThrow(/future/);
    expect((await readTokenStatus())!.issued_at).toBe(owner.toISOString());
  });

  it("SQL status matches the TS rules, is in the owner report, and is readable by the manager role", async () => {
    const none = (await runCli(["youtube", "token"])).output.youtubeToken as { level: string };
    expect(none.level).toBe("unknown");
    await runCli(["channel", "init", "--title", "c"]);
    const issued = new Date(Date.now() - 5.5 * DAY);
    await noteToken("1//0gTOKEN", { issuedAt: issued, now: new Date(), result: "ok" });
    await t.client.exec("SET ROLE app_manager");
    const s = (await runCli(["youtube", "token"])).output.youtubeToken as { level: string; days_left: number; how_to_fix: string };
    expect(s.level).toBe("warn");
    expect(s.days_left).toBeCloseTo(1.5, 0);
    expect(s.how_to_fix).toBe("docs/YOUTUBE-REAUTH.md");
    const report = (await runCli(["report"])).output.report as { youtube_token: { level: string } };
    expect(report.youtube_token.level).toBe("warn");
    await t.client.exec("RESET ROLE");
    await noteToken("1//0gTOKEN", { result: "invalid_grant" });
    expect(((await runCli(["youtube", "token"])).output.youtubeToken as { level: string }).level).toBe("expired");
  });

  it("refreshNow exchanges the token without calling any YouTube API (no quota)", async () => {
    const fake = await startFakeYouTube();
    try {
      const yt = new YouTube({ clientId: "cid", clientSecret: "cs", apiBase: fake.base, analyticsBase: fake.base, oauthBase: fake.base }, { access_token: "x", refresh_token: "rt", expires_at: Date.now() + DAY });
      await yt.refreshNow();
      expect(fake.state.tokenRefreshes).toBe(1); // forced even though the access token was still valid
      expect(await one(sql`SELECT 1 AS x FROM quota_ledger WHERE provider LIKE 'youtube%'`)).toBeFalsy();
    } finally {
      await fake.close();
    }
  });
});
