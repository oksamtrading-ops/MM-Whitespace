"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import {
  InvalidSetting, putSettings, SETTING_KEYS, type SettingKey,
} from "../../../lib/settings/index.ts";

export type SettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Save the Admin's defaults. Every change is written to the audit log. */
export async function saveSettings(
  _prev: SettingsResult | null, form: FormData,
): Promise<SettingsResult> {
  const { db, user } = await requireRole(["admin"]);
  const values: Partial<Record<SettingKey, string>> = {};
  for (const key of SETTING_KEYS) {
    const raw = form.get(key);
    if (raw !== null) values[key] = String(raw);
  }

  let changes;
  try {
    changes = await putSettings(db, values, user.id);
  } catch (err) {
    if (err instanceof InvalidSetting) return { ok: false, message: err.message };
    throw err;
  }

  // One line per change: "the settings were edited" answers nothing later.
  const audit =
    "insert into audit_log (event, actor_id, detail) values ('setting_changed', ?, ?)";
  for (const c of changes) await db.run(audit, user.id, JSON.stringify(c));

  revalidatePath("/settings");
  return changes.length === 0
    ? { ok: true, message: "Nothing changed." }
    : { ok: true, message: `${changes.length} setting${changes.length === 1 ? "" : "s"} saved.` };
}
