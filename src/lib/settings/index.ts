/**
 * Settings an Admin owns, and the only place they are validated.
 *
 * Every setting here has an effect: the period defaults are copied onto the
 * next period a commit creates, and the run budget is what startRun uses when
 * nobody names one. A setting that changes nothing is worse than no setting,
 * because it teaches people the screen is decorative.
 */
import type { Sql } from "../db/sql.ts";

export type SettingKey =
  | "default_threshold_amount" | "default_threshold_currency"
  | "default_threshold_operator" | "default_proximity_band_pct"
  | "default_run_budget_usd"
  | "pursuit_priorities" | "pursuit_action_statuses" | "pursuit_outcomes";

export type Setting = {
  key: SettingKey;
  label: string;
  help: string;
  kind: "money" | "currency" | "operator" | "percent" | "usd" | "list";
  value: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

const DEFINITIONS: Array<Pick<Setting, "key" | "label" | "help" | "kind">> = [
  { key: "default_threshold_amount", label: "Market-cap threshold", kind: "money",
    help: "The line a company must reach to be in the population. The workbook is " +
          "filtered at ingest, so changing this does not add or remove companies " +
          "from a period already committed — it sets the line for the next one." },
  { key: "default_threshold_currency", label: "Currency", kind: "currency",
    help: "Three letters. The workbook reports in Canadian dollars." },
  { key: "default_threshold_operator", label: "Operator", kind: "operator",
    help: "Decision 9 settled this at “at or above”. Two companies sit less than " +
          "1% above the line, so the comparison is not academic." },
  { key: "default_proximity_band_pct", label: "Proximity band", kind: "percent",
    help: "How close to the threshold a company must be to be marked near it. An " +
          "ordinary market move crosses the line without anything having happened." },
  { key: "default_run_budget_usd", label: "Default run budget", kind: "usd",
    help: "What a run gets when nobody names a budget. It warns at 80% and halts " +
          "at 100%; a run cannot exist without one." },
  // The pursuit vocabularies live here rather than in a check constraint
  // because nothing in the design specifies them, and a vocabulary invented in
  // a migration is a decision made by whoever wrote the migration. Here the
  // practice owns them and can change them without a deployment.
  { key: "pursuit_priorities", label: "Pursuit priorities", kind: "list",
    help: "In order, most urgent first. A pursuit already carrying a priority you " +
          "remove keeps it and shows it as retired, because rewriting somebody's " +
          "judgement to fit a new list is not a settings change." },
  { key: "pursuit_outcomes", label: "Pursuit outcomes", kind: "list",
    help: "How a pursuit ends. “This is over” is not worth recording; what " +
          "happened is. A pursuit already closed under a word you remove keeps " +
          "it and shows it as retired, and /pursuits offers to move them." },
  { key: "pursuit_action_statuses", label: "Pursuit action statuses", kind: "list",
    help: "The first is what a new action starts as. Put a star on any status that " +
          "CLOSES an action — “Open, Done*, Superseded*” — so that finished and " +
          "abandoned can both stop counting as open without pretending to be the " +
          "same thing. At least one must close, and at least one must not." },
];

/**
 * Every setting there is, in the order the screen shows them.
 *
 * Derived from the definitions rather than written out a second time. The
 * screen and the action behind it once kept separate lists, and adding a
 * setting to one but not the other rendered a field that saved nothing --
 * which is the decorative screen the note at the top of this file warns about.
 */
export const SETTING_KEYS: readonly SettingKey[] = DEFINITIONS.map((d) => d.key);

export class InvalidSetting extends Error {}

/** A comma-separated vocabulary, trimmed, with the blanks dropped. */
export function splitList(raw: string): string[] {
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * A vocabulary, or its fallback.
 *
 * Read rather than hardcoded, and it has to survive being unset: a database
 * that has not had 0020 yet returns null, and a screen that then renders no
 * options is a screen that cannot be used at all.
 */
export async function getList(
  db: Sql, key: SettingKey, fallback: readonly string[],
): Promise<string[]> {
  const raw = await getSetting(db, key);
  const terms = raw === null ? [] : splitList(raw);
  return terms.length > 0 ? terms : [...fallback];
}

/** Validation lives here, not in the form: the form is not the boundary. */
export function validate(key: SettingKey, raw: string): string {
  const value = raw.trim();
  switch (key) {
    case "default_threshold_amount": {
      const n = Number(value.replace(/[,_\s]/g, ""));
      if (!Number.isFinite(n) || n <= 0) throw new InvalidSetting("The threshold must be a positive amount.");
      if (n > 1e13) throw new InvalidSetting("That threshold is larger than any market.");
      return String(Math.round(n));
    }
    case "default_threshold_currency": {
      if (!/^[A-Za-z]{3}$/.test(value)) throw new InvalidSetting("A currency is three letters, such as CAD.");
      return value.toUpperCase();
    }
    case "default_threshold_operator": {
      if (value !== "gt" && value !== "gte") throw new InvalidSetting("The operator is above, or at or above.");
      return value;
    }
    case "default_proximity_band_pct": {
      const n = Number(value.replace(/%/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new InvalidSetting("The band cannot be negative.");
      if (n > 50) throw new InvalidSetting("A band above 50% marks most of the market as near the line.");
      return String(n);
    }
    case "default_run_budget_usd": {
      const n = Number(value.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n <= 0) throw new InvalidSetting("A run cannot be created without a budget.");
      if (n > 10_000) throw new InvalidSetting("That budget is high enough to want a second pair of eyes. Raise it in the database if you mean it.");
      return String(n);
    }
    case "pursuit_priorities":
    case "pursuit_outcomes":
    case "pursuit_action_statuses": {
      const terms = splitList(value);
      if (terms.length < 2) throw new InvalidSetting("A vocabulary of fewer than two terms is not a choice.");
      if (terms.length > 8) throw new InvalidSetting("More than eight terms is a form nobody reads. Eight is already a lot.");
      const bare = terms.map((t) => t.replace(/\*$/, "").trim());
      if (bare.some((t) => t.length === 0)) throw new InvalidSetting("A star needs a status in front of it.");
      if (bare.some((t) => t.length > 32)) throw new InvalidSetting("A term longer than 32 characters is a sentence, not a label.");
      if (bare.some((t) => t.includes("*"))) throw new InvalidSetting("A star marks the END of a status that closes an action.");
      const seen = new Set(bare.map((t) => t.toLowerCase()));
      if (seen.size !== bare.length) throw new InvalidSetting("Two terms differing only in case are the same term.");
      if (key !== "pursuit_action_statuses") {
        if (terms.some((t) => t.endsWith("*"))) {
          throw new InvalidSetting(
            "A star closes an ACTION. Nothing else in these lists closes anything.");
        }
        return bare.join(", ");
      }
      // A status list that closes nothing leaves every action open for ever;
      // one that closes everything leaves nowhere for an action to start.
      const closing = terms.filter((t) => t.endsWith("*")).length;
      if (closing === 0) throw new InvalidSetting("Star at least one status, or no action can ever be closed.");
      if (closing === terms.length) throw new InvalidSetting("Star at least one fewer, or a new action is closed the moment it is made.");
      if (terms[0].endsWith("*")) throw new InvalidSetting("The first status is where a new action starts, so it cannot be one that closes it.");
      return terms.map((t, i) => (t.endsWith("*") ? `${bare[i]}*` : bare[i])).join(", ");
    }
  }
}

export async function readSettings(db: Sql): Promise<Setting[]> {
  const rows = await db.all(
    `select s.key, s.value, s.updated_at, u.email as updated_by
       from app_settings s left join app_users u on u.id = s.updated_by`,
  ) as Array<{ key: string; value: string; updated_at: string | null; updated_by: string | null }>;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return DEFINITIONS.map((d) => {
    const row = byKey.get(d.key);
    return {
      ...d,
      value: row?.value ?? "",
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

/**
 * Absent on a database that has not had 0007 yet, which is every database made
 * before it existed. A setting read is optional by nature, so a missing table
 * reads as "not set" and the caller uses its fallback -- rather than a commit
 * failing because a defaults table it never needed is not there yet.
 * scripts/migrate.mjs is the actual fix; this is what keeps the lag survivable.
 */
export async function getSetting(db: Sql, key: SettingKey): Promise<string | null> {
  try {
    const row = await db.get("select value from app_settings where key = ?", key) as
      { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function getNumber(
  db: Sql, key: SettingKey, fallback: number,
): Promise<number> {
  const raw = await getSetting(db, key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Returns what changed, so the caller can write one audit line per change. */
export async function putSettings(
  db: Sql, values: Partial<Record<SettingKey, string>>, actorId: string | null,
): Promise<Array<{ key: SettingKey; from: string | null; to: string }>> {
  const changes: Array<{ key: SettingKey; from: string | null; to: string }> = [];
  for (const d of DEFINITIONS) {
    const raw = values[d.key];
    if (raw === undefined) continue;
    const clean = validate(d.key, raw);
    const before = await getSetting(db, d.key);
    if (before === clean) continue;
    await db.run(
      `insert into app_settings (key, value, updated_by, updated_at)
       values (?, ?, ?, current_timestamp)
       on conflict (key) do update
         set value = excluded.value, updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
      d.key, clean, actorId);
    changes.push({ key: d.key, from: before, to: clean });
  }
  return changes;
}
