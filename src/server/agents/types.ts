import { z } from "zod";
import type { ArtifactKind, Project } from "../db/schema";
import type { StructuredRequest } from "../providers/llm/types";

// ---------- Output schemas (the contract every LLM provider must satisfy) ----------
// Kept free of min/max constraints so they map cleanly to JSON-schema structured outputs;
// numeric/length rules are enforced by the deterministic QA checks instead.

export const ResearchSchema = z.object({
  summary: z.string(),
  audience: z.string(),
  keyPoints: z.array(z.string()),
  angles: z.array(z.object({ title: z.string(), why: z.string() })),
  facts: z.array(
    z.object({
      claim: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      needsVerification: z.boolean(),
      sourceHint: z.string(),
    }),
  ),
  viewerQuestions: z.array(z.string()),
  risks: z.array(z.string()),
});
export type Research = z.infer<typeof ResearchSchema>;

export const ScriptSchema = z.object({
  workingTitle: z.string(),
  hook: z.string(),
  sections: z.array(z.object({ heading: z.string(), narration: z.string(), estimatedSec: z.number() })),
  callToAction: z.string(),
});
export type Script = z.infer<typeof ScriptSchema>;

export const StoryboardSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16"]),
  musicMood: z.string(),
  pacingNotes: z.string(),
  scenes: z.array(
    z.object({
      index: z.number().int(),
      sectionHeading: z.string(),
      narration: z.string(),
      visual: z.string(),
      onScreenText: z.string(),
      shotType: z.string(),
      durationSec: z.number(),
      /** English keywords for stock-footage search (phase 2). */
      assetQuery: z.string(),
    }),
  ),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const SeoSchema = z.object({
  titles: z.array(z.string()),
  recommendedTitle: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  hashtags: z.array(z.string()),
  chapters: z.array(z.object({ timestamp: z.string(), title: z.string() })),
  thumbnailText: z.string(),
  thumbnailConcept: z.string(),
  /** YouTube category id, e.g. "27" Education, "28" Science & Technology, "22" People & Blogs. */
  categoryId: z.string(),
});
export type Seo = z.infer<typeof SeoSchema>;

export const QaLlmSchema = z.object({
  score: z.number(),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      area: z.enum(["research", "script", "storyboard", "seo", "policy"]),
      description: z.string(),
      suggestion: z.string(),
    }),
  ),
  factCheckFlags: z.array(z.string()),
});
export type QaLlm = z.infer<typeof QaLlmSchema>;

export type QaCheck = { id: string; passed: boolean; severity: "blocker" | "major" | "minor"; message: string };

export type QaReport = QaLlm & {
  checks: QaCheck[];
  passed: boolean;
  minScore: number;
};

// ---------- Agent contract ----------

/** The subset of channel configuration agents need (QA threshold). */
export type AgentSettings = { qaMinScore: number };

export type PipelineArtifacts = {
  research?: Research;
  script?: Script;
  storyboard?: Storyboard;
  seo?: Seo;
};

export type AgentContext = {
  project: Project;
  settings: AgentSettings;
  artifacts: PipelineArtifacts;
  /** Reviewer / QA feedback to address in this run. */
  feedback: string[];
};

export type AgentDefinition<T = unknown, R = T> = {
  id: string;
  label: string;
  artifactKind: ArtifactKind;
  build(ctx: AgentContext): StructuredRequest<T>;
  /** Optional deterministic post-processing (e.g. QA merges rule-based checks). */
  finalize?(data: T, ctx: AgentContext): R;
};

// ---------- Shared helpers ----------

export function languageName(code: string) {
  return code === "ar" ? "Modern Standard Arabic (فصحى مبسطة)" : "English";
}

/** Approximate narration pace (words per minute). */
export function wordsPerMinute(language: string) {
  return language === "ar" ? 125 : 150;
}

export function targetWords(project: Project) {
  return Math.round((project.targetDurationSec / 60) * wordsPerMinute(project.language));
}

export function countWords(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function scriptFullText(script: Script) {
  return [script.hook, ...script.sections.map((s) => s.narration), script.callToAction].join("\n");
}

export function projectBrief(p: Project) {
  return [
    `Topic (chosen by the channel owner): ${p.topic}`,
    `Format: ${p.format === "short" ? "YouTube Short (vertical 9:16)" : "Long-form YouTube video (16:9)"}`,
    `Target duration: ${p.targetDurationSec} seconds (~${targetWords(p)} spoken words)`,
    `Language: ${languageName(p.language)}`,
    p.tone ? `Tone: ${p.tone}` : null,
    p.audience ? `Audience: ${p.audience}` : null,
    p.notes ? `Owner notes: ${p.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function feedbackBlock(feedback: string[]) {
  if (!feedback.length) return "";
  return `\n\nFeedback that MUST be addressed in this version:\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
}

export const COMMON_RULES = `Rules:
- Write all viewer-facing text in the requested language.
- Be original. Do not copy existing creators' scripts, titles or branding.
- Never invent statistics, quotes or sources. If a fact is uncertain, say so and flag it for verification.
- Follow YouTube Community Guidelines; avoid misleading claims and clickbait that the content does not deliver.
- For health, legal or financial topics, include a short, clear disclaimer.`;

export const MOCK_LABEL = "[محتوى تجريبي — وضع mock]";
