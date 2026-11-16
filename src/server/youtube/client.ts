import { open, stat } from "node:fs/promises";
import { recordQuota } from "../../core/ops";

/**
 * YouTube Data API v3 + Analytics API v2 + Google OAuth (device flow), over plain fetch.
 * Free: the Data API's default quota is 10,000 units/day; every call is metered in quota_ledger
 * ("youtube.data", Pacific-time day, as Google resets it) and refused before the limit.
 * Base URLs are injectable so the whole flow is tested against a local fake server.
 */
export type YtConfig = {
  clientId: string;
  clientSecret: string;
  apiBase?: string; // https://www.googleapis.com
  analyticsBase?: string; // https://youtubeanalytics.googleapis.com
  oauthBase?: string; // https://oauth2.googleapis.com
  dailyQuota?: number;
};

export const SCOPES = [
  // youtube.force-ssl covers upload, thumbnails AND captions.insert (plain "youtube" is not accepted by captions.insert)
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

/** Quota costs (units) per Google's published table; conservative where it changed over time. */
export const COST = { insert: 1600, thumbnail: 50, caption: 400, list: 1 } as const;

export class QuotaExhaustedError extends Error {}
export class YouTubeApiError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
  get retryable() {
    return this.status >= 500 || this.status === 429 || ["backendError", "rateLimitExceeded", "quotaExceeded", "userRateLimitExceeded"].includes(this.reason);
  }
}

export type TokenSet = { access_token: string; refresh_token: string; expires_at: number };

export class YouTube {
  private api: string;
  private analytics: string;
  private oauth: string;
  constructor(
    private cfg: YtConfig,
    private tokens: TokenSet,
    private onTokens: (t: TokenSet) => Promise<void> = async () => {},
  ) {
    this.api = cfg.apiBase ?? "https://www.googleapis.com";
    this.analytics = cfg.analyticsBase ?? "https://youtubeanalytics.googleapis.com";
    this.oauth = cfg.oauthBase ?? "https://oauth2.googleapis.com";
  }

  // ------------------------------------------------------------------ auth
  /** Exchanges the refresh token for an access token (no YouTube quota is used). */
  async refreshNow(): Promise<void> {
    this.tokens = { ...this.tokens, expires_at: 0 };
    await this.accessToken();
  }

