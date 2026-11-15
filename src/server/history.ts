import { getDb } from "./db/client";
import { historyEvents } from "./db/schema";

export type HistoryInput = {
  actor: string;
  action: string;
  message: string;
  level?: "info" | "warn" | "error";
  projectId?: string | null;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
};

const SECRET_KEY_PATTERN = /(key|secret|token|password|authorization|cookie)/i;

/** Defensive redaction: history must never contain secret values. */
export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEY_PATTERN.test(k)) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export async function recordHistory(e: HistoryInput) {
  await getDb()
    .insert(historyEvents)
    .values({
      actor: e.actor,
      action: e.action,
      message: e.message.slice(0, 2000),
      level: e.level ?? "info",
      projectId: e.projectId ?? null,
      entityType: e.entityType,
      entityId: e.entityId,
      data: redact(e.data),
    });
}
