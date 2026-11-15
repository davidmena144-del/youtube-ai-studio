import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAgenda, noProgress } from "@/core/agenda";
import { initChannel, setPolicy } from "@/core/channel";
import { normalizeTitle, titleFingerprint } from "@/core/dedupe";
import {
  acquireManagerLease,
  addIdea,
  cancelProject,
  convertMessage,
  finishManagerRun,
  recordQuota,
  requestPublish,
  saveArtifact,
} from "@/core/ops";
import { preflight, spendModelCall } from "@/core/preflight";
import { agentMessages, artifacts, calendarSlots, jobs, managerRuns, projects, publications } from "@/server/db/schema";
import { claimNext, enqueue, getJob, ProjectClosedError } from "@/server/queue/queue";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
let channelId: string;
beforeEach(async () => {
  t = await useTestDb();
  channelId = (await initChannel({ title: "قناة الاختبار", timeZone: "Africa/Cairo" })).id;
});
afterEach(async () => {
  await t.close();
});

async function newProject(status: "in_progress" | "produced" | "media_review" = "in_progress", approvals = status !== "in_progress") {
  const [p] = await t.db
    .insert(projects)
    .values({ topic: "t", title: "t", format: "short", targetDurationSec: 45, channelId, status })
    .returning();
  if (approvals) {
    await t.db.insert(artifacts).values([
      { projectId: p.id, kind: "qa_report", version: 1, revision: p.revision, content: { approved: true } },
      { projectId: p.id, kind: "media_qa_report", version: 1, revision: p.revision, content: { qa: { passed: true } } },
    ]);
  }
  return p;
}

describe("manager run lease", () => {
  it("only one manager run per channel; an expired lease is reclaimed", async () => {
    const a = await acquireManagerLease(channelId, "run-a", { ttlSeconds: 60 });
    expect(a).not.toBeNull();
    expect(await acquireManagerLease(channelId, "run-b")).toBeNull();
    await t.db.update(managerRuns).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(managerRuns.id, a!.id));
    const c = await acquireManagerLease(channelId, "run-c");
    expect(c).not.toBeNull();
    const [old] = await t.db.select().from(managerRuns).where(eq(managerRuns.id, a!.id));
    expect(old.status).toBe("expired");
    expect(await finishManagerRun(a!.id, "run-a", "finished", "late")).toBe(false); // expired owner cannot finish
    expect(await finishManagerRun(c!.id, "run-c", "noop", "nothing to do")).toBe(true);
  });

  it("concurrent lease attempts: exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => acquireManagerLease(channelId, `r${i}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("free-tier quota ledger", () => {
  it("records usage, refuses past the limit without recording, and pauses dependent jobs", async () => {
    expect((await recordQuota("youtube.uploads", "day", 1, 2)).allowed).toBe(true);
    expect((await recordQuota("youtube.uploads", "day", 1, 2)).allowed).toBe(true);
    const third = await recordQuota("youtube.uploads", "day", 1, 2);
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(2);
    expect(third.pausedUntil!.getTime()).toBeGreaterThan(Date.now());
    // A job that requires the paused provider is not claimable; others still are.
    await enqueue({ type: "media.upload", payload: { requires: ["youtube.uploads"] }, idempotencyKey: "up", kind: "media" });
    await enqueue({ type: "media.render", payload: {}, idempotencyKey: "rd", kind: "media" });
    expect((await claimNext("w", { kinds: ["media"] }))?.type).toBe("media.render");
    expect(await claimNext("w", { kinds: ["media"] })).toBeNull();
  });
});

describe("idea de-duplication", () => {
  it("normalises Arabic spelling variants and tashkeel", () => {
    expect(normalizeTitle("أفضلُ طريقةٍ للقراءة!")).toBe(normalizeTitle("افضل طريقه للقراءه"));
    expect(titleFingerprint("طريقة القراءة اليومية")).toBe(titleFingerprint("اليومية القراءة طريقة"));
  });

  it("rejects exact and near-duplicate ideas, accepts different ones", async () => {
    const a = await addIdea(channelId, { title: "كيف تبني عادة القراءة اليومية في 30 يومًا", format: "long" });
    expect(a.status).toBe("backlog");
    const exact = await addIdea(channelId, { title: "كيف تبني عادة القراءة اليومية في 30 يوما", format: "long" });
    expect(exact).toMatchObject({ status: "duplicate", duplicateOf: a.ideaId });
    const near = await addIdea(channelId, { title: "كيف تبني عادة القراءة اليومية", format: "short" });
    expect(near.status).toBe("duplicate");
    const other = await addIdea(channelId, { title: "أسرار النوم العميق للطلاب", format: "short" });
    expect(other.status).toBe("backlog");
  });
});

