import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "YouTube AI Studio", template: "%s · YouTube AI Studio" },
  description: "استوديو إنتاج ونشر محتوى YouTube بالذكاء الاصطناعي",
  applicationName: "YouTube AI Studio",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "AI Studio", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
