/**
 * Choose the database.
 *
 * `MM_DATABASE_URL` selects Postgres; its absence selects the SQLite file at
 * `MM_DATABASE`. Nothing else in the application asks which one it is, and the
 * one place that has to -- the schema bootstrap -- asks here.
 */
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.ts";
import { SqliteSql } from "./sqlite.ts";
import { PostgresSql } from "./postgres.ts";
import type { Sql } from "./sql.ts";

export const DATABASE_PATH = process.env.MM_DATABASE ?? "./period.db";

/**
 * Where Postgres is, in the order the answer is most likely to be right.
 *
 * POSTGRES_URL and its non-pooling twin are what the Supabase integration
 * injects into a Vercel project. Reading them means connecting the two
 * services is a button rather than a secret copied by hand -- which matters
 * beyond convenience: a credential that is never typed is never pasted into a
 * chat, a ticket or a screenshot, and rotating it is the integration's job.
 *
 * MM_DATABASE_URL still wins, so a deployment can point somewhere else.
 */
export function databaseUrl(): string | null {
  return process.env.MM_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? process.env.POSTGRES_URL
    ?? process.env.POSTGRES_URL_NON_POOLING
    ?? null;
}

/**
 * A SQLite file is created and migrated on first touch, because that is how the
 * command line has always worked. A Postgres database is NOT: it is a shared,
 * deployed database and migrating it is a deliberate act -- `npm run migrate`
 * with the URL -- not a side effect of a page load.
 */
export function openSql(url: string | null = databaseUrl()): Sql {
  if (url) return new PostgresSql({ connectionString: url });
  if (process.env.NODE_ENV === "production") {
    // Falling through to SQLite here would open a file on a read-only, empty
    // serverless filesystem: the application would start, serve pages, and
    // report an empty population as though that were the truth. Refusing to
    // start is the difference between an outage and a lie.
    throw new Error(
      "MM_DATABASE_URL is not set. A production deployment reads Postgres; " +
      "the SQLite path is for tests and the command line.");
  }
  const handle = new DatabaseSync(DATABASE_PATH);
  handle.exec("pragma foreign_keys = on");
  const has = handle.prepare(
    "select count(*) n from sqlite_master where type='table' and name='app_users'",
  ).get() as { n: number };
  if (has.n === 0) applySchema(handle);
  return new SqliteSql(handle);
}

/**
 * An empty, migrated SQLite database in memory. Tests and short scripts use it;
 * it is the reason `node --test` needs no database daemon and no network.
 */
export function memorySql(): SqliteSql {
  const handle = new DatabaseSync(":memory:");
  applySchema(handle);
  return new SqliteSql(handle);
}