describe("fenced artifact save + pipeline advance", () => {
  it("saves, bumps the version, completes the job and enqueues next jobs atomically", async () => {
    const p = await newProject();
    await enqueue({ type: "research", payload: {}, idempotencyKey: "j1", projectId: p.id, channelId, assignee: "researcher" });
    const job = (await claimNext("agent-1", { assignee: "researcher" }))!;
    const r = await saveArtifact({
      jobId: job.id,
      owner: "agent-1",
      projectId: p.id,
      kind: "research",
      content: { summary: "x" },
      revision: 0,
      next: [
        { type: "fact_check", key: `fc:${p.id}`, assignee: "fact-checker" },
        { type: "script", key: `sc:${p.id}`, assignee: "scriptwriter" },
      ],
    });
    expect(r).toMatchObject({ status: "saved", version: 1, enqueued: 2 });
    expect((await getJob(job.id))!.status).toBe("succeeded");
    const next = await t.db.select().from(jobs).where(eq(jobs.parentJobId, job.id));
    expect(next.map((j) => j.assignee).sort()).toEqual(["fact-checker", "scriptwriter"]);
    expect(next.every((j) => j.channelId === channelId)).toBe(true);
  });

  it("refuses when the lease was lost or the project was cancelled/revised (paid result discarded)", async () => {
    const p = await newProject();
    await enqueue({ type: "script", payload: {}, idempotencyKey: "j2", projectId: p.id, channelId, assignee: "scriptwriter" });
    const job = (await claimNext("agent-1", { assignee: "scriptwriter" }))!;
    expect((await saveArtifact({ jobId: job.id, owner: "agent-2", projectId: p.id, kind: "script", content: {}, revision: 0 })).status).toBe("lease_lost");
    expect(await cancelProject(p.id)).toBe(true);
    expect((await saveArtifact({ jobId: job.id, owner: "agent-1", projectId: p.id, kind: "script", content: {}, revision: 0 })).status).toBe("stale");
    expect(await t.db.select().from(artifacts).where(eq(artifacts.projectId, p.id))).toHaveLength(0);
    // Closed projects accept no new jobs.
    await expect(enqueue({ type: "x", payload: {}, idempotencyKey: "after-cancel", projectId: p.id })).rejects.toBeInstanceOf(ProjectClosedError);
  });

  it("cancel cannot hit a project that is publishing", async () => {
    const p = await newProject("produced");
    expect((await requestPublish({ projectId: p.id, mode: "dry_run", publishAt: null, privacy: "private", synthetic: true, key: "pub-1" })).status).toBe("requested");
    expect(await cancelProject(p.id)).toBe(false);
  });
});

