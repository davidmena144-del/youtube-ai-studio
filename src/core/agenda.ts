import { one, sql } from "../server/db/client";

/**
 * Deterministic agenda: what the manager should look at in this run, computed in SQL only
 * (app.agenda, migration 0005), with no model call. An empty agenda means the scheduled run exits
 * immediately, which keeps idle runs nearly free of subscription usage. The same function is
 * called by a Claude session through the database connector, so there is one implementation.
 */
export type AgendaItem = {
  key: string; // stable identity, used for the no-progress fingerprint
  kind: "strategy_missing" | "calendar_short" | "directive" | "slot_unassigned" | "job_ready" | "job_dead" | "message_open" | "weekly_review";
  ref?: string;
  assignee?: string | null;
  detail: string;
};

export type Agenda = { channelId: string; paused: boolean; items: AgendaItem[]; fingerprint: string };

export async function computeAgenda(channelId: string, now = new Date()): Promise<Agenda> {
  const r = await one<{ agenda: Agenda }>(sql`SELECT app.agenda(${channelId}::uuid, ${now.toISOString()}::timestamptz) AS agenda`);
  return r!.agenda;
}

/**
 * No-progress detector: true when the last `n` finished runs had the same (non-empty) agenda
 * fingerprint as now. The manager then parks the items and escalates once instead of spending
 * more model calls on them.
 */
export async function noProgress(channelId: string, fingerprint: string, n = 3): Promise<boolean> {
  const r = await one<{ stuck: boolean | null }>(sql`SELECT app.no_progress(${channelId}::uuid, ${fingerprint}, ${n}::int) AS stuck`);
  return Boolean(r?.stuck);
}
