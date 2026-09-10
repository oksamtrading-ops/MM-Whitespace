/**
 * Redeem a sign-in link.
 *
 * A GET, because it is reached by clicking a link in a mail client. That makes
 * it the one place a token travels in a URL, which is why the token is single
 * use and short lived: a URL is logged by proxies, kept in history, and
 * forwarded by people trying to be helpful.
 *
 * EVERY FAILURE READS THE SAME. Unknown, expired, already used, or belonging
 * to an account that has since been deactivated all render one sentence. The
 * distinctions are in the audit log for an Admin, because telling the holder
 * of a stolen link that it was merely expired is an invitation to try again.
 */
import { NextResponse } from "next/server";
import { db } from "../../../lib/auth/context.ts";
import { consumeLink } from "../../../lib/auth/magiclink.ts";
import { createSession, SESSION_COOKIE, SESSION_HOURS } from "../../../lib/auth/sessions.ts";
import { resolveUser } from "../../../lib/auth/session.ts";
import { formatStamp } from "../../../lib/db/stamp.ts";

export const dynamic = "force-dynamic";

/**
 * A RELATIVE Location, deliberately.
 *
 * NextResponse.redirect wants an absolute URL and builds it from request.url,
 * which the dev server normalises to localhost even when the browser asked for
 * 127.0.0.1 -- so the cookie is set on the host that asked and the browser is
 * sent to a different one, which drops the session on the floor. The same
 * class of bug appears behind a proxy that rewrites the host. A relative
 * reference is legal in HTTP and keeps the browser on the origin it came from.
 */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

// @public-endpoint redeeming a sign-in link is what produces a session
export async function GET(request: Request) {
  const database = db();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  async function note(event: string, detail: Record<string, unknown>) {
    await database.run("insert into audit_log (event, detail) values (?, ?)",
                       event, JSON.stringify(detail));
  }
  const refuse = () => seeOther("/signin?link=invalid");

  const redeemed = await consumeLink(database, token);
  if (!redeemed.ok) {
    await note("sign_in_link_refused", { reason: redeemed.reason });
    return refuse();
  }

  // The roster is checked again here, not only when the link was issued: an
  // account can be deactivated in the fifteen minutes between the two, and
  // that is exactly the window an access review is meant to close.
  const user = await resolveUser(database, redeemed.email);
  if (!user) {
    await note("sign_in_link_refused",
               { reason: "no active user at redemption", email: redeemed.email });
    return refuse();
  }

  const { token: sessionToken } = await createSession(database, user.id, {
    ip: request.headers.get("x-forwarded-for"),
    ua: request.headers.get("user-agent"),
  });
  await database.run("update app_users set last_sign_in_at = ? where id = ?",
                     formatStamp(), user.id);
  await note("sign_in", { email: user.email, role: user.role });

  // "/" sends each role to the screen it starts on.
  const res = seeOther("/");
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
}
