import { and, desc, eq, max, notInArray } from "drizzle-orm";
import { z } from "zod";
import { AGENTS } from "../agents";
import type { AgentContext, AgentDefinition, PipelineArtifacts, QaReport, Seo } from "../agents/types";
import { getDb, type Executor } from "../db/client";
import {
  artifacts,
  jobs,
  projects,
  publications,
  reviews,
  stageRuns,
  type ArtifactKind,
  type Job,
  type Project,
} from "../db/schema";
import { recordHistory } from "../history";
import { createLlmProvider } from "../providers/llm";
import { DryRunPublisher } from "../providers/publisher/dry-run";
import type { Publisher } from "../providers/publisher/types";
import { errorMessage, NonRetryableError } from "../queue/errors";
import { cancelProjectJobs, enqueue, retryJob } from "../queue/queue";
import { getSettings } from "../settings";
import { isStageId, nextStage, pipelineFor, stageDef, type StageId } from "./pipeline";

/**
 * Claude Manager — the orchestrator. It owns the project lifecycle:
 * runs each pipeline stage through its specialised agent, reads the QA verdict,
 * triggers automatic rewrites, enforces the human approval gate, and dispatches publishing.
 * Every transition is written to the History log.
 */

const ACTOR = "claude-manager";

export const JOB_STAGE = "stage.run";
export const JOB_PUBLISH = "publish.run";

export class UserFacingError extends Error {}

// ---------------- Project creation ----------------

export const CreateProjectInput = z.object({
  topic: z.string().trim().min(3, "الموضوع قصير جدًا").max(500),
  format: z.enum(["long", "short"]),
  language: z.enum(["ar", "en"]),
  targetDurationSec: z.coerce.number().int().min(15).max(3600),
  tone: z.string().trim().max(200).optional(),
  audience: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  scheduledPublishAt: z.date().nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export async function createProject(raw: CreateProjectInput, opts: { start?: boolean } = {}): Promise<Project> {
  const input = CreateProjectInput.parse(raw);
  if (input.format === "short" && input.targetDurationSec > 180) {
    throw new UserFacingError("مدة الـ Short يجب ألا تتجاوز 180 ثانية");
  }
  const [project] = await getDb()
    .insert(projects)
    .values({
      topic: input.topic,
      title: input.topic.slice(0, 100),
      format: input.format,
      language: input.language,
      targetDurationSec: input.targetDurationSec,
      tone: input.tone || null,
      audience: input.audience || null,
      notes: input.notes || null,
      scheduledPublishAt: input.scheduledPublishAt ?? null,
    })
    .returning();
  await recordHistory({
    actor: "user",
    action: "project.created",
    projectId: project.id,
    entityType: "project",
    entityId: project.id,
    message: `تم إنشاء مشروع ${project.format === "short" ? "Short" : "فيديو طويل"}: ${project.topic}`,
    data: { format: project.format, targetDurationSec: project.targetDurationSec, language: project.language },
  });
  if (opts.start ?? true) return startProject(project.id);
  return project;
}

export async function startProject(projectId: string): Promise<Project> {
  const project = await mustGetProject(projectId);
  if (project.status !== "draft") throw new UserFacingError("المشروع بدأ بالفعل");
  const first = pipelineFor(project.format)[0];
  const updated = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({ status: "queued", currentStage: first.id, lastError: null })
      .where(eq(projects.id, projectId))
      .returning();
    await enqueueStage(row, first.id, [], tx);
    return row;
  });
  // History is written after commit so it never records work that was rolled back.
  await recordHistory({
    actor: ACTOR,
    action: "pipeline.started",
    projectId,
    message: `بدأ خط الإنتاج من مرحلة ${first.label}`,
  });
  return updated;
}

// ---------------- Stage execution ----------------

type StagePayload = { projectId: string; stage: StageId; revision: number; autoRevision: number; feedback: string[] };

function stageKey(p: Pick<Project, "id" | "revision" | "autoRevisions">, stage: StageId) {
  return `stage:${p.id}:r${p.revision}:a${p.autoRevisions}:${stage}`;
}

