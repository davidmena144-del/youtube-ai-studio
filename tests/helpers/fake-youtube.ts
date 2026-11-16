import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process fake of the Google endpoints the publisher uses (OAuth token + device flow, YouTube
 * Data API resumable upload, thumbnails, captions, channels, playlistItems, videos, Analytics).
 * Faults can be injected to test resume, dedupe and quota handling.
 */
export type FakeVideo = { id: string; resource: { snippet: Record<string, unknown>; status: Record<string, unknown> }; bytes: number };

export async function startFakeYouTube() {
  const state = {
    videos: [] as FakeVideo[],
    sessions: new Map<string, { size: number; received: number; resource: FakeVideo["resource"] }>(),
    thumbnails: new Map<string, number>(),
    captions: [] as { videoId: string; language: string; body: string }[],
    tokenRefreshes: 0,
    failChunkOnce: false, // the next chunk PUT returns 503 after storing nothing
    thumbnailForbidden: false,
    uploadInits: 0,
    deviceApproved: false,
    videosListFailOnce: false, // videos.list answers 400 once (non-retryable) — after the upload
    quotaExceededOnInit: false, // upload init answers 403 quotaExceeded
    processedAfterReads: Infinity, // videos.list reports uploadStatus "processed" after this many reads
    statusReads: 0,
  };
  let seq = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://x");
    const json = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(obj));
    };
    const authed = () => (req.headers.authorization ?? "").startsWith("Bearer at-");

    if (url.pathname === "/token") {
      const p = new URLSearchParams(body.toString());
      if (p.get("grant_type") === "refresh_token") {
        state.tokenRefreshes++;
        return json(200, { access_token: `at-${++seq}`, expires_in: 3600 });
      }
      if (p.get("grant_type")?.endsWith("device_code")) {
        return state.deviceApproved
          ? json(200, { access_token: "at-dev", refresh_token: "rt-dev", expires_in: 3600 })
          : json(428, { error: "authorization_pending" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/device/code") return json(200, { device_code: "dc", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", interval: 1, expires_in: 600 });
    if (!authed()) return json(401, { error: { message: "unauthorised", errors: [{ reason: "authError" }] } });

    if (url.pathname === "/upload/youtube/v3/videos" && req.method === "POST") {
      if (state.quotaExceededOnInit) return json(403, { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } });
      state.uploadInits++;
      const sid = `s${++seq}`;
      state.sessions.set(sid, { size: Number(req.headers["x-upload-content-length"]), received: 0, resource: JSON.parse(body.toString()) });
      const addr = server.address() as AddressInfo;
      res.writeHead(200, { location: `http://127.0.0.1:${addr.port}/session/${sid}` });
      return res.end();
    }
    if (url.pathname.startsWith("/session/") && req.method === "PUT") {
      const s = state.sessions.get(url.pathname.split("/")[2]);
      if (!s) return json(404, {});
      const range = String(req.headers["content-range"] ?? "");
      const done = () => {
        const v: FakeVideo = { id: `vid${++seq}`, resource: s.resource, bytes: s.received };
        state.videos.push(v);
        (s as { videoId?: string }).videoId = v.id;
        return json(200, { id: v.id });
      };
      if (range.startsWith("bytes */")) {
        const vid = (s as { videoId?: string }).videoId;
        if (vid) return json(200, { id: vid });
        res.writeHead(308, s.received ? { range: `bytes=0-${s.received - 1}` } : {});
        return res.end();
      }
      if (state.failChunkOnce) {
        state.failChunkOnce = false;
        return json(503, { error: { message: "backend", errors: [{ reason: "backendError" }] } });
      }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
      if (!m || Number(m[1]) !== s.received) return json(400, { error: { message: "bad range" } });
      s.received += body.length;
      if (s.received >= s.size) return done();
      res.writeHead(308, { range: `bytes=0-${s.received - 1}` });
      return res.end();
    }
    if (url.pathname === "/youtube/v3/channels") return json(200, { items: [{ id: "UC1", snippet: { title: "قناة" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
    if (url.pathname === "/youtube/v3/playlistItems") {
      return json(200, { items: state.videos.map((v) => ({ snippet: { description: v.resource.snippet.description, resourceId: { videoId: v.id } } })) });
    }
    if (url.pathname === "/youtube/v3/videos" && req.method === "DELETE") {
      const i = state.videos.findIndex((x) => x.id === url.searchParams.get("id"));
      if (i < 0) return json(404, { error: { message: "video not found", errors: [{ reason: "videoNotFound" }] } });
      state.videos.splice(i, 1);
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/youtube/v3/videos" && url.searchParams.get("part") === "snippet") {
      const v = state.videos.find((x) => x.id === url.searchParams.get("id"));
      return json(200, { items: v ? [{ id: v.id, snippet: { channelId: "UC1", title: v.resource.snippet.title, description: v.resource.snippet.description } }] : [] });
    }
    if (url.pathname === "/youtube/v3/videos") {
      if (state.videosListFailOnce) {
        state.videosListFailOnce = false;
        return json(400, { error: { message: "bad request", errors: [{ reason: "badRequest" }] } });
      }
      const v = state.videos.find((x) => x.id === url.searchParams.get("id"));
      const uploadStatus = ++state.statusReads > state.processedAfterReads ? "processed" : "uploaded";
      return json(200, { items: v ? [{ id: v.id, status: { uploadStatus, ...v.resource.status }, statistics: { viewCount: "0" } }] : [] });
    }
    if (url.pathname === "/upload/youtube/v3/thumbnails/set") {
      if (state.thumbnailForbidden) return json(403, { error: { message: "channel not verified for custom thumbnails", errors: [{ reason: "forbidden" }] } });
      state.thumbnails.set(String(url.searchParams.get("videoId")), body.length);
      return json(200, {});
    }
    if (url.pathname === "/upload/youtube/v3/captions") {
      const text = body.toString();
      const meta = JSON.parse(text.slice(text.indexOf("{"), text.indexOf("}}") + 2));
      state.captions.push({ videoId: meta.snippet.videoId, language: meta.snippet.language, body: text });
      return json(200, { id: `cap${++seq}` });
    }
    if (url.pathname === "/v2/reports") {
      return json(200, {
        columnHeaders: ["video", "views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "likes", "comments", "shares", "subscribersGained"].map((name) => ({ name })),
        rows: state.videos.map((v, i) => [v.id, 100 * (i + 1), 50 * (i + 1), 30, 55 + i, 5, 1, 1, 2]),
      });
    }
    json(404, { error: { message: `fake: no route ${req.method} ${url.pathname}` } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
