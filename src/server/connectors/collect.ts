import { one, rows, sql } from "../db/client";
import { facebookConnector } from "./facebook";
import { tiktokConnector } from "./tiktok";
import type { Competitor, ConnectorContext, ConnectorResult, TrendConnector } from "./types";
import { wikipediaConnector } from "./wikipedia";
import { youtubeConnector } from "./youtube";

/**
 * Runs every connector for a channel, isolates failures (one platform failing never stops the
 * others), stores normalised items with source + date (app.put_trend) and logs each run in
 * connector_runs so the Trend Intelligence specialist can see what is missing and why.
 */
export function defaultConnectors(): TrendConnector[] {
  return [youtubeConnector(), tiktokConnector(), facebookConnector(), wikipediaConnector()];
}

export async function buildContext(channelId: string, env: NodeJS.ProcessEnv = process.env): Promise<ConnectorContext> {
  const ch = await one<{ language: string; niche: string | null }>(sql`SELECT language, niche FROM channels WHERE id = ${channelId}::uuid`);
  const st = await one<{ content: { keywords?: string[]; pillars?: string[]; regions?: string[] } }>(
    sql`SELECT content FROM strategies WHERE channel_id = ${channelId}::uuid AND active LIMIT 1`);
  const keywords = [...new Set([...(st?.content.keywords ?? []), ...(st?.content.pillars ?? []), ...(ch?.niche ? [ch.niche] : [])])].filter(Boolean);
  const competitors = await rows<Competitor>(sql`SELECT platform, external_id, name FROM competitors WHERE channel_id = ${channelId}::uuid AND active`);
  return { channelId, keywords, regions: st?.content.regions?.length ? st.content.regions : ["EG", "SA", "AE"], language: ch?.language ?? "ar", competitors, env };
}

export async function collectTrends(channelId: string, connectors: TrendConnector[] = defaultConnectors(), env: NodeJS.ProcessEnv = process.env) {
  const ctx = await buildContext(channelId, env);
  const summary: Record<string, { status: string; items: number; detail: string }> = {};
  for (const c of connectors) {
    const started = new Date();
    let res: ConnectorResult;
    try {
      res = await c.collect(ctx);
    } catch (e) {
      res = { status: "error", items: [], detail: (e as Error).message.slice(0, 400) };
    }
    for (const item of res.items) {
      await one(sql`SELECT app.put_trend(${channelId}::uuid, ${JSON.stringify(item)}::jsonb) AS id`);
    }
    await one(sql`INSERT INTO connector_runs (channel_id, platform, status, items, detail, started_at, finished_at)
      VALUES (${channelId}::uuid, ${c.platform}, ${res.status}, ${res.items.length}, ${res.detail}, ${started.toISOString()}::timestamptz, now()) RETURNING id`);
    summary[c.platform] = { status: res.status, items: res.items.length, detail: res.detail };
  }
  return summary;
}
