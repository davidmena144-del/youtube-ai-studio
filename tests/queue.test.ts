import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InteractiveTransactionError } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { NonRetryableError, RetryableError } from "@/server/queue/errors";
import {
  backoffMs,
  claimNext,
  enqueue,
  getJob,
  heartbeat,
  markFailed,
  markSucceeded,
  recoverStaleJobs,
  retryJob,
} from "@/server/queue/queue";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
});
afterEach(async () => {
  await t.close();
});

const stale = (id: string) => t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(jobs.id, id));

describe("queue over SQL functions (same guarantees as PR #1)", () => {
  it("interactive transactions are forbidden, as on Neon HTTP", async () => {
    expect(() => (t.db as unknown as { transaction: () => void }).transaction()).toThrow(InteractiveTransactionError);
  });

  it("enqueue is idempotent on the key", async () => {
    const a = await enqueue({ type: "x", payload: { n: 1 }, idempotencyKey: "k1" });
    const b = await enqueue({ type: "x", payload: { n: 2 }, idempotencyKey: "k1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(b.job.payload).toEqual({ n: 1 });
  });

  it("claims due jobs once, by priority, and never a job that is not yet due", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "later", runAt: new Date(Date.now() + 60_000) });
    await enqueue({ type: "x", payload: {}, idempotencyKey: "low", priority: 200 });
    await enqueue({ type: "x", payload: {}, idempotencyKey: "high", priority: 10 });
    expect((await claimNext("w1"))?.idempotencyKey).toBe("high");
    expect((await claimNext("w1"))?.idempotencyKey).toBe("low");
    expect(await claimNext("w2")).toBeNull();
  });

  it("50 concurrent claims hand out each job exactly once", async () => {
    for (let i = 0; i < 20; i++) await enqueue({ type: "x", payload: {}, idempotencyKey: `c${i}` });
    const claimed = await Promise.all(Array.from({ length: 50 }, (_, i) => claimNext(`w${i}`)));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("respects dependencies: a job is claimable only after all its dependencies succeeded", async () => {
    const a = (await enqueue({ type: "a", payload: {}, idempotencyKey: "dep-a" })).job;
    await enqueue({ type: "b", payload: {}, idempotencyKey: "dep-b", dependsOn: [a.id] });
    const first = (await claimNext("w"))!;
    expect(first.type).toBe("a");
    expect(await claimNext("w")).toBeNull(); // b waits for a
    await markSucceeded(first);
    expect((await claimNext("w"))?.type).toBe("b");
  });

  it("filters by kind and assignee (cognitive jobs go to the right specialist)", async () => {
    await enqueue({ type: "script.write", payload: {}, idempotencyKey: "s1", assignee: "scriptwriter" });
    await enqueue({ type: "media.produce", payload: {}, idempotencyKey: "m1", kind: "media" });
    expect(await claimNext("w", { kinds: ["cognitive"], assignee: "seo" })).toBeNull();
    expect((await claimNext("w", { kinds: ["media"] }))?.type).toBe("media.produce");
    expect((await claimNext("w", { kinds: ["cognitive"], assignee: "scriptwriter" }))?.type).toBe("script.write");
  });

  it("retries with backoff, then goes dead after max attempts; manual retry resets", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "r", maxAttempts: 2 });
    let j = (await claimNext("w"))!;
    expect(await markFailed(j, new Error("boom"))).toBe("queued");
    expect((await getJob(j.id))!.runAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    await t.db.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.id, j.id));
    j = (await claimNext("w"))!;
    expect(j.attempts).toBe(2);
    expect(await markFailed(j, new Error("boom again"))).toBe("dead");
    expect(await retryJob(j.id)).toBe(true);
    expect((await claimNext("w"))!.attempts).toBe(1);
  });

  it("non-retryable errors stop immediately; retry-after is honoured", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "nr" });
    expect(await markFailed((await claimNext("w"))!, new NonRetryableError("bad config"))).toBe("dead");
    await enqueue({ type: "x", payload: {}, idempotencyKey: "ra" });
    const k = (await claimNext("w"))!;
    await markFailed(k, new RetryableError("429", 5_000));
    expect((await getJob(k.id))!.runAt.getTime() - Date.now()).toBeLessThan(6_000);
  });

  it("fencing: a worker that lost its lease cannot complete, fail or heartbeat the new owner's job", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "fence" });
    const a = (await claimNext("worker-a"))!;
    await stale(a.id);
    await recoverStaleJobs();
    const b = (await claimNext("worker-b"))!;
    expect(await markSucceeded(a)).toBe(false);
    expect(await markFailed(a, new Error("late"))).toBe("lost");
    expect(await heartbeat(a)).toBe(false);
    expect((await getJob(b.id))!.lockedBy).toBe("worker-b");
    expect(await heartbeat(b)).toBe(true);
    expect(await markSucceeded(b, { done: 1 })).toBe(true);
    expect((await getJob(b.id))!.result).toEqual({ done: 1 });
  });

  it("a job whose worker keeps getting killed goes dead instead of looping", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "killed", maxAttempts: 2 });
    let j = (await claimNext("w1"))!;
    await stale(j.id);
    expect((await recoverStaleJobs()).requeued).toEqual([j.id]);
    j = (await claimNext("w2"))!;
    await stale(j.id);
    expect((await recoverStaleJobs()).dead).toEqual([j.id]);
    expect(await claimNext("w3")).toBeNull();
  });

  it("backoff grows and is capped", () => {
    const fixed = () => 0.5;
    expect(backoffMs(1, fixed)).toBe(30_000);
    expect(backoffMs(2, fixed)).toBe(60_000);
    expect(backoffMs(30, fixed)).toBe(60 * 60 * 1000);
  });
});
