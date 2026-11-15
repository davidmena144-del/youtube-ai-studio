import { getJson, type ConnectorContext, type ConnectorResult, type TrendConnector, type TrendItem } from "./types";

/**
 * Public interest signal (open data, no key, no account): Wikimedia Pageviews API on the channel's
 * language Wikipedia. Each niche keyword is mapped to its best-matching article (MediaWiki search),
 * then last-7-days views are compared with the previous 7 days. Used because TikTok and Facebook
 * do not offer public trend data to commercial apps through their official APIs.
 */
export function wikipediaConnector(opts: { wikiBase?: string; restBase?: string; now?: () => Date } = {}): TrendConnector {
  return {
    platform: "wikipedia",
    async collect(ctx: ConnectorContext): Promise<ConnectorResult> {
      if (!ctx.keywords.length) return { status: "skipped", items: [], detail: "no niche keywords in the strategy yet" };
      const lang = /^[a-z]{2,3}$/.test(ctx.language) ? ctx.language : "ar"; // never let data choose the host
      const wiki = opts.wikiBase ?? `https://${lang}.wikipedia.org`;
      const rest = opts.restBase ?? "https://wikimedia.org/api/rest_v1";
      const now = (opts.now ?? (() => new Date()))();
      const day = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
      const end = new Date(now.getTime() - 86400_000);
      const start = new Date(end.getTime() - 13 * 86400_000);
      const items: TrendItem[] = [];
      const misses: string[] = [];
      for (const kw of ctx.keywords.slice(0, 10)) {
        const s = await getJson<{ query?: { search?: { title: string }[] } }>(
          `${wiki}/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(kw)}`);
        const title = s.query?.search?.[0]?.title;
        if (!title) { misses.push(kw); continue; }
        const article = encodeURIComponent(title.replaceAll(" ", "_"));
        const pv = await getJson<{ items?: { timestamp: string; views: number }[] }>(
          `${rest}/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${article}/daily/${day(start)}/${day(end)}`);
        const views = (pv.items ?? []).map((i) => i.views);
        const last7 = views.slice(-7).reduce((a, b) => a + b, 0);
        const prev7 = views.slice(-14, -7).reduce((a, b) => a + b, 0);
        items.push({
          platform: "wikipedia", kind: "interest", external_id: `${lang}:${title}`, title, url: `${wiki}/wiki/${article}`,
          metrics: { views_7d: last7, views_prev_7d: prev7, growth: prev7 ? Math.round(((last7 - prev7) / prev7) * 1000) / 1000 : 0 },
          keyword: kw, source: "wikimedia/pageviews/per-article",
        });
      }
      return { status: "ok", items, detail: misses.length ? `no article for: ${misses.join(", ")}` : `${items.length} topics` };
    },
  };
}
