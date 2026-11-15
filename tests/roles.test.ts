import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "@/cli/studio";
import { claimNext, enqueue, markSucceeded } from "@/server/queue/queue";
import { useTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof useTestDb>>;
beforeEach(async () => {
  t = await useTestDb();
});
afterEach(async () => {
  await t.client.exec("RESET ROLE");
  await t.close();
});

const as = (role: "app_manager" | "app_worker") => t.client.exec(`SET ROLE ${role}`);
const denied = (q: string) => expect(t.client.exec(q)).rejects.toThrow(/permission denied|must be owner/);

describe("least-privilege roles", () => {
  it("manager: full CLI + queue flow works, but the secrets table, DELETE and DDL are denied", async () => {
    expect((await runCli(["channel", "init", "--title", "c"])).code).toBe(0); // owner onboarding
    await as("app_manager");
    expect((await runCli(["run", "start", "--owner", "m"])).code).toBe(0);
    expect((await runCli(["directive", "add", "--text", "x"])).code).toBe(0);
    await enqueue({ type: "research", payload: {}, idempotencyKey: "k1", assignee: "researcher" });
    const job = await claimNext("m", { kinds: ["cognitive"], assignee: "researcher" });
    expect(job).not.toBeNull();
    expect(await markSucceeded(job!, { ok: true })).toBe(true);

    await denied("SELECT * FROM encrypted_secrets");
    await denied("INSERT INTO encrypted_secrets (name, ciphertext) VALUES ('x', 'y')");
    await denied("DELETE FROM jobs");
    await denied("TRUNCATE history_events");
    await denied("CREATE TABLE evil (id int)");
    await denied("DROP TABLE jobs");
    // H1: the manager cannot change policy (e.g. resume after the owner paused), publications or quotas
    expect((await runCli(["resume"])).code).toBe(1);
    await denied("UPDATE quota_ledger SET used = 0");
    await denied("UPDATE publications SET status = 'succeeded'");
    // ...but the budget still works through the SECURITY DEFINER function
    const ch = (await t.client.query<{ id: string }>("SELECT id FROM channels LIMIT 1")).rows[0].id;
    const r = (await t.client.query<{ r: { allowed: boolean } }>("SELECT app.spend_model_call($1) AS r", [ch])).rows[0].r;
    expect(r.allowed).toBe(true);
  });

  it("worker: can read encrypted_secrets, still cannot DELETE or change the schema", async () => {
    await as("app_worker");
    await t.client.exec("SELECT count(*) FROM encrypted_secrets");
    await denied("DELETE FROM publications");
    await denied("ALTER TABLE jobs ADD COLUMN x int");
  });
});

describe("row-level security hosts (e.g. Supabase auto-RLS)", () => {
  it("with RLS enabled on every table, the roles still work through the app_roles policies", async () => {
    await runCli(["channel", "init", "--title", "c"]);
    await t.client.exec(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname); END LOOP; END $$`);
    await t.client.exec("SELECT app.ensure_role_policies()");
    await as("app_manager");
    const ch = (await t.client.query<{ id: string }>("SELECT id FROM channels LIMIT 1")).rows[0].id;
    const [{ paused }] = (await t.client.query<{ paused: boolean }>("SELECT app.channel_paused($1) AS paused", [ch])).rows;
    expect(paused).toBe(false); // sees the channel and its policy
    await denied("SELECT * FROM encrypted_secrets"); // grants still apply under the permissive policy
  });
});
