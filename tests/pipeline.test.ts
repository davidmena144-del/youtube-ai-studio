import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QaReport } from "@/server/agents/types";
import { artifacts, historyEvents, jobs, projects, publications, stageRuns } from "@/server/db/schema";
import {
  createProject,
  getProject,
  loadArtifacts,
  requestPublish,
  submitReview,
  UserFacingError,
} from "@/server/manager/manager";
import { MockLlmProvider } from "@/server/providers/llm/mock";
import { setLlmProviderOverride } from "@/server/providers/llm";
import type { LlmProvider, StructuredRequest } from "@/server/providers/llm/types";
import { RetryableError } from "@/server/queue/errors";
import { updateSettings } from "@/server/settings";
import { drain } from "@/server/worker/run";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
  setLlmProviderOverride(null);
});
afterEach(async () => {
  setLlmProviderOverride(null);
  await t.close();
});

const longInput = { topic: "أساسيات الذكاء الاصطناعي", format: "long" as const, language: "ar" as const, targetDurationSec: 480 };

describe("Claude Manager pipeline (mock provider)", () => {
  it("runs research → script → direction → seo → qa and stops at the review gate", async () => {
    const p = await createProject(longInput);
    expect(p.status).toBe("queued");
    const processed = await drain({ deadlineMs: 20_000 });
    expect(processed).toBe(5);

    const done = (await getProject(p.id))!;
    expect(done.status).toBe("awaiting_review");
    const arts = await loadArtifacts(p.id);
    expect(arts.research && arts.script && arts.storyboard && arts.seo && arts.qa).toBeTruthy();
    expect(arts.storyboard!.aspectRatio).toBe("16:9");
    expect(arts.qa!.checks.find((c) => c.id === "content.not_mock")?.passed).toBe(false); // mock is flagged
    expect(arts.qa!.passed).toBe(true); // ...but only as a warning

    const runs = await t.db.select().from(stageRuns).where(eq(stageRuns.projectId, p.id));
    expect(runs.map((r) => r.status)).toEqual(Array(5).fill("succeeded"));
    const history = await t.db.select().from(historyEvents).where(eq(historyEvents.projectId, p.id));
    expect(history.some((h) => h.action === "review.requested")).toBe(true);
  });

  it("produces a vertical storyboard and enforces the Shorts duration limit", async () => {
    const p = await createProject({ ...longInput, format: "short", targetDurationSec: 50 });
    await drain({ deadlineMs: 20_000 });
    const arts = await loadArtifacts(p.id);
    expect(arts.storyboard!.aspectRatio).toBe("9:16");
    expect(arts.seo!.chapters).toEqual([]);
    expect(arts.qa!.checks.find((c) => c.id === "short.duration")?.passed).toBe(true);
    await expect(createProject({ ...longInput, format: "short", targetDurationSec: 600 })).rejects.toBeInstanceOf(UserFacingError);
  });

  it("rewrites the script automatically when QA fails, then hands over to the human", async () => {
    // A provider whose QA review always reports a blocker.
    const mock = new MockLlmProvider();
    const strict: LlmProvider = {
      id: "strict",
      model: "strict",
      async generateStructured<T>(req: StructuredRequest<T>) {
        const r = await mock.generateStructured(req);
        if (req.name === "qa_review") {
          (r.data as { issues: unknown[]; score: number }).issues = [
            { severity: "blocker", area: "script", description: "Weak hook", suggestion: "Open with the payoff" },
          ];
        }
        return r;
      },
    };
    setLlmProviderOverride(strict);
    await updateSettings({ qaMaxAutoRevisions: 1 });
    const p = await createProject(longInput);
    await drain({ deadlineMs: 20_000 });

    const done = (await getProject(p.id))!;
    expect(done.autoRevisions).toBe(1);
    expect(done.status).toBe("awaiting_review");
    const scripts = await t.db.select().from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.kind, "script")));
    expect(scripts).toHaveLength(2);
    const qa = (await loadArtifacts(p.id)).qa as QaReport;
    expect(qa.passed).toBe(false);
    const rewriteJob = (await t.db.select().from(jobs)).find((j) => j.idempotencyKey.endsWith(":a1:script"));
    expect((rewriteJob!.payload as { feedback: string[] }).feedback.join(" ")).toContain("Weak hook");
  });

  it("requested changes start a new revision from the chosen stage with the reviewer notes", async () => {
    const p = await createProject(longInput);
    await drain({ deadlineMs: 20_000 });
    await expect(submitReview({ projectId: p.id, decision: "changes_requested" })).rejects.toBeInstanceOf(UserFacingError);
    await submitReview({ projectId: p.id, decision: "changes_requested", notes: "اجعل العنوان أقصر", restartFromStage: "seo" });
    const mid = (await getProject(p.id))!;
    expect(mid.revision).toBe(1);
    expect(mid.status).toBe("changes_requested");
    const processed = await drain({ deadlineMs: 20_000 });
    expect(processed).toBe(2); // seo + qa only
    expect((await getProject(p.id))!.status).toBe("awaiting_review");
  });

  it("cannot publish before approval; dry-run publishes once and blocks duplicates", async () => {
    const p = await createProject(longInput);
    await drain({ deadlineMs: 20_000 });
    await expect(requestPublish(p.id)).rejects.toBeInstanceOf(UserFacingError);

    await submitReview({ projectId: p.id, decision: "approved" });
    await requestPublish(p.id);
    await expect(requestPublish(p.id)).rejects.toThrow(); // second click: rejected (status is "publishing")
    await drain({ deadlineMs: 20_000 });

    const final = (await getProject(p.id))!;
    expect(final.status).toBe("published");
    const pubs = await t.db.select().from(publications).where(eq(publications.projectId, p.id));
    expect(pubs).toHaveLength(1);
    expect(pubs[0].mode).toBe("dry_run");
    expect(pubs[0].status).toBe("succeeded");
    expect((pubs[0].response as { note: string }).note).toMatch(/Dry run/);

    // Even if the status were reset, the database refuses a second active publication.
    await t.db.update(projects).set({ status: "approved" }).where(eq(projects.id, p.id));
    await expect(requestPublish(p.id)).rejects.toBeInstanceOf(UserFacingError);
    await expect(
      t.db.insert(publications).values({ projectId: p.id, mode: "dry_run", revision: 0, idempotencyKey: "manual-dup" }),
    ).rejects.toThrow();
  });

  it("retries transient provider failures and marks the project failed when retries are exhausted", async () => {
    let calls = 0;
    const flaky: LlmProvider = {
      id: "flaky",
      model: "flaky",
      async generateStructured() {
        calls++;
        throw new RetryableError("503 overloaded", 1);
      },
    };
    setLlmProviderOverride(flaky);
    const p = await createProject(longInput);
    for (let i = 0; i < 3; i++) {
      await drain({ deadlineMs: 5_000 });
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(calls).toBe(3);
    const failed = (await getProject(p.id))!;
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("503");
    const [job] = await t.db.select().from(jobs).where(eq(jobs.projectId, p.id));
    expect(job.status).toBe("dead");
  });
});
