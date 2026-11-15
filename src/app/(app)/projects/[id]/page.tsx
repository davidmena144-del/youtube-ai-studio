import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  cancelProjectAction,
  publishAction,
  retryProjectAction,
  reviewAction,
  scheduleAction,
} from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { QaView, ResearchView, ScriptView, SeoView, Section, StoryboardView } from "@/components/artifacts";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, Field, input, StatusBadge } from "@/components/ui";
import { formatDateTime, formatDuration, formatUsd, utcToZonedLocal } from "@/lib/format";
import { FORMAT_LABEL, PROJECT_STATUS_LABEL } from "@/lib/labels";
import { pipelineFor } from "@/server/manager/pipeline";
import { projectDetail } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "تفاصيل المشروع" };

const RUNNING = ["queued", "in_progress", "changes_requested", "publishing"];
const DONE = ["awaiting_review", "approved", "publishing", "published"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, settings] = await Promise.all([projectDetail(id), getSettings()]);
  if (!d) notFound();
  const { project: p, artifacts: a } = d;
  const tz = settings.timeZone;
  const stages = pipelineFor(p.format);
  const currentIdx = stages.findIndex((s) => s.id === p.currentStage);
  const totalCost = d.stageRuns.reduce((s, r) => s + Number(r.costUsd ?? 0), 0);
  const nextJob = d.activeJobs[0];

  return (
    <>
      <AutoRefresh active={RUNNING.includes(p.status)} />

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={p.status} label={PROJECT_STATUS_LABEL[p.status]} />
          <Badge tone={p.format === "short" ? "violet" : "gray"}>{FORMAT_LABEL[p.format]}</Badge>
          <Badge>{formatDuration(p.targetDurationSec)}</Badge>
          {p.revision ? <Badge>مراجعة #{p.revision}</Badge> : null}
        </div>
        <h1 className="mt-2 text-xl font-bold leading-snug">{p.title}</h1>
        <p className="mt-1 text-sm text-muted">الموضوع: {p.topic}</p>
      </header>

      {/* Pipeline stepper */}
      <Card className="mb-4">
        <ol className="flex items-start justify-between gap-1">
          {stages.map((s, i) => {
            const state = DONE.includes(p.status)
              ? "done"
              : p.status === "cancelled"
                ? "idle"
                : i < currentIdx
                  ? "done"
                  : i === currentIdx
                    ? p.status === "failed"
                      ? "failed"
                      : "active"
                    : "idle";
            return (
              <li key={s.id} className="flex flex-1 flex-col items-center gap-1 text-center">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    state === "done"
                      ? "bg-tone-green text-tone-green-fg"
                      : state === "active"
                        ? "animate-pulse bg-tone-blue text-tone-blue-fg"
                        : state === "failed"
                          ? "bg-tone-red text-tone-red-fg"
                          : "bg-tone-gray text-muted"
                  }`}
                >
                  {state === "done" ? "✓" : state === "failed" ? "!" : i + 1}
                </span>
                <span className="text-[11px] leading-tight">{s.label}</span>
              </li>
            );
          })}
        </ol>
        {nextJob && nextJob.status === "queued" && nextJob.attempts > 0 ? (
          <p className="mt-3 text-xs text-tone-amber-fg">
            إعادة محاولة مجدولة {formatDateTime(nextJob.runAt, tz)} — آخر خطأ: {nextJob.lastError}
          </p>
        ) : null}
      </Card>

      {/* Decision panel */}
      {p.status === "failed" ? (
        <Card className="mb-4 border-tone-red-fg/30">
          <p className="font-semibold text-tone-red-fg">توقف الإنتاج</p>
          <p className="mt-1 text-sm">{p.lastError}</p>
          <ActionForm action={retryProjectAction} className="mt-3 space-y-2">
            <input type="hidden" name="projectId" value={p.id} />
            <SubmitButton>إعادة المحاولة</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {p.status === "awaiting_review" ? (
        <Card className="mb-4 border-tone-amber-fg/30">
          <p className="font-semibold">قرارك مطلوب</p>
          <p className="mt-1 text-sm text-muted">
            راجع المخرجات أدناه. {a.qa && !a.qa.passed ? "⚠️ مراجعة الجودة لديها ملاحظات غير محلولة." : ""}
          </p>
          <ActionForm action={reviewAction} className="mt-3 space-y-3">
            <input type="hidden" name="projectId" value={p.id} />
            <Field label="ملاحظات (مطلوبة لطلب التعديل)">
              <textarea name="notes" rows={3} maxLength={4000} className={input} placeholder="مثال: اجعل الافتتاحية أقوى واذكر مثالًا عمليًا" />
            </Field>
            <Field label="إعادة التشغيل من مرحلة">
              <select name="restartFromStage" defaultValue="script" className={input}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <SubmitButton name="decision" value="approved">
                ✓ موافقة
              </SubmitButton>
              <SubmitButton name="decision" value="changes_requested" variant="secondary">
                طلب تعديل
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {p.status === "approved" ? (
        <Card className="mb-4 border-tone-green-fg/30">
          <p className="font-semibold">جاهز للنشر</p>
          {p.lastError ? <p className="mt-1 text-sm text-tone-red-fg">{p.lastError}</p> : null}
          <p className="mt-1 text-sm text-muted">
            وضع النشر الحالي: <strong>تجريبي (dry-run)</strong> — يتحقق من بيانات الرفع ويسجلها دون إرسال أي شيء إلى YouTube. النشر الحقيقي يُبنى ويُختبر في المرحلة 3.
          </p>
          <ActionForm action={publishAction} className="mt-3 space-y-3">
            <input type="hidden" name="projectId" value={p.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" value="yes" required className="h-5 w-5" /> أؤكد طلب النشر التجريبي
            </label>
            <SubmitButton>نشر تجريبي</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {d.publications.length ? (
        <Section title="النشر" badge={<Badge tone="blue">{d.publications.length}</Badge>} open={p.status === "published"}>
          <ul className="space-y-2">
            {d.publications.map((pub) => (
              <li key={pub.id} className="rounded-xl bg-tone-gray p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={pub.status} label={pub.status} />
                  <Badge>{pub.mode === "dry_run" ? "تجريبي" : "حقيقي"}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(pub.createdAt, tz)}</span>
                </div>
                {pub.error ? <p className="mt-1 text-tone-red-fg">{pub.error}</p> : null}
                {pub.response ? (
                  <pre dir="ltr" className="mt-2 max-h-64 overflow-auto rounded-lg bg-bg p-2 text-[11px] leading-5">
                    {JSON.stringify(pub.response, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="space-y-3">
        {a.qa ? (
          <Section title="مراجعة الجودة" badge={<Badge tone={a.qa.passed ? "green" : "amber"}>{a.qa.score}</Badge>} open={p.status === "awaiting_review"}>
            <QaView qa={a.qa} />
          </Section>
        ) : null}
        {a.seo ? (
          <Section title="SEO والبيانات الوصفية">
            <SeoView seo={a.seo} />
          </Section>
        ) : null}
        {a.script ? (
          <Section title="السيناريو">
            <ScriptView s={a.script} />
          </Section>
        ) : null}
        {a.storyboard ? (
          <Section title="الإخراج (Storyboard)">
            <StoryboardView sb={a.storyboard} />
          </Section>
        ) : null}
        {a.research ? (
          <Section title="البحث">
            <ResearchView r={a.research} />
          </Section>
        ) : null}

        <Section title="موعد النشر" badge={p.scheduledPublishAt ? <Badge tone="blue">{formatDateTime(p.scheduledPublishAt, tz)}</Badge> : null}>
          <ActionForm action={scheduleAction}>
            <input type="hidden" name="projectId" value={p.id} />
            <Field label={`التاريخ والوقت (${tz})`} hint="اتركه فارغًا لإلغاء الموعد">
              <input name="scheduledPublishAt" type="datetime-local" defaultValue={utcToZonedLocal(p.scheduledPublishAt, tz)} className={input} />
            </Field>
            <SubmitButton variant="secondary">حفظ الموعد</SubmitButton>
          </ActionForm>
        </Section>

        <Section title="تشغيلات الوكلاء" badge={<Badge>{formatUsd(totalCost)}</Badge>}>
          <ul className="divide-y divide-line">
            {d.stageRuns.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.stage} · {r.agent}
                  </span>
                  <StatusBadge status={r.status} label={r.status} />
                </div>
                <p className="text-xs text-muted" dir="ltr">
                  {r.provider ?? "—"} / {r.model ?? "—"} · in {r.inputTokens ?? 0} · out {r.outputTokens ?? 0} · {formatUsd(r.costUsd)} ·{" "}
                  {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"}
                </p>
                {r.error ? <p className="mt-1 text-xs text-tone-red-fg">{r.error}</p> : null}
              </li>
            ))}
          </ul>
        </Section>

        {d.reviews.length ? (
          <Section title="المراجعات">
            <ul className="space-y-2">
              {d.reviews.map((r) => (
                <li key={r.id} className="rounded-xl bg-tone-gray p-2.5">
                  <Badge tone={r.decision === "approved" ? "green" : "violet"}>{r.decision === "approved" ? "موافقة" : "طلب تعديل"}</Badge>{" "}
                  <span className="text-xs text-muted">{formatDateTime(r.createdAt, tz)}</span>
                  {r.notes ? <p className="mt-1">{r.notes}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="سجل المشروع" badge={<Badge>{d.history.length}</Badge>}>
          <ol className="space-y-2">
            {d.history.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${h.level === "error" ? "bg-tone-red-fg" : h.level === "warn" ? "bg-tone-amber-fg" : "bg-muted"}`} />
                <div>
                  <p>{h.message}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(h.occurredAt, tz)} · {h.actor}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {!["published", "publishing", "cancelled"].includes(p.status) ? (
          <ActionForm action={cancelProjectAction} className="space-y-2 pt-2">
            <input type="hidden" name="projectId" value={p.id} />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" name="confirm" value="yes" required className="h-5 w-5" /> أؤكد إلغاء المشروع نهائيًا
            </label>
            <SubmitButton variant="danger" className="w-full">
              إلغاء المشروع
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
    </>
  );
}
