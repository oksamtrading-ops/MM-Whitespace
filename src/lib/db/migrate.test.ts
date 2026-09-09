import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema, MIGRATIONS_DIR, migrationFiles } from "./schema.ts";
import { isPostgresOnly } from "./dialect.ts";

/* A migration added later reaches new databases only. That is how a settings
   table ships and the settings screen throws on the one database in use. */

test("applying the schema twice is a no-op, not a duplicate-key error", () => {
  const db = new DatabaseSync(":memory:");
  const first = applySchema(db);
  assert.ok(first.applied.length > 0);

  const second = applySchema(db);
  assert.deepEqual(second.applied, [], "nothing is applied a second time");
  assert.equal(second.statements, 0);
});

test("a database that predates the ledger is adopted, not replayed", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  // Erase the ledger to stand in for a database made before it existed.
  db.exec("drop table schema_migrations");

  const again = applySchema(db);
  assert.deepEqual(again.applied, [],
    "0002 only inserts rows, so replaying it would violate a unique constraint");
  const rows = db.prepare("select count(*) n from field_catalog").get() as { n: number };
  assert.ok(rows.n > 0);
});

test("a migration the database has not had is applied to it", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-mig-"));
  writeFileSync(join(dir, "0001_first.sql"), "create table alpha (id integer primary key);");
  const db = new DatabaseSync(":memory:");
  assert.deepEqual(applySchema(db, dir).applied, ["0001_first.sql"]);

  writeFileSync(join(dir, "0002_second.sql"), "create table beta (id integer primary key);");
  assert.deepEqual(applySchema(db, dir).applied, ["0002_second.sql"],
    "only the new one, and the prefix before it is left alone");
  assert.ok(db.prepare("select 1 from sqlite_master where name = 'beta'").get());
});

test("the ledger records what was applied", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const recorded = (db.prepare("select file from schema_migrations order by file").all() as
    Array<{ file: string }>).map((r) => r.file);
  const expected = migrationFiles().filter(
    (f) => !isPostgresOnly(readFileSync(join(MIGRATIONS_DIR, f), "utf8")));
  assert.deepEqual(recorded, expected, "Postgres-only migrations are skipped, not recorded");
  assert.ok(expected.length < migrationFiles().length, "and some of them are");
});
