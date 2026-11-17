/**
 * Prints the next page of media/motion/queue.json that is not yet on the channel (by its ys:test:<page>
 * marker), and writes page=<name> to $GITHUB_OUTPUT. Empty when the queue is exhausted.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { closeDb } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { youtubeFromStore, ytConfigFromEnv } from "../src/server/youtube/publish";

async function main() {
  workerEnv();
  const { pages } = JSON.parse(readFileSync("media/motion/queue.json", "utf8")) as { pages: string[] };
  const yt = await youtubeFromStore(ytConfigFromEnv());
  const channel = await yt.myChannel();
  // one snapshot of the latest uploads (full descriptions); a page counts as published if its marker OR its exact title is there
  const uploads = await yt.recentUploads(channel.uploads);
  let next = "";
  for (const p of pages) {
    if (!/^[a-z0-9_]{3,40}$/.test(p) || !existsSync(`media/motion/${p}.html`) || !existsSync(`media/motion/${p}.seo.json`)) {
      console.log(`skip ${p}: missing page or SEO`);
      continue;
    }
    const marker = `ys:test:${p.replace(/_/g, "-")}`;
    const title = (JSON.parse(readFileSync(`media/motion/${p}.seo.json`, "utf8")) as { title: string }).title.slice(0, 100);
    if (uploads.some((u) => u.description.includes(marker) || u.title === title)) continue;
    next = p;
    break;
  }
  console.log(next ? `next: ${next}` : "queue exhausted: nothing to publish today");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `page=${next}\n`);
}

main()
  .catch((e) => {
    console.error("next-short failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
