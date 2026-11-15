import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initChannel, setPolicy } from "@/core/channel";
import { one, sql } from "@/server/db/client";
import { projects, publications } from "@/server/db/schema";
import { RetryableError } from "@/server/queue/errors";
import { pollDeviceFlow, startDeviceFlow, YouTube, type YtConfig } from "@/server/youtube/client";
import { publishProject, youtubeFromStore, type Seo } from "@/server/youtube/publish";
import { startFakeYouTube } from "./helpers/fake-youtube";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
let fake: Awaited<ReturnType<typeof startFakeYouTube>>;
let cfg: YtConfig;
let channelId: string;
let outDir: string;
const seo: Seo = { title: "دماغك لا ينام", description: "حقائق عن النوم.", tags: ["نوم", "دماغ"] };

beforeEach(async () => {
  t = await useTestDb();
  fake = await startFakeYouTube();
  cfg = { clientId: "cid", clientSecret: "cs", apiBase: fake.base, analyticsBase: fake.base, oauthBase: fake.base };
  channelId = (await initChannel({ title: "c", timeZone: "Africa/Cairo" })).id;
  outDir = mkdtempSync(path.join(os.tmpdir(), "pub-"));
  writeFileSync(path.join(outDir, "video.mp4"), Buffer.alloc(3 * 1024 * 1024 + 123, 7));
  writeFileSync(path.join(outDir, "thumbnail.jpg"), Buffer.alloc(2048, 1));
  writeFileSync(path.join(outDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:02,000\nمرحبا\n");
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
    format: "short", title: "t", files: { video: "video.mp4", thumbnail: "thumbnail.jpg", captions: "captions.srt" },
    attributions: ["صورة — مصور (by)"], qa: { passed: true, issues: [] },
  }));
});
afterEach(async () => {
  await fake.close();
  await t.close();
});

const yt = () => new YouTube(cfg, { access_token: "at-0", refresh_token: "rt", expires_at: 0 });
async function producedProject() {
  const [p] = await t.db.insert(projects).values({ topic: "t", title: "t", format: "short", targetDurationSec: 45, channelId, status: "produced" }).returning();
  return p;
}

