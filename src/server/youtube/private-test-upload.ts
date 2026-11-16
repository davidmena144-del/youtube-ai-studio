import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { YouTube } from "./client";
import { buildDescription, type Manifest, type Seo } from "./publish";

/**
 * Owner-approved single PRIVATE test upload. Guarantees:
 *  - privacy defaults to "private"; "public" only when the owner explicitly chooses it in the manual
 *    workflow; never a publishAt (YouTube would flip it public at that time);
 *  - at most one video per test marker: the channel's uploads are searched for the marker first, and an
 *    existing video is verified instead of uploading again (safe to re-run after any failure);
 *  - refuses when media QA failed;
 *  - reads the video back and waits for YouTube's processing to finish (bounded), then reports.
 */
const exists = (p: string) => access(p).then(() => true, () => false);

export type TestUploadResult = {
  videoId: string;
  url: string;
  reusedExisting: boolean;
  privacy: string;
  uploadStatus: string;
  publishAt: string | null;
  notes: string[];
};

export async function privateTestUpload(
  yt: YouTube,
  opts: { dir: string; seo: Seo; marker: string; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; privacy?: "private" | "public" },
): Promise<TestUploadResult> {
  const privacy = opts.privacy ?? "private"; // "public" only via the owner-approved manual workflow input
  const manifest = JSON.parse(await readFile(path.join(opts.dir, "manifest.json"), "utf8")) as Manifest;
  if (!manifest.qa.passed) throw new Error(`refusing: media QA failed (${manifest.qa.issues.join("; ")})`);
  if (!/^ys:test:[a-z0-9-]{3,60}$/.test(opts.marker)) throw new Error("marker must look like ys:test:<slug>");
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const notes: string[] = [];

  const channel = await yt.myChannel();
  let videoId = await yt.findByMarker(channel.uploads, opts.marker);
  const reusedExisting = Boolean(videoId);
  if (!videoId) {
    const video = path.join(opts.dir, "video.mp4");
    const session = await yt.startUpload(
      {
        title: opts.seo.title.slice(0, 100),
        description: buildDescription(opts.seo, manifest, opts.marker),
        tags: opts.seo.tags,
        categoryId: opts.seo.categoryId ?? "27",
        privacyStatus: privacy,
        publishAt: null,
        containsSyntheticMedia: true,
      },
      (await stat(video)).size,
    );
    videoId = await yt.uploadFile(session, video);
    if (await exists(path.join(opts.dir, "thumbnail.jpg"))) {
      try {
        await yt.setThumbnail(videoId, await readFile(path.join(opts.dir, "thumbnail.jpg")));
        notes.push("thumbnail: set");
      } catch (e) {
        notes.push(`thumbnail: ${(e as Error).message}`);
      }
    }
  } else {
    notes.push("a video with this test marker already exists: verified it, did NOT upload again");
  }

  const deadline = Date.now() + (opts.waitMs ?? 10 * 60_000);
  let s = await yt.videoStatus(videoId);
  while (s && s.status.uploadStatus === "uploaded" && Date.now() < deadline) {
    await sleep(opts.pollMs ?? 30_000);
    s = await yt.videoStatus(videoId);
  }
  if (!s) throw new Error(`video ${videoId} not found on read-back`);
  if (s.status.privacyStatus !== privacy) notes.push(`YouTube reports privacy "${s.status.privacyStatus}" (requested "${privacy}")`);
  if (s.status.uploadStatus === "uploaded") notes.push("YouTube still processing after the wait; check again later");
  // Captions only after processing: inserting them right after the upload fails with videoNotFound.
  if (!reusedExisting && (await exists(path.join(opts.dir, "captions.srt")))) {
    if (s.status.uploadStatus === "processed") {
      try {
        await yt.insertCaption(videoId, await readFile(path.join(opts.dir, "captions.srt"), "utf8"));
        notes.push("captions: Arabic track added");
      } catch (e) {
        notes.push(`captions: ${(e as Error).message}`);
      }
    } else notes.push("captions: skipped (video not processed yet)");
  }
  if (s.status.rejectionReason || s.status.failureReason) notes.push(`YouTube: ${s.status.rejectionReason ?? s.status.failureReason}`);
  return {
    videoId,
    url: `https://youtu.be/${videoId}`,
    reusedExisting,
    privacy: s.status.privacyStatus,
    uploadStatus: s.status.uploadStatus,
    publishAt: s.status.publishAt ?? null,
    notes,
  };
}
