import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifacts, jobs, projects, publications, stageRuns } from "@/server/db/schema";
import { acquireLockWithTimeout, isLikelyPooledUrl, resolveMigrationUrl } from "@/server/db/migration-lock";
import { authEnv, env, resetEnvCache } from "@/server/env";
import {
  cancelProject,
  createProject,
  getProject,
  requestPublish,
  retryJobById,
  retryProject,
  runPublishJob,
  submitReview,
  UserFacingError,
} from "@/server/manager/manager";
import { setLlmProviderOverride } from "@/server/providers/llm";
import { MockLlmProvider } from "@/server/providers/llm/mock";
import type { LlmProvider, StructuredRequest } from "@/server/providers/llm/types";
import { NonRetryableError } from "@/server/queue/errors";
import { claimNext, heartbeat, stillOwns } from "@/server/queue/queue";
import { drain, processOne } from "@/server/worker/run";
import { handleTick } from "@/server/worker/tick";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
const savedEnv = { ...process.env };
beforeEach(async () => {
  t = await useTestDb();
  setLlmProviderOverride(null);
});
afterEach(async () => {
  setLlmProviderOverride(null);
  process.env = { ...savedEnv };
  resetEnvCache();
  await t.close();
});

const input = { topic: "اختبار الإصلاحات", format: "short" as const, language: "ar" as const, targetDurationSec: 45 };

describe("fix 3 — a paid result is saved only by the worker that still owns the job", () => {
  it("discards the result when the lease moved to another worker during the LLM call", async () => {
    const mock = new MockLlmProvider();
    const stealing: LlmProvider = {
      id: "slow",
      model: "slow",
      async generateStructured<T>(req: StructuredRequest<T>) {
        // While this call runs, the lease expires and another worker takes the job over.
        await t.db.update(jobs).set({ lockedBy: "worker-b" }).where(eq(jobs.status, "running"));
        return mock.generateStructured(req);
      },
    };
    setLlmProviderOverride(stealing);
    const p = await createProject(input);
    await processOne("worker-a");
    expect(await t.db.select().from(artifacts).where(eq(artifacts.projectId, p.id))).toHaveLength(0);
    const [run] = await t.db.select().from(stageRuns).where(eq(stageRuns.projectId, p.id));
    expect(run.status).toBe("failed");
    const [job] = await t.db.select().from(jobs).where(eq(jobs.projectId, p.id));
    expect(job.lockedBy).toBe("worker-b"); // worker A did not touch the new owner's job
  });

  it("the heartbeat keeps a running job's lease fresh and reports a lost lease", async () => {
    await createProject(input);
    const job = (await claimNext("w1"))!;
    await t.db.update(jobs).set({ lockedAt: new Date(0) }).where(eq(jobs.id, job.id));
    expect(await heartbeat(job)).toBe(true);
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.lockedAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(await stillOwns(job)).toBe(true);
    await t.db.update(jobs).set({ lockedBy: "w2" }).where(eq(jobs.id, job.id));
    expect(await heartbeat(job)).toBe(false);
    expect(await stillOwns(job)).toBe(false);
  });
});

describe("fix 4 — worker time budget", () => {
  it("does not start a job when the remaining budget is shorter than the longest stage", async () => {
    await createProject(input);
    expect(await drain({ deadlineMs: 60_000, minRemainingMs: 10 * 60_000 })).toBe(0);
    expect(await drain({ deadlineMs: 60_000, minRemainingMs: 0, maxJobs: 1 })).toBe(1);
  });

  it("the serverless tick endpoint refuses real Claude work and runs mock work", async () => {
    process.env.CRON_SECRET = "a-cron-secret-that-is-long-enough";
    const req = () => new Request("http://x/api/worker/tick", { headers: { authorization: "Bearer a-cron-secret-that-is-long-enough" } });
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    resetEnvCache();
    expect((await handleTick(req())).status).toBe(409);
    process.env.LLM_PROVIDER = "mock";
    resetEnvCache();
    expect((await handleTick(req())).status).toBe(200);
    expect((await handleTick(new Request("http://x", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });
});

describe("fix 5 — migration lock", () => {
  it("detects pooled URLs and refuses to migrate through them", () => {
    expect(isLikelyPooledUrl("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(isLikelyPooledUrl("postgres://u:p@ep-cool-123-pooler.eu-central-1.aws.neon.tech/db")).toBe(true);
    expect(isLikelyPooledUrl("postgres://u:p@ep-cool-123.eu-central-1.aws.neon.tech/db")).toBe(false);
    expect(isLikelyPooledUrl("postgres://u:p@db.abc.supabase.co:5432/postgres")).toBe(false);
    expect(() => resolveMigrationUrl({ DATABASE_URL: "postgres://u:p@h-pooler.neon.tech/db" })).toThrow(/MIGRATION_DATABASE_URL/);
    expect(resolveMigrationUrl({ DATABASE_URL: "postgres://u:p@h-pooler.neon.tech/db", MIGRATION_DATABASE_URL: "postgres://u:p@h.neon.tech/db" })).toBe(
      "postgres://u:p@h.neon.tech/db",
    );
  });

  it("gives up with a clear error instead of waiting forever for a stuck lock", async () => {
    await expect(acquireLockWithTimeout(async () => false, { timeoutMs: 50, intervalMs: 10 })).rejects.toThrow(/migration lock/);
    let n = 0;
    await expect(acquireLockWithTimeout(async () => ++n >= 3, { timeoutMs: 1000, intervalMs: 5 })).resolves.toBeUndefined();
  });
});

describe("fix 7 — pages read data only through session-checked functions", () => {
  it("no page imports getSettings directly (it must use getSettingsForAdmin)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join("app", "actions.ts"))) {
          const src = fs.readFileSync(p, "utf8");
          if (/import\s*\{[^}]*\bgetSettings\b[^}]*\}\s*from\s*"@\/server\/settings"/.test(src)) offenders.push(p);
        }
      }
    };
    walk(path.resolve("src/app"));
    walk(path.resolve("src/components"));
    expect(offenders).toEqual([]);
  });
});

