import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * One in-process fake for the official endpoints the trend connectors call: YouTube Data API
 * (+ Google token), TikTok Display API v2, Facebook Graph API, MediaWiki search + Wikimedia
 * pageviews. Every request is recorded so tests can assert auth placement and what was NOT called.
 */
export async function startFakePlatforms() {
  const calls: { method: string; path: string; query: Record<string, string>; auth?: string; body: string }[] = [];
  const state = { ytFail: false, tiktokRotate: "rt-rotated", tiktokRefreshUsed: [] as string[] };
  const now = Date.now();
  const iso = (hAgo: number) => new Date(now - hAgo * 3600_000).toISOString();
  const vid = (id: string, title: string, views: number, hAgo: number) => ({
    id, snippet: { title, channelTitle: "قناة", channelId: "UCx", publishedAt: iso(hAgo) },
    statistics: { viewCount: String(views), likeCount: "10", commentCount: "2" }, contentDetails: { duration: "PT1M5S" },
  });
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url ?? "/", "http://x");
    const query = Object.fromEntries(url.searchParams.entries());
    calls.push({ method: req.method ?? "GET", path: url.pathname, query, auth: req.headers.authorization, body });
    const json = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const p = url.pathname;
    // Google OAuth
    if (p === "/token") return json(200, { access_token: "at-yt" });
    // YouTube
    if (p.startsWith("/youtube/v3/")) {
      if (state.ytFail) return json(500, { error: { message: "backend" } });
      if (!req.headers["x-goog-api-key"] && req.headers.authorization !== "Bearer at-yt") return json(403, { error: { message: "no auth" } });
      if (query.key) return json(400, { error: { message: "API key must not be in the URL" } });
      if (p.endsWith("/videos") && query.chart === "mostPopular") return json(200, { items: [vid(`pop-${query.regionCode}`, `رائج ${query.regionCode}`, 100000, 10)] });
      if (p.endsWith("/search")) return json(200, { items: [{ id: { videoId: "s1" } }, { id: { videoId: "s2" } }] });
      if (p.endsWith("/videos")) return json(200, { items: String(query.id).split(",").map((id, i) => vid(id, `فيديو ${id}`, 5000 * (i + 1), 2 + i * 40)) });
      if (p.endsWith("/channels")) return json(200, { items: [{ id: "UCcomp", snippet: { title: "منافس" }, statistics: { subscriberCount: "1200", viewCount: "99000", videoCount: "40" }, contentDetails: { relatedPlaylists: { uploads: "UUcomp" } } }] });
      if (p.endsWith("/playlistItems")) return json(200, { items: [{ contentDetails: { videoId: "c1" } }] });
    }
    // TikTok
    if (p === "/v2/oauth/token/") {
      state.tiktokRefreshUsed.push(new URLSearchParams(body).get("refresh_token") ?? "");
      return json(200, { access_token: "tt-at", refresh_token: state.tiktokRotate, scope: "user.info.basic,user.info.stats,video.list" });
    }
    if (p === "/v2/user/info/") return json(200, { data: { user: { open_id: "oid1", display_name: "حسابي", follower_count: 321, likes_count: 900, video_count: 12 } } });
    if (p === "/v2/video/list/") return json(200, { data: { videos: [{ id: "tt1", title: "أول فيديو", create_time: Math.floor(now / 1000) - 7200, share_url: "https://www.tiktok.com/@x/video/tt1", view_count: 4000, like_count: 300, comment_count: 20, share_count: 5, duration: 30 }] } });
    // Facebook Graph
    const fb = /^\/v[\d.]+\/([^/]+)(\/posts)?$/.exec(p);
    if (fb) {
      if (req.headers.authorization !== "Bearer fb-page-token") return json(401, { error: { message: "invalid token" } });
      if (fb[2]) return json(200, { data: [{ id: `${fb[1]}_p1`, message: "منشور تجريبي", created_time: iso(5), permalink_url: `https://facebook.com/${fb[1]}/posts/1`, shares: { count: 3 }, reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 7 } } }] });
      return json(200, { id: fb[1], name: "صفحتي", fan_count: 500, followers_count: 650, link: `https://facebook.com/${fb[1]}` });
    }
    // Wikipedia
    if (p === "/w/api.php") return json(200, { query: { search: query.srsearch === "لا شيء" ? [] : [{ title: `${query.srsearch} (مقال)` }] } });
    if (p.startsWith("/metrics/pageviews/per-article/")) {
      return json(200, { items: Array.from({ length: 14 }, (_, i) => ({ timestamp: String(i), views: i < 7 ? 100 : 150 })) });
    }
    json(404, { error: { message: `fake: no route ${p}` } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}