describe("publish gate", () => {
  it("prevents duplicate publications, enforces the daily cap, kill switch and readiness", async () => {
    const notReady = await newProject("in_progress");
    expect((await requestPublish({ projectId: notReady.id, mode: "dry_run", publishAt: null, privacy: "private", synthetic: true, key: "n" })).status).toBe("not_ready");

    await setPolicy(channelId, { max_uploads_per_day: 1 });
    const p1 = await newProject("produced");
    const p2 = await newProject("produced");
    const first = await requestPublish({ projectId: p1.id, mode: "dry_run", publishAt: new Date(Date.now() + 86_400_000), privacy: "private", synthetic: true, key: "a" });
    expect(first.status).toBe("requested");
    const [pub] = await t.db.select().from(publications).where(eq(publications.id, first.publicationId!));
    expect(pub.containsSyntheticMedia).toBe(true);
    expect(pub.publishAt).not.toBeNull();
    expect((await requestPublish({ projectId: p2.id, mode: "dry_run", publishAt: null, privacy: "private", synthetic: true, key: "b" })).status).toBe("rate_limited");

    await setPolicy(channelId, { max_uploads_per_day: 5 });
    // Duplicate for the same project: blocked by the partial unique index even with a new key.
    await t.db.update(projects).set({ status: "produced" }).where(eq(projects.id, p1.id));
    expect((await requestPublish({ projectId: p1.id, mode: "dry_run", publishAt: null, privacy: "private", synthetic: true, key: "c" })).status).toBe("duplicate");

    await setPolicy(channelId, { kill_switch: true });
    expect((await requestPublish({ projectId: p2.id, mode: "dry_run", publishAt: null, privacy: "private", synthetic: true, key: "d" })).status).toBe("paused");
  });

  it("requires editorial + media QA approval and refuses media_review (QA failed)", async () => {
    const noQa = await newProject("produced", false);
    expect((await requestPublish({ projectId: noQa.id, mode: "live", publishAt: null, privacy: "public", synthetic: true, key: "q1" })).status).toBe("not_approved");
    const failedMedia = await newProject("media_review");
    expect((await requestPublish({ projectId: failedMedia.id, mode: "live", publishAt: null, privacy: "public", synthetic: true, key: "q2" })).status).toBe("not_ready");
    // QA approved for an OLD revision does not count after a revision bump
    const p = await newProject("produced");
    await t.db.update(projects).set({ revision: 1 }).where(eq(projects.id, p.id));
    expect((await requestPublish({ projectId: p.id, mode: "live", publishAt: null, privacy: "public", synthetic: true, key: "q3" })).status).toBe("not_approved");
  });

  it("enforces cadence for live uploads: minimum hours between uploads and weekly caps per format", async () => {
    await setPolicy(channelId, { max_uploads_per_day: 10, min_hours_between_uploads: 12, max_shorts_per_week: 2 });
    const base = new Date("2027-01-04T10:00:00Z"); // a Monday
    const at = (h: number) => new Date(base.getTime() + h * 3600_000);
    const pub = async (h: number, key: string) =>
      (await requestPublish({ projectId: (await newProject("produced")).id, mode: "live", publishAt: at(h), privacy: "private", synthetic: true, key })).status;
    expect(await pub(0, "c1")).toBe("requested");
    expect(await pub(6, "c2")).toBe("rate_limited"); // < 12 h after the previous upload
    expect(await pub(24, "c3")).toBe("requested");
    expect(await pub(48, "c4")).toBe("rate_limited"); // 3rd Short in the same week > cap 2
    expect(await pub(7 * 24, "c5")).toBe("requested"); // next week
  });

  it("a project without a channel cannot exist; a missing channel counts as paused", async () => {
    await expect(t.client.query("INSERT INTO projects (topic, title, format, target_duration_sec) VALUES ('t','t','short',45)")).rejects.toThrow(/channel_id/);
    const [{ p }] = (await t.client.query<{ p: boolean }>("SELECT app.channel_paused(gen_random_uuid()) AS p")).rows;
    expect(p).toBe(true);
  });
});

describe("kill switch", () => {
  it("stops claiming channel jobs except analytics", async () => {
    await enqueue({ type: "script", payload: {}, idempotencyKey: "k1", channelId });
    await enqueue({ type: "analytics.pull", payload: {}, idempotencyKey: "k2", channelId, kind: "system" });
    await setPolicy(channelId, { kill_switch: true });
    expect(await claimNext("w", { kinds: ["cognitive"] })).toBeNull();
    expect((await claimNext("w", { kinds: ["system"] }))?.type).toBe("analytics.pull");
    expect((await computeAgenda(channelId)).paused).toBe(true);
    expect((await preflight()).reasons).toContain("channel paused (kill switch)");
  });

  it("a malformed policy cannot be stored, and if one ever exists the channel is paused (fail closed)", async () => {
    const insert = (policy: string) =>
      t.client.query(`INSERT INTO channel_policies (channel_id, version, policy, created_by) VALUES ($1, 99, ${policy}, 'test')`, [channelId]);
    // A double-encoded policy (a JSON *string*) and a policy without kill_switch are rejected.
    await expect(insert(`to_jsonb('{"kill_switch":true}'::text)`)).rejects.toThrow(/channel_policies_shape_ck/);
    await expect(insert(`'{"publish_mode":"auto"}'::jsonb`)).rejects.toThrow(/channel_policies_shape_ck/);

    // Defence in depth: bypass the constraint as if it had been dropped; the SQL pause check must not fail open.
    await enqueue({ type: "script", payload: {}, idempotencyKey: "k3", channelId });
    await t.client.exec("ALTER TABLE channel_policies DROP CONSTRAINT channel_policies_shape_ck");
    await insert(`to_jsonb('{"kill_switch":false}'::text)`);
    const [r] = (await t.client.query<{ p: boolean }>("SELECT app.channel_paused($1) AS p", [channelId])).rows;
    expect(r.p).toBe(true);
    expect(await claimNext("w", { kinds: ["cognitive"] })).toBeNull();
  });
});

