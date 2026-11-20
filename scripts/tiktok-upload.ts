/**
 * Uploads a rendered Short to the public Supabase Storage bucket `takka-media`, so a scheduler that needs a
 * public file URL (Buffer → TikTok) can fetch it. Usage: tiktok-upload.ts <file.mp4> <page>
 *
 * The bucket only accepts uploads into one unguessable folder. Its name lives in the database
 * (private.takka_media_folder()), so this job needs no extra secret: it reads the folder with DATABASE_URL
 * and uploads with the project's publishable key. The folder name is never printed.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

async function main() {
  const [file, page] = process.argv.slice(2);
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!file || !page || !/^[a-z0-9_]{3,40}$/.test(page))
    throw new Error("usage: tiktok-upload.ts <file.mp4> <page>");
  if (!base || !key || !dbUrl)
    throw new Error(
      "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and DATABASE_URL are required",
    );

  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  let folder: string;
  try {
    const rows = await sql<
      { folder: string | null }[]
    >`select private.takka_media_folder() as folder`;
    if (!rows[0]?.folder) throw new Error("upload folder is not configured");
    folder = rows[0].folder;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const body = readFileSync(file);
  const r = await fetch(
    `${base}/storage/v1/object/takka-media/${folder}/${page}.mp4`,
    {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "video/mp4",
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!r.ok)
    throw new Error(
      `storage upload failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`,
    );
  console.log(JSON.stringify({ ok: true, page, bytes: body.length }));
}

main().catch((e) => {
  console.error("tiktok-upload failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
