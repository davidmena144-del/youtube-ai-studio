import { desc, eq, and } from "drizzle-orm";
import { getDb, one, sql } from "../server/db/client";
import { channelPolicies, channels, directives, type Channel } from "../server/db/schema";
import { recordHistory } from "../server/history";
import { DEFAULT_POLICY, parsePolicy, type ChannelPolicy } from "./policy";

export async function initChannel(input: { title: string; language?: string; niche?: string; timeZone?: string }) {
  const db = getDb();
  const [ch] = await db
    .insert(channels)
    .values({
      title: input.title,
      language: input.language ?? "ar",
      niche: input.niche ?? null,
      timeZone: input.timeZone ?? "UTC",
      status: "active",
    })
    .returning();
  await db.insert(channelPolicies).values({ channelId: ch.id, version: 1, policy: DEFAULT_POLICY, createdBy: "owner" });
  await recordHistory({ actor: "owner", action: "channel.created", message: `Channel created: ${ch.title}`, data: { channelId: ch.id } });
  return ch;
}

export async function getChannel(id?: string): Promise<Channel | undefined> {
  const db = getDb();
  if (id) return (await db.select().from(channels).where(eq(channels.id, id)))[0];
  return (await db.select().from(channels).orderBy(channels.createdAt).limit(1))[0];
}

export async function mustGetChannel(id?: string): Promise<Channel> {
  const ch = await getChannel(id);
  if (!ch) throw new Error("No channel configured. Run: studio channel init --title <name>");
  return ch;
}

export async function activePolicy(channelId: string): Promise<{ version: number; policy: ChannelPolicy }> {
  const [row] = await getDb()
    .select()
    .from(channelPolicies)
    .where(eq(channelPolicies.channelId, channelId))
    .orderBy(desc(channelPolicies.version))
    .limit(1);
  return { version: row?.version ?? 0, policy: parsePolicy(row?.policy) };
}

/** Creates a new policy version (validated). Old versions are kept for audit and rollback. */
export async function setPolicy(channelId: string, patch: Partial<ChannelPolicy>, actor = "owner") {
  const current = await activePolicy(channelId);
  const next = parsePolicy({ ...current.policy, ...patch });
  const version = current.version + 1;
  await getDb().insert(channelPolicies).values({ channelId, version, policy: next, createdBy: actor });
  await recordHistory({
    actor,
    action: "policy.updated",
    message: `Policy v${version}`,
    data: { channelId, version, changed: Object.keys(patch) },
  });
  return { version, policy: next };
}

export async function isPaused(channelId: string): Promise<boolean> {
  const r = await one<{ paused: boolean }>(sql`SELECT app.channel_paused(${channelId}::uuid) AS paused`);
  return Boolean(r?.paused);
}

export async function addDirective(channelId: string, text: string, kind = "instruction") {
  const [d] = await getDb().insert(directives).values({ channelId, text: text.slice(0, 4000), kind }).returning();
  await recordHistory({ actor: "owner", action: "directive.added", message: text.slice(0, 200), data: { channelId, id: d.id } });
  return d;
}

export async function listDirectives(channelId: string, status = "active") {
  return getDb()
    .select()
    .from(directives)
    .where(and(eq(directives.channelId, channelId), eq(directives.status, status)))
    .orderBy(directives.createdAt);
}

export async function resolveDirective(id: string, status: "done" | "superseded" | "rejected", resolution: string) {
  const [d] = await getDb()
    .update(directives)
    .set({ status, resolution: resolution.slice(0, 2000), resolvedAt: new Date() })
    .where(and(eq(directives.id, id), eq(directives.status, "active")))
    .returning();
  return d;
}