async function enqueueStage(
  project: Project,
  stage: StageId,
  feedback: string[],
  tx?: Parameters<typeof enqueue>[1],
) {
  const payload: StagePayload = {
    projectId: project.id,
    stage,
    revision: project.revision,
    autoRevision: project.autoRevisions,
    feedback,
  };
  return enqueue(
    { type: JOB_STAGE, payload, idempotencyKey: stageKey(project, stage), projectId: project.id, maxAttempts: 3 },
    tx,
  );
}

/** Latest version of each artifact kind for the project. */
export async function loadArtifacts(projectId: string): Promise<PipelineArtifacts & { qa?: QaReport }> {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version));
  const latest = new Map<ArtifactKind, unknown>();
  for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, r.content);
  return {
    research: latest.get("research") as PipelineArtifacts["research"],
    script: latest.get("script") as PipelineArtifacts["script"],
    storyboard: latest.get("storyboard") as PipelineArtifacts["storyboard"],
    seo: latest.get("seo") as PipelineArtifacts["seo"],
    qa: latest.get("qa_report") as QaReport | undefined,
  };
}

/** Statuses in which no pipeline stage may run or change the project. */
const CLOSED_STATUSES: Project["status"][] = ["cancelled", "approved", "publishing", "published"];

/**
 * SQL condition: the project is still on the revision this job was created for and not closed.
 * Every write a stage job makes is guarded by it, so a cancelled or revised project can never be
 * "revived" by a job that was already running when the user acted.
 */
function stillCurrent(payload: StagePayload) {
  return and(
    eq(projects.id, payload.projectId),
    eq(projects.revision, payload.revision),
    eq(projects.autoRevisions, payload.autoRevision),
    notInArray(projects.status, CLOSED_STATUSES),
  );
}

async function recordSkipped(payload: StagePayload, job: Job, reason: string) {
  await recordHistory({
    actor: ACTOR,
    action: "stage.skipped",
    projectId: payload.projectId,
    level: "warn",
    message: `تم تجاهل مهمة مرحلة ${payload.stage}: ${reason}`,
    data: { jobId: job.id, jobRevision: payload.revision },
  });
}

