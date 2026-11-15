import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, input } from "@/components/ui";
import { getSession } from "@/server/auth";

export const metadata: Metadata = { title: "تسجيل الدخول" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-fg">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
            <path d="M9 7v10l8-5z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">YouTube AI Studio</h1>
        <p className="mt-1 text-sm text-muted">لوحة إدارة الإنتاج والنشر</p>
      </div>
      <ActionForm action={loginAction}>
        <Field label="كلمة المرور">
          <input name="password" type="password" autoComplete="current-password" required className={input} />
        </Field>
        <SubmitButton className="w-full">دخول</SubmitButton>
      </ActionForm>
    </main>
  );
}
