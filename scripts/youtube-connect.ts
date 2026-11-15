/**
 * One-time YouTube connection (run by .github/workflows/youtube-connect.yml, manual dispatch).
 * Google OAuth "device" flow: the log shows a short code; the owner opens google.com/device on
 * their phone, signs in to the channel's Google account and approves. The refresh token is stored
 * ENCRYPTED in the database (encrypted_secrets, AES-256-GCM with ENCRYPTION_KEY) and never printed.
 */
import { getChannel } from "../src/core/channel";
import { closeDb, one, sql } from "../src/server/db/client";
import { workerEnv } from "../src/server/env";
import { putSecret } from "../src/server/security/secrets-store";
import { pollDeviceFlow, startDeviceFlow, YouTube } from "../src/server/youtube/client";
import { TOKEN_SECRET, ytConfigFromEnv } from "../src/server/youtube/publish";

async function main() {
  const env = workerEnv();
  const cfg = ytConfigFromEnv();
  if (process.env.YT_REFRESH_TOKEN) {
    // Playground token from the GitHub secret: verify it works for both APIs; nothing to store.
    const yt = new YouTube(cfg, { access_token: "", refresh_token: process.env.YT_REFRESH_TOKEN, expires_at: 0 });
    const channel = await yt.myChannel();
    const today = new Date().toISOString().slice(0, 10);
    const rows = await yt.videoReport(new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10), today);
    const local = await getChannel();
    if (local) await one(sql`UPDATE channels SET youtube_channel_id = ${channel.id}, title = ${channel.title}, updated_at = now() WHERE id = ${local.id}::uuid RETURNING id`);
    console.log(`Connected: "${channel.title}" (${channel.id}). Data API OK; Analytics API OK (${rows.length} video rows).`);
    return;
  }
  // Fallback: device flow (YouTube Data API only — Google does not allow Analytics on this flow).
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required to store the device-flow token");
  const d = await startDeviceFlow(cfg);
  const banner = `\n=== Approve YouTube access ===\nOpen: ${d.verification_url}\nCode: ${d.user_code}\n(expires in ${Math.round(d.expires_in / 60)} min)\n`;
  console.log(banner);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Approve YouTube access\n\nOpen **${d.verification_url}** and enter **${d.user_code}**\n`);
  }
  const tokens = await pollDeviceFlow(cfg, d.device_code, d.interval, Date.now() + d.expires_in * 1000);
  await putSecret(TOKEN_SECRET, JSON.stringify(tokens));
  const yt = new YouTube(cfg, tokens, (t) => putSecret(TOKEN_SECRET, JSON.stringify(t)));
  const channel = await yt.myChannel();
  const local = await getChannel();
  if (local) await one(sql`UPDATE channels SET youtube_channel_id = ${channel.id}, updated_at = now() WHERE id = ${local.id}::uuid RETURNING id`);
  console.log(`Connected: "${channel.title}" (${channel.id}). Token stored encrypted.`);
}

main()
  .catch((e) => {
    console.error("youtube-connect failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