  private async accessToken(): Promise<string> {
    if (Date.now() < this.tokens.expires_at - 60_000) return this.tokens.access_token;
    const r = await fetch(`${this.oauth}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!r.ok || !j.access_token) {
      const why = j.error_description ? ` (${j.error_description})` : "";
      throw new YouTubeApiError(r.status, j.error ?? "auth", `token refresh failed: ${j.error ?? r.status}${why}`);
    }
    this.tokens = { ...this.tokens, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
    await this.onTokens(this.tokens);
    return this.tokens.access_token;
  }

  private async spend(units: number) {
    const q = await recordQuota("youtube.data", "day", units, this.cfg.dailyQuota ?? 10_000, "America/Los_Angeles");
    if (!q.allowed) throw new QuotaExhaustedError(`YouTube daily quota would be exceeded (used ${q.used})`);
  }

  private async call<T>(url: string, init: RequestInit = {}, units: number = COST.list): Promise<T> {
    await this.spend(units);
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await this.accessToken()}` } });
    const text = await r.text();
    const body = text ? JSON.parse(text) : {};
    if (!r.ok) {
      const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "error";
      throw new YouTubeApiError(r.status, reason, body?.error?.message ?? `HTTP ${r.status}`);
    }
    return body as T;
  }

  // ------------------------------------------------------------------ channel
  async myChannel(): Promise<{ id: string; title: string; uploads: string }> {
    const j = await this.call<{ items: { id: string; snippet: { title: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
      `${this.api}/youtube/v3/channels?part=snippet,contentDetails&mine=true`,
    );
    const c = j.items?.[0];
    if (!c) throw new YouTubeApiError(404, "noChannel", "the authorised account has no YouTube channel");
    return { id: c.id, title: c.snippet.title, uploads: c.contentDetails.relatedPlaylists.uploads };
  }

  /** Finds an already-uploaded video by the marker we put in every description (crash-safe dedupe). */
  async findByMarker(uploadsPlaylist: string, marker: string): Promise<string | null> {
    const j = await this.call<{ items: { snippet: { description: string; resourceId: { videoId: string } } }[] }>(
      `${this.api}/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(uploadsPlaylist)}`,
    );
    return j.items?.find((i) => i.snippet.description?.includes(marker))?.snippet.resourceId.videoId ?? null;
  }

  // ------------------------------------------------------------------ upload (resumable)
  async startUpload(meta: VideoMeta, size: number): Promise<string> {
    await this.spend(COST.insert);
    const r = await fetch(`${this.api}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "video/mp4",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify(videoResource(meta)),
    });
    const loc = r.headers.get("location");
    if (!r.ok || !loc) {
      const text = await r.text();
      let reason = "uploadInit";
      try {
        reason = JSON.parse(text)?.error?.errors?.[0]?.reason ?? reason; // e.g. quotaExceeded → retryable
      } catch {
        /* non-JSON body */
      }
      throw new YouTubeApiError(r.status, reason, `could not start upload: HTTP ${r.status} (${reason})`);
    }
    return loc;
  }

  /** Uploads (or resumes) the file at `sessionUri`; returns the new video id. */
  async uploadFile(sessionUri: string, file: string, chunkBytes = 8 * 1024 * 1024): Promise<string> {
    const size = (await stat(file)).size;
    let offset = await this.uploadedBytes(sessionUri, size);
    if (offset === -1) throw new YouTubeApiError(410, "sessionExpired", "upload session no longer valid");
    if (typeof offset === "string") return offset; // already complete: video id
    const fh = await open(file, "r");
    try {
      while (offset < size) {
        const len = Math.min(chunkBytes, size - offset);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, offset);
        const r = await fetch(sessionUri, {
          method: "PUT",
          headers: { authorization: `Bearer ${await this.accessToken()}`, "content-range": `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf,
        });
        if (r.status === 308) {
          const range = r.headers.get("range");
          offset = range ? Number(range.split("-")[1]) + 1 : 0;
          continue;
        }
        const body = (await r.json().catch(() => ({}))) as { id?: string };
        if ((r.status === 200 || r.status === 201) && body.id) return body.id;
        throw new YouTubeApiError(r.status, "uploadChunk", `chunk upload failed: HTTP ${r.status}`);
      }
    } finally {
      await fh.close();
    }
    throw new YouTubeApiError(500, "uploadIncomplete", "upload ended without a video id");
  }

  /** bytes already received (number), the video id if complete (string), or -1 if the session is gone. */
  private async uploadedBytes(sessionUri: string, size: number): Promise<number | string> {
    const r = await fetch(sessionUri, {
      method: "PUT",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-range": `bytes */${size}` },
    });
    if (r.status === 308) {
      const range = r.headers.get("range");
      return range ? Number(range.split("-")[1]) + 1 : 0;
    }
    if (r.status === 200 || r.status === 201) return ((await r.json()) as { id: string }).id;
    if (r.status === 404 || r.status === 410) return -1;
    throw new YouTubeApiError(r.status, "uploadStatus", `upload status check failed: HTTP ${r.status}`);
  }

  async setThumbnail(videoId: string, jpeg: Buffer): Promise<void> {
    await this.call(`${this.api}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    }, COST.thumbnail);
  }

  async insertCaption(videoId: string, srt: string, language = "ar", name = "العربية"): Promise<string> {
    const boundary = `ys${Date.now()}`;
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ snippet: { videoId, language, name, isDraft: false } }) +
      `\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--`;
    const j = await this.call<{ id: string }>(`${this.api}/upload/youtube/v3/captions?uploadType=multipart&part=snippet`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    }, COST.caption);
    return j.id;
  }

  async videoStatus(videoId: string) {
    const j = await this.call<{ items: { id: string; status: { uploadStatus: string; privacyStatus: string; publishAt?: string; rejectionReason?: string; failureReason?: string }; statistics?: Record<string, string> }[] }>(
      `${this.api}/youtube/v3/videos?part=status,statistics&id=${encodeURIComponent(videoId)}`,
    );
    return j.items?.[0] ?? null;
  }

  // ------------------------------------------------------------------ analytics
  async videoReport(startDate: string, endDate: string) {
    const qs = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained",
      dimensions: "video",
      sort: "-views",
      maxResults: "200",
    });
    const j = await this.call<{ columnHeaders: { name: string }[]; rows?: (string | number)[][] }>(`${this.analytics}/v2/reports?${qs}`, {}, 0);
    const names = j.columnHeaders.map((c) => c.name);
    return (j.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [names[i], v])) as Record<string, string | number>);
  }
}

export type VideoMeta = {
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  language?: string;
  privacyStatus: "private" | "unlisted" | "public";
  publishAt?: string | null; // ISO; requires privacyStatus "private" — YouTube flips it public at that time
  containsSyntheticMedia: boolean;
};

export function videoResource(m: VideoMeta) {
  if (m.publishAt && m.privacyStatus !== "private") throw new Error("publishAt requires privacyStatus=private");
  return {
    snippet: {
      title: m.title.slice(0, 100),
      description: m.description.slice(0, 5000),
      tags: m.tags.slice(0, 30),
      categoryId: m.categoryId ?? "27", // Education
      defaultLanguage: m.language ?? "ar",
      defaultAudioLanguage: m.language ?? "ar",
    },
    status: {
      privacyStatus: m.privacyStatus,
      ...(m.publishAt ? { publishAt: m.publishAt } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: m.containsSyntheticMedia,
    },
  };
}

// -------------------------------------------------------------------- device flow (one-time connect)
export async function startDeviceFlow(cfg: YtConfig) {
  const r = await fetch(`${cfg.oauthBase ?? "https://oauth2.googleapis.com"}/device/code`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES }),
  });
  const j = (await r.json()) as { device_code: string; user_code: string; verification_url: string; interval: number; expires_in: number; error?: string };
  if (!r.ok) throw new Error(`device flow start failed: ${j.error ?? r.status}`);
  return j;
}

export async function pollDeviceFlow(cfg: YtConfig, deviceCode: string, intervalS: number, deadlineMs: number, sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))): Promise<TokenSet> {
  let wait = intervalS;
  while (Date.now() < deadlineMs) {
    await sleep(wait * 1000);
    const r = await fetch(`${cfg.oauthBase ?? "https://oauth2.googleapis.com"}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (r.ok && j.access_token && j.refresh_token) {
      return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
    }
    if (j.error === "slow_down") wait += 5;
    else if (j.error !== "authorization_pending") throw new Error(`authorisation failed: ${j.error ?? r.status}`);
  }
  throw new Error("authorisation timed out (the code was not approved in time)");
}
