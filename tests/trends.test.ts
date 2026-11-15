import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "@/cli/studio";
import { one, rows, sql } from "@/server/db/client";
import { buildContext, collectTrends } from "@/server/connectors/collect";
import { facebookConnector } from "@/server/connectors/facebook";
import { tiktokConnector } from "@/server/connectors/tiktok";
import type { TrendConnector } from "@/server/connectors/types";
import { wikipediaConnector } from "@/server/connectors/wikipedia";
import { youtubeConnector, isoDurationSeconds } from "@/server/connectors/youtube";
import { getSecret } from "@/server/security/secrets-store";
import { startFakePlatforms } from "./helpers/fake-platforms";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
let fake: Awaited<ReturnType<typeof startFakePlatforms>>;
let channelId: string;
const cli = (...a: string[]) => runCli(a);

beforeEach(async () => {
  t = await useTestDb();
  fake = await startFakePlatforms();
  await cli("channel", "init", "--title", "قناة العلوم", "--tz", "Africa/Cairo");
  channelId = (await one<{ id: string }>(sql`SELECT id FROM channels LIMIT 1`))!.id;
  await one(sql`SELECT app.set_strategy(${channelId}::uuid, ${JSON.stringify({ pillars: ["النوم"], keywords: ["الأحلام"], regions: ["EG", "SA"] })}::jsonb, 'test') AS v`);
});
afterEach(async () => {
  await fake.close();
  await t.close();
});

const baseEnv = (extra: Record<string, string> = {}) =>
  ({ ...process.env, YT_API_BASE: fake.base, YT_OAUTH_BASE: fake.base, TIKTOK_API_BASE: fake.base, FB_GRAPH_BASE: fake.base, ...extra }) as NodeJS.ProcessEnv;
const ctx = async (env: NodeJS.ProcessEnv) => buildContext(channelId, env);
const wiki = () => wikipediaConnector({ wikiBase: fake.base, restBase: fake.base });

describe("YouTube connector (Data API v3, public data)", () => {
  it("collects most-popular per region, niche searches and competitors with source; meters quota", async () => {
    await cli("competitor", "add", "--platform", "youtube", "--id", "UCcomp", "--name", "منافس");
    const r = await youtubeConnector().collect(await ctx(baseEnv({ YT_API_KEY: "k-public" })));
    expect(r.status).toBe("ok");
    const kinds = r.items.map((i) => i.kind);
    expect(kinds.filter((k) => k === "trending_video")).toHaveLength(2); // EG + SA
    expect(kinds).toContain("search_video");
    expect(kinds).toContain("competitor_channel");
    expect(kinds).toContain("competitor_video");
    expect(r.items.every((i) => i.source.startsWith("youtube/v3/"))).toBe(true);
    expect(r.items.find((i) => i.kind === "search_video")).toMatchObject({ keyword: "الأحلام", metrics: { duration_s: 65 } });
    const used = await one<{ used: string }>(sql`SELECT used FROM quota_ledger WHERE provider = 'youtube.trends'`);
    expect(Number(used!.used)).toBe(2 + 101 * 2 + 1 + 2); // regions + 2 keyword searches + channels + uploads
  });

  it("stops at its own daily budget (uploads keep their quota) and reports partial", async () => {
    const r = await youtubeConnector().collect(await ctx(baseEnv({ YT_API_KEY: "k", TRENDS_YT_UNITS_PER_DAY: "50" })));
    expect(r.status).toBe("partial");
    expect(r.items.some((i) => i.kind === "search_video")).toBe(false);
    expect(fake.calls.some((c) => c.path.endsWith("/search"))).toBe(false);
  });

  it("without an API key falls back to the channel OAuth token (Bearer header); unconfigured → skipped", async () => {
    const r = await youtubeConnector().collect(await ctx(baseEnv({ YT_API_KEY: "", YT_REFRESH_TOKEN: "rt", YT_CLIENT_ID: "c", YT_CLIENT_SECRET: "s" })));
    expect(r.status).toBe("ok");
    expect(fake.calls.filter((c) => c.path.startsWith("/youtube/")).every((c) => c.auth === "Bearer at-yt" && !c.query.key)).toBe(true);
    expect(fake.calls.every((c) => !JSON.stringify(c.query).includes("k-public"))).toBe(true);
    const none = await youtubeConnector().collect(await ctx(baseEnv({ YT_API_KEY: "", YT_REFRESH_TOKEN: "" })));
    expect(none.status).toBe("skipped");
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
  });
});

