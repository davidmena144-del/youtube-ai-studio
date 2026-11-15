import { z } from "zod";

/**
 * Environment configuration. Validated lazily (on first use) so that
 * `next build` and unit tests do not require production secrets.
 *
 * - env():     what every process needs (web app AND worker).
 * - authEnv(): login/session secrets — only the web app needs them, so the worker
 *              never has to hold SESSION_SECRET (which could forge an admin cookie).
 *
 * Secrets are read ONLY here, never sent to the browser, never logged.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(10, "ADMIN_PASSWORD must be at least 10 characters").optional(),

  /** base64-encoded 32 bytes. Required only when encrypted secrets are stored (phase 3). */
  ENCRYPTION_KEY: z.string().optional(),

  /**
   * mock | anthropic. "auto" (anthropic if a key is set, otherwise mock) is a development
   * convenience only: production must choose explicitly, so it can never fall back to mock silently.
   */
  LLM_PROVIDER: z.enum(["auto", "mock", "anthropic"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),

  /** Header set by the host's edge that carries the real client IP (e.g. fly-client-ip). See auth-core. */
  TRUSTED_IP_HEADER: z.string().optional(),
  /** Set to "1" automatically by Vercel. */
  VERCEL: z.string().optional(),

  /** Only dry_run exists in phase 1. "live" is rejected until phase 3 is built and tested. */
  PUBLISHING_MODE: z.enum(["dry_run"]).default("dry_run"),

  /** Protects /api/worker/tick for external cron triggers. */
  CRON_SECRET: z.string().min(24).optional(),

  /** Process queued jobs inside the web process right after enqueueing (single-container / dev). */
  WORKER_INLINE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;
export type AuthEnv = { SESSION_SECRET: string; ADMIN_PASSWORD_HASH?: string; ADMIN_PASSWORD?: string };

let cached: Env | null = null;

function fail(message: string): never {
  throw new Error(`Invalid environment configuration: ${message}`);
}

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only report variable names and messages — never values.
    fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const data = parsed.data;
  if (data.NODE_ENV === "production") {
    // Fail loudly instead of silently producing mock content in production.
    if (!process.env.LLM_PROVIDER || data.LLM_PROVIDER === "auto") {
      fail('LLM_PROVIDER must be set explicitly in production ("mock" or "anthropic")');
    }
    if (data.LLM_PROVIDER === "anthropic" && !data.ANTHROPIC_API_KEY) {
      fail("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    }
  }
  cached = data;
  return cached;
}

/** Login configuration. There is no default password: a missing or unsafe setup refuses to start. */
export function authEnv(): AuthEnv {
  const e = env();
  if (!e.SESSION_SECRET) fail("SESSION_SECRET is required for the web app");
  if (e.NODE_ENV === "production") {
    if (!e.ADMIN_PASSWORD_HASH) {
      fail("ADMIN_PASSWORD_HASH is required in production (plain ADMIN_PASSWORD is accepted only in development)");
    }
    return { SESSION_SECRET: e.SESSION_SECRET, ADMIN_PASSWORD_HASH: e.ADMIN_PASSWORD_HASH };
  }
  if (!e.ADMIN_PASSWORD_HASH && !e.ADMIN_PASSWORD) fail("set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD");
  return { SESSION_SECRET: e.SESSION_SECRET, ADMIN_PASSWORD_HASH: e.ADMIN_PASSWORD_HASH, ADMIN_PASSWORD: e.ADMIN_PASSWORD };
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
