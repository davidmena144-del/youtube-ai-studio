import type { AgentId } from "../agents";
import type { ArtifactKind, VideoFormat } from "../db/schema";

export type StageId = "research" | "script" | "direction" | "seo" | "qa";

export type StageDef = { id: StageId; agent: AgentId; label: string; artifactKind: ArtifactKind };

const TEXT_STAGES: StageDef[] = [
  { id: "research", agent: "research", label: "البحث", artifactKind: "research" },
  { id: "script", agent: "script", label: "السيناريو", artifactKind: "script" },
  { id: "direction", agent: "director", label: "الإخراج", artifactKind: "storyboard" },
  { id: "seo", agent: "seo", label: "SEO", artifactKind: "seo" },
  { id: "qa", agent: "qa", label: "مراجعة الجودة", artifactKind: "qa_report" },
];

/**
 * Stages per format. Phase 1: text pipeline for both formats (agents adapt to the format).
 * Phase 2 inserts production stages (voice, subtitles, visuals, render, thumbnail) before QA.
 */
export function pipelineFor(format: VideoFormat): StageDef[] {
  void format;
  return TEXT_STAGES;
}

export function stageDef(format: VideoFormat, id: string): StageDef {
  const def = pipelineFor(format).find((s) => s.id === id);
  if (!def) throw new Error(`Unknown stage "${id}"`);
  return def;
}

export function nextStage(format: VideoFormat, id: StageId): StageDef | null {
  const stages = pipelineFor(format);
  const i = stages.findIndex((s) => s.id === id);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null;
}

export function isStageId(v: unknown): v is StageId {
  return typeof v === "string" && TEXT_STAGES.some((s) => s.id === v);
}
