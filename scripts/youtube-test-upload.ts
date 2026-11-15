/**
 * P5 acceptance: upload a rendered test video as PRIVATE (always — this script cannot publish),
 * set its thumbnail and Arabic captions, then read it back and verify. Prints the private URL.
 *   node --import tsx scripts/youtube-test-upload.ts <render_dir>
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { youtubeFromStore, ytConfigFromEnv } from "../src/server/youtube/publish";

async function main() {
  workerEnv();
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: youtube-test-upload <render_dir>");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  if (!manifest.qa.passed) throw new Error(`refusing: media QA failed (${manifest.qa.issues.join("; ")})`);
  const yt = await youtubeFromStore(ytConfigFromEnv());
  const video = path.join(dir, "video.mp4");
  const session = await yt.startUpload(
    {
      title: `[اختبار خاص] ${manifest.title}`.slice(0, 100),
      description: "فيديو اختبار تقني خاص — لا يُنشر.\nهذا الفيديو منتج بمساعدة أدوات الذكاء الاصطناعي.",
      tags: ["test"],
      privacyStatus: "private",
      containsSyntheticMedia: true,
    },
    (await stat(video)).size,
  );
  const id = await yt.uploadFile(session, video);
  const notes: string[] = [];
  try {
    await yt.setThumbnail(id, await readFile(path.join(dir, "thumbnail.jpg")));
  } catch (e) {
    notes.push(`thumbnail: ${(e as Error).message}`);
  }
  try {
    await yt.insertCaption(id, await readFile(path.join(dir, "captions.srt"), "utf8"));
  } catch (e) {
    notes.push(`captions: ${(e as Error).message}`);
  }
  const s = await yt.videoStatus(id);
  if (!s) throw new Error("uploaded video not found on read-back");
  if (s.status.privacyStatus !== "private") throw new Error(`expected private, got ${s.status.privacyStatus}`);
  console.log(JSON.stringify({ ok: true, videoId: id, url: `https://youtu.be/${id}`, privacy: s.status.privacyStatus, uploadStatus: s.status.uploadStatus, notes }, null, 2));
}

main()
  .catch((e) => {
    console.error("test upload failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
