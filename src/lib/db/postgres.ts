/**
 * The Postgres implementation of the `Sql` seam.
 *
 * TYPE PARSERS ARE THE WHOLE STORY. Every query and every test in this codebase
 * was written against SQLite, which returns text for dates and JSON, numbers
 * for numerics, and 1/0 for booleans. `pg` returns Date objects, parsed JSON,
 * strings for numeric and bigint, and real booleans. Left alone that difference
 * appears as `JSON.parse` receiving "[object Object]" and as arithmetic on
 * strings -- quietly, in half the views.
 *
 * So the parsers below make Postgres answer in SQLite's shapes rather than
 * making three hundred call sites defend against two. The direction is
 * deliberate: SQLite is the shape under test, so it is the shape that must be
 * matched. Writes need no equivalent, because `pg` sends parameters as text
 * with the type unspecified and the server casts them to the column's type --
 * 1 and '1' both land in a boolean column as true.
 *
 * ROLES. `txAs` issues `set local role`, so a request runs as `app_viewer`,
 * `app_analyst` or `enrichment_worker` and the row-level policies proved in
 * spike S5 apply to it. That is defence in depth, not the boundary: the
 * boundary is `requireRole` at the top of every action, because a policy cannot
 * express "this person may publish".
 */
import { readFileSync } from "node:fs";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, types as pgTypes, type PoolClient, type PoolConfig } from "pg";
import { toNumberedPlaceholders, type Row, type Sql } from "./sql.ts";
import { SUPABASE_ROOT_2021_CA } from "./supabase_ca.ts";

const asText = (v: string) => v;
const asNumber = (v: string) => Number(v);
const asSqliteBool = (v: string) => (v === "t" || v === "true" ? 1 : 0);

/** oid -> parser, for the types this schema actually uses. */
const PARSERS: Record<number, (v: string) => unknown> = {
  16: asSqliteBool,   // bool
  20: asNumber,       // int8, which pg returns as a string
  114: asText,        // json
  1082: asText,       // date
  1114: asText,       // timestamp
  1184: asText,       // timestamptz
  1700: asNumber,     // numeric
  3802: asText,       // jsonb
};

const types = {
  getTypeParser(oid: number, format?: unknown) {
    if (format === "text" || format === undefined) {
      const parser = PARSERS[oid];
      if (parser) return parser;
    }
    // Everything unlisted keeps pg's OWN parser. Returning text here instead
    // would turn int4 and int2 into strings, which is the exact class of quiet
    // difference these parsers exist to remove -- the schema's integer columns
    // come back as numbers from SQLite and must from Postgres too.
    return (pgTypes.getTypeParser as (o: number, f?: unknown) => (v: string) => unknown)(
      oid, format);
  },
};

/** A role name is interpolated into SQL, so it may only ever be one of these. */
const ROLES = new Set(["app_viewer", "app_analyst", "enrichment_worker"]);

export type PgOptions = {
  connectionString: string;
  ssl?: PoolConfig["ssl"];
  max?: number;
};

/**
 * Connections one instance may hold, and how long one may sit idle.
 *
 * Supabase's session pooler admits 15 clients in all, and every connection an
 * instance keeps -- idle or not -- is one of them. On 11 September 2026 the
 * pool allowed 10 per instance with pg's default idle handling, and a few
 * warm instances (Fluid compute keeps them, and a deploy leaves the previous
 * one's running) held all 15: every page that touched the database failed
 * with EMAXCONNSESSION, and /runs, /review and /publish went down together.
 *
 * Four covers the worker's four slots; a request past that waits for a
 * connection rather than taking one of someone else's. Five idle seconds is
 * long enough to reuse a connection across a page's queries.
 */
export const POOL_MAX = 4;
export const POOL_IDLE_MS = 5_000;

