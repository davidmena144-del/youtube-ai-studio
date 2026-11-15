import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction, revokeAllSessionsAction } from "@/app/actions";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "المزيد" };

const LINKS = [
  { href: "/history", label: "السجل الكامل (History)", hint: "كل العمليات والأخطاء" },
  { href: "/jobs", label: "طابور المهام", hint: "الحالة، المحاولات، إعادة التشغيل" },
  { href: "/settings", label: "الإعدادات والمزودون", hint: "القناة، النموذج، الجودة، حالة التكاملات" },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="المزيد" />
      <Card className="divide-y divide-line p-0">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="block px-4 py-3">
            <span className="block font-medium">{l.label}</span>
            <span className="block text-xs text-muted">{l.hint}</span>
          </Link>
        ))}
      </Card>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="w-full rounded-xl border border-line bg-surface py-3 font-medium">
          تسجيل الخروج
        </button>
      </form>
      <form action={revokeAllSessionsAction} className="mt-3">
        <button type="submit" className="w-full rounded-xl border border-tone-red-fg/30 py-3 font-medium text-tone-red-fg">
          تسجيل الخروج من جميع الأجهزة
        </button>
        <p className="mt-1 text-center text-xs text-muted">استخدمه إن فقدت هاتفك أو شككت في تسريب الجلسة</p>
      </form>
    </>
  );
}
