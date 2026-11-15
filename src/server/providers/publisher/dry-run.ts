import type { Publisher, PublishRequest, PublishResult } from "./types";

/**
 * Validates the exact payload that would be sent to the YouTube Data API and records it,
 * without making any network call. Lets the approval gate and duplicate prevention be tested safely.
 */
export class DryRunPublisher implements Publisher {
  readonly id = "youtube-dry-run";
  readonly mode = "dry_run" as const;

  async publish(req: PublishRequest): Promise<PublishResult> {
    const snippet = {
      title: req.title,
      description: req.description,
      tags: req.tags,
      categoryId: req.categoryId,
      defaultLanguage: req.defaultLanguage,
    };
    const status = {
      privacyStatus: req.publishAt ? "private" : req.privacy,
      ...(req.publishAt ? { publishAt: req.publishAt.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
    };
    return {
      externalId: `dryrun-${req.idempotencyKey.slice(0, 24)}`,
      externalUrl: null,
      raw: {
        note: "Dry run — nothing was sent to YouTube.",
        wouldCall: "POST https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status (resumable)",
        body: { snippet, status },
        media: { video: req.videoStorageKey, thumbnail: req.thumbnailStorageKey },
      },
    };
  }
}
