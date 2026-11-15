import { z } from "zod";
import { assertNoPaidProviders } from "../core/cost-guard";

/**
 * Per-process environment. Each process gets only what it needs:
 *  - manager (Claude sessions, `studio` CLI): DATABASE_URL for the least-privilege app_manager role.
 *  - worker (GitHub Actions): DATABASE_URL (app_worker), ENCRYPTION_KEY, and later YouTube /
 *    stock-media keys.
 *  - migrator (GitHub Actions migrate step only): MIGRATION_DATABASE_URL (direct connection).
 *
 * Every process refuses to start when paid-provider credentials are present (zero-spend rule).
 * Values are never logged; error messages name variables only.
 */
const Base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

const Worker = Base.extend({
  /** base64 of 32 random bytes; encrypts stored secrets such as the YouTube refresh token. */
  ENCRYPTION_KEY: z.string().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  assertNoPaidProviders(env);
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export function managerEnv(env: NodeJS.ProcessEnv = process.env) {
  return parse(Base, env);
}

export function workerEnv(env: NodeJS.ProcessEnv = process.env) {
  return parse(Worker, env);
}