export async function runStageJob(job: Job): Promise<void> {
  const payload = job.payload as unknown as StagePayload;
  if (!isStageId(payload.stage)) throw new NonRetryableError(`Invalid stage in job payload`);
  const db = getDb();
  const project = await getProject(payload.projectId);
  if (!project) throw new NonRetryableError("Project no longer exists");

  const def = stageDef(project.format, payload.stage);
  const agent = AGENTS[def.agent] as unknown as AgentDefinition<unknown, unknown>;

  // If this exact job already produced its artifact (crash before ack), do not pay for the LLM call again.
  const [done] = await db
    .select({ id: stageRuns.id })
    .from(stageRuns)
    .where(and(eq(stageRuns.jobId, job.id), eq(stageRuns.status, "succeeded")));
  if (done) {
    await advanceAfterStage(project, payload, await loadArtifacts(project.id));
    return;
  }

  // Claim the stage on the project; refuse if the project was cancelled, approved or revised.
  const [current] = await db
    .update(projects)
    .set({ status: "in_progress", currentStage: def.id })
    .where(stillCurrent(payload))
    .returning();
  if (!current) {
    await recordSkipped(payload, job, "المشروع أُلغي أو تغيّرت مراجعته");
    return;
  }

  const settings = await getSettings();
  const ctx: AgentContext = { project: current, settings, artifacts: await loadArtifacts(project.id), feedback: payload.feedback };

  const [run] = await db
    .insert(stageRuns)
    .values({ projectId: project.id, stage: def.id, agent: agent.id, revision: project.revision, jobId: job.id })
    .returning();
  await recordHistory({
    actor: `agent:${agent.id}`,
    action: "stage.started",
    projectId: project.id,
    entityType: "stage_run",
    entityId: run.id,
    message: `${agent.label}: بدأ العمل على مرحلة ${def.label} (محاولة ${job.attempts})`,
  });

  const started = Date.now();
  let output: unknown;
  let meta: { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null };
  try {
    const llm = createLlmProvider(settings);
    const result = await llm.generateStructured(agent.build(ctx));
    output = agent.finalize ? agent.finalize(result.data, ctx) : result.data;
    meta = { provider: result.provider, model: result.model, ...result.usage };
  } catch (err) {
    await db
      .update(stageRuns)
      .set({ status: "failed", error: errorMessage(err).slice(0, 4000), finishedAt: new Date(), durationMs: Date.now() - started })
      .where(eq(stageRuns.id, run.id));
    throw err;
  }

  const usageFields = {
    provider: meta.provider,
    model: meta.model,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    costUsd: meta.costUsd === null ? null : meta.costUsd.toFixed(6),
    finishedAt: new Date(),
    durationMs: Date.now() - started,
  };

  const saved = await db.transaction(async (tx) => {
    // Re-check (and lock the project row) after the slow LLM call: the user may have cancelled meanwhile.
    const [locked] = await tx.update(projects).set({ updatedAt: new Date() }).where(stillCurrent(payload)).returning({ id: projects.id });
    if (!locked) return false;
    const [{ v }] = await tx
      .select({ v: max(artifacts.version) })
      .from(artifacts)
      .where(and(eq(artifacts.projectId, project.id), eq(artifacts.kind, def.artifactKind)));
    await tx.insert(artifacts).values({
      projectId: project.id,
      kind: def.artifactKind,
      version: (v ?? 0) + 1,
      revision: project.revision,
      content: output,
      stageRunId: run.id,
    });
    await tx.update(stageRuns).set({ status: "succeeded", ...usageFields }).where(eq(stageRuns.id, run.id));
    const title =
      def.id === "script" ? (output as { workingTitle?: string }).workingTitle : def.id === "seo" ? (output as Seo).recommendedTitle : undefined;
    if (title) await tx.update(projects).set({ title: title.slice(0, 100) }).where(eq(projects.id, project.id));
    return true;
  });

  if (!saved) {
    // The call was paid for, so keep its usage on record, but discard the output.
    await db
      .update(stageRuns)
      .set({ status: "failed", error: "نتيجة مهملة: أُلغي المشروع أو تغيّرت مراجعته أثناء التنفيذ", ...usageFields })
      .where(eq(stageRuns.id, run.id));
    await recordSkipped(payload, job, "أُلغي المشروع أثناء التنفيذ، أُهملت النتيجة");
    return;
  }

  await recordHistory({
    actor: `agent:${agent.id}`,
    action: "stage.succeeded",
    projectId: project.id,
    entityType: "stage_run",
    entityId: run.id,
    message: `${agent.label}: اكتملت مرحلة ${def.label}`,
    data: { provider: meta.provider, model: meta.model, inputTokens: meta.inputTokens, outputTokens: meta.outputTokens, costUsd: meta.costUsd },
  });

  await advanceAfterStage(project, payload, await loadArtifacts(project.id));
}

/** Decide what happens after a stage: next stage, automatic rewrite, or the human review gate. */
async function advanceAfterStage(project: Project, payload: StagePayload, arts: Awaited<ReturnType<typeof loadArtifacts>>) {
  const db = getDb();
  const next = nextStage(project.format, payload.stage);
  if (next) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ currentStage: next.id, status: "in_progress" })
        .where(stillCurrent(payload))
        .returning();
      if (row) await enqueueStage(row, next.id, payload.feedback, tx);
    });
    return;
  }

  // Final stage = QA.
  const qa = arts.qa;
  const settings = await getSettings();
  if (qa && !qa.passed && project.autoRevisions < settings.qaMaxAutoRevisions) {
    const feedback = [
      ...qa.checks.filter((c) => !c.passed && c.severity !== "minor").map((c) => c.message),
      ...qa.issues.filter((i) => i.severity !== "minor").map((i) => `${i.description} — ${i.suggestion}`),
    ];
    // Counter bump and the rewrite job are written atomically, so a crash cannot strand the project.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ autoRevisions: payload.autoRevision + 1, currentStage: "script", status: "in_progress" })
        .where(stillCurrent(payload))
        .returning();
      if (row) await enqueueStage(row, "script", feedback.length ? feedback : [qa.summary], tx);
      return row;
    });
    if (!updated) return;
    await recordHistory({
      actor: ACTOR,
      action: "qa.auto_revision",
      projectId: project.id,
      level: "warn",
      message: `لم تجتز مراجعة الجودة (الدرجة ${qa.score}). إعادة كتابة تلقائية رقم ${updated.autoRevisions}`,
      data: { feedback },
    });
    return;
  }

  const [ready] = await db
    .update(projects)
    .set({ status: "awaiting_review", currentStage: null, lastError: null })
    .where(stillCurrent(payload))
    .returning({ id: projects.id });
  if (!ready) return;
  await recordHistory({
    actor: ACTOR,
    action: "review.requested",
    projectId: project.id,
    level: qa?.passed ? "info" : "warn",
    message: qa?.passed
      ? `جاهز لمراجعتك — درجة الجودة ${qa.score}`
      : `جاهز لمراجعتك مع ملاحظات جودة غير محلولة (الدرجة ${qa?.score ?? "?"})`,
  });
}

