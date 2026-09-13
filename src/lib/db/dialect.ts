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
];

export function isPostgresOnly(sql: string): boolean {
  return PG_ONLY.some((re) => re.test(sql));
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
