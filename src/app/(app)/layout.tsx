import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/server/auth";
import { env } from "@/server/env";
import { resolveLlmProviderId } from "@/server/providers/llm";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const llm = resolveLlmProviderId();
  const publishing = env().PUBLISHING_MODE;
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M9 7v10l8-5z" />
              </svg>
            </span>
            AI Studio
          </Link>
          <Link href="/settings" className="flex gap-1.5" aria-label="حالة المزودين">
            <Badge tone={llm === "mock" ? "amber" : "green"}>{llm === "mock" ? "LLM: تجريبي" : "LLM: Claude"}</Badge>
            <Badge tone="blue">{publishing === "dry_run" ? "نشر: تجريبي" : "نشر: حقيقي"}</Badge>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}
