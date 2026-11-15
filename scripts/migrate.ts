/**
 * Applies pending SQL migrations from ./drizzle. Safe to run repeatedly, and safe when several
 * replicas start at once: a Postgres advisory lock serialises concurrent runs.
 * Usage: DATABASE_URL=... npm run db:migrate
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const LOCK_ID = 7_242_015; // arbitrary, app-specific

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1, prepare: false });
  try {
    await client`select pg_advisory_lock(${LOCK_ID})`;
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
