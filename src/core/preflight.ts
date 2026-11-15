import { activePolicy, getChannel, isPaused } from "./channel";
import { paidProviderEnvPresent } from "./cost-guard";
import { quotaUsed, recordQuota } from "./ops";

/**
 * Run before every manager run (and by the console). Any failed check aborts the run before a
 * single model call is made.
 */
export type Preflight = {
  ok: boolean;
  reasons: string[];
  channelId?: string;
  budget?: { perRun: number; dailyLeft: number; weeklyLeft: number };
};

export async function preflight(env: NodeJS.ProcessEnv = process.env): Promise<Preflight> {
  const reasons: string[] = [];
  const paid = paidProviderEnvPresent(env);
  if (paid.length) reasons.push(`paid-provider credentials present: ${paid.join(", ")}`);

  const ch = await getChannel();
  if (!ch) return { ok: false, reasons: [...reasons, "no channel configured"] };
  if (await isPaused(ch.id)) reasons.push("channel paused (kill switch)");

  const { policy } = await activePolicy(ch.id);
  const dailyUsed = await quotaUsed("claude.model_calls", "day", ch.timeZone);
  const weeklyUsed = await quotaUsed("claude.model_calls", "week", ch.timeZone);
  const budget = {
    perRun: policy.max_model_calls_per_run,
    dailyLeft: Math.max(0, policy.daily_model_call_budget - dailyUsed),
    weeklyLeft: Math.max(0, policy.weekly_model_call_budget - weeklyUsed),
  };
  if (budget.dailyLeft === 0) reasons.push("daily model-call budget exhausted");
  if (budget.weeklyLeft === 0) reasons.push("weekly model-call budget exhausted");

  return { ok: reasons.length === 0, reasons, channelId: ch.id, budget };
}

/**
 * Reserve one specialist invocation against the weekly and daily budgets. Must be called (and
 * return allowed) before spawning any subagent. Weekly is checked first so a refused call never
 * consumes the daily budget.
 */
export async function spendModelCall(channelId: string): Promise<{ allowed: boolean; reason?: string }> {
  const ch = await getChannel(channelId);
  const { policy } = await activePolicy(channelId);
  const tz = ch?.timeZone ?? "UTC";
  const week = await recordQuota("claude.model_calls", "week", 1, policy.weekly_model_call_budget, tz);
  if (!week.allowed) return { allowed: false, reason: "weekly model-call budget exhausted" };
  const day = await recordQuota("claude.model_calls", "day", 1, policy.daily_model_call_budget, tz);
  if (!day.allowed) return { allowed: false, reason: "daily model-call budget exhausted" };
  return { allowed: true };
}
