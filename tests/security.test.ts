import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "@/server/security/crypto";
import { hashPassword, safeEqual, verifyPassword } from "@/server/security/password";
import { createSessionToken, SESSION_TTL_SEC, verifySessionToken } from "@/server/security/session-token";
import { redact } from "@/server/history";

const SECRET = "x".repeat(40);

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("a very long password");
    expect(h.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("a very long password", h)).toBe(true);
    expect(await verifyPassword("a very long passworD", h)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });

  it("safeEqual compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips and expires", () => {
    const now = 1_700_000_000;
    const t = createSessionToken("admin", SECRET, now);
    expect(verifySessionToken(t, SECRET, now + 10)?.sub).toBe("admin");
    expect(verifySessionToken(t, SECRET, now + SESSION_TTL_SEC + 1)).toBeNull();
  });

  it("rejects tampering and wrong secrets", () => {
    const t = createSessionToken("admin", SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", iat: 0, exp: 9e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifySessionToken(`${body}.${sig}x`, SECRET)).toBeNull();
    expect(verifySessionToken(t, "y".repeat(40))).toBeNull();
    expect(verifySessionToken(undefined, SECRET)).toBeNull();
  });
});

describe("AES-256-GCM secrets", () => {
  const key = parseKey(Buffer.alloc(32, 1).toString("base64"));

  it("encrypts with a random IV and decrypts", () => {
    const a = encrypt("refresh-token-value", key, "youtube");
    const b = encrypt("refresh-token-value", key, "youtube");
    expect(a).not.toEqual(b);
    expect(decrypt(a, key, "youtube")).toBe("refresh-token-value");
  });

  it("detects tampering and wrong associated data", () => {
    const c = encrypt("secret", key, "name-a");
    expect(() => decrypt(c, key, "name-b")).toThrow();
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key, "name-a")).toThrow();
  });

  it("rejects bad keys", () => {
    expect(() => parseKey(undefined)).toThrow();
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("history redaction", () => {
  it("never stores secret-looking fields", () => {
    const out = redact({ apiKey: "sk-123", nested: { refresh_token: "t", ok: 1 }, model: "m" });
    expect(out).toEqual({ apiKey: "[redacted]", nested: { refresh_token: "[redacted]", ok: 1 }, model: "m" });
  });
});
