import { afterEach, describe, expect, it } from "vitest";
import { authEnv, env, resetEnvCache } from "@/server/env";
import { isPublicPath } from "@/proxy";

const saved = { ...process.env };
function withEnv(patch: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("environment safety", () => {
  it("production refuses to start with a plain-text password (no default credentials)", () => {
    withEnv({ NODE_ENV: "production", ADMIN_PASSWORD_HASH: undefined, ADMIN_PASSWORD: "some-long-password" });
    expect(() => authEnv()).toThrow(/ADMIN_PASSWORD_HASH is required in production/);
  });

  it("refuses to start with no password configured at all", () => {
    withEnv({ NODE_ENV: "development", ADMIN_PASSWORD_HASH: undefined, ADMIN_PASSWORD: undefined });
    expect(() => authEnv()).toThrow();
  });

  it("the worker runs without login secrets", () => {
    withEnv({ SESSION_SECRET: undefined, ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: undefined });
    expect(() => env()).not.toThrow();
    expect(() => authEnv()).toThrow(/SESSION_SECRET/);
  });
});

describe("proxy public paths", () => {
  it("allows only exact public paths", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    for (const p of ["/", "/login-admin", "/loginx", "/iconography", "/api/worker/tick/x", "/api/healthz", "/projects"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
