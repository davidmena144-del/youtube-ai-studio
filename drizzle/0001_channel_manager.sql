-- Autonomous channel manager: channel model, memory, coordination, quotas, license ledger.
-- Additive only: no existing column, table or value is dropped or renamed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'brief';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'fact_check';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'thumbnail_spec';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'media_qa_report';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'strategy_note';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'producing';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'produced';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'media_review';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'scheduled';--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"from_agent" text NOT NULL,
	"to_agent" text NOT NULL,
	"type" text NOT NULL,
	"body" jsonb NOT NULL,
	"hop" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"youtube_video_id" text DEFAULT '' NOT NULL,
	"day" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"provider_asset_id" text NOT NULL,
	"source_url" text,
	"license" text NOT NULL,
	"license_url" text,
	"attribution" text,
	"sha256" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"format" "video_format" NOT NULL,
	"idea_id" uuid,
	"project_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" text,
	"title" text NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"niche" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_youtube_channel_id_unique" UNIQUE("youtube_channel_id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"manager_run_id" uuid,
	"project_id" uuid,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"rationale" text,
	"alternatives" jsonb,
	"expected_outcome" text,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"text" text NOT NULL,
	"kind" text DEFAULT 'instruction' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"component" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"fingerprint" text NOT NULL,
	"pillar" text,
	"format" "video_format" NOT NULL,
	"score" numeric(6, 2),
	"status" text DEFAULT 'backlog' NOT NULL,
	"source" text DEFAULT 'strategist' NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"prompt_version" text,
	"agenda" jsonb,
	"agenda_fingerprint" text,
	"actions_count" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"abort_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"data_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"confidence" numeric(4, 3),
	"source" text,
	"superseded_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_ledger" (
	"provider" text NOT NULL,
	"window_kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"used" numeric(14, 2) DEFAULT '0' NOT NULL,
	"hard_limit" numeric(14, 2) NOT NULL,
	"paused_until" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "research_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"rationale" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine" text NOT NULL,
	"version" text,
	"license" text,
	"license_verified_at" timestamp with time zone,
	"sample_id" text NOT NULL,
	"language" text NOT NULL,
	"rtf" numeric(8, 3),
	"peak_ram_mb" integer,
	"duration_s" numeric(8, 2),
	"listener_score" numeric(3, 1),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "kind" text DEFAULT 'cognitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "assignee" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "idea_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slot_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "origin" text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "youtube_privacy" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "contains_synthetic_media" boolean;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "upload_session_uri" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "verified_on_channel_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "manager_run_id" uuid;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "model_tier" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "approx_input_chars" integer;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "approx_output_chars" integer;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_slots" ADD CONSTRAINT "calendar_slots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_slots" ADD CONSTRAINT "calendar_slots_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_policies" ADD CONSTRAINT "channel_policies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directives" ADD CONSTRAINT "directives_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_runs" ADD CONSTRAINT "manager_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previews" ADD CONSTRAINT "media_previews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_dedupe_uq" ON "agent_messages" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "agent_messages_open_idx" ON "agent_messages" USING btree ("channel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshots_uq" ON "analytics_snapshots" USING btree ("channel_id","youtube_video_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_uq" ON "assets" USING btree ("project_id","provider","provider_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_slots_uq" ON "calendar_slots" USING btree ("channel_id","publish_at","format");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_policies_version_uq" ON "channel_policies" USING btree ("channel_id","version");--> statement-breakpoint
CREATE INDEX "decisions_channel_idx" ON "decisions" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "directives_channel_status_idx" ON "directives" USING btree ("channel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ideas_fingerprint_uq" ON "ideas" USING btree ("channel_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ideas_trgm_idx" ON "ideas" USING gin ("normalized_title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "manager_runs_one_running_uq" ON "manager_runs" USING btree ("channel_id") WHERE "manager_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "manager_runs_channel_idx" ON "manager_runs" USING btree ("channel_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_items_key_uq" ON "memory_items" USING btree ("channel_id","kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_ledger_pk" ON "quota_ledger" USING btree ("provider","window_kind","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_version_uq" ON "strategies" USING btree ("channel_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_one_active_uq" ON "strategies" USING btree ("channel_id") WHERE "strategies"."active";--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slot_id_calendar_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."calendar_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_kind_claim_idx" ON "jobs" USING btree ("kind","status","priority","run_at");--> statement-breakpoint
CREATE INDEX "projects_channel_idx" ON "projects" USING btree ("channel_id");
--> statement-breakpoint
ALTER TABLE "media_previews" ADD CONSTRAINT "media_previews_size_ck" CHECK (octet_length("data_base64") <= 600000);
