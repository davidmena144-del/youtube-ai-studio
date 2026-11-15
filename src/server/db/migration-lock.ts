/**
 * Helpers for running migrations safely.
 *
 * A session-level advisory lock is only reliable on a DIRECT database connection. Through a
 * transaction-mode pooler (Supabase port 6543, Neon "-pooler" hosts) the lock and unlock can run
 * on different server connections, leaving the lock stuck. So migrations use
 * MIGRATION_DATABASE_URL (a direct connection) and refuse to run through a pooled URL.
 */

export function isLikelyPooledUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.port === "6543" || u.hostname.includes("-pooler") || u.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
}

export function resolveMigrationUrl(env: { MIGRATION_DATABASE_URL?: string; DATABASE_URL?: string }): string {
  const url = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or MIGRATION_DATABASE_URL) is not set");
  if (isLikelyPooledUrl(url)) {
    throw new Error(
      "Migrations need a direct (non-pooled) database connection. Set MIGRATION_DATABASE_URL to the " +
        "provider's direct connection string (Neon: the URL without '-pooler'; Supabase: port 5432).",
    );
  }
  return url;
}

/**
 * Poll pg_try_advisory_lock until it succeeds or the timeout passes. Unlike pg_advisory_lock this
 * can never block forever: a stuck lock produces a clear error instead of a hung deployment.
 */
export async function acquireLockWithTimeout(
  tryLock: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (await tryLock()) return;
    if (Date.now() + interval > deadline) {
      throw new Error(`Could not acquire the migration lock within ${Math.round(opts.timeoutMs / 1000)} s (another migration still running?)`);
    }
    await sleep(interval);
  }
}
