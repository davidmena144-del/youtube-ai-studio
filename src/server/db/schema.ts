import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const videoFormat = pgEnum("video_format", ["long", "short"]);

export const projectStatus = pgEnum("project_status", [
  "draft",
  "queued",
  "in_progress",
  "failed",
  "awaiting_review",
  "changes_requested",
  "approved",
  "publishing",
  "published",
  "cancelled",
  // Autonomous channel manager (migration 0001)
  "producing",
  "produced",
  "media_review",
  "scheduled",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    format: videoFormat("format").notNull(),
    language: text("language").notNull().default("ar"),
    tone: text("tone"),
    audience: text("audience"),
    notes: text("notes"),
    targetDurationSec: integer("target_duration_sec").notNull(),
    status: projectStatus("status").notNull().default("draft"),
    currentStage: text("current_stage"),
    /** Incremented every time a human requests changes; stale jobs for older revisions are ignored. */
    revision: integer("revision").notNull().default(0),
    /** Automatic QA-driven rewrites performed in the current revision. */
    autoRevisions: integer("auto_revisions").notNull().default(0),
    lastError: text("last_error"),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    slotId: uuid("slot_id").references(() => calendarSlots.id, { onDelete: "set null" }),
    /** Who created the project: the autonomous manager or the owner via chat. */
    origin: text("origin").notNull().default("manager"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_status_idx").on(t.status),
    index("projects_scheduled_idx").on(t.scheduledPublishAt),
    index("projects_channel_idx").on(t.channelId),
  ],
);

export const stageRunStatus = pgEnum("stage_run_status", ["running", "succeeded", "failed"]);

/** One execution of one agent for one pipeline stage. */
export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    agent: text("agent").notNull(),
    revision: integer("revision").notNull(),
    /** Job that executed this run; used to skip re-running a stage that already succeeded. */
    jobId: uuid("job_id"),
    managerRunId: uuid("manager_run_id"),
    modelTier: text("model_tier"),
    approxInputChars: integer("approx_input_chars"),
    approxOutputChars: integer("approx_output_chars"),
    status: stageRunStatus("status").notNull().default("running"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("stage_runs_project_idx").on(t.projectId, t.startedAt)],
);

export const artifactKind = pgEnum("artifact_kind", [
  "research",
  "script",
  "storyboard",
  "seo",
  "qa_report",
  // phase 2+
  "voice",
  "subtitles",
  "video",
  "thumbnail",
  // Autonomous channel manager (migration 0001)
  "brief",
  "fact_check",
  "thumbnail_spec",
  "media_qa_report",
  "strategy_note",
]);

/** Versioned outputs of the pipeline. Text outputs live in `content`; media will use `storageKey`. */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: artifactKind("kind").notNull(),
    version: integer("version").notNull(),
    revision: integer("revision").notNull(),
    content: jsonb("content").$type<unknown>(),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    stageRunId: uuid("stage_run_id").references(() => stageRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("artifacts_project_kind_version_uq").on(t.projectId, t.kind, t.version)],
);

export const reviewDecision = pgEnum("review_decision", ["approved", "changes_requested"]);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    decision: reviewDecision("decision").notNull(),
    notes: text("notes"),
    restartFromStage: text("restart_from_stage"),
    reviewer: text("reviewer").notNull().default("admin"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_project_idx").on(t.projectId, t.createdAt)],
);

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead", "cancelled"]);

/** Postgres-backed job queue (claimed with FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** Unique: enqueueing the same logical work twice is a no-op. */
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** cognitive = done by a Claude specialist; media = GitHub Actions worker; system = deterministic. */
    kind: text("kind").notNull().default("cognitive"),
    /** Specialist agent or worker that may claim this job (null = any of its kind). */
    assignee: text("assignee"),
    parentJobId: uuid("parent_job_id"),
    /** The job becomes claimable only when every listed job has succeeded. */
    dependsOn: uuid("depends_on").array().notNull().default(sql`'{}'::uuid[]`),
    priority: integer("priority").notNull().default(100),
    result: jsonb("result").$type<unknown>(),
    createdBy: text("created_by"),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key_uq").on(t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAt),
    index("jobs_project_idx").on(t.projectId),
    index("jobs_kind_claim_idx").on(t.kind, t.status, t.priority, t.runAt),
  ],
);

