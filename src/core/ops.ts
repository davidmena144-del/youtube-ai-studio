import { one, rows, sql } from "../server/db/client";
import type { ManagerRun } from "../server/db/schema";
import { normalizeTitle, titleFingerprint } from "./dedupe";

/** Thin typed wrappers over the atomic app.* SQL functions. */

// ---------------- manager run lease
export async function acquireManagerLease(
  channelId: string,
  owner: string,
  opts: { ttlSeconds?: number; trigger?: "schedule" | "chat" | "manual"; promptVersion?: string } = {},
): Promise<ManagerRun | null> {
  const r = await one<Record<string, unknown>>(sql`
    SELECT * FROM app.acquire_manager_lease(${channelId}::uuid, ${owner}, ${opts.ttlSeconds ?? 3600}::int,
      ${opts.trigger ?? "schedule"}, ${opts.promptVersion ?? null})`);
  if (!r || !r.id) return null;
  return { id: r.id as string, channelId: r.channel_id as string, leaseOwner: r.lease_owner as string } as ManagerRun;
}

export async function finishManagerRun(
  runId: string,
  owner: string,
  status: "finished" | "noop" | "aborted",
  summary: string,
  counters: { actions?: number; modelCalls?: number; agenda?: unknown; fingerprint?: string; abortReason?: string } = {},
): Promise<boolean> {
  const r = await one<{ ok: boolean }>(sql`
    SELECT app.finish_manager_run(${runId}::uuid, ${owner}, ${status}, ${summary}, ${counters.actions ?? 0}::int,
      ${counters.modelCalls ?? 0}::int, ${counters.agenda === undefined ? null : JSON.stringify(counters.agenda)}::jsonb,
      ${counters.fingerprint ?? null}, ${counters.abortReason ?? null}) AS ok`);
  return Boolean(r?.ok);
}

// ---------------- quotas
export type QuotaWindow = "day" | "week" | "month";
export async function recordQuota(provider: string, window: QuotaWindow, amount: number, limit: number, tz = "UTC") {
  const r = await one<{ allowed: boolean; used: string; paused_until: string | null }>(sql`
    SELECT * FROM app.record_quota(${provider}, ${window}, ${amount}::numeric, ${limit}::numeric, ${tz})`);
  return { allowed: Boolean(r!.allowed), used: Number(r!.used), pausedUntil: r!.paused_until ? new Date(r!.paused_until) : null };
}

export async function quotaUsed(provider: string, window: QuotaWindow, tz = "UTC"): Promise<number> {
  const r = await one<{ used: string }>(sql`
    SELECT used FROM quota_ledger
    WHERE provider = ${provider} AND window_kind = ${window}
      AND window_start = (date_trunc(${window}, now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`);
  return r ? Number(r.used) : 0;
}

// ---------------- ideas
export async function addIdea(
  channelId: string,
  input: { title: string; format: "long" | "short"; pillar?: string; score?: number; source?: string; rationale?: string },
  threshold = 0.6,
) {
  const r = await one<{ idea_id: string | null; status: string; duplicate_of: string | null }>(sql`
    SELECT * FROM app.add_idea(${channelId}::uuid, ${input.title}, ${normalizeTitle(input.title)},
      ${titleFingerprint(input.title)}, ${input.format}::video_format, ${input.pillar ?? null},
      ${input.score ?? null}::numeric, ${input.source ?? "strategist"}, ${input.rationale ?? null}, ${threshold}::real)`);
  return { ideaId: r!.idea_id, status: r!.status as "backlog" | "duplicate", duplicateOf: r!.duplicate_of };
}

// ---------------- artifacts / projects / publishing / messages
export type NextJob = {
  type: string;
  key: string;
  kind?: "cognitive" | "media" | "system";
  assignee?: string;
  payload?: Record<string, unknown>;
  depends_on?: string[];
  priority?: number;
};

export async function saveArtifact(input: {
  jobId: string;
  owner: string;
  projectId: string;
  kind: string;
  content: unknown;
  revision: number;
  next?: NextJob[];
}) {
  const r = await one<{ status: string; artifact_id: string | null; version: number | null; enqueued: number }>(sql`
    SELECT * FROM app.save_artifact(${input.jobId}::uuid, ${input.owner}, ${input.projectId}::uuid,
      ${input.kind}::artifact_kind, ${JSON.stringify(input.content)}::jsonb, ${input.revision}::int,
      ${JSON.stringify(input.next ?? [])}::jsonb)`);
  return {
    status: r!.status as "saved" | "lease_lost" | "stale",
    artifactId: r!.artifact_id,
    version: r!.version,
    enqueued: Number(r!.enqueued),
  };
}

export async function cancelProject(projectId: string): Promise<boolean> {
  const r = await one<{ ok: boolean }>(sql`SELECT app.cancel_project(${projectId}::uuid) AS ok`);
  return Boolean(r?.ok);
}

export async function requestPublish(input: {
  projectId: string;
  mode: "dry_run" | "live";
  publishAt: Date | null;
  privacy: "private" | "unlisted" | "public";
  synthetic: boolean;
  key: string;
}) {
  const r = await one<{ status: string; publication_id: string | null }>(sql`
    SELECT * FROM app.request_publish(${input.projectId}::uuid, ${input.mode}::publication_mode,
      ${input.publishAt ? input.publishAt.toISOString() : null}::timestamptz, ${input.privacy},
      ${input.synthetic}, ${input.key})`);
  return {
    status: r!.status as "requested" | "duplicate" | "rate_limited" | "paused" | "not_ready" | "not_found",
    publicationId: r!.publication_id,
  };
}

export async function convertMessage(messageId: string, maxHop: number, job: { type: string; assignee?: string; payload?: unknown; priority?: number; kind?: string }) {
  const r = await one<{ outcome: string }>(sql`
    SELECT app.convert_message(${messageId}::uuid, ${maxHop}::int, ${JSON.stringify(job)}::jsonb) AS outcome`);
  return r!.outcome as "converted" | "hop_limit" | "not_open";
}

export async function rawRows<T = Record<string, unknown>>(q: ReturnType<typeof sql>) {
  return rows<T>(q);
}
