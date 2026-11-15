import {
  COMMON_RULES,
  feedbackBlock,
  projectBrief,
  StoryboardSchema,
  type AgentDefinition,
  type Storyboard,
} from "./types";

export const directorAgent: AgentDefinition<Storyboard> = {
  id: "director",
  label: "وكيل الإخراج",
  artifactKind: "storyboard",
  build(ctx) {
    const { project, artifacts } = ctx;
    const isShort = project.format === "short";
    const aspectRatio = isShort ? "9:16" : "16:9";
    return {
      name: "storyboard",
      schema: StoryboardSchema,
      system: `You are the Director Agent of a YouTube studio. You turn a narration script into a shot-by-shot storyboard that a fully automated renderer will assemble from stock footage, generated title cards and on-screen text.
${COMMON_RULES}
- aspectRatio must be "${aspectRatio}".
- Split narration into scenes of ${isShort ? "2-6" : "5-15"} seconds; keep every word of the narration, in order, across scenes.
- sectionHeading must exactly match the script section heading the scene belongs to (use "Hook" and "Call to action" for those parts).
- visual: what is on screen, described concretely. onScreenText: short overlay text in the viewer's language (may be empty).
- assetQuery: 2-5 English keywords to search a stock-footage library (Pexels/Pixabay); avoid people's names and brands.
${isShort ? "- Shorts: fast cuts, big readable text, keep the subject centered for vertical crop." : ""}`,
      prompt: `${projectBrief(project)}

Script (JSON):
${JSON.stringify(artifacts.script ?? {}, null, 2)}${feedbackBlock(ctx.feedback)}`,
      mock: () => {
        const script = artifacts.script!;
        const parts = [
          { heading: "Hook", text: script.hook, sec: isShort ? 3 : 20 },
          ...script.sections.map((s) => ({ heading: s.heading, text: s.narration, sec: s.estimatedSec })),
          { heading: "Call to action", text: script.callToAction, sec: isShort ? 3 : 15 },
        ];
        return {
          aspectRatio,
          musicMood: "هادئ ومحفّز",
          pacingNotes: isShort ? "قطع سريع كل 2-3 ثوانٍ" : "إيقاع متوسط مع لقطات داعمة",
          scenes: parts.map((p, index) => ({
            index,
            sectionHeading: p.heading,
            narration: p.text,
            visual: `لقطة توضيحية لموضوع: ${project.topic}`,
            onScreenText: p.heading === "Hook" ? project.topic : p.heading,
            shotType: index === 0 ? "close-up" : "b-roll",
            durationSec: p.sec,
            assetQuery: "abstract technology background",
          })),
        };
      },
    };
  },
};
