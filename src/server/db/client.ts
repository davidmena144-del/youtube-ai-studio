import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A database handle or an open transaction. */
export type Executor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

type GlobalWithDb = typeof globalThis & { __ytsDb?: DB; __ytsSql?: postgres.Sql };
const g = globalThis as GlobalWithDb;

/**
 * Returns the shared database handle. In tests, `setDb()` injects an in-memory PGlite database.
 * The instance is stored on globalThis so Next.js dev hot-reloads do not leak connections.
 */
export function getDb(): DB {
  if (g.__ytsDb) return g.__ytsDb;
  const url = env().DATABASE_URL;
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Serverless poolers (Supabase/Neon in transaction mode) do not support prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  g.__ytsSql = client;
  g.__ytsDb = drizzle(client, { schema }) as unknown as DB;
  return g.__ytsDb;
}

export function setDb(db: DB | undefined) {
  g.__ytsDb = db;
}

export async function closeDb() {
  if (g.__ytsSql) await g.__ytsSql.end({ timeout: 5 });
  g.__ytsSql = undefined;
  g.__ytsDb = undefined;
}

export { schema };
