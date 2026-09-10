/**
 * Apply the canonical migrations to Postgres.
 *
 * The SQLite path in `schema.ts` translates and skips; this one applies the
 * files verbatim, including the role and policy migrations that only exist
 * there. Same ledger, same adoption rule, so a database created by either route
 * reports the same list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statements } from "./dialect.ts";
import { MIGRATIONS_DIR, migrationFiles, type LoadResult } from "./schema.ts";
import type { Sql } from "./sql.ts";

function firstTable(sql: string): string | null {
  return sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/i)?.[1] ?? null;
}

/**
 * A database that predates the ledger -- which includes the one this project
 * loaded by hand -- has had a PREFIX of the list. The prefix ends at the last
 * migration whose first table is present. Recording them one at a time does not
 * work: 0002 only inserts rows, so there is no table to look for.
 */
async function adopt(sql: Sql, dir: string): Promise<void> {
  const files = migrationFiles(dir);
  let end = -1;
  for (const [i, file] of files.entries()) {
    const table = firstTable(readFileSync(join(dir, file), "utf8"));
    if (!table) continue;
    const found = await sql.get("select to_regclass(?) as t", `public.${table}`);
    if (found?.t) end = i;
  }
  for (const file of files.slice(0, end + 1)) {
    await sql.run("insert into schema_migrations (file) values (?) on conflict do nothing", file);
  }
}

export async function applySchemaPg(
  sql: Sql, dir: string = MIGRATIONS_DIR,
): Promise<LoadResult> {
  await sql.exec(
    `create table if not exists schema_migrations (
       file text primary key,
       applied_at timestamptz not null default now()
     )`);
  await adopt(sql, dir);
  const already = new Set(
    (await sql.all("select file from schema_migrations")).map((r) => String(r.file)));

  const applied: string[] = [];
  let count = 0;
  for (const file of migrationFiles(dir)) {
    if (already.has(file)) continue;
    const text = readFileSync(join(dir, file), "utf8");
    await sql.tx(async (tx) => {
      for (const stmt of statements(text)) {
        try {
          await tx.exec(stmt);
        } catch (err) {
          throw new Error(`${file}: ${(err as Error).message}\n  in: ${stmt.slice(0, 160)}`);
        }
        count++;
      }
      await tx.run("insert into schema_migrations (file) values (?)", file);
    });
    applied.push(file);
  }
  // Nothing is skipped on Postgres: the Postgres-only files are the point.
  return { applied, skipped: [], statements: count };
}
