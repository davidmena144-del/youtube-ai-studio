import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YouTube } from "@/server/youtube/client";
import { privateTestUpload } from "@/server/youtube/private-test-upload";
import { startFakeYouTube } from "./helpers/fake-youtube";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
let fake: Awaited<ReturnType<typeof startFakeYouTube>>;
let dir: string;
const seo = { title: "لماذا نتثاءب؟ #shorts", description: "وصف.", tags: ["التثاؤب"], categoryId: "27" };
const noSleep = async () => {};

beforeEach(async () => {
  t = await useTestDb(); // API calls meter quota in the database
  fake = await startFakeYouTube();
  dir = mkdtempSync(path.join(os.tmpdir(), "ptu-"));
  writeFileSync(path.join(dir, "video.mp4"), Buffer.alloc(2 * 1024 * 1024, 3));
  writeFileSync(path.join(dir, "thumbnail.jpg"), Buffer.alloc(1024, 1));
  writeFileSync(path.join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:02,000\nمرحبا\n");
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: "short", title: "t", files: {}, attributions: ["صورة — مصور (cc0)"], qa: { passed: true, issues: [] } }));
});
afterEach(async () => {
  await fake.close();
  await t.close();
});
const yt = () => new YouTube({ clientId: "c", clientSecret: "s", apiBase: fake.base, analyticsBase: fake.base, oauthBase: fake.base }, { access_token: "", refresh_token: "rt", expires_at: 0 });

describe("owner-approved private test upload", () => {
  it("uploads exactly once as PRIVATE (no publishAt) with SEO, synthetic flag, thumbnail, captions; waits for processing", async () => {
    fake.state.processedAfterReads = 2;
    const r = await privateTestUpload(yt(), { dir, seo, marker: "ys:test:short-yawn", sleep: noSleep });
    expect(r).toMatchObject({ reusedExisting: false, privacy: "private", uploadStatus: "processed", publishAt: null });
    expect(fake.state.videos).toHaveLength(1);
    const v = fake.state.videos[0].resource;
    expect(v.status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true });
    expect(v.status.publishAt).toBeUndefined();
    expect(v.snippet).toMatchObject({ title: seo.title, tags: seo.tags, categoryId: "27" });
    expect(String(v.snippet.description)).toContain("[ys:test:short-yawn]");
    expect(String(v.snippet.description)).toContain("مصادر الصور");
    expect(fake.state.thumbnails.size).toBe(1);
    expect(fake.state.captions[0].language).toBe("ar");
  });

  it("re-running with the same marker verifies the existing video and never uploads a second one", async () => {
    await privateTestUpload(yt(), { dir, seo, marker: "ys:test:short-yawn", sleep: noSleep, waitMs: 0 });
    const again = await privateTestUpload(yt(), { dir, seo, marker: "ys:test:short-yawn", sleep: noSleep, waitMs: 0 });
    expect(again.reusedExisting).toBe(true);
    expect(fake.state.videos).toHaveLength(1);
    expect(fake.state.uploadInits).toBe(1);
  });

  it("refuses when media QA failed or the marker is malformed; reports when still processing", async () => {
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ qa: { passed: false, issues: ["loudness"] }, attributions: [] }));
    await expect(privateTestUpload(yt(), { dir, seo, marker: "ys:test:x-y-z", sleep: noSleep })).rejects.toThrow(/media QA failed/);
    expect(fake.state.uploadInits).toBe(0);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ qa: { passed: true, issues: [] }, attributions: [] }));
    await expect(privateTestUpload(yt(), { dir, seo, marker: "bad marker", sleep: noSleep })).rejects.toThrow(/marker/);
    const r = await privateTestUpload(yt(), { dir, seo, marker: "ys:test:slow", sleep: noSleep, waitMs: 0 });
    expect(r.uploadStatus).toBe("uploaded");
    expect(r.notes.join(" ")).toMatch(/still processing/);
  });
});
