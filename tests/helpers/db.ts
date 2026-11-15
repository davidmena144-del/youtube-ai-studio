import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { setDb, type DB } from "@/server/db/client";
import * as schema from "@/server/db/schema";

/** Fresh in-memory Postgres with all migrations applied, injected as the app database. */
export async function useTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  setDb(db as unknown as DB);
  return {
    db: db as unknown as DB,
    close: async () => {
      setDb(undefined);
      await client.close();
    },
  };
}
