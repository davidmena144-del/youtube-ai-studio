"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { ZodError } from "zod";
import { zonedLocalToUtc } from "@/lib/format";
import { login, logout, requireAdmin, revokeAllSessions } from "@/server/auth";
import { env } from "@/server/env";
import { recordHistory } from "@/server/history";
import {
  cancelProject,
  createProject,
  requestPublish,
  retryJobById,
  retryProject,
  scheduleProject,
  submitReview,
  UserFacingError,
} from "@/server/manager/manager";
import { AppSettingsSchema, getSettings, updateSettings } from "@/server/settings";
import { drain } from "@/server/worker/run";

export type ActionState = { error?: string; ok?: string } | undefined;

function toMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof ZodError) return err.issues.map((i) => i.message).join("، ");
  console.error("[action]", err);
  return "حدث خطأ غير متوقع. راجع السجل.";
}

/** Single-container deployments can process the queue right after the response is sent. */
function kickWorker() {
  if (!env().WORKER_INLINE) return;
  after(async () => {
    try {
      await drain({ maxJobs: 25, deadlineMs: 4 * 60 * 1000 });
    } catch (err) {
      console.error("[inline-worker]", err);
    }
  });
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

// ---------- auth ----------

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await login(str(fd, "password") ?? "");
  if (!res.ok) return { error: res.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function revokeAllSessionsAction() {
  await requireAdmin();
  await revokeAllSessions();
  redirect("/login");
}

// ---------- projects ----------

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  let id: string;
  try {
    const settings = await getSettings();
    const schedule = str(fd, "scheduledPublishAt");
    const project = await createProject({
      topic: str(fd, "topic") ?? "",
      format: (str(fd, "format") as "long" | "short") ?? "long",
      language: (str(fd, "language") as "ar" | "en") ?? settings.defaultLanguage,
      targetDurationSec: Number(str(fd, "targetDurationSec")),
      tone: str(fd, "tone"),
      audience: str(fd, "audience"),
      notes: str(fd, "notes"),
      scheduledPublishAt: schedule ? zonedLocalToUtc(schedule, settings.timeZone) : null,
    });
    id = project.id;
  } catch (err) {
    return { error: toMessage(err) };
  }
  kickWorker();
  revalidatePath("/");
  redirect(`/projects/${id}`);
}

export async function reviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const projectId = str(fd, "projectId") ?? "";
  try {
    await submitReview({
      projectId,
      decision: str(fd, "decision") as "approved" | "changes_requested",
      notes: str(fd, "notes") || undefined,
      restartFromStage: (str(fd, "restartFromStage") || undefined) as never,
    });
  } catch (err) {
    return { error: toMessage(err) };
  }
  kickWorker();
  revalidatePath(`/projects/${projectId}`);
  return { ok: "تم حفظ قرارك" };
}

export async function publishAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const projectId = str(fd, "projectId") ?? "";
  if (str(fd, "confirm") !== "yes") return { error: "أكّد طلب النشر أولًا" };
  try {
    await requestPublish(projectId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  kickWorker();
  revalidatePath(`/projects/${projectId}`);
  return { ok: "تم إرسال طلب النشر التجريبي" };
}

export async function retryProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const projectId = str(fd, "projectId") ?? "";
  try {
    await retryProject(projectId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  kickWorker();
  revalidatePath(`/projects/${projectId}`);
  return { ok: "أعيدت المهمة إلى الطابور" };
}

export async function cancelProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const projectId = str(fd, "projectId") ?? "";
  if (str(fd, "confirm") !== "yes") return { error: "أكّد الإلغاء أولًا" };
  try {
    await cancelProject(projectId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: "تم الإلغاء" };
}

export async function scheduleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const projectId = str(fd, "projectId") ?? "";
  try {
    const settings = await getSettings();
    const raw = str(fd, "scheduledPublishAt");
    const when = raw ? zonedLocalToUtc(raw, settings.timeZone) : null;
    if (raw && !when) return { error: "صيغة التاريخ غير صحيحة" };
    await scheduleProject(projectId, when);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/calendar");
  return { ok: "تم تحديث الموعد" };
}

// ---------- jobs ----------

export async function retryJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await retryJobById(str(fd, "jobId") ?? "");
  } catch (err) {
    return { error: toMessage(err) };
  }
  kickWorker();
  revalidatePath("/jobs");
  return { ok: "أعيدت المهمة إلى الطابور" };
}

// ---------- settings ----------

export async function updateSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const num = (k: string) => Number(str(fd, k));
    const patch = AppSettingsSchema.partial().parse({
      channelName: str(fd, "channelName"),
      channelDescription: str(fd, "channelDescription"),
      defaultLanguage: str(fd, "defaultLanguage"),
      defaultTone: str(fd, "defaultTone"),
      longTargetSec: num("longTargetSec"),
      shortTargetSec: num("shortTargetSec"),
      llmModel: str(fd, "llmModel"),
      llmEffort: str(fd, "llmEffort"),
      qaMinScore: num("qaMinScore"),
      qaMaxAutoRevisions: num("qaMaxAutoRevisions"),
      defaultPrivacy: str(fd, "defaultPrivacy"),
      timeZone: str(fd, "timeZone"),
    });
    await updateSettings(patch);
    await recordHistory({ actor: "user", action: "settings.updated", message: "تم تحديث الإعدادات", data: patch });
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath("/settings");
  return { ok: "تم حفظ الإعدادات" };
}
