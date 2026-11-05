"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../lib/auth/context.ts";
import { checkName } from "../../lib/auth/person.ts";

export type NameResult = { ok: true } | { ok: false; message: string };

/**
 * Set your own first and last name.
 *
 * Waives the name gate, because this is the way past it; it does not waive
 * the password gate, which comes first. All three roles are named, so it is
 * still a real role assertion. Only your own row is written: the id comes from
 * the session, never from the form.
 */
export async function saveOwnName(_prev: NameResult | null, form: FormData): Promise<NameResult> {
  const { user, db } = await requireRole(["admin", "analyst", "viewer"], { allowMissingName: true });

  const checked = checkName(form.get("first"), form.get("last"));
  if (!checked.ok) return checked;

  await db.run("update app_users set first_name = ?, last_name = ? where id = ?",
               checked.first, checked.last, user.id);
  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)",
               "name_set", user.id,
               JSON.stringify({ from: user.needsName ? null : user.name, to: `${checked.first} ${checked.last}` }));
  // The layout reads the name too -- the sidebar, and the gate itself.
  revalidatePath("/", "layout");
  return { ok: true };
}
