import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getSettingsForAdmin } from "@/server/queries";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "مشروع جديد" };

export default async function NewProjectPage() {
  const s = await getSettingsForAdmin();
  return (
    <>
      <PageHeader title="مشروع جديد" subtitle="حدد الموضوع، وسيبدأ مدير Claude بتوزيع العمل على الوكلاء" />
      <NewProjectForm defaults={{ language: s.defaultLanguage, tone: s.defaultTone, longSec: s.longTargetSec, shortSec: s.shortTargetSec }} />
    </>
  );
}
