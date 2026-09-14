"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "../../lib/auth/context.ts";
import { attemptSignIn } from "../../lib/auth/signin.ts";
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from "../../lib/auth/sessions.ts";
import { formatStamp } from "../../lib/db/stamp.ts";

/**
 * EVERY REFUSAL READS THE SAME, AND TAKES THE SAME TIME.
 *
 * This used to be the stronger "one answer, whoever asks" -- a link was mailed
 * or it was not, and the form said the same sentence either way. A password
 * cannot keep that: somebody holding the right one is let in, and already knows
 * the account exists. So the property narrowed, and the narrower version is
 * stated here rather than leaving the old claim standing over code that no
 * longer has it.
 *
 * What is still true, and what the library behind this defends: a person at
 * this form cannot tell an address that is on the roster from one that is not.
 * Not by reading -- every refusal below is this one sentence -- and not by
 * timing, which is why signin.ts hashes against a decoy for an address it has
 * never seen and floors every refusal to the same wall clock.
 *
 * The differences are in the audit log, where an Admin can read them and the
 * person at the keyboard cannot.
 */
const SAME_ANSWER =
  "That email address and password do not match an account. " +
  "If you have forgotten it, an administrator can set you a new one.";

export type SignInResult = { ok: false; message: string };

// @public-endpoint sign-in cannot require a session; it is what creates one
export async function signIn(
  _prev: SignInResult | null, form: FormData,
): Promise<SignInResult> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const h = await headers();
  const database = db();

  const got = await attemptSignIn(database, {
    email,
    password,
    // The first hop. Anything after it is supplied by the client and is not
    // evidence of anything.
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: h.get("user-agent"),
  });

  if (!got.ok) {
    // The reason is recorded and never rendered. RUNBOOK has the triage.
    await database.run(
      "insert into audit_log (event, detail) values (?, ?)",
      "sign_in_refused",
      JSON.stringify({ reason: got.reason, email, at: formatStamp() }));
    return { ok: false, message: SAME_ANSWER };
  }

  // Unlike every refusal, a success knows who it was: the actor goes in the
  // column the rest of the application uses, not only into the detail.
  await database.run(
    "insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
    "sign_in", got.user.id,
    JSON.stringify({ email: got.user.email, role: got.user.role, at: formatStamp() }));

  (await cookies()).set(SESSION_COOKIE, got.session.token, sessionCookieOptions());

  // Outside anything that could catch it: redirect() throws NEXT_REDIRECT, and
  // a try around it renders the form again instead of navigating. "/" sends
  // each role to the screen it starts on -- and sends somebody still holding a
  // temporary password to the one screen that will take it.
  redirect("/");
}

// @public-endpoint signing out must work whatever the session's state is
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  if (token) await revokeSession(db(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}
