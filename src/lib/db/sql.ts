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
   * One transaction. The callback gets a handle bound to it; using the outer
   * handle inside the callback is a bug the Postgres implementation detects,
   * because there the two are different connections.
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
