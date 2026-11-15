import type { Metadata } from "next";
import Link from "next/link";
import { retryJobAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { JOB_STATUS_LABEL } from "@/lib/labels";
import { listJobs } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "المهام" };

export default async function JobsPage() {
  const [rows, settings] = await Promise.all([listJobs(100), getSettings()]);
  const tz = settings.timeZone;
  return (
    <>
      <PageHeader title="طابور المهام" subtitle="إعادة المحاولة تلقائية؛ المهام المتوقفة تحتاج تدخلك" />
      {rows.length ? (
        <Card className="divide-y divide-line p-0">
          {rows.map(({ job: j, projectTitle }) => (
            <div key={j.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" dir="ltr">
                  {j.type} · {(j.payload as { stage?: string }).stage ?? ""}
                </span>
                <StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status] ?? j.status} />
              </div>
              {j.projectId ? (
                <Link href={`/projects/${j.projectId}`} className="block text-xs text-accent">
                  {projectTitle}
                </Link>
              ) : null}
              <p className="text-xs text-muted">
                محاولات {j.attempts}/{j.maxAttempts} · {j.status === "queued" ? `موعد التنفيذ ${formatDateTime(j.runAt, tz)}` : `تحديث ${formatDateTime(j.updatedAt, tz)}`}
              </p>
              {j.lastError ? <p className="text-xs text-tone-red-fg">{j.lastError}</p> : null}
              {j.status === "dead" ? (
                <ActionForm action={retryJobAction} className="pt-1">
                  <input type="hidden" name="jobId" value={j.id} />
                  <SubmitButton variant="secondary">إعادة المحاولة</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          ))}
        </Card>
      ) : (
        <Empty title="الطابور فارغ" />
      )}
    </>
  );
}