describe("fix 8 — project state transitions are compare-and-set", () => {
  async function failCurrentStage(projectId: string) {
    const [job] = await t.db.select().from(jobs).where(eq(jobs.projectId, projectId));
    await t.db.update(jobs).set({ status: "dead" }).where(eq(jobs.id, job.id));
    await t.db.update(projects).set({ status: "failed" }).where(eq(projects.id, projectId));
    return job;
  }

  it("retrying a dead job from an older revision is refused and does not strand the project", async () => {
    const p = await createProject(input);
    const old = await failCurrentStage(p.id);
    // The project moved on to a newer revision since that job died.
    await t.db.update(projects).set({ revision: 1 }).where(eq(projects.id, p.id));
    await expect(retryJobById(old.id)).rejects.toBeInstanceOf(UserFacingError);
    await expect(retryProject(p.id)).rejects.toBeInstanceOf(UserFacingError);
    expect((await getProject(p.id))!.status).toBe("failed");
  });

  it("retrying a dead job of the current revision requeues job and project together", async () => {
    const p = await createProject(input);
    const job = await failCurrentStage(p.id);
    await retryProject(p.id);
    expect((await getProject(p.id))!.status).toBe("queued");
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("queued");
  });

  it("a project being published cannot be cancelled, and a cancelled project is never marked published", async () => {
    const p = await createProject(input);
    await drain({ deadlineMs: 20_000 });
    await submitReview({ projectId: p.id, decision: "approved" });
    const publicationId = await requestPublish(p.id);
    await expect(cancelProject(p.id)).rejects.toBeInstanceOf(UserFacingError);

    // Even if the project were cancelled by some other path, the publish job refuses to publish it.
    await t.db.update(projects).set({ status: "cancelled" }).where(eq(projects.id, p.id));
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "publish.run"));
    await expect(runPublishJob(job)).rejects.toBeInstanceOf(NonRetryableError);
    expect((await getProject(p.id))!.status).toBe("cancelled");
    const [pub] = await t.db.select().from(publications).where(eq(publications.id, publicationId));
    expect(pub.status).not.toBe("succeeded");
  });
});

describe("fix 9 — production configuration fails loudly instead of using mock silently", () => {
  const prod = (patch: Record<string, string | undefined>) => {
    process.env = { ...savedEnv, NODE_ENV: "production", ...patch } as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
    resetEnvCache();
  };

  it("refuses to start without an explicit LLM_PROVIDER", () => {
    prod({ LLM_PROVIDER: undefined });
    expect(() => env()).toThrow(/LLM_PROVIDER must be set explicitly/);
    prod({ LLM_PROVIDER: "auto" });
    expect(() => env()).toThrow(/LLM_PROVIDER must be set explicitly/);
  });

  it("refuses LLM_PROVIDER=anthropic without a key", () => {
    prod({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined });
    expect(() => env()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("accepts an explicit choice", () => {
    prod({ LLM_PROVIDER: "mock", ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:c2FsdA==:aGFzaA==" });
    expect(env().LLM_PROVIDER).toBe("mock");
    expect(() => authEnv()).not.toThrow();
  });

  it("the GitHub worker workflow has no silent mock fallback", () => {
    const wf = fs.readFileSync(path.resolve(".github/workflows/worker.yml"), "utf8");
    expect(wf).not.toMatch(/LLM_PROVIDER[^\n]*\|\|/);
    expect(wf).toMatch(/LLM_PROVIDER: \$\{\{ vars\.LLM_PROVIDER \}\}/);
  });
});
