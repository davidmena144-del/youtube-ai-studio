import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { guard, setDb, type DB } from "@/server/db/client";
import * as schema from "@/server/db/schema";

/**
 * Fresh in-memory Postgres (real Postgres compiled to WASM) with every migration applied,
 * including the PL/pgSQL functions, injected as the app database. `db.transaction()` is guarded
 * exactly as in production, so tests cannot rely on interactive transactions.
 */
export async function useTestDb(): Promise<{ db: DB; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const raw = drizzle(client, { schema });
  await migrate(raw, { migrationsFolder: "./drizzle" });
  const db = guard(raw);
  setDb(db);
  return {
    db,
    client,
    close: async () => {
      setDb(undefined);
      await client.close();
    },
  };
}