describe("agent messages → jobs (only via the manager)", () => {
  it("converts once, and stops revision ping-pong at the hop limit", async () => {
    const p = await newProject();
    const [m] = await t.db
      .insert(agentMessages)
      .values({ channelId, projectId: p.id, fromAgent: "qa-editor", toAgent: "scriptwriter", type: "revision_request", body: { note: "hook" }, hop: 1, dedupeKey: "m1" })
      .returning();
    expect(await convertMessage(m.id, 2, { type: "script.revise" })).toBe("converted");
    expect(await convertMessage(m.id, 2, { type: "script.revise" })).toBe("not_open");
    const created = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `msg:${m.id}`));
    expect(created).toHaveLength(1);
    expect(created[0].assignee).toBe("scriptwriter");

    const [deep] = await t.db
      .insert(agentMessages)
      .values({ channelId, projectId: p.id, fromAgent: "qa-editor", toAgent: "scriptwriter", type: "revision_request", body: {}, hop: 3, dedupeKey: "m2" })
      .returning();
    expect(await convertMessage(deep.id, 2, { type: "script.revise" })).toBe("hop_limit");
    // A duplicate message (same dedupe key) cannot even be inserted.
    await expect(
      t.db.insert(agentMessages).values({ channelId, fromAgent: "a", toAgent: "b", type: "question", body: {}, dedupeKey: "m1" }),
    ).rejects.toThrow();
  });
});

describe("deterministic agenda", () => {
  it("lists what is due; an idle channel with a strategy and a plan yields an empty agenda", async () => {
    const first = await computeAgenda(channelId);
    expect(first.items.map((i) => i.kind)).toContain("strategy_missing");

    await t.client.query(`INSERT INTO strategies (channel_id, version, content, active) VALUES ('${channelId}', 1, '{}', true)`);
    await t.db.insert(calendarSlots).values({ channelId, publishAt: new Date(Date.now() + 5 * 86_400_000), format: "short" });
    expect((await computeAgenda(channelId)).items).toEqual([]);

    await t.db.insert(calendarSlots).values({ channelId, publishAt: new Date(Date.now() + 24 * 3_600_000), format: "long" });
    await enqueue({ type: "seo", payload: {}, idempotencyKey: "a1", channelId, assignee: "seo" });
    const kinds = (await computeAgenda(channelId)).items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["job_ready", "slot_unassigned"]);
  });

  it("detects no progress after three runs with the same agenda", async () => {
    const agenda = await computeAgenda(channelId);
    for (let i = 0; i < 3; i++) {
      const run = await acquireManagerLease(channelId, `r${i}`);
      await finishManagerRun(run!.id, `r${i}`, "finished", "s", { fingerprint: agenda.fingerprint });
    }
    expect(await noProgress(channelId, agenda.fingerprint)).toBe(true);
  });
});

describe("Claude subscription budget", () => {
  it("refuses specialist calls once the daily budget is used; weekly counted first", async () => {
    await setPolicy(channelId, { daily_model_call_budget: 2, weekly_model_call_budget: 10 });
    expect((await spendModelCall(channelId)).allowed).toBe(true);
    expect((await spendModelCall(channelId)).allowed).toBe(true);
    const third = await spendModelCall(channelId);
    expect(third).toEqual({ allowed: false, reason: "daily model-call budget exhausted" });
    const pf = await preflight();
    expect(pf.ok).toBe(false);
    expect(pf.reasons).toContain("daily model-call budget exhausted");
  });
});
