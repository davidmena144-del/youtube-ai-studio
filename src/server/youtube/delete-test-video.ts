import type { YouTube } from "./client";

/**
 * Deletes ONE video the owner asked to remove, but only if it is provably one of our own test uploads:
 * it must belong to the authorised channel AND carry a "[ys:test:" marker in its description (set by
 * privateTestUpload). Anything else is refused. Verifies afterwards that the video is gone.
 */
export async function deleteOwnTestVideo(yt: YouTube, videoId: string): Promise<{ videoId: string; title: string; deleted: true }> {
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(videoId)) throw new Error("invalid YouTube video id");
  const channel = await yt.myChannel();
  const v = await yt.videoSnippet(videoId);
  if (!v) throw new Error(`video ${videoId} not found on this channel`);
  if (v.snippet.channelId !== channel.id) throw new Error("refusing: the video belongs to another channel");
  if (!v.snippet.description.includes("[ys:test:")) throw new Error("refusing: not a ys:test upload made by this project");
  await yt.deleteVideo(videoId);
  if (await yt.videoSnippet(videoId)) throw new Error(`video ${videoId} still exists after delete`);
  return { videoId, title: v.snippet.title, deleted: true };
}
