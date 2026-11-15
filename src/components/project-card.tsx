import Link from "next/link";
import { formatDateTime, formatDuration } from "@/lib/format";
import { FORMAT_LABEL, PROJECT_STATUS_LABEL, STAGE_LABEL } from "@/lib/labels";
import type { Project } from "@/server/db/schema";
import { Badge, StatusBadge } from "./ui";

export function ProjectCard({ project, timeZone }: { project: Project; timeZone: string }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-2xl border border-line bg-surface p-4 active:bg-tone-gray"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 font-semibold leading-snug">{project.title}</h3>
        <StatusBadge status={project.status} label={PROJECT_STATUS_LABEL[project.status]} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone={project.format === "short" ? "violet" : "gray"}>{FORMAT_LABEL[project.format]}</Badge>
        <span>{formatDuration(project.targetDurationSec)}</span>
        {project.currentStage && ["queued", "in_progress", "changes_requested"].includes(project.status) ? (
          <span>· المرحلة: {STAGE_LABEL[project.currentStage] ?? project.currentStage}</span>
        ) : null}
        {project.scheduledPublishAt ? <span>· 📅 {formatDateTime(project.scheduledPublishAt, timeZone)}</span> : null}
      </div>
    </Link>
  );
}
