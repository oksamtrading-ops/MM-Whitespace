"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "../../lib/auth/context.ts";
import { changePassword, ChangeRefused } from "../../lib/auth/signin.ts";
import { SESSION_COOKIE, sessionCookieOptions } from "../../lib/auth/sessions.ts";
import { formatStamp } from "../../lib/db/stamp.ts";

export type ChangeResult = { ok: false; message: string };

/**
 * Replace your own password.
 *
 * NEVER log the FormData, and catch narrowly. Three paths write a live
 * credential into a log otherwise: an unhandled throw whose message quotes the
 * input, a console.error that passes the form along with the error, and Next's
 * development error overlay. mail.ts refuses to run its logging sender in
 * production for exactly this reason.
 */
export async function changePasswordAction(
  _prev: ChangeResult | null, form: FormData,
): Promise<ChangeResult> {
  const { user, db } = await requireRole(
    ["admin", "analyst", "viewer"], { allowPasswordChange: true });

  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  let changed;
  try {
    changed = await changePassword(db, { userId: user.id, current, next, confirm });
  } catch (err) {
    // Only the refusal's own sentence. Anything else is a fault, not an answer,
    // and must not carry what was typed back to the screen.
    if (err instanceof ChangeRefused) return { ok: false, message: err.message };
    throw err;
  }

  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "password_changed", user.id,
               JSON.stringify({ email: user.email, at: formatStamp(),
                                sessionsRevoked: changed.sessionsRevoked }));

  // Changing a password ends every session the account had, this one included,
  // so the caller has to be handed the new one or they would be signed out by
  // succeeding. The cookie options come from the one place that holds them.
  (await cookies()).set(SESSION_COOKIE, changed.session.token, sessionCookieOptions());

  // Outside the try, deliberately: redirect() throws NEXT_REDIRECT, and a catch
  // around it renders the form again instead of navigating.
  redirect("/");
}
