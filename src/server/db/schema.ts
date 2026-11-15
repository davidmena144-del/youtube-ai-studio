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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_status_idx").on(t.status), index("projects_scheduled_idx").on(t.scheduledPublishAt)],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key_uq").on(t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAt),
    index("jobs_project_idx").on(t.projectId),
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
