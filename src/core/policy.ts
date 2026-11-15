import { z } from "zod";

/**
 * Channel safety & autonomy policy, set once at onboarding and changeable only from the owner's
 * chat (stored versioned in channel_policies). Defaults implement FULL AUTONOMY: the manager
 * publishes without per-video approval; the owner only sets this up and can stop it (kill_switch).
 */
export const PUBLISH_MODES = ["dry_run", "private_only", "auto"] as const;

export const ChannelPolicySchema = z.object({
  /**
   * dry_run: nothing reaches YouTube. private_only: uploads stay private.
   * auto: uploads are scheduled (private + publishAt) and YouTube publishes them on time.
   */
  publish_mode: z.enum(PUBLISH_MODES).default("auto"),
  /** Stop everything (manager runs, production, publishing). Analytics may continue. */
  kill_switch: z.boolean().default(false),
  max_long_per_week: z.number().int().min(0).max(14).default(1),
  max_shorts_per_week: z.number().int().min(0).max(21).default(3),
  max_uploads_per_day: z.number().int().min(0).max(10).default(2),
  min_hours_between_uploads: z.number().min(0).max(72).default(12),
  /** Realistic synthetic voice/visuals are disclosed via status.containsSyntheticMedia. */
  synthetic_media_rule: z.enum(["always", "when_realistic"]).default("always"),
  banned_topics: z.array(z.string().max(200)).max(100).default([]),
  required_disclaimers: z.array(z.enum(["health", "finance", "legal"])).default(["health", "finance", "legal"]),
  allowed_licenses: z
    .array(z.string())
    .default(["pexels", "pixabay", "cc0", "cc-by-4.0", "cc-by-3.0", "original"]),
  languages: z.array(z.enum(["ar", "en"])).min(1).default(["ar"]),
  manager_cadence_hours: z.number().int().min(1).max(24).default(3),
  /** Claude subscription protection: specialist invocations allowed. */
  max_model_calls_per_run: z.number().int().min(0).max(30).default(8),
  daily_model_call_budget: z.number().int().min(0).max(200).default(40),
  weekly_model_call_budget: z.number().int().min(0).max(1000).default(200),
  max_revisions_per_stage: z.number().int().min(0).max(5).default(2),
  /** Free-tier guards (stop BEFORE the provider's own hard limit). */
  gha_monthly_minutes_budget: z.number().int().min(0).max(2000).default(1700),
});

export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>;

export const DEFAULT_POLICY: ChannelPolicy = ChannelPolicySchema.parse({});

export function parsePolicy(raw: unknown): ChannelPolicy {
  return ChannelPolicySchema.parse(raw ?? {});
}
