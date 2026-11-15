export type PublishRequest = {
  projectId: string;
  idempotencyKey: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  publishAt: Date | null;
  isShort: boolean;
  categoryId: string;
  defaultLanguage: string;
  /** Phase 2+: storage keys of the rendered media. */
  videoStorageKey: string | null;
  thumbnailStorageKey: string | null;
};

export type PublishResult = {
  externalId: string;
  externalUrl: string | null;
  raw: Record<string, unknown>;
};

/** Replaceable publishing target. Phase 1 ships only the dry-run implementation. */
export interface Publisher {
  readonly id: string;
  readonly mode: "dry_run" | "live";
  publish(req: PublishRequest): Promise<PublishResult>;
}
