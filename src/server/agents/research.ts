import {
  COMMON_RULES,
  MOCK_LABEL,
  projectBrief,
  feedbackBlock,
  ResearchSchema,
  type AgentDefinition,
  type Research,
} from "./types";

export const researchAgent: AgentDefinition<Research> = {
  id: "research",
  label: "وكيل البحث",
  artifactKind: "research",
  build(ctx) {
    const { project } = ctx;
    return {
      name: "research",
      schema: ResearchSchema,
      system: `You are the Research Agent of a YouTube production studio. You prepare a concise, accurate research brief that a scriptwriter will rely on.
${COMMON_RULES}
- You have no live web access: mark any time-sensitive or specific factual claim with needsVerification=true and give a sourceHint (what kind of source would confirm it).
- Prefer evergreen, verifiable knowledge.`,
      prompt: `${projectBrief(project)}

Produce a research brief: a short summary, the target audience, 5-8 key points, 3 distinct angles with reasons, the important facts (with confidence and whether they need verification), common viewer questions, and risks (misinformation, policy, sensitivity).${feedbackBlock(ctx.feedback)}`,
      mock: () => ({
        summary: `${MOCK_LABEL} ملخص بحثي قالبي عن: ${project.topic}. فعّل مزوّد Claude للحصول على بحث حقيقي.`,
        audience: project.audience || "جمهور عام مهتم بالموضوع",
        keyPoints: [1, 2, 3, 4, 5].map((i) => `نقطة رئيسية ${i} حول ${project.topic}`),
        angles: [
          { title: `مدخل مبسط إلى ${project.topic}`, why: "يناسب المشاهد الجديد" },
          { title: "أخطاء شائعة", why: "يجذب الفضول ويقدم قيمة عملية" },
          { title: "خطوات عملية", why: "قابل للتطبيق فورًا" },
        ],
        facts: [
          {
            claim: `معلومة عامة عن ${project.topic}`,
            confidence: "low",
            needsVerification: true,
            sourceHint: "مصدر رسمي أو مرجع أكاديمي",
          },
        ],
        viewerQuestions: [`ما هو ${project.topic}؟`, "كيف أبدأ؟", "ما الأخطاء التي يجب تجنبها؟"],
        risks: ["المحتوى قالبي ويجب استبداله بمحتوى حقيقي قبل النشر"],
      }),
    };
  },
};
