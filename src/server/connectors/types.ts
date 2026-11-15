/**
 * Trend Intelligence connectors. Each platform connector uses ONLY official APIs (or public open
 * data) with the least privilege available, never passwords, never scraping. When an API does not
 * allow a kind of data, the connector reports it as "skipped" with the reason instead of working
 * around it.
 */
export type Platform = "youtube" | "tiktok" | "facebook" | "wikipedia";

export type TrendKind =
  | "trending_video"
  | "search_video"
  | "competitor_video"
  | "competitor_channel"
  | "own_video"
  | "own_account"
  | "own_post"
  | "own_page"
  | "competitor_post"
  | "interest";

export type TrendItem = {
  platform: Platform;
  kind: TrendKind;
  external_id: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  author_id?: string | null;
  published_at?: string | null;
  metrics: Record<string, number>;
  keyword?: string | null;
  region?: string | null;
  source: string; // exact API endpoint (no query secrets)
};

export type Competitor = { platform: "youtube" | "tiktok" | "facebook"; external_id: string; name: string | null };

export type ConnectorContext = {
  channelId: string;
  keywords: string[];
  regions: string[];
  language: string;
  competitors: Competitor[];
  env: NodeJS.ProcessEnv;
};

export type ConnectorResult = {
  status: "ok" | "partial" | "skipped" | "error";
  items: TrendItem[];
  detail: string;
};

export interface TrendConnector {
  platform: Platform;
  collect(ctx: ConnectorContext): Promise<ConnectorResult>;
}

export const UA = "youtube-ai-studio/1.0 (open-source channel tool)";

export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!r.ok) {
    const b = body as { error?: { message?: string } | string; message?: string };
    const msg = typeof b.error === "string" ? b.error : (b.error?.message ?? b.message ?? `HTTP ${r.status}`);
    throw new ConnectorHttpError(r.status, msg);
  }
  return body as T;
}

export class ConnectorHttpError extends Error {
  constructor(public status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
  }
}

export const n = (v: unknown): number => (v === undefined || v === null || v === "" ? 0 : Number(v));
