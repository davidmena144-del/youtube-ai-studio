import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobs } from "@/server/db/schema";
import { NonRetryableError, RetryableError } from "@/server/queue/errors";
import { backoffMs, claimNext, enqueue, markFailed, markSucceeded, recoverStaleJobs, retryJob } from "@/server/queue/queue";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
});
afterEach(async () => {
  await t.close();
});

describe("job queue", () => {
  it("is idempotent on the idempotency key", async () => {
    const a = await enqueue({ type: "x", payload: { n: 1 }, idempotencyKey: "k1" });
    const b = await enqueue({ type: "x", payload: { n: 2 }, idempotencyKey: "k1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(await t.db.select().from(jobs)).toHaveLength(1);
  });

  it("claims due jobs in order, once", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "later", runAt: new Date(Date.now() + 60_000) });
    await enqueue({ type: "x", payload: {}, idempotencyKey: "first" });
    const j = await claimNext("w1");
    expect(j?.idempotencyKey).toBe("first");
    expect(j?.status).toBe("running");
    expect(j?.attempts).toBe(1);
    expect(await claimNext("w2")).toBeNull(); // "later" is not due yet
  });

  it("retries with backoff, then goes dead after max attempts", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "r", maxAttempts: 2 });
    let j = (await claimNext("w"))!;
    expect(await markFailed(j, new Error("boom"))).toBe("queued");
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, j.id));
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    await t.db.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.id, j.id));
    j = (await claimNext("w"))!;
    expect(j.attempts).toBe(2);
    expect(await markFailed(j, new Error("boom again"))).toBe("dead");
    expect(await retryJob(j.id)).toBe(true);
    j = (await claimNext("w"))!;
    expect(j.attempts).toBe(1);
    expect(await markSucceeded(j)).toBe(true);
    const [done] = await t.db.select().from(jobs).where(eq(jobs.id, j.id));
    expect(done.status).toBe("succeeded");
  });

  it("stops immediately on non-retryable errors and honours retry-after", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "nr" });
    const j = (await claimNext("w"))!;
    expect(await markFailed(j, new NonRetryableError("bad key"))).toBe("dead");

    await enqueue({ type: "x", payload: {}, idempotencyKey: "ra" });
    const k = (await claimNext("w"))!;
    await markFailed(k, new RetryableError("429", 5_000));
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, k.id));
    expect(row.runAt.getTime() - Date.now()).toBeLessThan(6_000);
  });

  it("recovers jobs abandoned by a crashed worker", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "stale" });
    const j = (await claimNext("w"))!;
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(jobs.id, j.id));
    expect((await recoverStaleJobs()).requeued).toBe(1);
    expect((await claimNext("w2"))?.id).toBe(j.id);
  });

  it("marks a job dead instead of looping when its worker keeps getting killed", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "killed", maxAttempts: 2 });
    for (let i = 1; i <= 2; i++) {
      const j = (await claimNext(`w${i}`))!;
      expect(j.attempts).toBe(i);
      // The host kills the process: nothing calls markFailed, only the lease expires.
      await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(jobs.id, j.id));
      const r = await recoverStaleJobs();
      if (i === 1) expect(r.requeued).toBe(1);
      else expect(r.dead.map((d) => d.id)).toEqual([j.id]);
    }
    const [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("dead");
    expect(await claimNext("w3")).toBeNull();
  });

  it("fences finished work: a worker that lost its lease cannot overwrite the new owner", async () => {
    await enqueue({ type: "x", payload: {}, idempotencyKey: "fence" });
    const a = (await claimNext("worker-a"))!;
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(jobs.id, a.id));
    await recoverStaleJobs();
    const b = (await claimNext("worker-b"))!;
    expect(await markSucceeded(a)).toBe(false); // stale worker A finishes late
    expect(await markFailed(a, new Error("late failure"))).toBe("lost");
    const [mid] = await t.db.select().from(jobs);
    expect(mid.status).toBe("running");
    expect(mid.lockedBy).toBe("worker-b");
    expect(await markSucceeded(b)).toBe(true);
  });

  it("backoff grows and is capped", () => {
    const fixed = () => 0.5;
    expect(backoffMs(1, fixed)).toBe(30_000);
    expect(backoffMs(2, fixed)).toBe(60_000);
    expect(backoffMs(30, fixed)).toBe(60 * 60 * 1000);
  });
});
