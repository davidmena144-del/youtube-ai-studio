import { z } from "zod";

/**
 * Environment configuration. Validated lazily (on first use) so that
 * `next build` and unit tests do not require production secrets.
 *
 * Secrets are read ONLY here, never sent to the browser, never logged.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(10, "ADMIN_PASSWORD must be at least 10 characters").optional(),

  /** base64-encoded 32 bytes. Required only when encrypted secrets are stored (phase 3). */
  ENCRYPTION_KEY: z.string().optional(),

  /** auto = anthropic if ANTHROPIC_API_KEY is set, otherwise mock. */
  LLM_PROVIDER: z.enum(["auto", "mock", "anthropic"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),

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

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only report variable names and messages — never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (!parsed.data.ADMIN_PASSWORD_HASH && !parsed.data.ADMIN_PASSWORD) {
    throw new Error("Invalid environment configuration: set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD");
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
