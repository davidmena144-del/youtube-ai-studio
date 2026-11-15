import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoPaidProviders,
  FORBIDDEN_ENV,
  FORBIDDEN_HOSTS,
  FORBIDDEN_PACKAGES,
  PaidProviderConfiguredError,
} from "@/core/cost-guard";
import { managerEnv, workerEnv } from "@/server/env";

/**
 * Zero-spend guard (CI): fails if a paid SDK, paid API host or paid-provider credential name is
 * introduced anywhere in the runtime code or dependencies.
 */
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|ya?ml|sql|py|sh)$/.test(name)) out.push(p);
  }
  return out;
}

const RUNTIME_DIRS = ["src", "scripts", "drizzle", ".github"].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});
// The guard's own definition lists the forbidden names on purpose.
const ALLOWED = new Set([path.join("src", "core", "cost-guard.ts")]);

describe("zero-spend guard", () => {
  it("no paid SDK in dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => (FORBIDDEN_PACKAGES as readonly string[]).includes(d))).toEqual([]);
  });

  it("no paid SDK import, paid API host or paid credential name in runtime code, workflows or SQL", () => {
    const offenders: string[] = [];
    for (const file of RUNTIME_DIRS.flatMap((d) => walk(d))) {
      if (ALLOWED.has(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const needle of [...FORBIDDEN_PACKAGES.map((p) => `"${p}"`), ...FORBIDDEN_HOSTS, ...FORBIDDEN_ENV]) {
        if (src.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("processes refuse to start when paid-provider credentials are present", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(() => assertNoPaidProviders({ ...base, ANTHROPIC_API_KEY: "sk-test-not-real" })).toThrow(PaidProviderConfiguredError);
    expect(() => managerEnv({ ...base, ANTHROPIC_API_KEY: "sk-test-not-real" } as NodeJS.ProcessEnv)).toThrow(/Refusing to run/);
    expect(() => workerEnv({ ...base, ELEVENLABS_API_KEY: "x" } as NodeJS.ProcessEnv)).toThrow(/Refusing to run/);
    expect(() => managerEnv(base as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("the guard itself would catch a planted paid SDK import", () => {
    const planted = `import Anthropic from "@anthropic-ai/sdk";`;
    expect(FORBIDDEN_PACKAGES.some((p) => planted.includes(`"${p}"`))).toBe(true);
  });
});
