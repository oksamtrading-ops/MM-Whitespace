import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema, MIGRATIONS_DIR, migrationFiles } from "./schema.ts";
import { isPostgresOnly } from "./dialect.ts";

/* A migration added later reaches new databases only. That is how a settings
   table ships and the settings screen throws on the one database in use. */

test("applying the schema twice is a no-op, not a duplicate-key error", async () => {
  const db = new DatabaseSync(":memory:");
  const first = applySchema(db);
  assert.ok(first.applied.length > 0);

  const second = applySchema(db);
  assert.deepEqual(second.applied, [], "nothing is applied a second time");
  assert.equal(second.statements, 0);
});

test("a database that predates the ledger is adopted, not replayed", async () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  // Erase the ledger to stand in for a database made before it existed.
  db.exec("drop table schema_migrations");

  // Adoption covers the prefix ending at the last migration whose table is
  // present. 0002 sits inside that prefix, so it is adopted, not replayed --
  // replaying it would violate a unique constraint. A data-only migration AFTER
  // the last table-creating one (0015) cannot be recognised that way, so it
  // runs again; that is why such a migration must be idempotent.
  const catalogBefore = db.prepare("select count(*) n from field_catalog").get() as { n: number };
  const again = applySchema(db);
  const createsTable = (f: string) =>
    /create\s+table/i.test(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  assert.ok(!again.applied.includes("0002_seed_catalog.sql"), "0002 is adopted, never replayed");
  assert.deepEqual(again.applied.filter(createsTable), [], "no table-creating migration is replayed");
  const catalogAfter = db.prepare("select count(*) n from field_catalog").get() as { n: number };
  assert.equal(catalogAfter.n, catalogBefore.n, "re-running a data-only migration changes nothing");
  assert.deepEqual(applySchema(db).applied, [], "and once recorded, nothing runs twice");
});

test("a migration the database has not had is applied to it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-mig-"));
  writeFileSync(join(dir, "0001_first.sql"), "create table alpha (id integer primary key);");
  const db = new DatabaseSync(":memory:");
  assert.deepEqual(applySchema(db, dir).applied, ["0001_first.sql"]);

  writeFileSync(join(dir, "0002_second.sql"), "create table beta (id integer primary key);");
  assert.deepEqual(applySchema(db, dir).applied, ["0002_second.sql"],
    "only the new one, and the prefix before it is left alone");
  assert.ok(db.prepare("select 1 from sqlite_master where name = 'beta'").get());
});

test("the ledger records what was applied", async () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const recorded = (db.prepare("select file from schema_migrations order by file").all() as
    Array<{ file: string }>).map((r) => r.file);
  const expected = migrationFiles().filter(
    (f) => !isPostgresOnly(readFileSync(join(MIGRATIONS_DIR, f), "utf8")));
  assert.deepEqual(recorded, expected, "Postgres-only migrations are skipped, not recorded");
  assert.ok(expected.length < migrationFiles().length, "and some of them are");
});

test("a trigger migration is Postgres-only, so SQLite never tries to translate it", () => {
  // SQLite has triggers but not plpgsql, so the translator would throw on
  // 0024 -- the loud failure it is designed to give rather than silently
  // changing meaning. That is the right behaviour and the wrong outcome: the
  // whole schema would refuse to load locally. PG_ONLY carried no trigger
  // pattern until 0024, which is why doc 11's allowlist trigger was recorded
  // as forbidden by the portable migrations rather than simply unwritten.
  const trigger = migrationFiles().find((f) => f.includes("domain_allowlist"));
  assert.ok(trigger, "0024 is present");
  const sql = readFileSync(join(MIGRATIONS_DIR, trigger!), "utf8");
  assert.ok(isPostgresOnly(sql), "and it is skipped locally");

  // The predicate must answer to the construct, not to this one file's name.
  assert.ok(isPostgresOnly("create trigger t before insert on x for each row execute function f();"));
  assert.ok(isPostgresOnly("create or replace function f() returns trigger language plpgsql as $$ begin end $$;"));
  assert.equal(isPostgresOnly("create table t (id text primary key);"), false,
               "and an ordinary migration still loads on both engines");
});
