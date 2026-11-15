import { formatTimestamp } from "./seo";
import {
  COMMON_RULES,
  MOCK_LABEL,
  countWords,
  projectBrief,
  QaLlmSchema,
  scriptFullText,
  targetWords,
  wordsPerMinute,
  type AgentContext,
  type AgentDefinition,
  type QaCheck,
  type QaLlm,
  type QaReport,
} from "./types";

const SHORTS_MAX_SEC = 180;

function parseTimestamp(ts: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(ts.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Rule-based checks that do not depend on any model. They are the hard gate. */
export function runDeterministicChecks(ctx: AgentContext): QaCheck[] {
  const { project, artifacts } = ctx;
  const { script, storyboard, seo, research } = artifacts;
  const checks: QaCheck[] = [];
  const add = (id: string, passed: boolean, severity: QaCheck["severity"], message: string) =>
    checks.push({ id, passed, severity, message });

  if (!script || !storyboard || !seo || !research) {
    add("artifacts.complete", false, "blocker", "مخرجات مرحلة سابقة مفقودة");
    return checks;
  }

  // Script length vs. target duration.
  const words = countWords(scriptFullText(script));
  const target = targetWords(project);
  const deviation = (words - target) / target;
  add(
    "script.length",
    Math.abs(deviation) <= 0.3,
    "major",
    `عدد كلمات السيناريو ${words} مقابل المستهدف ~${target} (انحراف ${Math.round(deviation * 100)}%)`,
  );
  if (!script.sections.length) add("script.sections", false, "blocker", "السيناريو بلا أقسام");

  const estimatedSec = Math.round((words / wordsPerMinute(project.language)) * 60);
  if (project.format === "short") {
    add(
      "short.duration",
      estimatedSec <= SHORTS_MAX_SEC,
      "blocker",
      `المدة المقدرة للـ Short ${estimatedSec} ثانية (الحد ${SHORTS_MAX_SEC})`,
    );
  }

  // Storyboard.
  const expectedRatio = project.format === "short" ? "9:16" : "16:9";
  add(
    "storyboard.aspect",
    storyboard.aspectRatio === expectedRatio,
    "blocker",
    `نسبة الأبعاد ${storyboard.aspectRatio} (المطلوب ${expectedRatio})`,
  );
  const sceneHeadings = new Set(storyboard.scenes.map((s) => s.sectionHeading.trim()));
  const missing = script.sections.filter((s) => !sceneHeadings.has(s.heading.trim())).map((s) => s.heading);
  add(
    "storyboard.coverage",
    missing.length === 0,
    "major",
    missing.length ? `أقسام بلا مشاهد: ${missing.join("، ")}` : "كل أقسام السيناريو مغطاة بمشاهد",
  );
  const sceneSec = storyboard.scenes.reduce((a, s) => a + s.durationSec, 0);
  add(
    "storyboard.duration",
    Math.abs(sceneSec - project.targetDurationSec) / project.targetDurationSec <= 0.3,
    "minor",
    `مجموع مدد المشاهد ${Math.round(sceneSec)} ثانية مقابل المستهدف ${project.targetDurationSec}`,
  );

  // SEO — YouTube hard limits.
  const title = seo.recommendedTitle.trim();
  add("seo.title.length", title.length > 0 && title.length <= 100, "blocker", `طول العنوان ${title.length} حرفًا (الحد 100)`);
  add(
    "seo.no_angle_brackets",
    !/[<>]/.test(title + seo.description),
    "blocker",
    "العنوان والوصف خاليان من الرمزين < و > (يرفضهما YouTube)",
  );
  add(
    "seo.description.length",
    seo.description.length <= 5000,
    "blocker",
    `طول الوصف ${seo.description.length} حرفًا (الحد 5000)`,
  );
  const tagsLen = seo.tags.reduce((a, t) => a + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, seo.tags.length - 1);
  add("seo.tags.length", tagsLen <= 500, "major", `إجمالي طول الوسوم ${tagsLen} حرفًا (الحد 500)`);
  add("seo.hashtags.count", seo.hashtags.length <= 15, "major", `عدد الهاشتاغات ${seo.hashtags.length} (أكثر من 15 يتجاهلها YouTube)`);

  if (project.format === "long" && seo.chapters.length) {
    const secs = seo.chapters.map((c) => parseTimestamp(c.timestamp));
    const valid =
      secs[0] === 0 &&
      seo.chapters.length >= 3 &&
      secs.every((s, i) => s !== null && (i === 0 || s - (secs[i - 1] ?? 0) >= 10));
    add(
      "seo.chapters",
      valid,
      "minor",
      valid
        ? `الفصول صالحة (${seo.chapters.length})`
        : `الفصول لا تطابق شروط YouTube (تبدأ بـ ${formatTimestamp(0)}، 3 على الأقل، 10 ثوانٍ بينها)`,
    );
  }

  // Informational warnings.
  const unverified = research.facts.filter((f) => f.needsVerification).length;
  add(
    "research.unverified",
    unverified === 0,
    "minor",
    unverified ? `${unverified} معلومة تحتاج تحققًا يدويًا قبل النشر` : "لا توجد معلومات معلّمة للتحقق",
  );
  const isMock = JSON.stringify(artifacts).includes(MOCK_LABEL);
  add("content.not_mock", !isMock, "minor", isMock ? "المحتوى قالبي (mock) — لا يصلح للنشر" : "المحتوى مولّد من مزود حقيقي");

  return checks;
}

export const qaAgent: AgentDefinition<QaLlm, QaReport> = {
  id: "qa",
  label: "وكيل مراجعة الجودة",
  artifactKind: "qa_report",
  build(ctx) {
    return {
      name: "qa_review",
      schema: QaLlmSchema,
      system: `You are the Quality Review Agent of a YouTube studio. You are strict, specific and fair. You review the research, script, storyboard and SEO metadata before a human approves publication.
${COMMON_RULES}
Score 0-100 for overall publish-readiness. Report concrete issues with severity:
- blocker: must not be published as is (factual error, policy risk, broken structure)
- major: clearly hurts quality or retention (weak hook, padding, misleading title)
- minor: polish
List any claims that a human should fact-check in factCheckFlags. Write descriptions and suggestions in the content language.`,
      prompt: `${projectBrief(ctx.project)}

Artifacts (JSON):
${JSON.stringify(ctx.artifacts, null, 2)}`,
      mock: () => ({
        score: 75,
        summary: `${MOCK_LABEL} مراجعة قالبية: البنية سليمة، لكن المحتوى غير حقيقي.`,
        issues: [],
        factCheckFlags: [],
      }),
    };
  },
  finalize(data, ctx) {
    const checks = runDeterministicChecks(ctx);
    const minScore = ctx.settings.qaMinScore;
    const score = Math.max(0, Math.min(100, Math.round(data.score)));
    const hardFail = checks.some((c) => !c.passed && (c.severity === "blocker" || c.severity === "major"));
    const llmBlocker = data.issues.some((i) => i.severity === "blocker");
    return { ...data, score, checks, minScore, passed: !hardFail && !llmBlocker && score >= minScore };
  },
};