/** Called by the worker when a job exhausted its retries or failed permanently. */
export async function onJobDead(job: Job, err: unknown) {
  if (!job.projectId) return;
  const db = getDb();
  const message = errorMessage(err).slice(0, 1000);
  if (job.type === JOB_PUBLISH) {
    const publicationId = (job.payload as { publicationId?: string }).publicationId;
    if (publicationId) {
      await db
        .update(publications)
        .set({ status: "failed", error: message })
        .where(and(eq(publications.id, publicationId), notInArray(publications.status, ["succeeded"])));
    }
    // Only roll back a project that is still waiting on this publication.
    await db
      .update(projects)
      .set({ status: "approved", lastError: `فشل النشر: ${message}` })
      .where(and(eq(projects.id, job.projectId), eq(projects.status, "publishing")));
  } else {
    // A dead job from an older revision, or for a cancelled/closed project, must not mark it failed.
    await db
      .update(projects)
      .set({ status: "failed", lastError: message })
      .where(stillCurrent(job.payload as unknown as StagePayload));
  }
  await recordHistory({
    actor: ACTOR,
    action: "job.dead",
    projectId: job.projectId,
    level: "error",
    entityType: "job",
    entityId: job.id,
    message: `توقفت المهمة ${job.type} بعد ${job.attempts} محاولة: ${message}`,
  });
}

// ---------------- Human review gate ----------------

export const ReviewInput = z.object({
  projectId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.string().trim().max(4000).optional(),
  restartFromStage: z.enum(["research", "script", "direction", "seo", "qa"]).optional(),
});

/**
 * Apply a review decision only if the project is still awaiting review on the same revision.
 * Two simultaneous decisions (double tap, two devices) cannot both apply: the loser gets an error.
 */
async function claimReview(tx: Executor, project: Project, set: Partial<typeof projects.$inferInsert>) {
  const [row] = await tx
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, project.id), eq(projects.status, "awaiting_review"), eq(projects.revision, project.revision)))
    .returning();
  if (!row) throw new UserFacingError("تغيّرت حالة المشروع للتو — حدّث الصفحة");
  return row;
}

export async function submitReview(raw: z.infer<typeof ReviewInput>) {
  const input = ReviewInput.parse(raw);
  const project = await mustGetProject(input.projectId);
  if (project.status !== "awaiting_review") throw new UserFacingError("المشروع ليس في انتظار المراجعة");

  if (input.decision === "approved") {
    await getDb().transaction(async (tx) => {
      await claimReview(tx, project, { status: "approved" });
      await tx.insert(reviews).values({ projectId: project.id, revision: project.revision, decision: "approved", notes: input.notes });
    });
    await recordHistory({ actor: "user", action: "review.approved", projectId: project.id, message: "تمت الموافقة على المحتوى" });
    return;
  }

  if (!input.notes) throw new UserFacingError("اكتب ملاحظاتك ليعمل عليها الوكلاء");
  const from = input.restartFromStage ?? "script";
  await getDb().transaction(async (tx) => {
    const updated = await claimReview(tx, project, {
      status: "changes_requested",
      revision: project.revision + 1,
      autoRevisions: 0,
      currentStage: from,
    });
    await tx.insert(reviews).values({
      projectId: project.id,
      revision: project.revision,
      decision: "changes_requested",
      notes: input.notes,
      restartFromStage: from,
    });
    await enqueueStage(updated, from, [input.notes!], tx);
  });
  await recordHistory({
    actor: "user",
    action: "review.changes_requested",
    projectId: project.id,
    message: `طُلبت تعديلات — إعادة التشغيل من مرحلة ${stageDef(project.format, from).label}`,
    data: { notes: input.notes, restartFromStage: from },
  });
}

