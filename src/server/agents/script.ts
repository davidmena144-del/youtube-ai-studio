import {
  COMMON_RULES,
  MOCK_LABEL,
  feedbackBlock,
  projectBrief,
  ScriptSchema,
  targetWords,
  type AgentDefinition,
  type Script,
} from "./types";

function filler(words: number, seed: string) {
  const sentence = `هذا نص سردي تجريبي عن ${seed} يوضح شكل السيناريو النهائي.`;
  const perSentence = sentence.split(/\s+/).length;
  return Array.from({ length: Math.max(1, Math.round(words / perSentence)) }, () => sentence).join(" ");
}

export const scriptAgent: AgentDefinition<Script> = {
  id: "script",
  label: "وكيل الكتابة",
  artifactKind: "script",
  build(ctx) {
    const { project, artifacts } = ctx;
    const isShort = project.format === "short";
    const words = targetWords(project);
    const structure = isShort
      ? `Structure for a Short: a hook that grabs attention in the first 2 seconds, 2-4 fast beats (each a section), and a one-line call to action. No intro, no "welcome back". Every sentence must earn its place.`
      : `Structure for long-form: a hook (first 15-30 seconds) that states the payoff, then 4-8 sections with clear headings (they become chapters), each with concrete examples, and a closing call to action. Use natural spoken language with short sentences.`;
    return {
      name: "script",
      schema: ScriptSchema,
      system: `You are the Script Agent (scriptwriter) of a YouTube studio. You write narration to be read aloud by a voice-over.
${COMMON_RULES}
- Total narration (hook + sections + call to action) must be close to the target word count (±15%).
- estimatedSec per section must be realistic for the narration length; their sum plus hook and CTA should match the target duration.
- Only use facts from the research brief; keep flagged facts hedged ("according to…", "it is estimated…").`,
      prompt: `${projectBrief(project)}

${structure}
Target narration length: ~${words} words.

Research brief (JSON):
${JSON.stringify(artifacts.research ?? {}, null, 2)}
${artifacts.script ? `\nPrevious script version to improve (JSON):\n${JSON.stringify(artifacts.script)}` : ""}${feedbackBlock(ctx.feedback)}`,
      mock: () => {
        const sectionCount = isShort ? 3 : 5;
        const hookWords = Math.round(words * 0.1);
        const ctaWords = Math.round(words * 0.05);
        const perSection = Math.round((words - hookWords - ctaWords) / sectionCount);
        const perSectionSec = Math.round((project.targetDurationSec * 0.85) / sectionCount);
        return {
          workingTitle: `${project.topic} ${MOCK_LABEL}`,
          hook: `${MOCK_LABEL} ${filler(hookWords - 4, project.topic)}`,
          sections: Array.from({ length: sectionCount }, (_, i) => ({
            heading: `القسم ${i + 1}: ${project.topic}`,
            narration: filler(perSection, project.topic),
            estimatedSec: perSectionSec,
          })),
          callToAction: filler(ctaWords, "الاشتراك في القناة"),
        };
      },
    };
  },
};
