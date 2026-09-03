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

export function applySchema(db: DatabaseSync, dir: string = MIGRATIONS_DIR): LoadResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  let count = 0;
  db.exec("pragma foreign_keys = on");
  for (const file of migrationFiles(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    if (isPostgresOnly(sql)) { skipped.push(file); continue; }
    for (const stmt of statements(toSqlite(sql))) {
      try {
        db.exec(stmt);
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}\n  in: ${stmt.slice(0, 160)}`);
      }
      count++;
    }
    applied.push(file);
  }
  return { applied, skipped, statements: count };
}

export function openDatabase(path: string = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  applySchema(db);
  return db;
}