/** Retry the most recent dead job of a failed project. */
export async function retryProject(projectId: string) {
  const project = await mustGetProject(projectId);
  if (project.status !== "failed" && project.status !== "approved") throw new UserFacingError("لا توجد مهمة فاشلة لإعادتها");
  const [dead] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.status, "dead")))
    .orderBy(desc(jobs.updatedAt))
    .limit(1);
  if (!dead) throw new UserFacingError("لا توجد مهمة فاشلة لإعادتها");
  if (dead.type === JOB_PUBLISH) {
    throw new UserFacingError("لإعادة النشر استخدم زر النشر مجددًا بعد مراجعة سبب الفشل");
  }
  await retryJob(dead.id);
  await getDb().update(projects).set({ status: "queued", lastError: null }).where(eq(projects.id, projectId));
  await recordHistory({ actor: "user", action: "job.retried", projectId, entityType: "job", entityId: dead.id, message: "إعادة محاولة يدوية" });
}

/** Retry one dead job from the jobs page. Publish jobs are excluded on purpose (see retryProject). */
export async function retryJobById(jobId: string) {
  if (!z.string().uuid().safeParse(jobId).success) throw new UserFacingError("معرّف مهمة غير صالح");
  const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new UserFacingError("المهمة غير موجودة");
  if (job.type === JOB_PUBLISH) throw new UserFacingError("لإعادة النشر استخدم زر النشر من صفحة المشروع بعد مراجعة سبب الفشل");
  if (!(await retryJob(jobId))) throw new UserFacingError("لا يمكن إعادة هذه المهمة");
  if (job.projectId) {
    await getDb()
      .update(projects)
      .set({ status: "queued", lastError: null })
      .where(and(eq(projects.id, job.projectId), eq(projects.status, "failed")));
  }
  await recordHistory({ actor: "user", action: "job.retried", projectId: job.projectId, entityType: "job", entityId: jobId, message: "إعادة مهمة يدويًا" });
}

export async function cancelProject(projectId: string) {
  const project = await mustGetProject(projectId);
  if (["published", "publishing"].includes(project.status)) throw new UserFacingError("لا يمكن إلغاء مشروع منشور");
  await cancelProjectJobs(projectId);
  await getDb().update(projects).set({ status: "cancelled", currentStage: null }).where(eq(projects.id, projectId));
  await recordHistory({ actor: "user", action: "project.cancelled", projectId, message: "تم إلغاء المشروع" });
}

export async function scheduleProject(projectId: string, when: Date | null) {
  const project = await mustGetProject(projectId);
  if (["published", "publishing", "cancelled"].includes(project.status)) throw new UserFacingError("لا يمكن تغيير موعد هذا المشروع");
  if (when && when.getTime() < Date.now()) throw new UserFacingError("الموعد يجب أن يكون في المستقبل");
  await getDb().update(projects).set({ scheduledPublishAt: when }).where(eq(projects.id, projectId));
  await recordHistory({
    actor: "user",
    action: "project.scheduled",
    projectId,
    message: when ? `موعد النشر: ${when.toISOString()}` : "أُلغي موعد النشر",
  });
}

// ---------------- Publishing ----------------

export function getPublisher(): Publisher {
  // Phase 1: dry-run only. The live YouTube publisher is added and tested in phase 3.
  return new DryRunPublisher();
}

