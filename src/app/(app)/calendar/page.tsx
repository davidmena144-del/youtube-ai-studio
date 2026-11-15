import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { dayKey, formatDate, formatDateTime } from "@/lib/format";
import { FORMAT_LABEL, PROJECT_STATUS_LABEL } from "@/lib/labels";
import { calendarItems, calendarWindow, getSettingsForAdmin, listProjects } from "@/server/queries";

export const metadata: Metadata = { title: "تقويم النشر" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const { offset: offsetRaw } = await searchParams;
  const offset = Math.max(-12, Math.min(12, Number(offsetRaw ?? 0) || 0));
  const settings = await getSettingsForAdmin();
  const tz = settings.timeZone;
  const { from, to, now } = calendarWindow(offset);
  const [items, unscheduled] = await Promise.all([
    calendarItems(from, to),
    listProjects({ status: ["approved", "awaiting_review"], limit: 50 }),
  ]);
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const k = dayKey(it.scheduledPublishAt!, tz);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const todayKey = dayKey(now, tz);

  return (
    <>
      <PageHeader title="تقويم النشر" subtitle={`${formatDate(from, tz)} — ${formatDate(to, tz)} · ${tz}`} />
      <div className="mb-4 flex gap-2">
        <Link href={`/calendar?offset=${offset - 1}`} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          → السابق
        </Link>
        <Link href="/calendar" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          الآن
        </Link>
        <Link href={`/calendar?offset=${offset + 1}`} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          التالي ←
        </Link>
      </div>

      {groups.size ? (
        <div className="space-y-4">
          {[...groups.entries()].map(([k, list]) => (
            <div key={k}>
              <h2 className={`mb-2 text-sm font-semibold ${k === todayKey ? "text-accent" : ""}`}>
                {formatDate(list[0].scheduledPublishAt!, tz)} {k === todayKey ? "· اليوم" : ""}
              </h2>
              <div className="space-y-2">
                {list.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-2xl border border-line bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{p.title}</span>
                      <StatusBadge status={p.status} label={PROJECT_STATUS_LABEL[p.status]} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {formatDateTime(p.scheduledPublishAt, tz)} · {FORMAT_LABEL[p.format]}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="لا توجد مواعيد نشر في هذه الفترة" hint="حدد موعدًا من صفحة أي مشروع" />
      )}

      {unscheduled.filter((p) => !p.scheduledPublishAt).length ? (
        <>
          <h2 className="mb-2 mt-6 font-semibold">جاهز بلا موعد</h2>
          <Card className="divide-y divide-line p-0">
            {unscheduled
              .filter((p) => !p.scheduledPublishAt)
              .map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>{p.title}</span>
                  <StatusBadge status={p.status} label={PROJECT_STATUS_LABEL[p.status]} />
                </Link>
              ))}
          </Card>
        </>
      ) : null}
    </>
  );
}
