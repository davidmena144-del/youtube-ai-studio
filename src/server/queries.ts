import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, lte, sql, sum } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { getDb } from "./db/client";
import {
  historyEvents,
  jobs,
  projects,
  publications,
  reviews,
  stageRuns,
  type ProjectStatus,
} from "./db/schema";
import { env } from "./env";
import { loadArtifacts } from "./manager/manager";
import { resolveLlmProviderId } from "./providers/llm";
import { getSettings } from "./settings";

export async function dashboardStats() {
  await requireAdmin();
  const db = getDb();
  const byStatus = await db.select({ status: projects.status, n: count() }).from(projects).groupBy(projects.status);
  const jobsByStatus = await db
    .select({ status: jobs.status, n: count() })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running", "dead"]))
    .groupBy(jobs.status);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [cost] = await db
    .select({ usd: sum(stageRuns.costUsd), tokensOut: sum(stageRuns.outputTokens) })
    .from(stageRuns)
    .where(gte(stageRuns.startedAt, monthStart));
  const [lastJob] = await db
    .select({ at: jobs.finishedAt })
    .from(jobs)
    .where(isNotNull(jobs.finishedAt))
    .orderBy(desc(jobs.finishedAt))
    .limit(1);
  const status = Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Partial<Record<ProjectStatus, number>>;
  const jobsMap = Object.fromEntries(jobsByStatus.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    status,
    totalProjects: byStatus.reduce((a, r) => a + r.n, 0),
    jobs: { queued: jobsMap.queued ?? 0, running: jobsMap.running ?? 0, dead: jobsMap.dead ?? 0 },
    monthCostUsd: Number(cost?.usd ?? 0),
    lastWorkerActivity: lastJob?.at ?? null,
  };
}

export async function listProjects(opts: { status?: ProjectStatus[]; limit?: number } = {}) {
  await requireAdmin();
  const db = getDb();
  const where = opts.status?.length ? inArray(projects.status, opts.status) : undefined;
  return db
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt))
    .limit(opts.limit ?? 100);
}

export async function projectDetail(id: string) {
  await requireAdmin();
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return null;
  const [arts, runs, revs, pubs, history, activeJobs] = await Promise.all([
    loadArtifacts(id),
    db.select().from(stageRuns).where(eq(stageRuns.projectId, id)).orderBy(desc(stageRuns.startedAt)).limit(50),
    db.select().from(reviews).where(eq(reviews.projectId, id)).orderBy(desc(reviews.createdAt)),
    db.select().from(publications).where(eq(publications.projectId, id)).orderBy(desc(publications.createdAt)),
    db.select().from(historyEvents).where(eq(historyEvents.projectId, id)).orderBy(desc(historyEvents.id)).limit(100),
    db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, id), inArray(jobs.status, ["queued", "running"])))
      .orderBy(asc(jobs.runAt)),
  ]);
  return { project, artifacts: arts, stageRuns: runs, reviews: revs, publications: pubs, history, activeJobs };
}

export async function listHistory(opts: { beforeId?: number; limit?: number; level?: "warn" | "error" } = {}) {
  await requireAdmin();
  const conditions = [];
  if (opts.beforeId) conditions.push(lt(historyEvents.id, opts.beforeId));
  if (opts.level === "error") conditions.push(eq(historyEvents.level, "error"));
  if (opts.level === "warn") conditions.push(inArray(historyEvents.level, ["warn", "error"]));
  return getDb()
    .select({ event: historyEvents, projectTitle: projects.title })
    .from(historyEvents)
    .leftJoin(projects, eq(historyEvents.projectId, projects.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(historyEvents.id))
    .limit(opts.limit ?? 50);
}

export async function listJobs(limit = 100) {
  await requireAdmin();
  return getDb()
    .select({ job: jobs, projectTitle: projects.title })
    .from(jobs)
    .leftJoin(projects, eq(jobs.projectId, projects.id))
    .orderBy(sql`case when ${jobs.status} in ('running','queued','dead') then 0 else 1 end`, desc(jobs.updatedAt))
    .limit(limit);
}

/** A ~31-day window starting yesterday, shifted by `offset` months of 30 days. */
export function calendarWindow(offset: number) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const from = new Date(now.getTime() + offset * 30 * DAY - DAY);
  return { now, from, to: new Date(from.getTime() + 31 * DAY) };
}

export async function calendarItems(from: Date, to: Date) {
  await requireAdmin();
  return getDb()
    .select()
    .from(projects)
    .where(and(isNotNull(projects.scheduledPublishAt), gte(projects.scheduledPublishAt, from), lte(projects.scheduledPublishAt, to)))
    .orderBy(asc(projects.scheduledPublishAt));
}

export type ProviderState = "active" | "configured_untested" | "tested" | "missing" | "not_built";

/** Honest integration status: nothing is reported as working until it has actually succeeded. */
export async function providerStatus() {
  await requireAdmin();
  const db = getDb();
  const llmId = resolveLlmProviderId();
  const [lastAnthropic] = await db
    .select({ at: stageRuns.finishedAt, model: stageRuns.model })
    .from(stageRuns)
    .where(and(eq(stageRuns.provider, "anthropic"), eq(stageRuns.status, "succeeded")))
    .orderBy(desc(stageRuns.finishedAt))
    .limit(1);
  const e = env();
  return {
    llm: {
      active: llmId,
      anthropic: (e.ANTHROPIC_API_KEY ? (lastAnthropic ? "tested" : "configured_untested") : "missing") as ProviderState,
      lastAnthropicSuccess: lastAnthropic?.at ?? null,
      lastAnthropicModel: lastAnthropic?.model ?? null,
    },
    publishing: { mode: e.PUBLISHING_MODE, youtube: "not_built" as ProviderState },
    encryptionKey: Boolean(e.ENCRYPTION_KEY),
    cronSecret: Boolean(e.CRON_SECRET),
    workerInline: e.WORKER_INLINE,
    passwordHashed: Boolean(e.ADMIN_PASSWORD_HASH),
  };
}

/** Settings for rendering a page: same as getSettings(), but only for a valid, unrevoked session. */
export async function getSettingsForAdmin() {
  await requireAdmin();
  return getSettings();
}
