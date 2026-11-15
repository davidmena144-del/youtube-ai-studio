import { getJson, n, type ConnectorContext, type ConnectorResult, type TrendConnector, type TrendItem } from "./types";

/**
 * Facebook — official Graph API with a Page access token for a Page the owner manages
 * (permissions: pages_show_list, pages_read_engagement; no publishing permission, no password).
 *   ✔ own Page: followers + recent posts with reactions/comments/shares
 *   ✘ other Pages' public posts: requires Meta's "Page Public Content Access" feature (App Review +
 *     Business Verification). Only requested when FB_PPCA_APPROVED=true; otherwise reported as skipped.
 *   ✘ CrowdTangle is shut down; the Meta Content Library is for academic/non-profit researchers only.
 * The token travels in the Authorization header (never in URLs or logs).
 */
type Post = { id: string; message?: string; created_time?: string; permalink_url?: string; shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };

const POST_FIELDS = "id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";

export function facebookConnector(opts: { base?: string } = {}): TrendConnector {
  return {
    platform: "facebook",
    async collect(ctx: ConnectorContext): Promise<ConnectorResult> {
      const version = ctx.env.FB_GRAPH_VERSION ?? "v23.0";
      const base = `${opts.base ?? ctx.env.FB_GRAPH_BASE ?? "https://graph.facebook.com"}/${version}`;
      const { FB_PAGE_ID: pageId, FB_PAGE_TOKEN: token } = ctx.env;
      const competitors = ctx.competitors.filter((c) => c.platform === "facebook");
      if (!pageId || !token) return { status: "skipped", items: [], detail: "not configured: FB_PAGE_ID + FB_PAGE_TOKEN (Graph API Explorer page token)" };
      const auth = { headers: { authorization: `Bearer ${token}` } };
      const toPost = (p: Post, kind: TrendItem["kind"], author: string | null, authorId: string): TrendItem => ({
        platform: "facebook", kind, external_id: p.id, title: (p.message ?? "").slice(0, 140) || null, url: p.permalink_url ?? null,
        author, author_id: authorId, published_at: p.created_time ?? null,
        metrics: { reactions: n(p.reactions?.summary?.total_count), comments: n(p.comments?.summary?.total_count), shares: n(p.shares?.count) },
        source: kind === "own_post" ? "graph/{page}/posts" : "graph/{public-page}/posts (PPCA)",
      });
      const items: TrendItem[] = [];
      const page = await getJson<{ id: string; name?: string; fan_count?: number; followers_count?: number; link?: string }>(
        `${base}/${encodeURIComponent(pageId)}?fields=id,name,fan_count,followers_count,link`, auth);
      items.push({ platform: "facebook", kind: "own_page", external_id: page.id, title: page.name ?? null, url: page.link ?? null, author: page.name ?? null, author_id: page.id,
        metrics: { followers: n(page.followers_count), fans: n(page.fan_count) }, source: "graph/{page}" });
      const posts = await getJson<{ data: Post[] }>(`${base}/${encodeURIComponent(pageId)}/posts?fields=${POST_FIELDS}&limit=25`, auth);
      items.push(...(posts.data ?? []).map((p) => toPost(p, "own_post", page.name ?? null, page.id)));

      const notes: string[] = [];
      if (competitors.length) {
        if (ctx.env.FB_PPCA_APPROVED === "true") {
          for (const c of competitors.slice(0, 10)) {
            const cp = await getJson<{ data: Post[] }>(`${base}/${encodeURIComponent(c.external_id)}/posts?fields=${POST_FIELDS}&limit=10`, auth);
            items.push(...(cp.data ?? []).map((p) => toPost(p, "competitor_post", c.name, c.external_id)));
          }
        } else {
          notes.push(`${competitors.length} competitor Page(s) not read: needs Meta "Page Public Content Access" approval`);
        }
      }
      return { status: notes.length ? "partial" : "ok", items, detail: notes.join("; ") || "own Page" };
    },
  };
}