export const publicationMode = pgEnum("publication_mode", ["dry_run", "live"]);
export const publicationStatus = pgEnum("publication_status", ["pending", "uploading", "succeeded", "failed"]);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("youtube"),
    mode: publicationMode("mode").notNull(),
    status: publicationStatus("status").notNull().default("pending"),
    revision: integer("revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    privacy: text("privacy").notNull().default("private"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    request: jsonb("request").$type<unknown>(),
    response: jsonb("response").$type<unknown>(),
    error: text("error"),
    youtubePrivacy: text("youtube_privacy"),
    containsSyntheticMedia: boolean("contains_synthetic_media"),
    /** Resumable-upload session URI, so an interrupted upload resumes instead of re-uploading. */
    uploadSessionUri: text("upload_session_uri"),
    verifiedOnChannelAt: timestamp("verified_on_channel_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("publications_idempotency_key_uq").on(t.idempotencyKey),
    // At most one non-failed publication per project and mode: the database itself refuses duplicates.
    uniqueIndex("publications_one_active_per_project_uq")
      .on(t.projectId, t.mode)
      .where(sql`${t.status} <> 'failed'`),
  ],
);

export const historyLevel = pgEnum("history_level", ["info", "warn", "error"]);

/** Append-only audit log of every operation. Never store secret values here. */
export const historyEvents = pgTable(
  "history_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    level: historyLevel("level").notNull().default("info"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (t) => [index("history_occurred_idx").on(t.occurredAt), index("history_project_idx").on(t.projectId, t.occurredAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/** Secrets that must live in the DB (e.g. OAuth refresh tokens) — AES-256-GCM encrypted. */
export const encryptedSecrets = pgTable("encrypted_secrets", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientHash: text("client_hash").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_client_idx").on(t.clientHash, t.createdAt)],
);

// ===================== Autonomous channel manager (migration 0001) =====================

const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  youtubeChannelId: text("youtube_channel_id").unique(),
  title: text("title").notNull(),
  language: text("language").notNull().default("ar"),
  niche: text("niche"),
  timeZone: text("time_zone").notNull().default("UTC"),
  status: text("status").notNull().default("setup"), // setup | active | paused | archived
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Versioned safety & autonomy policy. The highest version is the active one. */
export const channelPolicies = pgTable(
  "channel_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("channel_policies_version_uq").on(t.channelId, t.version)],
);

/** Owner instructions from the chat — the only way the owner steers the manager. */
export const directives = pgTable(
  "directives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: text("kind").notNull().default("instruction"),
    status: text("status").notNull().default("active"), // active | done | superseded | rejected
    resolution: text("resolution"),
    createdAt: createdAt(),
    resolvedAt: tsz("resolved_at"),
  },
  (t) => [index("directives_channel_status_idx").on(t.channelId, t.status)],
);

export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    rationale: text("rationale"),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("strategies_version_uq").on(t.channelId, t.version),
    uniqueIndex("strategies_one_active_uq").on(t.channelId).where(sql`${t.active}`),
  ],
);

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    fingerprint: text("fingerprint").notNull(),
    pillar: text("pillar"),
    format: videoFormat("format").notNull(),
    score: numeric("score", { precision: 6, scale: 2 }),
    status: text("status").notNull().default("backlog"), // backlog|planned|in_production|published|rejected|duplicate
    source: text("source").notNull().default("strategist"),
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ideas_fingerprint_uq").on(t.channelId, t.fingerprint),
    index("ideas_trgm_idx").using("gin", sql`${t.normalizedTitle} gin_trgm_ops`),
  ],
);

export const calendarSlots = pgTable(
  "calendar_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    publishAt: tsz("publish_at").notNull(),
    format: videoFormat("format").notNull(),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    projectId: uuid("project_id"),
    status: text("status").notNull().default("open"), // open|assigned|in_production|scheduled|published|skipped
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_slots_uq").on(t.channelId, t.publishAt, t.format)],
);

/** Manager run lease + bookkeeping. At most one running run per channel (partial unique index). */
export const managerRuns = pgTable(
  "manager_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // schedule | chat | manual
    leaseOwner: text("lease_owner").notNull(),
    leaseExpiresAt: tsz("lease_expires_at").notNull(),
    status: text("status").notNull().default("running"), // running | finished | noop | aborted | expired
    promptVersion: text("prompt_version"),
    agenda: jsonb("agenda").$type<unknown>(),
    agendaFingerprint: text("agenda_fingerprint"),
    actionsCount: integer("actions_count").notNull().default(0),
    modelCalls: integer("model_calls").notNull().default(0),
    summary: text("summary"),
    abortReason: text("abort_reason"),
    startedAt: tsz("started_at").notNull().defaultNow(),
    finishedAt: tsz("finished_at"),
  },
  (t) => [
    uniqueIndex("manager_runs_one_running_uq").on(t.channelId).where(sql`${t.status} = 'running'`),
    index("manager_runs_channel_idx").on(t.channelId, t.startedAt),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    managerRunId: uuid("manager_run_id"),
    projectId: uuid("project_id"),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale"),
    alternatives: jsonb("alternatives").$type<unknown>(),
    expectedOutcome: text("expected_outcome"),
    outcome: jsonb("outcome").$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_channel_idx").on(t.channelId, t.createdAt)],
);