export async function requestPublish(projectId: string) {
  const project = await mustGetProject(projectId);
  if (project.status !== "approved") throw new UserFacingError("لا يمكن النشر قبل الموافقة على المشروع");
  const publisher = getPublisher();
  const settings = await getSettings();
  const publishAt = project.scheduledPublishAt && project.scheduledPublishAt > new Date() ? project.scheduledPublishAt : null;

  const publicationId = await getDb().transaction(async (tx) => {
    const previous = await tx
      .select({ id: publications.id, status: publications.status })
      .from(publications)
      .where(and(eq(publications.projectId, project.id), eq(publications.mode, publisher.mode)));
    if (previous.some((p) => p.status !== "failed")) {
      throw new UserFacingError("يوجد نشر سابق أو جارٍ لهذا المشروع — تم منع التكرار");
    }
    // Only failed attempts exist (or none): a new attempt gets a new key; the partial unique index
    // still guarantees at most one active publication even under concurrent requests.
    const idempotencyKey = `publish:${project.id}:${publisher.mode}:${previous.length + 1}`;
    const [pub] = await tx
      .insert(publications)
      .values({
        projectId: project.id,
        mode: publisher.mode,
        revision: project.revision,
        idempotencyKey,
        privacy: settings.defaultPrivacy,
        publishAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!pub) throw new UserFacingError("يوجد نشر سابق لهذا المشروع — تم منع التكرار");
    await tx.update(projects).set({ status: "publishing" }).where(eq(projects.id, project.id));
    await enqueue(
      { type: JOB_PUBLISH, payload: { publicationId: pub.id }, idempotencyKey, projectId: project.id, maxAttempts: 3 },
      tx,
    );
    return pub.id;
  });
  await recordHistory({
    actor: "user",
    action: "publish.requested",
    projectId: project.id,
    entityType: "publication",
    entityId: publicationId,
    message: `طلب نشر (${publisher.mode === "dry_run" ? "تجريبي — لن يُرسل شيء إلى YouTube" : "حقيقي"})`,
  });
  return publicationId;
}

export async function runPublishJob(job: Job) {
  const { publicationId } = job.payload as { publicationId: string };
  const db = getDb();
  const [pub] = await db.select().from(publications).where(eq(publications.id, publicationId));
  if (!pub) throw new NonRetryableError("Publication record not found");
  if (pub.status === "succeeded") return; // idempotent: never publish twice
  if (pub.status === "failed") throw new NonRetryableError("This publication attempt was closed as failed — request publishing again");
  // A previous attempt reached the upload step and then crashed. For a live upload the video may
  // already exist on YouTube, so never upload blindly again: a human must verify first.
  if (pub.status === "uploading" && pub.mode === "live") {
    throw new NonRetryableError("A previous upload attempt was interrupted. Check the channel before retrying to avoid a duplicate video.");
  }
  const project = await mustGetProject(pub.projectId);
  const arts = await loadArtifacts(project.id);
  if (!arts.seo) throw new NonRetryableError("SEO metadata is missing");

  const publisher = getPublisher();
  if (publisher.mode !== pub.mode) throw new NonRetryableError("Publisher mode changed since the request — re-request publishing");

  await db.update(publications).set({ status: "uploading" }).where(eq(publications.id, pub.id));
  const hashtags = arts.seo.hashtags.join(" ");
  const request = {
    projectId: project.id,
    idempotencyKey: pub.idempotencyKey,
    title: arts.seo.recommendedTitle.slice(0, 100),
    description: `${arts.seo.description}${hashtags ? `\n\n${hashtags}` : ""}`.slice(0, 5000),
    tags: arts.seo.tags,
    privacy: pub.privacy as "private" | "unlisted" | "public",
    publishAt: pub.publishAt,
    isShort: project.format === "short",
    categoryId: arts.seo.categoryId || "22",
    defaultLanguage: project.language,
    videoStorageKey: null,
    thumbnailStorageKey: null,
  };
  const result = await publisher.publish(request);
  await db.transaction(async (tx) => {
    await tx
      .update(publications)
      .set({ status: "succeeded", externalId: result.externalId, externalUrl: result.externalUrl, request, response: result.raw, error: null })
      .where(eq(publications.id, pub.id));
    await tx.update(projects).set({ status: "published", lastError: null }).where(eq(projects.id, project.id));
  });
  await recordHistory({
    actor: "worker",
    action: "publish.succeeded",
    projectId: project.id,
    entityType: "publication",
    entityId: pub.id,
    message: pub.mode === "dry_run" ? "اكتمل النشر التجريبي (لم يُرسل شيء إلى YouTube)" : `تم النشر: ${result.externalId}`,
  });
}

// ---------------- Helpers ----------------

export async function getProject(id: string): Promise<Project | undefined> {
  const [p] = await getDb().select().from(projects).where(eq(projects.id, id));
  return p;
}

async function mustGetProject(id: string): Promise<Project> {
  const p = await getProject(id);
  if (!p) throw new UserFacingError("المشروع غير موجود");
  return p;
}
