import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { encryptedSecrets } from "../db/schema";
import { workerEnv } from "../env";
import { decrypt, encrypt, parseKey } from "./crypto";

/** Encrypted key/value store for secrets that must be persisted (never returned to the browser). */
export async function putSecret(name: string, value: string) {
  const ciphertext = encrypt(value, parseKey(workerEnv().ENCRYPTION_KEY), name);
  await getDb()
    .insert(encryptedSecrets)
    .values({ name, ciphertext })
    .onConflictDoUpdate({ target: encryptedSecrets.name, set: { ciphertext, updatedAt: new Date() } });
}

export async function getSecret(name: string): Promise<string | null> {
  const [row] = await getDb().select().from(encryptedSecrets).where(eq(encryptedSecrets.name, name));
  if (!row) return null;
  return decrypt(row.ciphertext, parseKey(workerEnv().ENCRYPTION_KEY), name);
}

export async function hasSecret(name: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ name: encryptedSecrets.name })
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.name, name));
  return Boolean(row);
}
