/**
 * The SQLite implementation of the `Sql` seam.
 *
 * Synchronous underneath and asynchronous at the surface, so tests and the
 * command line keep their zero-dependency, no-daemon behaviour while the
 * application code is written once against the interface Postgres needs.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Row, Sql } from "./sql.ts";

/**
 * `node:sqlite` binds null, number, bigint, string and Uint8Array. A boolean
 * throws, so the codebase used to pass 1 and 0 by hand at every call site.
 * Coercing here lets a caller write `true`, which is also what Postgres wants,
 * and keeps the query text identical between the two.
 */
function bind(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p;
  });
}

export class SqliteSql implements Sql {
  readonly dialect = "sqlite" as const;
  readonly handle: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();
  private readonly owned: boolean;
  private depth = 0;

  constructor(handle: DatabaseSync, owned = true) {
    this.handle = handle;
    this.owned = owned;
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) { s = this.handle.prepare(sql); this.cache.set(sql, s); }
    return s;
  }

  /**
   * `node:sqlite` returns null-prototype objects and `pg` returns plain ones.
   * The copy is here so a row is the same kind of thing on both, rather than
   * the difference surfacing later as a method that exists on one and not the
   * other.
   */
  async all(sql: string, ...params: unknown[]): Promise<Row[]> {
    return (this.stmt(sql).all(...(bind(params) as never[])) as Row[])
      .map((r) => ({ ...r }));
  }

  async get(sql: string, ...params: unknown[]): Promise<Row | undefined> {
    const r = this.stmt(sql).get(...(bind(params) as never[])) as Row | undefined;
    return r === undefined ? undefined : { ...r };
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const r = this.stmt(sql).run(...(bind(params) as never[]));
    return { changes: Number(r.changes) };
  }

  async exec(sql: string): Promise<void> {
    this.handle.exec(sql);
  }

  /**
   * Nested calls become savepoints rather than a second `begin`, which SQLite
   * rejects. A caller should not have to know whether it is already inside one.
   */
  async tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const name = `sp_${this.depth}`;
    this.handle.exec(this.depth === 0 ? "begin" : `savepoint ${name}`);
    this.depth++;
    try {
      const out = await fn(this);
      this.depth--;
      this.handle.exec(this.depth === 0 ? "commit" : `release ${name}`);
      return out;
    } catch (err) {
      this.depth--;
      this.handle.exec(this.depth === 0 ? "rollback" : `rollback to ${name}`);
      throw err;
    }
  }

  /** SQLite has no roles. The argument is accepted and ignored on purpose. */
  txAs<T>(_role: string | null, fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.tx(fn);
  }

  async close(): Promise<void> {
    this.cache.clear();
    if (this.owned) this.handle.close();
  }
}
