import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "@/cli/studio";
import { one, rows, sql } from "@/server/db/client";
import { claimNext, recoverStaleJobs } from "@/server/queue/queue";
import { produceAndPublish, pullAnalytics } from "@/server/worker/handlers";
import { clearHandlers, drain, registerHandler } from "@/server/worker/run";
import { YouTube } from "@/server/youtube/client";
import { startFakeYouTube } from "./helpers/fake-youtube";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
let fake: Awaited<ReturnType<typeof startFakeYouTube>>;
let mediaOut: string;
const cli = (...argv: string[]) => runCli(argv);
const tmp = (name: string, obj: unknown) => {
  const f = path.join(os.tmpdir(), `mf-${Date.now()}-${Math.random()}-${name}.json`);
  writeFileSync(f, JSON.stringify(obj));
  return f;
};

/** Stand-in for the Python renderer: writes what studio_media.produce writes (QA passed). */
const fakeRender = async (args: string[]) => {
  const out = args[args.indexOf("--out") + 1];
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "video.mp4"), Buffer.alloc(1024 * 1024, 3));
  writeFileSync(path.join(out, "thumbnail.jpg"), Buffer.alloc(1000, 1));
  writeFileSync(path.join(out, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nمرحبا\n");
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ format: "short", title: "t", files: { video: "video.mp4", thumbnail: "thumbnail.jpg", captions: "captions.srt" }, attributions: [], qa: { passed: true, issues: [] } }));
  return { code: 0, out: "", err: "" };
};

beforeEach(async () => {
  t = await useTestDb();
  fake = await startFakeYouTube();
  mediaOut = path.join(os.tmpdir(), `media-${Date.now()}-${Math.random()}`);
  process.env.MEDIA_OUT = mediaOut;
  clearHandlers();
});
afterEach(async () => {
  clearHandlers();
  delete process.env.MEDIA_OUT;
  await fake.close();
  await t.close();
});

const yt = () => new YouTube({ clientId: "c", clientSecret: "s", apiBase: fake.base, analyticsBase: fake.base, oauthBase: fake.base }, { access_token: "at-0", refresh_token: "rt", expires_at: 0 });

