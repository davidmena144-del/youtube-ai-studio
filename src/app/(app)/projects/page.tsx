import Link from "next/link";
import { ProjectCard } from "@/components/project-card";
import { Empty, LinkButton, PageHeader } from "@/components/ui";
import { PROJECT_STATUS_LABEL } from "@/lib/labels";
import { projectStatus, type ProjectStatus } from "@/server/db/schema";
import { getSettingsForAdmin, listProjects } from "@/server/queries";

const FILTERS: { key: string; label: string; statuses?: ProjectStatus[] }[] = [
  { key: "all", label: "الكل" },
  { key: "awaiting_review", label: "للمراجعة", statuses: ["awaiting_review"] },
  { key: "in_progress", label: "قيد الإنتاج", statuses: ["queued", "in_progress", "changes_requested"] },
  { key: "approved", label: "موافق عليه", statuses: ["approved", "publishing"] },
  { key: "published", label: "منشور", statuses: ["published"] },
  { key: "failed", label: "فشل", statuses: ["failed"] },
];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const known = (projectStatus.enumValues as readonly string[]).includes(status ?? "");
  const [projects, settings] = await Promise.all([
    listProjects({ status: filter.statuses ?? (known ? [status as ProjectStatus] : undefined), limit: 200 }),
    getSettingsForAdmin(),
  ]);
  return (
    <>
      <PageHeader title="المشاريع" action={<LinkButton href="/projects/new">+ جديد</LinkButton>} />
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/projects" : `/projects?status=${f.key}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              f.key === filter.key ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {projects.length ? (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} timeZone={settings.timeZone} />
          ))}
        </div>
      ) : (
        <Empty title={`لا توجد مشاريع${filter.key !== "all" ? ` بحالة "${filter.label}"` : ""}`} hint={known ? PROJECT_STATUS_LABEL[status!] : undefined} />
      )}
    </>
  );
}
