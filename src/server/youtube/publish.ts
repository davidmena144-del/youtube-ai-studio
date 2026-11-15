import { readFile } from "node:fs/promises";
import path from "node:path";
import { activePolicy, isPaused } from "../../core/channel";
import { requestPublish } from "../../core/ops";
import { one, rows, sql } from "../db/client";
import { recordHistory } from "../history";
import { NonRetryableError, RetryableError } from "../queue/errors";
import { getSecret, putSecret } from "../security/secrets-store";
import { YouTube, YouTubeApiError, QuotaExhaustedError, type TokenSet, type VideoMeta, type YtConfig } from "./client";

export const TOKEN_SECRET = "youtube.oauth";

export type Manifest = {
  format: "short" | "long";
  title: string;
  files: { video: string; thumbnail: string; captions: string };
  attributions: string[];
  qa: { passed: boolean; issues: string[] };
};

export type Seo = { title: string; description: string; tags: string[]; categoryId?: string };

export function ytConfigFromEnv(env = process.env): YtConfig {
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) throw new NonRetryableError("YouTube is not connected: YT_CLIENT_ID / YT_CLIENT_SECRET missing");
  return {
    clientId: env.YT_CLIENT_ID,
    clientSecret: env.YT_CLIENT_SECRET,
    apiBase: env.YT_API_BASE,
    analyticsBase: env.YT_ANALYTICS_BASE,
    oauthBase: env.YT_OAUTH_BASE,
  };
}

export async function youtubeFromStore(cfg: YtConfig, env = process.env): Promise<YouTube> {
  // Primary: refresh token obtained once via Google's OAuth Playground and kept ONLY as a GitHub
  // secret (YT_REFRESH_TOKEN). It covers YouTube Data + Analytics (the device flow cannot do Analytics).
  if (env.YT_REFRESH_TOKEN) return new YouTube(cfg, { access_token: "", refresh_token: env.YT_REFRESH_TOKEN, expires_at: 0 });
  const raw = await getSecret(TOKEN_SECRET);
  if (!raw) throw new NonRetryableError("YouTube is not connected: set the YT_REFRESH_TOKEN secret (docs/SETUP.md) or run the youtube-connect workflow");
  return new YouTube(cfg, JSON.parse(raw) as TokenSet, (t) => putSecret(TOKEN_SECRET, JSON.stringify(t)));
}

export function buildDescription(seo: Seo, manifest: Manifest, marker: string): string {
  const parts = [seo.description.trim()];
  if (manifest.attributions.length) parts.push("—\nمصادر الصور:\n" + manifest.attributions.map((a) => `• ${a}`).join("\n"));
  parts.push("—\nهذا الفيديو منتج بمساعدة أدوات الذكاء الاصطناعي (صوت ومرئيات مولّدة).");
  parts.push(`[${marker}]`); // crash-safe dedupe marker (findByMarker)
  return parts.join("\n\n");
}

type PubRow = { id: string; external_id: string | null; upload_session_uri: string | null; status: string; publish_at: string | null; youtube_privacy: string | null };

/**
 * Publishes a produced project exactly once. Safe to re-run after any crash:
 *  - the publication row is created by app.request_publish (daily cap, kill switch, readiness, no duplicates);
 *  - the resumable session URI is stored before any byte is sent, so an interrupted upload resumes;
 *  - a marker in the description lets a re-run find a video that was uploaded but not recorded.
 */
