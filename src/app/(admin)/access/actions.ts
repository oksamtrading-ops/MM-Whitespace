"use server";

/** Access review actions. Admin only, asserted first. */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import { revokeAllForUser } from "../../../lib/auth/sessions.ts";

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
