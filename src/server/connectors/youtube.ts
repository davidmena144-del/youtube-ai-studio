import { recordQuota } from "../../core/ops";
import { getJson, n, type ConnectorContext, type ConnectorResult, type TrendConnector, type TrendItem } from "./types";
import { cleanSecret } from "../youtube/oauth-diagnostics";

/**
 * YouTube Data API v3 — public data only (free; 10,000 units/day shared with uploads).
 *  - most popular videos per region (videos.list chart=mostPopular, 1 unit)
 *  - recent high-view videos for the niche keywords (search.list, 100 units; capped per day)
 *  - competitor channels: stats + latest uploads (channels/playlistItems/videos.list, 1 unit each)
 * Auth (least privilege first): an API key (YT_API_KEY, public data only) or, if absent, the
 * channel's OAuth token (YT_REFRESH_TOKEN + client id/secret). No passwords, no scraping.
 * Trend calls are capped by their own daily budget (youtube.trends) so uploads always keep quota.
 */
type YtVideo = {
  id: string;
  snippet?: { title?: string; channelTitle?: string; channelId?: string; publishedAt?: string; categoryId?: string; defaultAudioLanguage?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

export function isoDurationSeconds(d?: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export function youtubeConnector(opts: { base?: string; oauthBase?: string } = {}): TrendConnector {
  return {
    platform: "youtube",
    async collect(ctx: ConnectorContext): Promise<ConnectorResult> {
      const base = opts.base ?? ctx.env.YT_API_BASE ?? "https://www.googleapis.com";
      const auth = await resolveAuth(ctx, opts.oauthBase);
      if (!auth) return { status: "skipped", items: [], detail: "not configured: set YT_API_KEY (public data) or connect YouTube OAuth" };
      const budget = Number(ctx.env.TRENDS_YT_UNITS_PER_DAY ?? 1200);
      const spend = async (units: number) => {
        const t = await recordQuota("youtube.trends", "day", units, budget, "America/Los_Angeles");
        if (!t.allowed) return false;
        const all = await recordQuota("youtube.data", "day", units, 10_000, "America/Los_Angeles");
        return all.allowed;
      };
      const call = <T>(path: string, params: Record<string, string>) => {
        const qs = new URLSearchParams(params);
        // credentials in headers only (never in URLs that could end up in logs)
        const headers: Record<string, string> = auth.key ? { "x-goog-api-key": auth.key } : { authorization: `Bearer ${auth.bearer}` };
        return getJson<T>(`${base}/youtube/v3/${path}?${qs}`, { headers });
      };
      const toItem = (v: YtVideo, kind: TrendItem["kind"], source: string, extra: Partial<TrendItem> = {}): TrendItem => ({
        platform: "youtube",
        kind,
        external_id: v.id,
        title: v.snippet?.title ?? null,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        author: v.snippet?.channelTitle ?? null,
        author_id: v.snippet?.channelId ?? null,
        published_at: v.snippet?.publishedAt ?? null,
        metrics: { views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount), duration_s: isoDurationSeconds(v.contentDetails?.duration) },
        source,
        ...extra,
      });

      const items: TrendItem[] = [];
      const notes: string[] = [];
      // 1) most popular per region (cheap)
      for (const region of ctx.regions.slice(0, 3)) {
        if (!(await spend(1))) { notes.push("daily trend budget reached"); break; }
        const r = await call<{ items: YtVideo[] }>("videos", { part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: region, maxResults: "25" });
        items.push(...(r.items ?? []).map((v) => toItem(v, "trending_video", "youtube/v3/videos?chart=mostPopular", { region })));
      }
      // 2) niche keywords: recent videos ordered by views (expensive: 100 units each)
      const after = new Date(Date.now() - 7 * 86400_000).toISOString();
      for (const kw of ctx.keywords.slice(0, Number(ctx.env.TRENDS_YT_MAX_SEARCHES ?? 3))) {
        if (!(await spend(101))) { notes.push("search skipped: daily trend budget reached"); break; }
        const s = await call<{ items: { id: { videoId?: string } }[] }>("search", {
          part: "id", type: "video", order: "viewCount", publishedAfter: after, q: kw, relevanceLanguage: ctx.language, maxResults: "15",
        });
        const ids = (s.items ?? []).map((i) => i.id.videoId).filter((x): x is string => Boolean(x));
        if (!ids.length) continue;
        const v = await call<{ items: YtVideo[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
        items.push(...(v.items ?? []).map((x) => toItem(x, "search_video", "youtube/v3/search?order=viewCount", { keyword: kw })));
      }
      // 3) competitors: channel stats + latest uploads
      const comp = ctx.competitors.filter((c) => c.platform === "youtube").slice(0, 10);
      if (comp.length && (await spend(1))) {
        const ch = await call<{ items: { id: string; snippet: { title: string }; statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
          "channels", { part: "snippet,statistics,contentDetails", id: comp.map((c) => c.external_id).join(",") });
        for (const c of ch.items ?? []) {
          items.push({
            platform: "youtube", kind: "competitor_channel", external_id: c.id, title: c.snippet.title, url: `https://www.youtube.com/channel/${c.id}`,
            author: c.snippet.title, author_id: c.id,
            metrics: { subscribers: n(c.statistics.subscriberCount), views: n(c.statistics.viewCount), videos: n(c.statistics.videoCount) },
            source: "youtube/v3/channels",
          });
          if (!(await spend(2))) { notes.push("competitor uploads skipped: budget"); break; }
          const pl = await call<{ items: { contentDetails: { videoId: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: "10" });
          const ids = (pl.items ?? []).map((i) => i.contentDetails.videoId);
          if (ids.length) {
            const v = await call<{ items: YtVideo[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
            items.push(...(v.items ?? []).map((x) => toItem(x, "competitor_video", "youtube/v3/playlistItems+videos")));
          }
        }
      }
      return { status: notes.length ? "partial" : "ok", items, detail: notes.join("; ") || `auth=${auth.key ? "api_key" : "oauth"}` };
    },
  };
}

async function resolveAuth(ctx: ConnectorContext, oauthBase?: string): Promise<{ key?: string; bearer?: string } | null> {
  const apiKey = cleanSecret(ctx.env.YT_API_KEY);
  if (apiKey) return { key: apiKey };
  const [rt, id, secret] = [ctx.env.YT_REFRESH_TOKEN, ctx.env.YT_CLIENT_ID, ctx.env.YT_CLIENT_SECRET].map(cleanSecret);
  if (!rt || !id || !secret) return null;
  const r = await getJson<{ access_token: string }>(`${oauthBase ?? ctx.env.YT_OAUTH_BASE ?? "https://oauth2.googleapis.com"}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: rt, grant_type: "refresh_token" }),
  });
  return { bearer: r.access_token };
}
