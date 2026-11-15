"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data periodically while work is in progress (no websockets needed). */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return active ? (
    <p className="mb-3 flex items-center gap-2 text-xs text-muted">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> يتم التحديث تلقائيًا
    </p>
  ) : null;
}
