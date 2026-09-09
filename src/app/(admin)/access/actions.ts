"use server";

/** Access review actions. Admin only, asserted first. */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";

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
  db.prepare("update app_users set is_active = ? where id = ?").run(active ? 1 : 0, targetId);
  db.prepare(
    `insert into audit_log (event, actor_id, detail) values (?, ?, ?)`,
  ).run(active ? "user_reactivated" : "user_deactivated", user.id,
        JSON.stringify({ targetId, by: user.email }));
  revalidatePath("/access");
}
