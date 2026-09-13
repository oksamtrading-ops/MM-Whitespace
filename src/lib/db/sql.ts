/**
 * The database seam.
 *
 * Every query in the application goes through this interface, and there are two
 * implementations behind it: SQLite for tests, for the M1 command line and for
 * running the app against a committed `period.db`, and Postgres for a deployed
 * instance reading Supabase.
 *
 * WHY IT IS ASYNCHRONOUS. `node:sqlite` is synchronous and Postgres cannot be.
 * A synchronous facade over Postgres is buildable -- a worker thread plus
 * `Atomics.wait` -- and would have saved a wide refactor, but it blocks the
 * event loop for the duration of every query, which serialises every request
 * the server is handling. The refactor is paid once; that cost would be paid on
 * every page view.
 *
 * WHY ONE INTERFACE RATHER THAN A PORT OF THE APP TO POSTGRES. The migrations
 * in supabase/migrations/ are canonical Postgres and `dialect.ts` translates
 * them down, so the schema under test is the schema that ships. Keeping SQLite
 * keeps that property, keeps `node --test` free of a database daemon, and keeps
 * the documented `commit_period.mjs ./period.db` path working.
 *
 * PORTABLE SQL IS THE CALLER'S JOB. This layer rewrites placeholders and
 * nothing else. Statements are written so both dialects accept them as-is:
 * `current_timestamp` rather than `datetime('now')`, `on conflict do nothing`
 * rather than `insert or ignore`, `true`/`false` rather than `1`/`0`. Where
 * that is not possible the statement belongs in a Postgres-only path, not in a
 * translation table that silently changes meaning.
 */

export type Row = Record<string, unknown>;

export type Dialect = "sqlite" | "postgres";

export interface Sql {
  readonly dialect: Dialect;
  all(sql: string, ...params: unknown[]): Promise<Row[]>;
  get(sql: string, ...params: unknown[]): Promise<Row | undefined>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  /** Multi-statement DDL. Never takes parameters, never takes user input. */
  exec(sql: string): Promise<void>;
  /**
   * One transaction. The callback gets a handle bound to it, and on Postgres
   * that is a different connection from the outer handle's pool -- so a query
   * through the outer handle inside the callback runs OUTSIDE the transaction.
   * Nothing detects that at runtime. Name the callback's parameter `db` and let
   * it shadow the outer one, which is how every caller here does it.
   */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /**
   * The same, as a database role. SQLite has no roles and ignores it, so a
   * caller writes one thing and the policies apply wherever they exist.
   */
  txAs<T>(role: string | null, fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Rewrite `?` placeholders to `$1, $2, ...`.
 *
 * Quote-aware, because a `?` inside a string literal is data. Postgres also
 * spells three jsonb operators with `?`, which this would corrupt -- no query
 * here uses them, and one that needs to should use the `jsonb_exists` function
 * form instead, which is what this comment exists to say.
 */
export function toNumberedPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") out += sql[i++];
      if (i < sql.length) out += sql[i];
      continue;
    }
    if (ch === "?") { out += `$${++n}`; continue; }
    out += ch;
  }
  return out;
}

/**
 * How many bind parameters one statement may carry.
 *
 * Postgres allows 65535 and SQLite 32766, so this is far below both. It is a
 * chunk size, not a limit to push against: the win is going from one round
 * trip per row to one per few hundred, and the last 2% of that is not worth
 * sitting next to an engine's ceiling.
 */
export const MAX_BIND_PARAMS = 5000;

/**
 * Insert many rows in as few statements as the parameter budget allows.
 *
 * Publishing revision 6 took about four minutes because it wrote roughly 3,600
 * values one at a time, and against a pooled connection the round trip IS the
 * cost. The same rows in chunks are seconds.
 *
 * `table`, `columns` and `suffix` are interpolated into the statement, so they
 * must be literals the caller wrote -- never a value from the database, a
 * request or a file. Only the row values are bound.
 */
export async function insertMany(
  db: Sql, table: string, columns: readonly string[], rows: readonly unknown[][],
  suffix = "",
): Promise<number> {
  if (rows.length === 0) return 0;
  const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / columns.length));
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const head = `insert into ${table} (${columns.join(", ")}) values `;
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    await db.run(head + chunk.map(() => tuple).join(", ") + (suffix ? ` ${suffix}` : ""),
                 ...chunk.flat());
  }
  return rows.length;
}
