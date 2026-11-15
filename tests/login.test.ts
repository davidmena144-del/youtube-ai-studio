import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attemptLogin,
  GLOBAL_SLOWDOWN_THRESHOLD,
  MAX_FAILURES_PER_CLIENT,
  RETENTION_MS,
  resolveClientIp,
} from "@/server/auth-core";
import { historyEvents, loginAttempts } from "@/server/db/schema";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
});
afterEach(async () => {
  await t.close();
});

const CORRECT = "the-real-admin-password";
const deps = (calls = { n: 0 }) => ({
  verify: async (p: string) => {
    calls.n++;
    return p === CORRECT;
  },
  sleep: async () => {}, // the global slowdown is exercised without actually waiting
});
const rowCount = async () => (await t.db.select({ n: count() }).from(loginAttempts))[0].n;

describe("fix 1 — one attacker cannot lock the admin out", () => {
  it("a single client hammering the login does not block the admin on another client", async () => {
    for (let i = 0; i < 300; i++) await attemptLogin("attacker", "guess", deps());
    expect(await attemptLogin("admin-phone", CORRECT, deps())).toEqual({ ok: true });
  });

  it("many clients failing at once only slow wrong guesses down; the correct password still works", async () => {
    let slept = 0;
    const d = { ...deps(), sleep: async () => void slept++ };
    for (let i = 0; i < GLOBAL_SLOWDOWN_THRESHOLD + 10; i++) await attemptLogin(`bot-${i}`, "guess", d);
    expect(slept).toBeGreaterThan(0);
    expect(await attemptLogin("admin-phone", CORRECT, d)).toEqual({ ok: true });
  });

  it("a client is blocked after the limit — without the password even being checked", async () => {
    const calls = { n: 0 };
    for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) {
      expect(await attemptLogin("c", "wrong", deps(calls))).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await attemptLogin("c", CORRECT, deps(calls))).toEqual({ ok: false, reason: "blocked" });
    expect(calls.n).toBe(MAX_FAILURES_PER_CLIENT);
  });

  it("parallel requests from one client cannot exceed the limit", async () => {
    const calls = { n: 0 };
    const results = await Promise.all(Array.from({ length: 20 }, () => attemptLogin("burst", "wrong", deps(calls))));
    expect(calls.n).toBeLessThanOrEqual(MAX_FAILURES_PER_CLIENT);
    expect(results.filter((r) => !r.ok && r.reason === "blocked").length).toBeGreaterThanOrEqual(20 - MAX_FAILURES_PER_CLIENT);
  });
});

describe("fix 2 — login requests cannot fill the database", () => {
  it("blocked requests write nothing, and history records at most two events per client", async () => {
    for (let i = 0; i < 500; i++) await attemptLogin("flood", "wrong", deps());
    expect(await rowCount()).toBe(MAX_FAILURES_PER_CLIENT);
    const events = await t.db.select().from(historyEvents);
    expect(events.length).toBeLessThanOrEqual(2);
    expect(events.map((e) => e.action).sort()).toEqual(["auth.client_blocked", "auth.login_failed"]);
  });

  it("old attempt rows are pruned", async () => {
    await t.db.insert(loginAttempts).values({ clientHash: "old", succeeded: false, createdAt: new Date(Date.now() - RETENTION_MS - 60_000) });
    await attemptLogin("new", CORRECT, deps());
    expect(await t.db.select().from(loginAttempts).where(eq(loginAttempts.clientHash, "old"))).toHaveLength(0);
  });
});

describe("fix 6 — client IP comes only from trusted headers", () => {
  const headers = (h: Record<string, string>) => (n: string) => h[n] ?? null;

  it("ignores spoofable headers unless the host is configured to trust them", () => {
    const spoofed = headers({ "fly-client-ip": "6.6.6.6", "cf-connecting-ip": "6.6.6.6", "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 10.0.0.1" });
    expect(resolveClientIp(spoofed, {})).toBe("10.0.0.1"); // last hop, added by the proxy
  });

  it("uses the configured trusted header", () => {
    expect(resolveClientIp(headers({ "fly-client-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), { trustedHeader: "fly-client-ip" })).toBe("1.2.3.4");
    expect(resolveClientIp(headers({ "x-forwarded-for": "6.6.6.6, 5.5.5.5" }), { trustedHeader: "x-forwarded-for" })).toBe("5.5.5.5");
  });

  it("uses Vercel's header on Vercel", () => {
    expect(resolveClientIp(headers({ "x-vercel-forwarded-for": "7.7.7.7", "x-forwarded-for": "6.6.6.6" }), { onVercel: true })).toBe("7.7.7.7");
  });
});
