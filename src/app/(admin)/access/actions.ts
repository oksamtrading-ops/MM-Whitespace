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

export type InviteResult =
  | { ok: true; email: string; role: string; password: string }
  | { ok: false; message: string };

const ROLES = ["admin", "analyst", "viewer"] as const;

/**
 * Put somebody on the roster and give them a way in, in one act.
 *
 * Inviting used to be a hand-written INSERT in the runbook, which meant the one
 * screen called "Access" could review access and end it but not grant it. It
 * also meant the two halves of onboarding -- the row and the password -- were
 * documented in different places and easy to half-do: an account with no
 * password looks invited and cannot sign in.
 *
 * So this does both and returns the password once. The row alone is never a
 * useful state to leave somebody in.
 */
export async function inviteUser(
  _prev: InviteResult | null, form: FormData,
): Promise<InviteResult> {
  const { user, db } = await requireRole(["admin"]);
  const email = String(form.get("email") ?? "").trim();
  const role = String(form.get("role") ?? "");

  if (!email || !email.includes("@") || email.length > 320) {
    return { ok: false, message: "That is not an email address." };
  }
  if (!ROLES.includes(role as typeof ROLES[number])) {
    return { ok: false, message: "Pick a role." };
  }
  const existing = await db.get(
    "select id, is_active from app_users where lower(email) = lower(?)", email) as
    { id: string; is_active: number } | undefined;
  if (existing) {
    return { ok: false, message: existing.is_active
      ? "That address is already on the roster."
      : "That address is on the roster, deactivated. Reactivate it instead of inviting again." };
  }

  let created: { id: string };
  try {
    created = await db.get(
      "insert into app_users (email, role) values (?, ?) returning id", email, role) as { id: string };
  } catch (err) {
    // The 0024 trigger refuses an address outside the allowlist, and its
    // message is written for a database session rather than for this screen.
    // Say what to do about it instead of showing the raw refusal -- the setting
    // it names is one an Admin can edit, two screens away.
    const raw = (err as Error).message ?? "";
    if (/allowlist|not an email address/i.test(raw)) {
      return { ok: false, message:
        `The domain of ${email} is not allowed to sign in. Add it to "Sign-in domains" on Settings first.` };
    }
    throw err;
  }

  const { password } = await setTemporaryPassword(db, { targetId: created.id, actorId: user.id });

  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "user_invited", user.id,
               JSON.stringify({ targetId: created.id, targetEmail: email, role, by: user.email }));
  revalidatePath("/access");
  return { ok: true, email, role, password };
}

/**
 * Change what somebody may do.
 *
 * Not your own, for the reason self-deactivation is refused: an Admin demoting
 * themselves is one click from an application with no Admin in it, and the cure
 * is behind an Admin session. The control is also absent, but the control is
 * not the boundary.
 */
export async function setRole(form: FormData): Promise<void> {
  const { user, db } = await requireRole(["admin"]);
  const targetId = String(form.get("userId") ?? "");
  const role = String(form.get("role") ?? "");

  if (targetId === user.id) return;
  if (!ROLES.includes(role as typeof ROLES[number])) return;

  const before = await db.get(
    "select email, role from app_users where id = ?", targetId) as
    { email: string; role: string } | undefined;
  if (!before || before.role === role) return;

  await db.run("update app_users set role = ? where id = ?", role, targetId);
  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "user_role_changed", user.id,
               JSON.stringify({ targetId, targetEmail: before.email,
                                from: before.role, to: role, by: user.email }));
  revalidatePath("/access");
}
