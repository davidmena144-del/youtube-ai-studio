import {
  COMMON_RULES,
  MOCK_LABEL,
  feedbackBlock,
  projectBrief,
  SeoSchema,
  type AgentDefinition,
  type Seo,
} from "./types";

export function formatTimestamp(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export const seoAgent: AgentDefinition<Seo> = {
  id: "seo",
  label: "وكيل SEO",
  artifactKind: "seo",
  build(ctx) {
    const { project, artifacts } = ctx;
    const isShort = project.format === "short";
    return {
      name: "seo",
      schema: SeoSchema,
      system: `You are the SEO Agent of a YouTube studio. You write metadata that is accurate to the content and optimised for search and click-through without clickbait.
${COMMON_RULES}
- titles: 3 options, each at most 70 characters ideally and never more than 100. No "<" or ">" characters anywhere.
- description: first 2 lines summarise the value (they show in search); then details${isShort ? "" : ", then the chapters list"}; at most 5000 characters.
- tags: 8-15 relevant tags; total length of all tags combined under 450 characters.
- hashtags: 2-5 (YouTube ignores all hashtags if there are more than 15).${isShort ? ' Include "#shorts".' : ""}
- chapters: ${isShort ? "return an empty array for Shorts." : 'one per script section, the first at "0:00", at least 3, each at least 10 seconds apart.'}
- thumbnailText: 2-4 punchy words. thumbnailConcept: a description of the thumbnail image.
- categoryId: the best YouTube category id (e.g. "27" Education, "28" Science & Technology, "22" People & Blogs, "26" Howto & Style).`,
      prompt: `${projectBrief(project)}

Script (JSON):
${JSON.stringify(artifacts.script ?? {}, null, 2)}

Research summary: ${artifacts.research?.summary ?? ""}${feedbackBlock(ctx.feedback)}`,
      mock: () => {
        const script = artifacts.script!;
        let t = isShort ? 0 : 20;
        const chapters = isShort
          ? []
          : [
              { timestamp: "0:00", title: "المقدمة" },
              ...script.sections.map((s) => {
                const c = { timestamp: formatTimestamp(t), title: s.heading };
                t += s.estimatedSec;
                return c;
              }),
            ];
        const title = `${project.topic} — دليل مختصر`.slice(0, 90);
        return {
          titles: [title, `كل ما تحتاج معرفته عن ${project.topic}`.slice(0, 90), `${project.topic} ببساطة`.slice(0, 90)],
          recommendedTitle: title,
          description: `${MOCK_LABEL}\nفي هذا الفيديو نتحدث عن ${project.topic}.\n\n${chapters
            .map((c) => `${c.timestamp} ${c.title}`)
            .join("\n")}`,
          tags: [project.topic, "تعلم", "شرح", "دليل"],
          hashtags: isShort ? ["#shorts", "#تعلم"] : ["#تعلم", "#شرح"],
          chapters,
          thumbnailText: project.topic.split(/\s+/).slice(0, 3).join(" "),
          thumbnailConcept: "خلفية بلون قوي ونص كبير واضح مع أيقونة تعبر عن الموضوع",
          categoryId: "27",
        };
      },
    };
  },
};
