import { rows, sql } from "../server/db/client";
import { agendaFingerprint } from "./dedupe";

/**
 * Deterministic agenda: what the manager should look at in this run, computed with SQL only
 * (no model call). An empty agenda means the scheduled run exits immediately, which keeps idle
 * runs nearly free of subscription usage.
 */
export type AgendaItem = {
  key: string; // stable identity, used for the no-progress fingerprint
  kind:
    | "strategy_missing"
    | "calendar_short"
    | "directive"
    | "slot_unassigned"
    | "job_ready"
    | "job_dead"
    | "message_open"
    | "weekly_review";
  ref?: string;
  assignee?: string | null;
  detail: string;
};

export type Agenda = { channelId: string; paused: boolean; items: AgendaItem[]; fingerprint: string };

export async function computeAgenda(channelId: string, now = new Date()): Promise<Agenda> {
  const [{ paused }] = await rows<{ paused: boolean }>(sql`SELECT app.channel_paused(${channelId}::uuid) AS paused`);
  if (paused) return { channelId, paused: true, items: [], fingerprint: agendaFingerprint([]) };

  const items: AgendaItem[] = [];
  const nowIso = now.toISOString();

  const strategy = await rows(sql`SELECT 1 FROM strategies WHERE channel_id = ${channelId}::uuid AND active LIMIT 1`);
  if (!strategy.length) {
    items.push({ key: "strategy_missing", kind: "strategy_missing", assignee: "strategist", detail: "No active strategy" });
  }

  for (const d of await rows<{ id: string; text: string }>(sql`
    SELECT id, text FROM directives WHERE channel_id = ${channelId}::uuid AND status = 'active' ORDER BY created_at LIMIT 10`)) {
    items.push({ key: `directive:${d.id}`, kind: "directive", ref: d.id, detail: d.text.slice(0, 200) });
  }

  const [{ ahead }] = await rows<{ ahead: number }>(sql`
    SELECT count(*)::int AS ahead FROM calendar_slots
    WHERE channel_id = ${channelId}::uuid AND status IN ('open','assigned','in_production','scheduled')
      AND publish_at BETWEEN ${nowIso}::timestamptz AND ${nowIso}::timestamptz + interval '7 days'`);
  if (strategy.length && ahead === 0) {
    items.push({ key: "calendar_short", kind: "calendar_short", assignee: "strategist", detail: "No slots planned for the next 7 days" });
  }

  for (const s of await rows<{ id: string; format: string; publish_at: string }>(sql`
    SELECT id, format, publish_at FROM calendar_slots
    WHERE channel_id = ${channelId}::uuid AND project_id IS NULL AND status IN ('open','assigned')
      AND publish_at BETWEEN ${nowIso}::timestamptz AND ${nowIso}::timestamptz + interval '48 hours'
    ORDER BY publish_at LIMIT 5`)) {
    items.push({ key: `slot:${s.id}`, kind: "slot_unassigned", ref: s.id, detail: `${s.format} due ${new Date(s.publish_at).toISOString()}` });
  }

  for (const j of await rows<{ id: string; type: string; assignee: string | null }>(sql`
    SELECT j.id, j.type, j.assignee FROM jobs j
    WHERE j.channel_id = ${channelId}::uuid AND j.kind = 'cognitive' AND j.status = 'queued' AND j.run_at <= ${nowIso}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM unnest(j.depends_on) d(dep_id)
                      WHERE NOT EXISTS (SELECT 1 FROM jobs x WHERE x.id = d.dep_id AND x.status = 'succeeded'))
    ORDER BY j.priority, j.run_at LIMIT 10`)) {
    items.push({ key: `job:${j.id}`, kind: "job_ready", ref: j.id, assignee: j.assignee, detail: j.type });
  }

  for (const j of await rows<{ id: string; type: string; last_error: string | null }>(sql`
    SELECT id, type, last_error FROM jobs
    WHERE channel_id = ${channelId}::uuid AND status = 'dead' AND finished_at > ${nowIso}::timestamptz - interval '7 days'
    ORDER BY finished_at DESC LIMIT 5`)) {
    items.push({ key: `dead:${j.id}`, kind: "job_dead", ref: j.id, detail: `${j.type}: ${(j.last_error ?? "").slice(0, 160)}` });
  }

  for (const m of await rows<{ id: string; type: string; from_agent: string; to_agent: string }>(sql`
    SELECT id, type, from_agent, to_agent FROM agent_messages
    WHERE channel_id = ${channelId}::uuid AND status = 'open' ORDER BY created_at LIMIT 10`)) {
    items.push({ key: `msg:${m.id}`, kind: "message_open", ref: m.id, assignee: m.to_agent, detail: `${m.type} ${m.from_agent}→${m.to_agent}` });
  }

  const [{ published, reviewed }] = await rows<{ published: number; reviewed: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM publications pb JOIN projects p ON p.id = pb.project_id
        WHERE p.channel_id = ${channelId}::uuid AND pb.status = 'succeeded') AS published,
      (SELECT count(*)::int FROM decisions
        WHERE channel_id = ${channelId}::uuid AND type = 'weekly_review' AND created_at > ${nowIso}::timestamptz - interval '7 days') AS reviewed`);
  if (published > 0 && reviewed === 0) {
    items.push({ key: "weekly_review", kind: "weekly_review", assignee: "performance-analyst", detail: "Weekly performance review due" });
  }

  return { channelId, paused: false, items, fingerprint: agendaFingerprint(items) };
}

/**
 * No-progress detector: true when the last `n` finished runs had the same agenda fingerprint as
 * now (the manager keeps seeing the same items without resolving them). The caller parks the
 * items and escalates once instead of spending more model calls on them.
 */
export async function noProgress(channelId: string, fingerprint: string, n = 3): Promise<boolean> {
  const recent = await rows<{ agenda_fingerprint: string | null }>(sql`
    SELECT agenda_fingerprint FROM manager_runs
    WHERE channel_id = ${channelId}::uuid AND status IN ('finished','noop') AND agenda_fingerprint IS NOT NULL
    ORDER BY started_at DESC LIMIT ${n}::int`);
  return recent.length === n && recent.every((r) => r.agenda_fingerprint === fingerprint) && fingerprint !== agendaFingerprint([]);
}
