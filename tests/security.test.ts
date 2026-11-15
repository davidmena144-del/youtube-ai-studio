import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "@/server/security/crypto";
import { redact } from "@/server/history";

describe("AES-256-GCM secrets (for the YouTube refresh token, worker-only)", () => {
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
