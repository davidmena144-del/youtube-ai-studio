import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { one, rows, sql } from "../db/client";
import type { Job } from "../db/schema";
import { recordHistory } from "../history";
import { NonRetryableError, RetryableError } from "../queue/errors";
import { publishProject, type Seo, youtubeFromStore, ytConfigFromEnv } from "../youtube/publish";
import type { YouTube } from "../youtube/client";
import { registerHandler } from "./run";
import { collectTrends } from "../connectors/collect";

/**
 * Media worker handlers (GitHub Actions). Cognitive work (research, scripts, SEO, review) is done
 * by Claude specialists and stored as artifacts; these handlers turn artifacts into a published
 * video and pull analytics back in.
 */
const MEDIA_DIR = path.resolve(process.cwd(), "media");

async function latestArtifact<T>(projectId: string, kind: string): Promise<T | null> {
  const r = await one<{ content: T }>(sql`SELECT content FROM artifacts WHERE project_id = ${projectId}::uuid AND kind = ${kind}::artifact_kind ORDER BY version DESC LIMIT 1`);
  return r?.content ?? null;
}

async function saveArtifact(projectId: string, kind: string, content: unknown) {
  await one(sql`INSERT INTO artifacts (project_id, kind, version, revision, content)
    SELECT ${projectId}::uuid, ${kind}::artifact_kind, COALESCE(MAX(a.version), 0) + 1, p.revision, ${JSON.stringify(content)}::jsonb
    FROM projects p LEFT JOIN artifacts a ON a.project_id = p.id AND a.kind = ${kind}::artifact_kind
    WHERE p.id = ${projectId}::uuid GROUP BY p.revision RETURNING id`);
}

/** Allowlisted environment for the Python media process: it runs third-party TTS packages and
 * downloaded model files, so it never receives database URLs, tokens or keys. */
export function mediaEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TTS_ENGINE", "HF_HOME", "HF_HUB_CACHE", "XDG_CACHE_HOME", "TTS_CACHE", "OMP_NUM_THREADS"];
  return Object.fromEntries(allow.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
}

