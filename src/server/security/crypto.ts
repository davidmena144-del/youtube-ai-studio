import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for secrets stored in the database
 * (e.g. YouTube OAuth refresh tokens in phase 3).
 * Output format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
export function parseKey(keyB64: string | undefined): Buffer {
  if (!keyB64) throw new Error("ENCRYPTION_KEY is not configured");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
}

export function encrypt(plaintext: string, key: Buffer, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(token: string, key: Buffer, aad = ""): string {
  const [v, ivB, tagB, ctB] = token.split(".");
  if (v !== "v1" || !ivB || !tagB || ctB === undefined) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"), { authTagLength: 16 }); // reject truncated tags
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}