describe("YouTube publisher (against a fake Google API)", () => {
  it("auto policy: uploads private with publishAt, synthetic flag, thumbnail and Arabic captions; project scheduled", async () => {
    const p = await producedProject();
    const at = new Date(Date.now() + 24 * 3600_000);
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: at, yt: yt() });
    expect(r.status).toBe("scheduled");
    expect(fake.state.videos).toHaveLength(1);
    const v = fake.state.videos[0];
    expect(v.bytes).toBe(3 * 1024 * 1024 + 123);
    expect(v.resource.status).toMatchObject({ privacyStatus: "private", publishAt: at.toISOString(), containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
    expect(String(v.resource.snippet.description)).toContain("الذكاء الاصطناعي");
    expect(String(v.resource.snippet.description)).toContain("مصادر الصور");
    expect(fake.state.thumbnails.get(v.id)).toBe(2048);
    expect(fake.state.captions[0]).toMatchObject({ videoId: v.id, language: "ar" });
    expect((await one<{ status: string }>(sql`SELECT status FROM projects WHERE id = ${p.id}::uuid`))!.status).toBe("scheduled");
    expect(fake.state.tokenRefreshes).toBe(1);
  });

  it("no slot time under auto policy → public immediately", async () => {
    const p = await producedProject();
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    expect(r.status).toBe("public");
    expect(fake.state.videos[0].resource.status).toMatchObject({ privacyStatus: "public" });
  });

  it("an interrupted upload resumes from the stored session on the next run (no second upload)", async () => {
    const p = await producedProject();
    fake.state.failChunkOnce = false;
    const client = yt();
    // make the 2nd chunk fail: 1 MiB chunks, fail after the first succeeded
    const orig = client.uploadFile.bind(client);
    let calls = 0;
    client.uploadFile = async (s: string, f: string) => {
      calls++;
      if (calls === 1) {
        fake.state.failChunkOnce = false;
        setTimeout(() => (fake.state.failChunkOnce = true), 0);
      }
      return orig(s, f, 1024 * 1024);
    };
    await expect(publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: client })).rejects.toBeInstanceOf(RetryableError);
    const [pub] = await t.db.select().from(publications);
    expect(pub.uploadSessionUri).toBeTruthy();
    expect(pub.status).toBe("uploading");
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: client });
    expect(r.videoId).toBeTruthy();
    expect(fake.state.uploadInits).toBe(1); // resumed, not restarted
    expect(fake.state.videos).toHaveLength(1);
    expect(fake.state.videos[0].bytes).toBe(3 * 1024 * 1024 + 123);
  });

  it("crash after upload but before recording: the marker finds the video, nothing is uploaded twice", async () => {
    const p = await producedProject();
    await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    // simulate lost bookkeeping: publication forgot the video id and status
    await one(sql`UPDATE publications SET external_id = NULL, status = 'uploading', upload_session_uri = NULL RETURNING id`);
    await one(sql`UPDATE projects SET status = 'publishing' RETURNING id`);
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    expect(r.videoId).toBe(fake.state.videos[0].id);
    expect(fake.state.uploadInits).toBe(1);
  });

  it("re-running a finished publication is a no-op", async () => {
    const p = await producedProject();
    await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    const again = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    expect(again.status).toBe("already_published");
    expect(fake.state.uploadInits).toBe(1);
  });

  it("thumbnail refused (unverified channel) is a warning, not a failure", async () => {
    const p = await producedProject();
    fake.state.thumbnailForbidden = true;
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    expect(r.videoId).toBeTruthy();
    const [pub] = await t.db.select().from(publications);
    expect(pub.status).toBe("succeeded");
    expect(pub.error).toMatch(/thumbnail/);
  });

  it("daily quota exhausted → retry later, nothing uploaded", async () => {
    const p = await producedProject();
    const client = new YouTube({ ...cfg, dailyQuota: 1000 }, { access_token: "at-0", refresh_token: "rt", expires_at: 0 });
    await expect(publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: client })).rejects.toBeInstanceOf(RetryableError);
    expect(fake.state.videos).toHaveLength(0);
  });

  it("kill switch: refused before any API call; dry_run policy uploads nothing", async () => {
    const p = await producedProject();
    await setPolicy(channelId, { kill_switch: true });
    await expect(publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() })).rejects.toBeInstanceOf(RetryableError);
    await setPolicy(channelId, { kill_switch: false, publish_mode: "dry_run" });
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    expect(r.status).toBe("dry_run");
    expect(fake.state.uploadInits).toBe(0);
  });

  it("failed media QA is never published", async () => {
    const p = await producedProject();
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ format: "short", title: "t", files: {}, attributions: [], qa: { passed: false, issues: ["loudness"] } }));
    await expect(publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() })).rejects.toThrow(/QA failed/);
    expect(fake.state.uploadInits).toBe(0);
  });

  it("device flow: pending until approved, then returns a refresh token", async () => {
    const d = await startDeviceFlow(cfg);
    expect(d.user_code).toBe("ABCD-EFGH");
    setTimeout(() => (fake.state.deviceApproved = true), 30);
    const tokens = await pollDeviceFlow(cfg, d.device_code, 0, Date.now() + 5000, (ms) => new Promise((r) => setTimeout(r, Math.max(ms, 10))));
    expect(tokens.refresh_token).toBe("rt-dev");
  });

  it("YT_REFRESH_TOKEN (OAuth Playground) is used directly: refresh → upload works with no stored token", async () => {
    const p = await producedProject();
    const client = await youtubeFromStore(cfg, { YT_REFRESH_TOKEN: "rt-from-secret" } as NodeJS.ProcessEnv);
    const r = await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: client });
    expect(r.videoId).toBeTruthy();
    expect(fake.state.tokenRefreshes).toBe(1);
    await expect(youtubeFromStore(cfg, {} as NodeJS.ProcessEnv)).rejects.toThrow(/not connected/);
  });

  it("analytics report rows are parsed by column name", async () => {
    const p = await producedProject();
    await publishProject({ projectId: p.id, channelId, outDir, seo, publishAt: null, yt: yt() });
    const rows = await yt().videoReport("2026-11-01", "2026-11-14");
    expect(rows[0]).toMatchObject({ video: fake.state.videos[0].id, views: 100, averageViewPercentage: 55 });
  });
});