/**
 * TLS is verified. There is no switch here to turn that off.
 *
 * This connection carries licensed exchange data across the public internet,
 * and an unverified certificate makes the whole transport impersonable by
 * whoever holds the route.
 *
 * WHAT IS TRUSTED. Supabase's chain ends at its own private root, which no
 * operating system trusts -- an earlier version of this comment claimed
 * otherwise, and would have failed with SELF_SIGNED_CERT_IN_CHAIN on first
 * contact. So a Supabase host is verified against exactly that root, shipped in
 * supabase_ca.ts with its provenance recorded, and against nothing else. Any
 * other host uses the system store. MM_DATABASE_CA overrides both, and takes
 * either a path or the PEM text itself, because a serverless platform has
 * environment variables and no filesystem to put a certificate on.
 *
 * `sslmode=disable` in the connection string is honoured, because a local
 * Postgres on a unix socket has no certificate to verify and pretending
 * otherwise would only teach people to reach for a flag that does not exist.
 */
export function tls(connectionString: string, override?: PoolConfig["ssl"]): PoolConfig["ssl"] {
  if (override !== undefined) return override;
  if (/[?&]sslmode=disable\b/.test(connectionString)) return false;

  const configured = process.env.MM_DATABASE_CA;
  if (configured) {
    const pem = configured.includes("-----BEGIN CERTIFICATE-----")
      ? configured
      : readFileSync(configured, "utf8");
    return { ca: pem, rejectUnauthorized: true };
  }
  if (isSupabaseHost(connectionString)) {
    return { ca: SUPABASE_ROOT_2021_CA, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

function isSupabaseHost(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export class PostgresSql implements Sql {
  readonly dialect = "postgres" as const;
  private readonly pool: Pool;
  /** Set when this handle is bound to one transaction's connection. */
  private readonly client: PoolClient | null;

  constructor(options: PgOptions | Pool, client: PoolClient | null = null) {
    if (options instanceof Pool) {
      this.pool = options;
    } else {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ssl: tls(options.connectionString, options.ssl),
        max: options.max ?? POOL_MAX,
        idleTimeoutMillis: POOL_IDLE_MS,
        types,
      });
      // A pooler or the database dropping an idle connection is an 'error' on
      // the pool; unheard, it is an uncaught exception that ends the instance.
      this.pool.on("error", (err) => console.error("postgres: idle connection lost", err.message));
      // On Vercel, keep the instance awake until its idle connections close,
      // rather than suspending it with them still open and counted against the
      // pooler. Off Vercel this does nothing.
      attachDatabasePool(this.pool);
    }
    this.client = client;
  }

  private async query(sql: string, params: unknown[]) {
    const text = toNumberedPlaceholders(sql);
    const values = params.map((p) => (p === undefined ? null : p));
    return this.client
      ? this.client.query({ text, values, types })
      : this.pool.query({ text, values, types });
  }

  async all(sql: string, ...params: unknown[]): Promise<Row[]> {
    return (await this.query(sql, params)).rows as Row[];
  }

  async get(sql: string, ...params: unknown[]): Promise<Row | undefined> {
    return (await this.query(sql, params)).rows[0] as Row | undefined;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return { changes: (await this.query(sql, params)).rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    if (this.client) { await this.client.query(sql); return; }
    await this.pool.query(sql);
  }

  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.txAs(null, fn);
  }

  /**
   * One transaction on one connection, optionally as a database role.
   *
   * `set local role` rather than `set role`: it reverts when the transaction
   * ends, so a connection cannot be returned to the pool still wearing the
   * previous request's role.
   */
  async txAs<T>(role: string | null, fn: (sql: Sql) => Promise<T>): Promise<T> {
    if (role !== null && !ROLES.has(role)) {
      throw new Error(`refusing to set unknown database role ${JSON.stringify(role)}`);
    }
    if (this.client) {
      // Already inside one. Postgres has savepoints, but nothing here needs a
      // partial rollback, and a nested role switch would be a privilege bug.
      return fn(this);
    }
    const client = await this.pool.connect();
    const bound = new PostgresSql(this.pool, client);
    try {
      await client.query("begin");
      if (role) await client.query(`set local role ${role}`);
      const out = await fn(bound);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.client) await this.pool.end();
  }
}
