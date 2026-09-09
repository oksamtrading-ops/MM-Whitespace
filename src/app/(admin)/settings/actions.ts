"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import { InvalidSetting, putSettings, type SettingKey } from "../../../lib/settings/index.ts";

export type SettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const KEYS: SettingKey[] = [
  "default_threshold_amount", "default_threshold_currency", "default_threshold_operator",
  "default_proximity_band_pct", "default_run_budget_usd",
];

/** Save the Admin's defaults. Every change is written to the audit log. */
export async function saveSettings(
  _prev: SettingsResult | null, form: FormData,
): Promise<SettingsResult> {
  const { db, user } = await requireRole(["admin"]);
  const values: Partial<Record<SettingKey, string>> = {};
  for (const key of KEYS) {
    const raw = form.get(key);
    if (raw !== null) values[key] = String(raw);
  }

  let changes;
  try {
    changes = putSettings(db, values, user.id);
  } catch (err) {
    if (err instanceof InvalidSetting) return { ok: false, message: err.message };
    throw err;
  }

  // One line per change: "the settings were edited" answers nothing later.
  const audit = db.prepare(
    "insert into audit_log (event, actor_id, detail) values ('setting_changed', ?, ?)");
  for (const c of changes) audit.run(user.id, JSON.stringify(c));

  revalidatePath("/settings");
  return changes.length === 0
    ? { ok: true, message: "Nothing changed." }
    : { ok: true, message: `${changes.length} setting${changes.length === 1 ? "" : "s"} saved.` };
}