export async function publishProject(opts: {
  projectId: string;
  channelId: string;
  outDir: string;
  seo: Seo;
  publishAt: Date | null;
  yt?: YouTube;
}): Promise<{ status: string; videoId?: string; url?: string }> {
  const manifest = JSON.parse(await readFile(path.join(opts.outDir, "manifest.json"), "utf8")) as Manifest;
  if (!manifest.qa.passed) throw new NonRetryableError(`media QA failed: ${manifest.qa.issues.join("; ")}`);

  const { policy } = await activePolicy(opts.channelId);
  const mode = policy.publish_mode === "dry_run" ? "dry_run" : "live";
  const future = opts.publishAt && opts.publishAt.getTime() > Date.now() + 15 * 60_000 ? opts.publishAt : null;
  let privacy: VideoMeta["privacyStatus"] = policy.publish_mode === "auto" && !future ? "public" : "private";
  let publishAt = policy.publish_mode === "auto" ? future : null;

  const project = await one<{ revision: number }>(sql`SELECT revision FROM projects WHERE id = ${opts.projectId}::uuid`);
  const key = `pub:${opts.projectId}:${project?.revision ?? 1}:${mode}`;
  const findActive = async () =>
    (await rows<PubRow>(sql`SELECT id, external_id, upload_session_uri, status, publish_at, youtube_privacy FROM publications
      WHERE project_id = ${opts.projectId}::uuid AND mode = ${mode} AND status <> 'failed'
      ORDER BY created_at DESC LIMIT 1`))[0];
  // Resume an existing publication first: the gate only decides whether a NEW one may be created
  // (once requested, the project is "publishing" and the gate would answer not_ready).
  let pub = await findActive();
  if (pub?.status === "succeeded") return { status: "already_published", videoId: pub.external_id ?? undefined };
  if (pub) {
    if (await isPaused(opts.channelId)) throw new RetryableError("channel paused (kill switch)", 3600_000);
  } else {
    const gate = await requestPublish({ projectId: opts.projectId, mode, publishAt, privacy, synthetic: true, key });
    if (gate.status === "requested" || gate.status === "duplicate") pub = await findActive();
    if (!pub) {
      if (gate.status === "rate_limited") throw new RetryableError("daily upload cap reached", 6 * 3600_000);
      if (gate.status === "paused") throw new RetryableError("channel paused (kill switch)", 3600_000);
      throw new NonRetryableError(`publish refused: ${gate.status}`);
    }
  }
  // A resumed publication keeps the privacy/schedule it was created with.
  if (pub.youtube_privacy) privacy = pub.youtube_privacy as VideoMeta["privacyStatus"];
  if (pub.publish_at) publishAt = new Date(pub.publish_at);

  if (mode === "dry_run") {
    await finish(pub.id, opts.projectId, true, null, null, null, "produced");
    await recordHistory({ actor: "worker", action: "publish.dry_run", projectId: opts.projectId, message: "dry run: nothing uploaded" });
    return { status: "dry_run" };
  }

  const yt = opts.yt ?? (await youtubeFromStore(ytConfigFromEnv()));
  await rows(sql`UPDATE publications SET status = 'uploading', updated_at = now() WHERE id = ${pub.id}::uuid RETURNING id`);
  try {
    const marker = `ys:${pub.id}`;
    let videoId = pub.external_id;
    if (!videoId) {
      const channel = await yt.myChannel();
      videoId = await yt.findByMarker(channel.uploads, marker);
    }
    if (!videoId) {
      const video = path.join(opts.outDir, manifest.files.video);
      const meta: VideoMeta = {
        title: opts.seo.title || manifest.title,
        description: buildDescription(opts.seo, manifest, marker),
        tags: opts.seo.tags,
        categoryId: opts.seo.categoryId,
        privacyStatus: privacy,
        publishAt: publishAt?.toISOString() ?? null,
        containsSyntheticMedia: true,
      };
      let session = pub.upload_session_uri;
      if (!session) {
        session = await yt.startUpload(meta, (await readFile(video)).length);
        await one(sql`UPDATE publications SET upload_session_uri = ${session}, request = ${JSON.stringify(meta)}::jsonb, updated_at = now() WHERE id = ${pub.id}::uuid RETURNING id`);
      }
      videoId = await yt.uploadFile(session, video);
    }
    await one(sql`UPDATE publications SET external_id = ${videoId}, external_url = ${"https://youtu.be/" + videoId}, updated_at = now() WHERE id = ${pub.id}::uuid RETURNING id`);

    const warnings: string[] = [];
    try {
      await yt.setThumbnail(videoId, await readFile(path.join(opts.outDir, manifest.files.thumbnail)));
    } catch (e) {
      warnings.push(`thumbnail: ${(e as Error).message}`); // e.g. channel not phone-verified: not fatal
    }
    try {
      await yt.insertCaption(videoId, await readFile(path.join(opts.outDir, manifest.files.captions), "utf8"));
    } catch (e) {
      warnings.push(`captions: ${(e as Error).message}`);
    }
    const status = await yt.videoStatus(videoId);
    if (!status) throw new RetryableError("uploaded video not visible yet", 5 * 60_000);
    if (status.status.uploadStatus === "rejected" || status.status.uploadStatus === "failed") {
      throw new NonRetryableError(`YouTube ${status.status.uploadStatus} the video: ${status.status.rejectionReason ?? status.status.failureReason ?? "unknown"}`);
    }
    await finish(pub.id, opts.projectId, true, videoId, `https://youtu.be/${videoId}`, warnings.join("; ") || null, publishAt ? "scheduled" : "published");
    await recordHistory({
      actor: "worker",
      action: "publish.succeeded",
      projectId: opts.projectId,
      message: `${privacy}${publishAt ? " → public at " + publishAt.toISOString() : ""}: https://youtu.be/${videoId}`,
      data: { videoId, warnings },
    });
    return { status: publishAt ? "scheduled" : privacy, videoId, url: `https://youtu.be/${videoId}` };
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw new RetryableError(e.message, 6 * 3600_000);
    if (e instanceof YouTubeApiError && e.retryable) throw new RetryableError(e.message, 10 * 60_000);
    if (e instanceof RetryableError) throw e;
    await finish(pub.id, opts.projectId, false, null, null, (e as Error).message, "failed");
    throw e instanceof NonRetryableError ? e : new NonRetryableError((e as Error).message);
  }
}

async function finish(pubId: string, projectId: string, ok: boolean, externalId: string | null, url: string | null, note: string | null, projectStatus: string) {
  await one(sql`SELECT app.finish_publication(${pubId}::uuid, ${ok}, ${externalId}, ${url}, ${note}, ${projectStatus}::project_status) AS done`);
  void projectId;
}
