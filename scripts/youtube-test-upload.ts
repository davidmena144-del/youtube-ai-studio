/**
 * Owner-approved PRIVATE test upload (always private — this script cannot publish).
 *   node --import tsx scripts/youtube-test-upload.ts <render_dir> [seo.json] [marker]
 * Re-running with the same marker never uploads a second video: the existing one is verified instead.
 */
import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { closeDb } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { privateTestUpload } from "../src/server/youtube/private-test-upload";
import { youtubeFromStore, ytConfigFromEnv, type Seo } from "../src/server/youtube/publish";

async function main() {
  workerEnv();
  const [dir, seoFile, marker = "ys:test:private-test"] = process.argv.slice(2);
  if (!dir) throw new Error("usage: youtube-test-upload <render_dir> [seo.json] [marker]");
  const seo: Seo = seoFile
    ? (JSON.parse(await readFile(seoFile, "utf8")) as Seo)
    : { title: "[اختبار خاص] فيديو تجريبي", description: "فيديو اختبار تقني خاص — لا يُنشر.", tags: ["test"] };
  const yt = await youtubeFromStore(ytConfigFromEnv());
  const r = await privateTestUpload(yt, { dir, seo, marker });
  console.log(JSON.stringify({ ok: true, ...r }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Private test upload",
        `- video: ${r.url} (${r.reusedExisting ? "existing video verified, not re-uploaded" : "uploaded now"})`,
        `- privacy: **${r.privacy}**; publishAt: ${r.publishAt ?? "none"}`,
        `- processing: ${r.uploadStatus}`,
        ...r.notes.map((n) => `- ${n}`),
        "",
      ].join("\n"),
    );
  }
}

main()
  .catch((e) => {
    console.error("test upload failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
