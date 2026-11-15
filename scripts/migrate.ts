/**
 * Applies pending SQL migrations from ./drizzle. Safe to run repeatedly, and safe when several
 * replicas start at once (advisory lock with a timeout, on a direct connection).
 * Usage: DATABASE_URL=... [MIGRATION_DATABASE_URL=<direct url>] npm run db:migrate
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { acquireLockWithTimeout, resolveMigrationUrl } from "../src/server/db/migration-lock";

const LOCK_ID = 7_242_015; // arbitrary, app-specific
const LOCK_TIMEOUT_MS = Number(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? 5 * 60 * 1000);

async function main() {
  const url = resolveMigrationUrl({ MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL });
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  let locked = false;
  try {
    await acquireLockWithTimeout(
      async () => {
        const [row] = await client<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_ID}) as ok`;
        return row.ok;
      },
      { timeoutMs: LOCK_TIMEOUT_MS },
    );
    locked = true;
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    if (locked) await client`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const cause = err instanceof Error && err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
  console.error("Migration failed:", (err instanceof Error ? err.message.split("\n")[0] : String(err)) + cause);
  process.exit(1);
});
