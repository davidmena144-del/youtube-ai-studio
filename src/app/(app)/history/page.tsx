import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { listHistory } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "السجل" };

const PAGE = 50;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ before?: string; level?: string }> }) {
  const sp = await searchParams;
  const beforeId = Number(sp.before) || undefined;
  const level = sp.level === "warn" || sp.level === "error" ? sp.level : undefined;
  const [rows, settings] = await Promise.all([listHistory({ beforeId, level, limit: PAGE }), getSettings()]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ level, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/history?${s}` : "/history";
  };

  return (
    <>
      <PageHeader title="السجل الكامل" subtitle="كل عملية في النظام مسجلة هنا" />
      <div className="mb-4 flex gap-2">
        {[
          [undefined, "الكل"],
          ["warn", "تحذيرات وأخطاء"],
          ["error", "أخطاء فقط"],
        ].map(([v, label]) => (
          <Link
            key={label}
            href={v ? `/history?level=${v}` : "/history"}
            className={`rounded-full border px-3 py-1.5 text-sm ${level === v ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <Card className="divide-y divide-line p-0">
          {rows.map(({ event: e, projectTitle }) => (
            <div key={e.id} className="flex gap-3 px-4 py-3 text-sm">
              <span
                className={`mt-2 h-2 w-2 shrink-0 rounded-full ${e.level === "error" ? "bg-tone-red-fg" : e.level === "warn" ? "bg-tone-amber-fg" : "bg-muted"}`}
              />
              <div className="min-w-0">
                <p>{e.message}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.occurredAt, settings.timeZone)} · {e.actor} · <span dir="ltr">{e.action}</span>
                </p>
                {e.projectId ? (
                  <Link href={`/projects/${e.projectId}`} className="text-xs text-accent">
                    {projectTitle ?? "المشروع"}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="لا توجد أحداث" />
      )}
      {rows.length === PAGE ? (
        <div className="mt-4 text-center">
          <Link href={qs({ before: String(rows[rows.length - 1].event.id) })} className="text-sm text-accent">
            أقدم ←
          </Link>
        </div>
      ) : null}
    </>
  );
}
