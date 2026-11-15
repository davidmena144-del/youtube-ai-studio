import { neon } from "@neondatabase/serverless";
import { sql as sqlTag, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Database access for every process (manager CLI in Claude sessions, GitHub Actions worker).
 *
 * Production uses Neon's serverless HTTP driver: it is the only transport that works from
 * Claude Code cloud sessions (HTTPS-only proxy). HTTP has NO interactive transactions, so:
 *   - `db.transaction()` is forbidden (it throws, also in tests, so tests cannot pass on code
 *     that would fail in production);
 *   - every multi-statement invariant is a PL/pgSQL function in the `app` schema
 *     (drizzle/0002_functions.sql), called with a single statement.
 */
export type DB = Omit<PgDatabase<PgQueryResultHKT, typeof schema>, "transaction">;

type GlobalWithDb = typeof globalThis & { __ytsDb?: DB };
const g = globalThis as GlobalWithDb;

export class InteractiveTransactionError extends Error {
  constructor() {
    super("Interactive transactions are not available over Neon HTTP. Use an app.* SQL function instead.");
    this.name = "InteractiveTransactionError";
  }
}

/** Wrap a drizzle database so that `.transaction()` always throws. */
export function guard<T extends object>(db: T): DB {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return () => {
          throw new InteractiveTransactionError();
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as DB;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export function getDb(): DB {
  if (g.__ytsDb) return g.__ytsDb;
  g.__ytsDb = guard(drizzle(neon(databaseUrl()), { schema }));
  return g.__ytsDb;
}

/** Tests inject an in-memory PGlite database here. */
export function setDb(db: DB | undefined) {
  g.__ytsDb = db;
}

/** Run raw SQL and return rows (normalises driver result shapes). */
export async function rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const res = (await getDb().execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export async function one<T = Record<string, unknown>>(query: SQL): Promise<T | undefined> {
  return (await rows<T>(query))[0];
}

export const sql = sqlTag;
export { schema };