export const memoryItems = pgTable(
  "memory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // fact|lesson|preference|audience|competitor|style|constraint
    key: text("key").notNull(),
    content: text("content").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    source: text("source"),
    supersededBy: uuid("superseded_by"),
    expiresAt: tsz("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memory_items_key_uq").on(t.channelId, t.kind, t.key)],
);

/** Specialist ↔ manager blackboard. Only the manager converts messages into jobs. */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    jobId: uuid("job_id"),
    fromAgent: text("from_agent").notNull(),
    toAgent: text("to_agent").notNull(),
    type: text("type").notNull(), // result|revision_request|question|escalation|handoff
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    hop: integer("hop").notNull().default(0),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("open"), // open|converted|closed|rejected
    createdAt: createdAt(),
    closedAt: tsz("closed_at"),
  },
  (t) => [uniqueIndex("agent_messages_dedupe_uq").on(t.dedupeKey), index("agent_messages_open_idx").on(t.channelId, t.status)],
);

/** License ledger: every external asset used in a video. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // footage|image|music|voice|font|sfx
    provider: text("provider").notNull(),
    providerAssetId: text("provider_asset_id").notNull(),
    sourceUrl: text("source_url"),
    license: text("license").notNull(),
    licenseUrl: text("license_url"),
    attribution: text("attribution"),
    sha256: text("sha256"),
    retrievedAt: tsz("retrieved_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assets_uq").on(t.projectId, t.provider, t.providerAssetId)],
);

/** Small previews (contact sheet, thumbnail) so the QA editor can see the output. */
export const mediaPreviews = pgTable("media_previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // contact_sheet | thumbnail | frame
  mime: text("mime").notNull(),
  dataBase64: text("data_base64").notNull(),
  createdAt: createdAt(),
});

export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    youtubeVideoId: text("youtube_video_id").notNull().default(""), // "" = channel-level row
    day: text("day").notNull(), // YYYY-MM-DD
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull(),
    pulledAt: tsz("pulled_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("analytics_snapshots_uq").on(t.channelId, t.youtubeVideoId, t.day)],
);

export const researchCache = pgTable("research_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  fetchedAt: tsz("fetched_at").notNull().defaultNow(),
  expiresAt: tsz("expires_at").notNull(),
});

/** Free-tier accounting. Enforced by app.record_quota(): an exhausted window pauses the provider. */
export const quotaLedger = pgTable(
  "quota_ledger",
  {
    provider: text("provider").notNull(),
    windowKind: text("window_kind").notNull(), // day | week | month
    windowStart: tsz("window_start").notNull(),
    used: numeric("used", { precision: 14, scale: 2 }).notNull().default("0"),
    hardLimit: numeric("hard_limit", { precision: 14, scale: 2 }).notNull(),
    pausedUntil: tsz("paused_until"),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("quota_ledger_pk").on(t.provider, t.windowKind, t.windowStart)],
);

export const heartbeats = pgTable("heartbeats", {
  component: text("component").primaryKey(),
  lastSeenAt: tsz("last_seen_at").notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, unknown>>(),
});

export const ttsEvaluations = pgTable("tts_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  engine: text("engine").notNull(),
  version: text("version"),
  license: text("license"),
  licenseVerifiedAt: tsz("license_verified_at"),
  sampleId: text("sample_id").notNull(),
  language: text("language").notNull(),
  rtf: numeric("rtf", { precision: 8, scale: 3 }),
  peakRamMb: integer("peak_ram_mb"),
  durationS: numeric("duration_s", { precision: 8, scale: 2 }),
  listenerScore: numeric("listener_score", { precision: 3, scale: 1 }),
  notes: text("notes"),
  createdAt: createdAt(),
});

export type Channel = typeof channels.$inferSelect;
export type ManagerRun = typeof managerRuns.$inferSelect;
export type Idea = typeof ideas.$inferSelect;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type StageRun = typeof stageRuns.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Publication = typeof publications.$inferSelect;
export type HistoryEvent = typeof historyEvents.$inferSelect;
export type ProjectStatus = (typeof projectStatus.enumValues)[number];
export type VideoFormat = (typeof videoFormat.enumValues)[number];
export type ArtifactKind = (typeof artifactKind.enumValues)[number];
