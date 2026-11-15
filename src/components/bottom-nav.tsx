"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "الرئيسية", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/projects", label: "المشاريع", icon: "M4 5h16v4H4zM4 11h16v8H4z" },
  { href: "/projects/new", label: "جديد", icon: "M12 5v14M5 12h14", primary: true },
  { href: "/calendar", label: "التقويم", icon: "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4" },
  { href: "/more", label: "المزيد", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export function BottomNav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.href === "/projects" ? isActive("/projects") && path !== "/projects/new" : isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] ${
                  active ? "text-accent font-semibold" : "text-muted"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    item.primary ? "bg-accent text-accent-fg" : ""
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={item.icon} />
                  </svg>
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
