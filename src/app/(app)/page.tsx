import Link from "next/link";
import { ProjectCard } from "@/components/project-card";
import { Card, Empty, LinkButton, PageHeader, Stat } from "@/components/ui";
import { formatDateTime, formatUsd } from "@/lib/format";
import { dashboardStats, listHistory, listProjects } from "@/server/queries";
import { getSettings } from "@/server/settings";

export default async function DashboardPage() {
  const [stats, attention, recent, settings, events] = await Promise.all([
    dashboardStats(),
    listProjects({ status: ["awaiting_review", "failed", "approved"], limit: 10 }),
    listProjects({ limit: 5 }),
    getSettings(),
    listHistory({ limit: 6 }),
  ]);
  const inProgress = (stats.status.queued ?? 0) + (stats.status.in_progress ?? 0) + (stats.status.changes_requested ?? 0);

  return (
    <>
      <PageHeader
        title={settings.channelName || "لوحة التحكم"}
        subtitle="ملخص الإنتاج والمهام التي تحتاج قرارك"
        action={<LinkButton href="/projects/new">+ مشروع</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="بانتظار مراجعتك" value={stats.status.awaiting_review ?? 0} href="/projects?status=awaiting_review" />
        <Stat label="قيد الإنتاج" value={inProgress} href="/projects?status=in_progress" />
        <Stat label="منشور" value={stats.status.published ?? 0} href="/projects?status=published" />
        <Stat label="تكلفة الشهر (تقديرية)" value={formatUsd(stats.monthCostUsd)} />
      </div>

      {stats.jobs.dead > 0 ? (
        <Link href="/jobs" className="mt-3 block rounded-2xl bg-tone-red p-3 text-sm text-tone-red-fg">
          ⚠️ {stats.jobs.dead} مهمة متوقفة تحتاج تدخلك — اضغط للعرض
        </Link>
      ) : null}
      {stats.jobs.queued > 0 && !stats.lastWorkerActivity ? (
        <p className="mt-3 rounded-2xl bg-tone-amber p-3 text-sm text-tone-amber-fg">
          توجد {stats.jobs.queued} مهمة في الطابور ولم يعمل أي Worker بعد. شغّل الـ Worker (راجع README).
        </p>
      ) : null}

      <h2 className="mb-2 mt-6 font-semibold">يحتاج قرارك</h2>
      {attention.length ? (
        <div className="space-y-3">
          {attention.map((p) => (
            <ProjectCard key={p.id} project={p} timeZone={settings.timeZone} />
          ))}
        </div>
      ) : (
        <Empty title="لا شيء ينتظرك الآن" hint="المشاريع الجاهزة للمراجعة ستظهر هنا" />
      )}

      <h2 className="mb-2 mt-6 font-semibold">آخر المشاريع</h2>
      {recent.length ? (
        <div className="space-y-3">
          {recent.map((p) => (
            <ProjectCard key={p.id} project={p} timeZone={settings.timeZone} />
          ))}
        </div>
      ) : (
        <Empty
          title="لا توجد مشاريع بعد"
          hint="ابدأ بموضوع تختاره أنت، وسيتولى الوكلاء البحث والكتابة والإخراج"
          action={<LinkButton href="/projects/new">إنشاء أول مشروع</LinkButton>}
        />
      )}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-semibold">آخر النشاط</h2>
        <Link href="/history" className="text-sm text-accent">
          السجل الكامل
        </Link>
      </div>
      <Card className="divide-y divide-line p-0">
        {events.length ? (
          events.map(({ event }) => (
            <div key={event.id} className="px-4 py-2.5 text-sm">
              <p>{event.message}</p>
              <p className="text-xs text-muted">{formatDateTime(event.occurredAt, settings.timeZone)}</p>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted">لا يوجد نشاط بعد</p>
        )}
      </Card>
    </>
  );
}
