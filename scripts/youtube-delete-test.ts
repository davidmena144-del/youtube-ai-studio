/**
 * Owner-requested deletion of ONE project test video (only ys:test uploads on this channel).
 *   node --import tsx scripts/youtube-delete-test.ts <videoId>
 */
import { appendFileSync } from "node:fs";
import { closeDb } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { deleteOwnTestVideo } from "../src/server/youtube/delete-test-video";
import { youtubeFromStore, ytConfigFromEnv } from "../src/server/youtube/publish";

async function main() {
  workerEnv();
  const id = (process.argv[2] ?? "").trim();
  const r = await deleteOwnTestVideo(await youtubeFromStore(ytConfigFromEnv()), id);
  console.log(JSON.stringify({ ok: true, ...r }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Deleted test video\n- ${r.videoId} (${r.title}) — verified gone\n`);
}

main()
  .catch((e) => {
    console.error("delete failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
