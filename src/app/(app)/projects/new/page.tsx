import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/server/settings";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "مشروع جديد" };

export default async function NewProjectPage() {
  const s = await getSettings();
  return (
    <>
      <PageHeader title="مشروع جديد" subtitle="حدد الموضوع، وسيبدأ مدير Claude بتوزيع العمل على الوكلاء" />
      <NewProjectForm defaults={{ language: s.defaultLanguage, tone: s.defaultTone, longSec: s.longTargetSec, shortSec: s.shortTargetSec }} />
    </>
  );
}
