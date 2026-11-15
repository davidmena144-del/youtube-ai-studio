import { getSecret, putSecret } from "../security/secrets-store";
import { getJson, n, type ConnectorContext, type ConnectorResult, type TrendConnector, type TrendItem } from "./types";

/**
 * TikTok — official Display API v2 (Login Kit OAuth), least-privilege scopes:
 *   user.info.basic, user.info.stats, video.list   (no posting scope, no password)
 * What the official API allows for a commercial channel:
 *   ✔ the connected account's own profile stats and own videos' metrics
 *   ✘ public trends, hashtags, or other accounts' videos: only the Research API offers that, and it
 *     is restricted to approved academic / non-profit researchers (commercial use excluded).
 * So TikTok trend data is NOT collected; the cross-platform trend signal comes from the YouTube and
 * Wikimedia connectors. Competitor entries for TikTok are reported as unsupported.
 * Token rotation: TikTok may return a new refresh token; it is stored ENCRYPTED in the database
 * (encrypted_secrets "tiktok.oauth") and preferred over the TIKTOK_REFRESH_TOKEN secret afterwards.
 */
const SECRET = "tiktok.oauth";

export function tiktokConnector(opts: { base?: string; store?: boolean } = {}): TrendConnector {
  return {
    platform: "tiktok",
    async collect(ctx: ConnectorContext): Promise<ConnectorResult> {
      const base = opts.base ?? ctx.env.TIKTOK_API_BASE ?? "https://open.tiktokapis.com";
      const { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret } = ctx.env;
      const unsupported = ctx.competitors.some((c) => c.platform === "tiktok")
        ? "; TikTok competitor/trend data unavailable via official API for commercial use (Research API is academic-only)"
        : "";
      const store = opts.store ?? Boolean(ctx.env.ENCRYPTION_KEY);
      const stored = store ? await getSecret(SECRET).catch(() => null) : null;
      const refresh = stored ?? ctx.env.TIKTOK_REFRESH_TOKEN;
      if (!key || !secret || !refresh) {
        return { status: "skipped", items: [], detail: `not configured: TikTok app (client key/secret) + Login Kit refresh token required${unsupported}` };
      }
      const tok = await getJson<{ access_token: string; refresh_token?: string; scope?: string }>(`${base}/v2/oauth/token/`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh }),
      });
      if (store && tok.refresh_token && tok.refresh_token !== refresh) await putSecret(SECRET, tok.refresh_token);
      const auth = { authorization: `Bearer ${tok.access_token}` };
      const items: TrendItem[] = [];
      const u = await getJson<{ data: { user: { open_id: string; display_name?: string; follower_count?: number; likes_count?: number; video_count?: number } } }>(
        `${base}/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count`, { headers: auth });
      const user = u.data.user;
      items.push({
        platform: "tiktok", kind: "own_account", external_id: user.open_id, title: user.display_name ?? null, author: user.display_name ?? null,
        metrics: { followers: n(user.follower_count), likes: n(user.likes_count), videos: n(user.video_count) }, source: "tiktok/v2/user/info",
      });
      const v = await getJson<{ data: { videos: { id: string; title?: string; video_description?: string; create_time?: number; share_url?: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number; duration?: number }[] } }>(
        `${base}/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count,duration`,
        { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ max_count: 20 }) });
      for (const x of v.data.videos ?? []) {
        items.push({
          platform: "tiktok", kind: "own_video", external_id: x.id, title: x.title || x.video_description?.slice(0, 120) || null, url: x.share_url ?? null,
          author: user.display_name ?? null, author_id: user.open_id,
          published_at: x.create_time ? new Date(x.create_time * 1000).toISOString() : null,
          metrics: { views: n(x.view_count), likes: n(x.like_count), comments: n(x.comment_count), shares: n(x.share_count), duration_s: n(x.duration) },
          source: "tiktok/v2/video/list",
        });
      }
      return { status: unsupported ? "partial" : "ok", items, detail: `own account only (official API scope)${unsupported}` };
    },
  };
}
