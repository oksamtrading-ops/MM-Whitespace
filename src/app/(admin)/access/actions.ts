"use server";

/** Access review actions. Admin only, asserted first. */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";

export async function setActive(form: FormData) {
  const { user, db } = await requireRole(["admin"]);
  const targetId = String(form.get("userId") ?? "");
  const active = String(form.get("active") ?? "") === "1";

  // An Admin cannot deactivate themselves: it is the one action that can lock
  // every Admin out of the access-review screen at once.
  if (targetId === user.id && !active) {
    return { ok: false, message: "You cannot deactivate your own account." };
  }
  db.prepare("update app_users set is_active = ? where id = ?").run(active ? 1 : 0, targetId);
  db.prepare(
    `insert into audit_log (event, actor_id, detail) values (?, ?, ?)`,
  ).run(active ? "user_reactivated" : "user_deactivated", user.id,
        JSON.stringify({ targetId, by: user.email }));
  revalidatePath("/access");
  return { ok: true, message: active ? "Reactivated." : "Deactivated." };
}