describe("TikTok connector (Display API v2, own account only)", () => {
  it("unconfigured → skipped with the reason; competitors explained as unsupported", async () => {
    await cli("competitor", "add", "--platform", "tiktok", "--id", "@rival");
    const r = await tiktokConnector({ store: false }).collect(await ctx(baseEnv({ TIKTOK_CLIENT_KEY: "", TIKTOK_REFRESH_TOKEN: "" })));
    expect(r.status).toBe("skipped");
    expect(r.detail).toMatch(/Research API is academic-only/);
  });

  it("collects own profile + videos; a rotated refresh token is stored encrypted, then preferred", async () => {
    const env = baseEnv({ TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs", TIKTOK_REFRESH_TOKEN: "rt-initial" });
    const r = await tiktokConnector({ store: true }).collect(await ctx(env));
    expect(r.status).toBe("ok");
    expect(r.items.map((i) => i.kind)).toEqual(["own_account", "own_video"]);
    expect(r.items[1]).toMatchObject({ metrics: { views: 4000, shares: 5 }, source: "tiktok/v2/video/list" });
    expect(await getSecret("tiktok.oauth")).toBe("rt-rotated");
    const raw = await one<{ ciphertext: string }>(sql`SELECT ciphertext FROM encrypted_secrets WHERE name = 'tiktok.oauth'`);
    expect(raw!.ciphertext).not.toContain("rt-rotated"); // encrypted at rest
    await tiktokConnector({ store: true }).collect(await ctx(env));
    expect(fake.state.tiktokRefreshUsed).toEqual(["rt-initial", "rt-rotated"]);
    expect(fake.calls.filter((c) => c.path.startsWith("/v2/")).every((c) => !JSON.stringify(c.query).includes("tt-at"))).toBe(true);
  });
});

describe("Facebook connector (Graph API, own Page)", () => {
  it("reads own Page + posts with the token in the header; competitor Pages NOT requested without PPCA", async () => {
    await cli("competitor", "add", "--platform", "facebook", "--id", "rivalpage", "--name", "منافس");
    const env = baseEnv({ FB_PAGE_ID: "mypage", FB_PAGE_TOKEN: "fb-page-token" });
    const r = await facebookConnector().collect(await ctx(env));
    expect(r.status).toBe("partial");
    expect(r.detail).toMatch(/Page Public Content Access/);
    expect(r.items.map((i) => i.kind)).toEqual(["own_page", "own_post"]);
    expect(r.items[1].metrics).toEqual({ reactions: 40, comments: 7, shares: 3 });
    expect(fake.calls.some((c) => c.path.includes("rivalpage"))).toBe(false);
    expect(fake.calls.every((c) => !c.query.access_token)).toBe(true);
  });

  it("with PPCA approved, competitor public posts are collected", async () => {
    await cli("competitor", "add", "--platform", "facebook", "--id", "rivalpage", "--name", "منافس");
    const r = await facebookConnector().collect(await ctx(baseEnv({ FB_PAGE_ID: "mypage", FB_PAGE_TOKEN: "fb-page-token", FB_PPCA_APPROVED: "true" })));
    expect(r.status).toBe("ok");
    expect(r.items.filter((i) => i.kind === "competitor_post")).toHaveLength(1);
  });
});

describe("collection, storage and the Trend Intelligence summary", () => {
  it("stores normalised items with source and date, isolates failures, dedupes per day, logs every connector", async () => {
    const env = baseEnv({ YT_API_KEY: "k", FB_PAGE_ID: "mypage", FB_PAGE_TOKEN: "fb-page-token" });
    const boom: TrendConnector = { platform: "tiktok", collect: async () => { throw new Error("network down"); } };
    const s1 = await collectTrends(channelId, [youtubeConnector(), boom, facebookConnector(), wiki()], env);
    expect(s1.tiktok.status).toBe("error");
    expect(s1.youtube.status).toBe("ok");
    expect(s1.facebook.status).toBe("ok");
    expect(s1.wikipedia.items).toBe(2); // النوم + الأحلام
    const n1 = (await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM trend_items`))!.n;
    await collectTrends(channelId, [youtubeConnector(), facebookConnector(), wiki()], env);
    const n2 = (await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM trend_items`))!.n;
    expect(n2).toBe(n1); // same day: updated, not duplicated
    const sample = await one<{ source: string; observed_on: string }>(sql`SELECT source, observed_on::text FROM trend_items WHERE platform = 'facebook' LIMIT 1`);
    expect(sample!.source).toMatch(/^graph\//);
    expect(sample!.observed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await rows(sql`SELECT 1 FROM connector_runs`)).length).toBe(7);

    const sum = (await cli("trends", "summary")).output.trends as {
      videos: { views_per_hour: number }[]; interest: { metrics: { growth: number } }[]; own: unknown[]; connectors: Record<string, { status: string }>;
    };
    const vph = sum.videos.map((v) => v.views_per_hour);
    expect(vph).toEqual([...vph].sort((a, b) => b - a)); // fastest-moving first
    expect(sum.interest[0].metrics.growth).toBe(0.5);
    expect(sum.own.length).toBeGreaterThan(0);
    expect(sum.connectors.tiktok.status).toBe("error");
    expect(sum.connectors.youtube.status).toBe("ok");
  });

  it("trends.collect job is enqueued once per day; competitor list via CLI", async () => {
    const a = await cli("trends", "collect");
    const b = await cli("trends", "collect");
    expect(a.output.jobId).toBe(b.output.jobId);
    await cli("competitor", "add", "--platform", "youtube", "--id", "UC1", "--name", "أ");
    await cli("competitor", "add", "--platform", "youtube", "--id", "UC1", "--name", "أ٢");
    expect((await cli("competitor", "list")).output.competitors).toHaveLength(1);
    expect((await cli("competitor", "add", "--platform", "instagram", "--id", "x")).code).toBe(1);
  });

  it("no platform token is ever written to trend_items or connector_runs", async () => {
    const env = baseEnv({ YT_API_KEY: "k-secret-123", FB_PAGE_ID: "mypage", FB_PAGE_TOKEN: "fb-page-token", TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs-secret", TIKTOK_REFRESH_TOKEN: "rt-initial" });
    await collectTrends(channelId, [youtubeConnector(), tiktokConnector({ store: false }), facebookConnector(), wiki()], env);
    const dump = JSON.stringify(await rows(sql`SELECT * FROM trend_items`)) + JSON.stringify(await rows(sql`SELECT * FROM connector_runs`));
    for (const secret of ["k-secret-123", "fb-page-token", "cs-secret", "rt-initial", "tt-at", "at-yt"]) expect(dump).not.toContain(secret);
  });
});
