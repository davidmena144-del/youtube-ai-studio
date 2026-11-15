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
    await as("app_manager");
    expect((await runCli(["channel", "init", "--title", "c"])).code).toBe(0);
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
  });

  it("worker: can read encrypted_secrets, still cannot DELETE or change the schema", async () => {
    await as("app_worker");
    await t.client.exec("SELECT count(*) FROM encrypted_secrets");
    await denied("DELETE FROM publications");
    await denied("ALTER TABLE jobs ADD COLUMN x int");
  });
});
