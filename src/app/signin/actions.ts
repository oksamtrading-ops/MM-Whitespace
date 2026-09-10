"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "../../lib/auth/context.ts";
import { isAllowedDomain, resolveUser } from "../../lib/auth/session.ts";
import { issueLink, TooManyLinks } from "../../lib/auth/magiclink.ts";
import { mailSender } from "../../lib/auth/mail.ts";
import { revokeSession, SESSION_COOKIE } from "../../lib/auth/sessions.ts";
import { formatStamp } from "../../lib/db/stamp.ts";

const ALLOWED_DOMAINS = (process.env.MM_ALLOWED_DOMAINS ?? "deloitte.ca,example.invalid")
  .split(",").map((d) => d.trim()).filter(Boolean);

/**
 * ONE ANSWER, WHOEVER ASKS.
 *
 * Every path through this action returns the same sentence: a valid address on
 * the roster, an address that is not, a domain that is not allowed, a
 * malformed string, or a send that failed. A sign-in form that distinguishes
 * them is a way to ask "does this partner have access" and get an answer, and
 * the roster is the client-adjacent thing this application most needs to keep.
 *
 * The differences are recorded in the audit log, where an Admin can see them
 * and the person at the keyboard cannot.
 */
const SAME_ANSWER =
  "If that address is on the roster, a sign-in link is on its way. " +
  "It is good for fifteen minutes and can be used once.";

export type SignInResult = { ok: true; message: string } | { ok: false; message: string };

// @public-endpoint sign-in cannot require a session; it is what creates one
export async function requestSignInLink(
  _prev: SignInResult | null, form: FormData,
): Promise<SignInResult> {
  const email = String(form.get("email") ?? "").trim();
  const h = await headers();
  const meta = { ip: h.get("x-forwarded-for"), ua: h.get("user-agent") };
  const database = db();

  async function note(event: string, detail: Record<string, unknown>) {
    await database.run(
      "insert into audit_log (event, detail) values (?, ?)",
      event, JSON.stringify({ ...detail, at: formatStamp() }));
  }

  if (!email || !email.includes("@") || email.length > 320) {
    await note("sign_in_refused", { reason: "malformed" });
    return { ok: true, message: SAME_ANSWER };
  }
  if (!isAllowedDomain(email, ALLOWED_DOMAINS)) {
    await note("sign_in_refused", { reason: "domain", email });
    return { ok: true, message: SAME_ANSWER };
  }

  // Invite-only. The roster decides whether a link is SENT; it does not change
  // what this function says, and it does not change how long it takes to say
  // it in any way a stopwatch could use.
  const user = await resolveUser(database, email);
  if (!user) {
    await note("sign_in_refused", { reason: "not on the roster", email });
    return { ok: true, message: SAME_ANSWER };
  }

  let token: string;
  try {
    ({ token } = await issueLink(database, email, meta));
  } catch (err) {
    if (err instanceof TooManyLinks) {
      await note("sign_in_refused", { reason: "too many live links", email });
      return { ok: true, message: SAME_ANSWER };
    }
    throw err;
  }

  // MM_PUBLIC_URL is the answer in a deployment, because a Host header is
  // attacker-controlled and this string goes into a mail as a link to click.
  // Falling back to the request's own host keeps local development working,
  // and the scheme follows the proxy rather than being assumed.
  const proto = h.get("x-forwarded-proto")
    ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const base = (process.env.MM_PUBLIC_URL ?? `${proto}://${h.get("host") ?? "localhost:3000"}`)
    .replace(/\/+$/, "");
  const link = `${base}/auth/verify?token=${encodeURIComponent(token)}`;

  try {
    await mailSender().send({
      to: email,
      subject: "Your sign-in link — Whitespace",
      text: [
        "Open this link to sign in to Whitespace:",
        "",
        link,
        "",
        "It is good for fifteen minutes and can be used once.",
        "If you did not ask for it, nothing has happened and you can ignore this.",
      ].join("\n"),
    });
    await note("sign_in_link_sent", { email });
  } catch (err) {
    // The sender failing is an operational fault, not something to tell the
    // person at the form -- who would learn from it that the address IS on the
    // roster. It goes to the log, loudly.
    console.error("sign-in mail failed:", (err as Error).message);
    await note("sign_in_mail_failed", { email, error: (err as Error).message });
  }
  return { ok: true, message: SAME_ANSWER };
}

// @public-endpoint signing out must work whatever the session's state is
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  if (token) await revokeSession(db(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}