export function runPython(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const py = spawn(process.env.MEDIA_PYTHON ?? "python3", args, { cwd, env: mediaEnv() });
    let out = "";
    let err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    const timer = setTimeout(() => py.kill("SIGKILL"), timeoutMs);
    py.on("error", reject);
    py.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

type ProjectRow = { id: string; channel_id: string; status: string; slot_publish_at: string | null };

export async function produceAndPublish(job: Job, deps: { yt?: YouTube; render?: typeof runPython } = {}) {
  const projectId = (job.payload as { projectId?: string }).projectId;
  if (!projectId) throw new NonRetryableError("payload.projectId missing");
  const p = await one<ProjectRow>(sql`SELECT p.id, p.channel_id, p.status, s.publish_at AS slot_publish_at
    FROM projects p LEFT JOIN calendar_slots s ON s.id = p.slot_id WHERE p.id = ${projectId}::uuid`);
  if (!p) throw new NonRetryableError("project not found");
  if (["published", "scheduled", "cancelled"].includes(p.status)) return { skipped: p.status };

  const spec = await latestArtifact<Record<string, unknown>>(projectId, "storyboard");
  const seo = await latestArtifact<Seo>(projectId, "seo");
  if (!spec || !seo) throw new NonRetryableError("storyboard (video spec) and seo artifacts are required");

  const out = path.join(process.env.MEDIA_OUT ?? path.join(os.tmpdir(), "studio-media"), projectId);
  const manifestPath = path.join(out, "manifest.json");
  let manifest: { qa: { passed: boolean; issues: string[] } } | null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")); // already rendered by an earlier attempt
  } catch {
    manifest = null;
  }
  if (!manifest?.qa.passed) {
    await one(sql`SELECT app.set_project_status(${projectId}::uuid, ARRAY['approved','produced','producing']::project_status[], 'producing') AS ok`);
    mkdirSync(out, { recursive: true });
    const specFile = path.join(out, "spec.json");
    writeFileSync(specFile, JSON.stringify(spec));
    const render = deps.render ?? runPython;
    const r = await render(["-m", "studio_media.produce", "--spec", specFile, "--out", out, ...(process.env.MEDIA_PHOTOS === "1" ? ["--photos"] : [])], MEDIA_DIR, 50 * 60_000);
    if (r.code !== 0 && r.code !== 3) throw new RetryableError(`media render crashed (exit ${r.code}): ${r.err.slice(-600)}`, 10 * 60_000);
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    await saveArtifact(projectId, "media_qa_report", manifest);
    try {
      const thumb = readFileSync(path.join(out, "thumbnail.jpg")).toString("base64");
      if (thumb.length <= 600_000) await one(sql`INSERT INTO media_previews (project_id, kind, mime, data_base64) VALUES (${projectId}::uuid, 'thumbnail', 'image/jpeg', ${thumb}) RETURNING id`);
    } catch {
      /* preview is optional */
    }
    if (!manifest!.qa.passed) {
      await one(sql`SELECT app.set_project_status(${projectId}::uuid, ARRAY['producing']::project_status[], 'media_review') AS ok`);
      await recordHistory({ actor: "worker", action: "media.qa_failed", level: "warn", projectId, message: manifest!.qa.issues.join("; "), data: { issues: manifest!.qa.issues } });
      throw new NonRetryableError(`media QA failed: ${manifest!.qa.issues.join("; ")}`);
    }
    await one(sql`SELECT app.set_project_status(${projectId}::uuid, ARRAY['producing']::project_status[], 'produced') AS ok`);
  }
  const res = await publishProject({
    projectId,
    channelId: p.channel_id,
    outDir: out,
    seo,
    publishAt: p.slot_publish_at ? new Date(p.slot_publish_at) : null,
    yt: deps.yt,
  });
  if (res.videoId) await one(sql`UPDATE calendar_slots SET status = ${res.status === "scheduled" ? "scheduled" : "published"} WHERE project_id = ${projectId}::uuid RETURNING id`);
  return res;
}

/** analytics.pull: per-video numbers for the last 28 days, one snapshot row per video per day. */
export async function pullAnalytics(job: Job, deps: { yt?: YouTube } = {}) {
  const channelId = (job.payload as { channelId?: string }).channelId ?? job.channelId;
  if (!channelId) throw new NonRetryableError("channelId missing");
  const yt = deps.yt ?? (await youtubeFromStore(ytConfigFromEnv()));
  const end = new Date(Date.now() - 24 * 3600_000); // Analytics data lags ~1 day
  const start = new Date(end.getTime() - 27 * 24 * 3600_000);
  const day = end.toISOString().slice(0, 10);
  const report = await yt.videoReport(start.toISOString().slice(0, 10), day);
  for (const row of report) {
    const { video, ...metrics } = row;
    await one(sql`INSERT INTO analytics_snapshots (channel_id, youtube_video_id, day, metrics)
      VALUES (${channelId}::uuid, ${String(video)}, ${day}, ${JSON.stringify(metrics)}::jsonb)
      ON CONFLICT (channel_id, youtube_video_id, day) DO UPDATE SET metrics = EXCLUDED.metrics, pulled_at = now() RETURNING id`);
  }
  await rows(sql`UPDATE publications SET last_synced_at = now() WHERE external_id = ANY (${report.map((r) => String(r.video))}::text[]) RETURNING id`);
  return { videos: report.length, day };
}

/** trends.collect: run every Trend Intelligence connector for the channel (official APIs only). */
export async function collectTrendsJob(job: Job) {
  const channelId = (job.payload as { channelId?: string }).channelId ?? job.channelId;
  if (!channelId) throw new NonRetryableError("channelId missing");
  return collectTrends(channelId);
}

export function registerProductionHandlers() {
  registerHandler("video.produce", (job) => produceAndPublish(job));
  registerHandler("analytics.pull", (job) => pullAnalytics(job));
  registerHandler("trends.collect", (job) => collectTrendsJob(job));
}
