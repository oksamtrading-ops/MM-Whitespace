/** Load the canonical migrations and apply them to a database. */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isPostgresOnly, statements, toSqlite } from "./dialect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "..", "..", "..", "supabase", "migrations");

export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export type LoadResult = { applied: string[]; skipped: string[]; statements: number };

/**
 * Which migrations a database has had.
 *
 * Without this, a migration added later reaches new databases only, and every
 * database already in use is quietly a version behind -- which is how a
 * settings table ships and the settings screen throws on the one database
 * anybody is looking at.
 */
export function ensureLedger(db: DatabaseSync): void {
  db.exec(
    `create table if not exists schema_migrations (
       file text primary key,
       applied_at text not null default (datetime('now'))
     )`);
}

function recorded(db: DatabaseSync): Set<string> {
  ensureLedger(db);
  return new Set((db.prepare("select file from schema_migrations").all() as Array<{ file: string }>)
    .map((r) => r.file));
}

/** The first table a migration creates, used to recognise one already applied. */
function firstTable(sql: string): string | null {
  return sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/i)?.[1] ?? null;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare(
    "select 1 from sqlite_master where type = 'table' and name = ?").get(name));
}

/**
 * Adopt a database that predates the ledger.
 *
 * Migrations run in sorted order, so what a database has had is a PREFIX of
 * the list. The prefix ends at the last migration whose first table is
 * present. Recognising them one at a time does not work: 0002 only inserts
 * rows, so there is no table to look for, and re-running it violates a unique
 * constraint rather than doing nothing.
 */
function adopt(db: DatabaseSync, dir: string): void {
  const files = migrationFiles(dir).filter(
    (f) => !isPostgresOnly(readFileSync(join(dir, f), "utf8")));
  let end = -1;
  files.forEach((file, i) => {
    const table = firstTable(toSqlite(readFileSync(join(dir, file), "utf8")));
    if (table && tableExists(db, table)) end = i;
  });
  const mark = db.prepare("insert or ignore into schema_migrations (file) values (?)");
  for (const file of files.slice(0, end + 1)) mark.run(file);
}

export function applySchema(db: DatabaseSync, dir: string = MIGRATIONS_DIR): LoadResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  let count = 0;
  db.exec("pragma foreign_keys = on");
  ensureLedger(db);
  adopt(db, dir);
  const already = recorded(db);
  const mark = db.prepare("insert or ignore into schema_migrations (file) values (?)");

  for (const file of migrationFiles(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    if (isPostgresOnly(sql)) { skipped.push(file); continue; }
    if (already.has(file)) continue;
    for (const stmt of statements(toSqlite(sql))) {
      try {
        db.exec(stmt);
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}\n  in: ${stmt.slice(0, 160)}`);
      }
      count++;
    }
    mark.run(file);
    applied.push(file);
  }
  return { applied, skipped, statements: count };
}

export function openDatabase(path: string = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  applySchema(db);
  return db;
}
