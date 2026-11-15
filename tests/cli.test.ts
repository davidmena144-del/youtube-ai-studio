import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "@/cli/studio";
import { enqueue } from "@/server/queue/queue";
import { clearHandlers, drain, registerHandler } from "@/server/worker/run";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
  clearHandlers();
});
afterEach(async () => {
  clearHandlers();
  await t.close();
});

const cli = (...argv: string[]) => runCli(argv);

describe("studio CLI (the single write path for Claude sessions)", () => {
  it("onboarding: channel init creates a fully autonomous default policy", async () => {
    expect((await cli("status")).output.error).toMatch(/No channel configured/);
    const init = await cli("channel", "init", "--title", "قناتي", "--tz", "Asia/Riyadh");
    expect(init.code).toBe(0);
    const pol = await cli("policy", "show");
    expect(pol.output).toMatchObject({ version: 1, policy: { publish_mode: "auto", kill_switch: false } });
  });

  it("a scheduled run: preflight → lease → empty agenda work → finish; a second concurrent run is refused", async () => {
    await cli("channel", "init", "--title", "c");
    const start = await cli("run", "start", "--owner", "mgr-1");
    expect(start.code).toBe(0);
    expect((await cli("run", "start", "--owner", "mgr-2")).output).toMatchObject({ refused: true, reason: "another manager run is active" });
    const next = await cli("next");
    expect((next.output.agenda as { items: { kind: string }[] }).items.map((i) => i.kind)).toContain("strategy_missing");
    const fin = await cli("run", "finish", String(start.output.runId), "--owner", "mgr-1", "--status", "finished", "--summary", "planned", "--calls", "1");
    expect(fin.code).toBe(0);
  });

  it("owner controls: directive, pause (kill switch) blocks runs, resume restores", async () => {
    await cli("channel", "init", "--title", "c");
    expect((await cli("directive", "add", "--text", "ركّز على Shorts هذا الأسبوع")).code).toBe(0);
    expect(((await cli("directive", "list")).output.directives as unknown[]).length).toBe(1);
    await cli("pause");
    const refusedRun = await cli("run", "start");
    expect(refusedRun.code).toBe(2);
    expect(String(refusedRun.output.reason)).toContain("kill switch");
    await cli("resume");
    expect((await cli("run", "start")).code).toBe(0);
  });

  it("policy changes are validated and versioned", async () => {
    await cli("channel", "init", "--title", "c");
    const bad = await cli("policy", "set", "--json", '{"max_uploads_per_day": 99}'); // out of range
    expect(bad.code).toBe(1);
    expect(bad.output).toMatchObject({ error: "invalid input" });
    expect(String((bad.output.issues as string[])[0])).toMatch(/^max_uploads_per_day: /);
    const ok = await cli("policy", "set", "--json", '{"max_shorts_per_week": 5}');
    expect(ok.output).toMatchObject({ version: 2, policy: { max_shorts_per_week: 5, publish_mode: "auto" } });
  });

  it("specialist flow: claim a job for my role, complete it with a result file; budget spend is enforced", async () => {
    await cli("channel", "init", "--title", "c");
    await cli("policy", "set", "--json", '{"daily_model_call_budget": 1}');
    expect((await cli("budget", "spend")).code).toBe(0);
    expect((await cli("budget", "spend")).output).toMatchObject({ refused: true });

    await enqueue({ type: "research", payload: { topic: "x" }, idempotencyKey: "r1", assignee: "researcher" });
    expect((await cli("job", "claim", "--assignee", "seo")).output.job).toBeNull();
    const claim = await cli("job", "claim", "--assignee", "researcher", "--owner", "agent-r");
    const jobId = (claim.output.job as { id: string }).id;
    const file = path.join(os.tmpdir(), `studio-result-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ summary: "done" }));
    expect((await cli("job", "complete", jobId, "--owner", "someone-else", "--file", file)).code).toBe(2);
    expect((await cli("job", "complete", jobId, "--owner", "agent-r", "--file", file)).code).toBe(0);
  });

  it("idea add rejects duplicates", async () => {
    await cli("channel", "init", "--title", "c");
    expect((await cli("idea", "add", "--title", "أسرار النوم العميق", "--format", "short")).code).toBe(0);
    expect((await cli("idea", "add", "--title", "أسرار النوم العميق!", "--format", "long")).code).toBe(2);
  });
});

describe("worker", () => {
  it("drains registered media/system jobs only and records results", async () => {
    registerHandler("system.noop", async (job) => ({ echo: job.payload }));
    await enqueue({ type: "system.noop", payload: { n: 1 }, idempotencyKey: "w1", kind: "system" });
    await enqueue({ type: "research", payload: {}, idempotencyKey: "w2" }); // cognitive: not the worker's job
    expect(await drain({ deadlineMs: 10_000 })).toBe(1);
  });

  it("does not start a job when the remaining time budget is too short", async () => {
    registerHandler("system.noop", async () => ({}));
    await enqueue({ type: "system.noop", payload: {}, idempotencyKey: "w3", kind: "system" });
    expect(await drain({ deadlineMs: 1_000, minRemainingMs: 60_000 })).toBe(0);
  });
});
