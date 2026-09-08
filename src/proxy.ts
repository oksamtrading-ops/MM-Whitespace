/**
 * Redirects only. THIS IS NOT AN AUTHORISATION BOUNDARY.
 *
 * (Next 16 renamed this convention from `middleware` to `proxy`; the security
 * argument is unchanged.) Next.js middleware has a documented bypass class, and every Server Action
 * compiles to an addressable endpoint whether or not the control that calls it
 * renders. Nothing here is load-bearing for security: every page, route handler
 * and action asserts its own role, and scripts/check_role_assertions.mjs fails
 * the build when one does not.
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  if (url.pathname === "/index" || url.pathname === "/home") {
    return NextResponse.redirect(new URL("/", url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
