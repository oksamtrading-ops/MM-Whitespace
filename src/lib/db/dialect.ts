/**
 * Mechanical Postgres -> SQLite translation.
 *
 * The migrations in supabase/migrations/ are the canonical artifact and are
 * written in Postgres. This translates them for the local SQLite runtime so the
 * schema under test is the schema that ships, rather than a hand-maintained
 * second copy that drifts.
 *
 * It is deliberately narrow. It handles the constructs those migrations
 * actually use and throws on anything it does not recognise, so an untranslated
 * construct fails loudly at load rather than silently changing meaning.
 */

/** Constructs that exist only on Postgres. Files carrying them are never loaded locally. */
const PG_ONLY = [
  /\bcreate\s+role\b/i,
  /\bcreate\s+policy\b/i,
  /\benable\s+row\s+level\s+security\b/i,
  /^\s*(grant|revoke)\b/im,
  // SQLite has triggers, but not plpgsql, and a rule enforced in only one of
  // the two engines is worse than one enforced in neither: local tests would
  // pass against a gate production does not have, or fail against one it does.
  // So a trigger file is Postgres-only and the same rule is kept in code for
  // both engines. Until 0024 this list had no trigger pattern at all, which is
  // why doc 11's allowlist trigger was recorded as impossible rather than
  // unwritten -- the mechanism to ship it already existed.
  /\bcreate\s+(or\s+replace\s+)?function\b/i,
  /\bcreate\s+trigger\b/i,
  // SQLite cannot alter a column in place at all. Postgres can, and a
  // constraint is worth having on the engine that holds the real data even
  // when the other cannot express it.
  /\balter\s+table\s+\w+\s+alter\s+column\b/i,
];

export function isPostgresOnly(sql: string): boolean {
  return PG_ONLY.some((re) => re.test(sql));
}

/**
 * `alter table T add column if not exists C ...`, which Postgres has and
 * SQLite does not.
 *
 * A migration that lands after the last table-creating one cannot be
 * recognised by adoption -- the prefix is found by looking for tables -- so it
 * RUNS AGAIN on a database that predates the ledger, and must therefore be
 * idempotent. Every such migration so far has been data-only, where `on
 * conflict do nothing` says it. An ADD COLUMN has no such phrasing in SQLite,
 * so the loader supplies the condition: it asks whether the column is there
 * and skips the statement if it is. Returns what to ask about, or null when
 * the statement is something else.
 */
export function addColumnIfNotExists(stmt: string): { table: string; column: string } | null {
  const m = stmt.match(
    /^\s*alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)/i);
  return m ? { table: m[1], column: m[2] } : null;
}

/** The same statement SQLite will accept: it understands the ADD, not the condition. */
export function withoutIfNotExists(stmt: string): string {
  return stmt.replace(/(\badd\s+column\s+)if\s+not\s+exists\s+/i, "$1");
}

const TYPE_RULES: Array<[RegExp, string]> = [
  // Identity default first, before the bare uuid rule can touch it.
  [/\buuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/gi,
   "text primary key default (lower(hex(randomblob(16))))"],
  [/\bgen_random_uuid\(\)/gi, "(lower(hex(randomblob(16))))"],
  [/\buuid\b/gi, "text"],
  [/\btimestamptz\b/gi, "text"],
  [/\bdefault\s+now\(\)/gi, "default (datetime('now'))"],
  [/\bjsonb\b/gi, "text"],
  [/\bchar\s*\(\s*\d+\s*\)/gi, "text"],
  [/\bnumeric\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, "numeric"],
  [/\bsmallint\b/gi, "integer"],
  [/\bint\b(?!\w)/gi, "integer"],
  // A column type, never the word in `default now()::date` or a column NAMED
  // date. The separator may be whitespace or may be nothing at all: a nullable
  // `due_date date,` has no space before its comma, and used to slip through
  // as SQLite's `date` type -- NUMERIC affinity, where every other timestamp
  // in this schema is TEXT.
  [/\bdate\b(?=\s*(,|\))|\s+(not\s+null|references))/gi, "text"],
];

/** Anything left that we know we cannot faithfully translate. */
const UNSUPPORTED: Array<[RegExp, string]> = [
  [/\bcreate\s+(or\s+replace\s+)?function\b/i, "functions"],
  [/\bcreate\s+trigger\b/i, "triggers"],
  [/\bcreate\s+type\b/i, "custom types"],
  [/\bexclude\s+using\b/i, "exclusion constraints"],
  // SQLite has no ADD CONSTRAINT. Declare checks inline in CREATE TABLE.
  [/\balter\s+table\s+\w+\s+add\s+constraint\b/i, "ALTER TABLE ADD CONSTRAINT"],
  [/\balter\s+table\s+\w+\s+drop\s+(column|constraint)\b/i, "ALTER TABLE DROP"],
  // Postgres writes this as `(values (...)) as alias(col, col)` -- the alias
  // follows the list, so the pattern has to look forward from `values`.
  [/\bvalues\s*\([\s\S]*?\)\s*\)?\s*as\s+\w+\s*\(/i, "column-aliased VALUES"],
];

export function toSqlite(sql: string): string {
  let out = sql;
  for (const [re, replacement] of TYPE_RULES) out = out.replace(re, replacement);
  for (const [re, what] of UNSUPPORTED) {
    if (re.test(out)) {
      throw new Error(
        `dialect: cannot translate ${what} to SQLite. Either express it portably ` +
        `in the migration, or move it into a Postgres-only migration file.`,
      );
    }
  }
  return out;
}

/** Split on semicolons that terminate a statement, ignoring those inside quotes. */
export function statements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = sql[i + 1] === quote ? (buf += ch + ch, i++, quote) : null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      buf += "\n";
      continue;
    }
    if (ch === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