describe("autonomous cycle: idea → script → video → upload → analytics (CLI + worker, fake YouTube)", () => {
  it("runs end to end without owner approval, honouring the QA gate, kill switch and sample-size guard", async () => {
    expect((await cli("channel", "init", "--title", "قناة العلوم", "--tz", "Africa/Cairo")).code).toBe(0);
    const run = await cli("run", "start", "--owner", "mgr");
    expect(run.code).toBe(0);
    expect(JSON.stringify((await cli("next")).output)).toContain("strategy_missing");

    // strategist
    expect((await cli("strategy", "set", "--file", tmp("s", { pillars: ["علوم الجسم"], cadence: { short: 3, long: 1 } }), "--rationale", "niche")).output).toMatchObject({ version: 1 });
    const idea = await cli("idea", "add", "--title", "لماذا نحلم؟", "--format", "short", "--pillar", "علوم الجسم");
    const at = new Date(Date.now() + 24 * 3600_000).toISOString();
    const slot = await cli("slot", "add", "--at", at, "--format", "short", "--idea", String(idea.output.ideaId));
    expect(JSON.stringify((await cli("next")).output)).toContain("slot_unassigned");

    // manager creates the project; specialists' outputs are stored as artifacts
    const proj = await cli("project", "create", "--slot", String(slot.output.slotId), "--title", "لماذا نحلم؟", "--topic", "الأحلام", "--target-s", "45");
    const pid = String(proj.output.projectId);
    expect((await cli("project", "create", "--slot", String(slot.output.slotId), "--title", "x", "--topic", "x", "--target-s", "45")).output.projectId).toBe(pid); // idempotent
    for (const [kind, body] of [
      ["research", { facts: ["…"], sources: ["https://example.org"] }],
      ["script", { segments: [{ text: "هل تساءلت لماذا نحلم؟" }] }],
      ["fact_check", { verdict: "ok" }],
      ["storyboard", { format: "short", title: "لماذا نحلم؟", segments: [{ text: "هل تساءلت لماذا نحلم؟", on_screen: "لماذا نحلم؟" }] }],
      ["seo", { title: "لماذا نحلم؟ #shorts", description: "حقيقة عن الأحلام.", tags: ["أحلام"] }],
      ["qa_report", { approved: false, issues: ["hook weak"] }],
    ] as const) {
      expect((await cli("artifact", "put", "--project", pid, "--kind", kind, "--file", tmp(kind, body))).code).toBe(0);
    }
    expect((await cli("produce", pid)).output).toMatchObject({ refused: true, reason: "not_approved" });
    await cli("artifact", "put", "--project", pid, "--kind", "qa_report", "--file", tmp("qa2", { approved: true, score: 8.5 }));
    expect((await cli("produce", pid)).output).toMatchObject({ status: "enqueued" });
    expect((await cli("produce", pid)).output).toMatchObject({ status: "already_enqueued" });

    // kill switch: the worker claims nothing while paused
    registerHandler("video.produce", (job) => produceAndPublish(job, { yt: yt(), render: fakeRender }));
    await cli("pause");
    expect(await drain({ kinds: ["media"], deadlineMs: 5000 })).toBe(0);
    await cli("resume");

    // media worker: render → QA → publish (private + publishAt = slot time) → scheduled
    expect(await drain({ kinds: ["media"], deadlineMs: 10_000 })).toBe(1);
    expect(fake.state.videos).toHaveLength(1);
    expect(fake.state.videos[0].resource.status).toMatchObject({ privacyStatus: "private", publishAt: at, containsSyntheticMedia: true });
    const p = await one<{ status: string }>(sql`SELECT status FROM projects WHERE id = ${pid}::uuid`);
    expect(p!.status).toBe("scheduled");
    expect((await one<{ status: string }>(sql`SELECT status FROM calendar_slots WHERE project_id = ${pid}::uuid`))!.status).toBe("scheduled");
    expect((await rows(sql`SELECT 1 FROM media_previews WHERE project_id = ${pid}::uuid`)).length).toBe(1);

    // owner digest
    const rep = (await cli("report")).output.report as { published: { url: string }[]; paused: boolean };
    expect(rep.paused).toBe(false);
    expect(rep.published[0].url).toContain("youtu.be/");

    // analytics: pull → snapshots; one video is far below the sample-size threshold
    registerHandler("analytics.pull", (job) => pullAnalytics(job, { yt: yt() }));
    await cli("analytics", "enqueue");
    await cli("analytics", "enqueue"); // idempotent per day
    expect(await drain({ kinds: ["system"], deadlineMs: 10_000 })).toBe(1);
    const summary = (await cli("analytics", "summary")).output.summary as { videos: number; groups: { enough_data: boolean }[] };
    expect(summary.videos).toBe(1);
    expect(summary.groups.every((g) => g.enough_data === false)).toBe(true);

    // weekly review recorded as a decision; memory + message dedupe
    expect(JSON.stringify((await cli("next")).output)).toContain("weekly_review");
    await cli("decision", "log", "--type", "weekly_review", "--summary", "insufficient data, keep strategy", "--run", String(run.output.runId));
    expect(JSON.stringify((await cli("next")).output)).not.toContain("weekly_review");
    await cli("memory", "set", "--kind", "lesson", "--key", "hooks", "--content", "questions work", "--confidence", "0.4");
    const body = tmp("b", { note: "x" });
    const m1 = await cli("message", "send", "--from", "qa-editor", "--to", "scriptwriter", "--type", "revision_request", "--key", "k1", "--body-file", body);
    const m2 = await cli("message", "send", "--from", "qa-editor", "--to", "scriptwriter", "--type", "revision_request", "--key", "k1", "--body-file", body);
    expect(m1.output.messageId).toBe(m2.output.messageId);
    expect((await cli("run", "finish", String(run.output.runId), "--owner", "mgr", "--status", "finished", "--summary", "cycle", "--calls", "6")).code).toBe(0);
  });

  it("a worker killed mid-job: the job is recovered and completed exactly once", async () => {
    await cli("channel", "init", "--title", "c");
    await t.client.query("SELECT * FROM app.enqueue_job('system.noop', '{}'::jsonb, 'crash-1', NULL, 'system')");
    const stolen = await claimNext("dead-worker", { kinds: ["system"] });
    expect(stolen).not.toBeNull();
    await t.client.query("UPDATE jobs SET locked_at = now() - interval '2 hours' WHERE id = $1", [stolen!.id]);
    const rec = await recoverStaleJobs(15 * 60_000);
    expect(rec.requeued).toContain(stolen!.id);
    let runs = 0;
    registerHandler("system.noop", async () => ({ n: ++runs }));
    expect(await drain({ kinds: ["system"], deadlineMs: 5000 })).toBe(1);
    expect(await drain({ kinds: ["system"], deadlineMs: 5000 })).toBe(0);
    expect(runs).toBe(1);
  });
});
