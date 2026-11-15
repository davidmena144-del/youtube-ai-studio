import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./server/security/session-token";

/**
 * First line of defence: unauthenticated requests to app pages are redirected to /login.
 * Server actions and pages still re-verify the session themselves (requireAdmin).
 */
export function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const session = secret ? verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (session) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except login, public API endpoints, Next internals and static files.
    "/((?!login|api/health|api/worker|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
