import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { settings } from "./db/schema";

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export const AppSettingsSchema = z.object({
  channelName: z.string().max(100).default(""),
  channelDescription: z.string().max(1000).default(""),
  defaultLanguage: z.enum(["ar", "en"]).default("ar"),
  defaultTone: z.string().max(200).default("ودّي ومعلوماتي"),
  longTargetSec: z.number().int().min(120).max(3600).default(480),
  shortTargetSec: z.number().int().min(15).max(180).default(50),
  llmModel: z.enum(CLAUDE_MODELS).default("claude-opus-5-5"),
  llmEffort: z.enum(EFFORT_LEVELS).default("medium"),
  qaMinScore: z.number().int().min(0).max(100).default(70),
  qaMaxAutoRevisions: z.number().int().min(0).max(3).default(1),
  defaultPrivacy: z.enum(["private", "unlisted", "public"]).default("private"),
  timeZone: z
    .string()
    .default("UTC")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "منطقة زمنية غير صالحة"),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

const KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, KEY));
  const parsed = AppSettingsSchema.safeParse(row?.value ?? {});
  // If stored settings became invalid (schema change), fall back to defaults for bad fields.
  return parsed.success ? parsed.data : AppSettingsSchema.parse({});
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = AppSettingsSchema.parse({ ...current, ...patch });
  await getDb()
    .insert(settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
