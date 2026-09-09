/**
 * Development sign-in.
 *
 * NOT magic-link authentication and not a production provider. It exists so the
 * application can be run before a Supabase project exists. The claim source it
 * writes for refuses to operate outside development.
 */
import { NextResponse } from "next/server";
import { db } from "../../../../lib/auth/context.ts";
import { isAllowedDomain, signDevSession } from "../../../../lib/auth/session.ts";

export const dynamic = "force-dynamic";

const ALLOWED_DOMAINS = (process.env.MM_ALLOWED_DOMAINS ?? "deloitte.ca,example.invalid")
  .split(",").map((d) => d.trim()).filter(Boolean);

// @public-endpoint sign-in cannot require a session; it is dev-only and refuses in production
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const secret = process.env.MM_DEV_AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MM_DEV_AUTH_SECRET is not set" }, { status: 500 });
  }
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  // Invite-only, and the domain allowlist is checked here AND in the database.
  if (!isAllowedDomain(email, ALLOWED_DOMAINS)) {
    return NextResponse.json({ error: "domain not allowed" }, { status: 403 });
  }
  const known = db().prepare(
    "select id from app_users where lower(email) = lower(?) and is_active = 1").get(email);
  if (!known) {
    return NextResponse.json(
      { error: "no active application user for that address (invite-only)" }, { status: 403 });
  }

  // Without this the access review has nothing to review.
  db().prepare(
    "update app_users set last_sign_in_at = ? where lower(email) = lower(?)",
  ).run(new Date().toISOString().replace("T", " ").slice(0, 19), email);
  db().prepare(
    "insert into audit_log (event, detail) values ('sign_in', ?)",
  ).run(JSON.stringify({ email }));

  const response = NextResponse.json({ ok: true, email });
  response.cookies.set("mm_dev_session", signDevSession(email, secret), {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV !== "development", maxAge: 60 * 60 * 8,
  });
  return response;
}
