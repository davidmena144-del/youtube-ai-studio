import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./server/security/session-token";

/** Exact paths reachable without a session. Everything else requires one. */
export const PUBLIC_PATHS = new Set(["/login", "/api/health", "/api/worker/tick", "/manifest.webmanifest", "/icon.svg", "/favicon.ico"]);

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * First line of defence: requests without a validly signed, unexpired session cookie are
 * redirected to /login. The (app) layout, every query and every server action additionally
 * call requireAdmin(), which also enforces server-side revocation.
 */
export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  const secret = process.env.SESSION_SECRET;
  const session = secret ? verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (session) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Only Next.js build assets are skipped here; every other path goes through the check above.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
