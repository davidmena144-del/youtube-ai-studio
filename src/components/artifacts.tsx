import type { ReactNode } from "react";
import type { QaReport, Research, Script, Seo, Storyboard } from "@/server/agents/types";
import { countWords, scriptFullText } from "@/server/agents/types";
import { SEVERITY_LABEL } from "@/lib/labels";
import { Badge } from "./ui";

export function Section({ title, badge, children, open = false }: { title: string; badge?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-surface">
      <summary className="flex items-center justify-between gap-2 px-4 py-3 font-semibold">
        <span className="flex items-center gap-2">
          {title} {badge}
        </span>
        <span className="text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

const sev = { blocker: "red", major: "amber", minor: "gray" } as const;

export function QaView({ qa }: { qa: QaReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={`text-3xl font-bold tabular-nums ${qa.passed ? "text-tone-green-fg" : "text-tone-amber-fg"}`}>{qa.score}</div>
        <div>
          <p className="font-medium">{qa.passed ? "اجتاز مراجعة الجودة" : "لم يجتز مراجعة الجودة"}</p>
          <p className="text-xs text-muted">الحد الأدنى {qa.minScore}</p>
        </div>
      </div>
      <p>{qa.summary}</p>
      <ul className="space-y-1.5">
        {qa.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <span aria-hidden>{c.passed ? "✅" : c.severity === "minor" ? "⚠️" : "❌"}</span>
            <span className={c.passed ? "text-muted" : ""}>{c.message}</span>
          </li>
        ))}
      </ul>
      {qa.issues.length ? (
        <div>
          <p className="mb-1 font-medium">ملاحظات المراجِع</p>
          <ul className="space-y-2">
            {qa.issues.map((i, n) => (
              <li key={n} className="rounded-xl bg-tone-gray p-2.5">
                <Badge tone={sev[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge> <span className="font-medium">{i.description}</span>
                <p className="mt-1 text-muted">💡 {i.suggestion}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {qa.factCheckFlags.length ? (
        <div>
          <p className="mb-1 font-medium">تحقق يدويًا من:</p>
          <ul className="list-disc ps-5">
            {qa.factCheckFlags.map((f, n) => (
              <li key={n}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ResearchView({ r }: { r: Research }) {
  return (
    <div className="space-y-3">
      <p>{r.summary}</p>
      <p>
        <span className="font-medium">الجمهور: </span>
        {r.audience}
      </p>
      <List title="النقاط الرئيسية" items={r.keyPoints} />
      <List title="زوايا الطرح" items={r.angles.map((a) => `${a.title} — ${a.why}`)} />
      <div>
        <p className="mb-1 font-medium">المعلومات</p>
        <ul className="space-y-1.5">
          {r.facts.map((f, i) => (
            <li key={i} className="rounded-xl bg-tone-gray p-2.5">
              {f.claim}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone={f.confidence === "high" ? "green" : f.confidence === "medium" ? "amber" : "red"}>ثقة: {f.confidence}</Badge>
                {f.needsVerification ? <Badge tone="amber">يحتاج تحقق</Badge> : null}
                <span className="text-xs text-muted">{f.sourceHint}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <List title="أسئلة المشاهدين" items={r.viewerQuestions} />
      <List title="مخاطر" items={r.risks} />
    </div>
  );
}

export function ScriptView({ s }: { s: Script }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{countWords(scriptFullText(s))} كلمة</p>
      <Block title="الافتتاحية (Hook)">{s.hook}</Block>
      {s.sections.map((sec, i) => (
        <Block key={i} title={`${sec.heading} · ~${Math.round(sec.estimatedSec)} ث`}>
          {sec.narration}
        </Block>
      ))}
      <Block title="الدعوة لاتخاذ إجراء">{s.callToAction}</Block>
    </div>
  );
}

export function StoryboardView({ sb }: { sb: Storyboard }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="blue">{sb.aspectRatio}</Badge>
        <Badge>🎵 {sb.musicMood}</Badge>
        <Badge>{sb.scenes.length} مشهد</Badge>
      </div>
      <p className="text-muted">{sb.pacingNotes}</p>
      <ol className="space-y-2">
        {sb.scenes.map((sc) => (
          <li key={sc.index} className="rounded-xl bg-tone-gray p-2.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                #{sc.index + 1} · {sc.shotType} · {sc.sectionHeading}
              </span>
              <span>{Math.round(sc.durationSec)} ث</span>
            </div>
            <p className="mt-1">🎬 {sc.visual}</p>
            {sc.onScreenText ? <p className="mt-1 font-medium">🅃 {sc.onScreenText}</p> : null}
            <p className="mt-1 line-clamp-3 text-muted">🎙 {sc.narration}</p>
            <p className="mt-1 text-xs text-muted" dir="ltr">
              🔎 {sc.assetQuery}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SeoView({ seo }: { seo: Seo }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 font-medium">العنوان المقترح</p>
        <p className="rounded-xl bg-tone-gray p-2.5 font-semibold">{seo.recommendedTitle}</p>
        <p className="mt-1 text-xs text-muted">{seo.recommendedTitle.length}/100 حرف</p>
      </div>
      <List title="بدائل" items={seo.titles} />
      <Block title={`الوصف (${seo.description.length}/5000)`}>
        <span className="whitespace-pre-wrap">{seo.description}</span>
      </Block>
      <div>
        <p className="mb-1 font-medium">الوسوم</p>
        <div className="flex flex-wrap gap-1.5">
          {seo.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </div>
      <p>
        <span className="font-medium">الهاشتاغات: </span>
        {seo.hashtags.join(" ")}
      </p>
      {seo.chapters.length ? <List title="الفصول" items={seo.chapters.map((c) => `${c.timestamp} ${c.title}`)} /> : null}
      <Block title="الصورة المصغرة">
        <p className="font-bold">«{seo.thumbnailText}»</p>
        <p className="text-muted">{seo.thumbnailConcept}</p>
      </Block>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="list-disc space-y-0.5 ps-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <div className="rounded-xl bg-tone-gray p-2.5 leading-7">{children}</div>
    </div>
  );
}
