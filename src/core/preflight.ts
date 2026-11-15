import { one, sql } from "../server/db/client";
import { getChannel } from "./channel";
import { paidProviderEnvPresent } from "./cost-guard";

/**
 * Run before every manager run. Any failed check aborts the run before a single model call.
 * The checks live in SQL (app.preflight / app.budget / app.spend_model_call) so a Claude session
 * using the database connector gets exactly the same answers as the CLI.
 */
export type Preflight = {
  ok: boolean;
  reasons: string[];
  channelId?: string;
  budget?: { perRun: number; dailyLeft: number; weeklyLeft: number };
};

export async function preflight(env: NodeJS.ProcessEnv = process.env): Promise<Preflight> {
  const paid = paidProviderEnvPresent(env);
  const extra = paid.length ? [`paid-provider credentials present: ${paid.join(", ")}`] : [];
  const ch = await getChannel();
  if (!ch) return { ok: false, reasons: [...extra, "no channel configured"] };
  const r = (await one<{ p: Preflight }>(sql`SELECT app.preflight(${ch.id}::uuid) AS p`))!.p;
  const reasons = [...extra, ...r.reasons];
  return { ...r, ok: reasons.length === 0, reasons };
}

/** Reserve one specialist invocation; a refusal consumes nothing from either window. */
export async function spendModelCall(channelId: string): Promise<{ allowed: boolean; reason?: string }> {
  return (await one<{ r: { allowed: boolean; reason?: string } }>(sql`SELECT app.spend_model_call(${channelId}::uuid) AS r`))!.r;
}
