"use server";

/** Access review actions. Admin only, asserted first. */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import { revokeAllForUser } from "../../../lib/auth/sessions.ts";
import { setTemporaryPassword } from "../../../lib/auth/signin.ts";

// Returns void: a form action's type is (formData) => void | Promise<void>,
// and returning a result object does not type-check against it.
export async function setActive(form: FormData): Promise<void> {
  const { user, db } = await requireRole(["admin"]);
  const targetId = String(form.get("userId") ?? "");
  const active = String(form.get("active") ?? "") === "1";

  // An Admin cannot deactivate themselves: it is the one action that can lock
  // every Admin out of the access-review screen at once.
  if (targetId === user.id && !active) {
    // The button is also disabled, but the button is not the boundary: a
    // server action is addressable whether or not its control renders.
    return;
  }
  await db.run("update app_users set is_active = ? where id = ?", active, targetId);

  // Deactivation has to end the sessions that are already running, not merely
  // stop the next sign-in. Without this the screen appears to offboard someone
  // who stays signed in until their session lapses on its own -- which is the
  // opposite of what a quarterly access review is for.
  const revoked = active
    ? 0
    : await revokeAllForUser(db, targetId, user.id, "account deactivated");

  await db.run(`insert into audit_log (event, actor_id, detail) values (?, ?, ?)`, active ? "user_reactivated" : "user_deactivated", user.id,
        JSON.stringify({ targetId, by: user.email, sessionsRevoked: revoked }));
  revalidatePath("/access");
}

export type TempPasswordResult =
  | { ok: true; email: string; password: string; sessionsRevoked: number }
  | { ok: false; message: string };

/**
 * Give somebody a password they will be made to replace.
 *
 * Unlike setActive this RETURNS something, so it cannot be a plain form action
 * -- the password has to reach the screen once and nowhere else. It travels in
 * this one response and is never put in a URL, a redirect, a cookie, a setting
 * or the audit log.
 *
 * Not offered for yourself. Setting your own password here would revoke your
 * own session mid-request and sign you out; an Admin who wants a new password
 * uses /password like everybody else.
 */
export async function issueTemporaryPassword(
  _prev: TempPasswordResult | null, form: FormData,
): Promise<TempPasswordResult> {
  const { user, db } = await requireRole(["admin"]);
  const targetId = String(form.get("userId") ?? "");

  if (targetId === user.id) {
    // The control is also absent, but the control is not the boundary.
    return { ok: false, message: "Use the password screen to change your own." };
  }
  const target = await db.get(
    "select email, is_active from app_users where id = ?", targetId) as
    { email: string; is_active: number } | undefined;
  if (!target) return { ok: false, message: "That account no longer exists." };

  const { password, sessionsRevoked } = await setTemporaryPassword(
    db, { targetId, actorId: user.id });

  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "password_set_by_admin", user.id,
               JSON.stringify({ targetId, targetEmail: target.email,
                                by: user.email, sessionsRevoked }));
  revalidatePath("/access");
  return { ok: true, email: target.email, password, sessionsRevoked };
}
