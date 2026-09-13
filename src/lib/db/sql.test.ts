import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { insertMany, MAX_BIND_PARAMS, toNumberedPlaceholders } from "./sql.ts";
import { SqliteSql } from "./sqlite.ts";

test("placeholders are numbered in order", async () => {
  assert.equal(
    toNumberedPlaceholders("select * from t where a = ? and b = ?"),
    "select * from t where a = $1 and b = $2");
});

test("a question mark inside a string literal is data, not a placeholder", async () => {
  assert.equal(
    toNumberedPlaceholders("select '?' as q, ? as p"),
    "select '?' as q, $1 as p");
  // A doubled quote does not end the literal.
  assert.equal(
    toNumberedPlaceholders("select 'it''s ? here' as q, ? as p"),
    "select 'it''s ? here' as q, $1 as p");
  assert.equal(
    toNumberedPlaceholders('select "od?d" as q, ? as p'),
    'select "od?d" as q, $1 as p');
});

test("a question mark inside a comment is left alone", async () => {
  assert.equal(
    toNumberedPlaceholders("select 1 -- why? because\nwhere a = ?"),
    "select 1 -- why? because\nwhere a = $1");
});

function open(): SqliteSql {
  const handle = new DatabaseSync(":memory:");
  handle.exec("create table t (id integer primary key, name text, flag integer)");
  return new SqliteSql(handle);
}

test("all, get and run carry through", async () => {
  const sql = open();
  const r = await sql.run("insert into t (name, flag) values (?, ?)", "a", true);
  assert.equal(r.changes, 1);
  await sql.run("insert into t (name, flag) values (?, ?)", "b", false);
  assert.equal((await sql.all("select * from t")).length, 2);
  assert.deepEqual(await sql.get("select name, flag from t where name = ?", "a"),
                   { name: "a", flag: 1 });
  assert.equal(await sql.get("select 1 from t where name = ?", "nobody"), undefined);
  await sql.close();
});

test("a boolean binds, because Postgres wants one and node:sqlite refuses one", async () => {
  const sql = open();
  await sql.run("insert into t (name, flag) values (?, ?)", "a", false);
  assert.deepEqual(await sql.get("select flag from t"), { flag: 0 });
  await sql.close();
});

test("undefined binds as null rather than throwing", async () => {
  const sql = open();
  await sql.run("insert into t (name) values (?)", undefined);
  assert.deepEqual(await sql.get("select name from t"), { name: null });
  await sql.close();
});

test("a transaction rolls back on a throw", async () => {
  const sql = open();
  await assert.rejects(sql.tx(async (t) => {
    await t.run("insert into t (name) values (?)", "a");
    throw new Error("no");
  }));
  assert.equal((await sql.all("select * from t")).length, 0);
  await sql.close();
});

test("a nested transaction is a savepoint, not a second begin", async () => {
  const sql = open();
  await sql.tx(async (outer) => {
    await outer.run("insert into t (name) values (?)", "kept");
    await assert.rejects(outer.tx(async (inner) => {
      await inner.run("insert into t (name) values (?)", "dropped");
      throw new Error("no");
    }));
  });
  assert.deepEqual((await sql.all("select name from t")).map((r) => r.name), ["kept"]);
  await sql.close();
});

test("txAs ignores the role on SQLite rather than failing", async () => {
  const sql = open();
  await sql.txAs("app_viewer", async (t) => {
    await t.run("insert into t (name) values (?)", "a");
  });
  assert.equal((await sql.all("select * from t")).length, 1);
  await sql.close();
});

test("insertMany writes every row, in chunks inside the parameter budget", async () => {
  const sql = new SqliteSql(new DatabaseSync(":memory:"));
  await sql.exec("create table t (a integer, b text, c text, d text, e text, f text)");
  const columns = ["a", "b", "c", "d", "e", "f"];
  // Two full chunks and a remainder, so the boundary is actually crossed.
  const perChunk = Math.floor(MAX_BIND_PARAMS / columns.length);
  const rows = Array.from({ length: perChunk * 2 + 7 },
                          (_, i) => [i, `b${i}`, "c", "d", "e", "f"]);

  // What is being bought here is round trips, so they are what is counted --
  // SQLite would swallow one statement of this size and prove nothing.
  const statements: number[] = [];
  const counting = new Proxy(sql, {
    get: (target, prop, receiver) => prop !== "run" ? Reflect.get(target, prop, receiver)
      : (s: string, ...params: unknown[]) => { statements.push(params.length); return sql.run(s, ...params); },
  });

  assert.equal(await insertMany(counting, "t", columns, rows), rows.length);
  assert.equal(statements.length, 3, "one statement per chunk, not one per row");
  assert.ok(Math.max(...statements) <= MAX_BIND_PARAMS,
            `no statement binds more than ${MAX_BIND_PARAMS} parameters: ${statements}`);

  const all = await sql.all("select a, b from t order by a") as Array<{ a: number; b: string }>;
  assert.equal(all.length, rows.length);
  assert.deepEqual(all[0], { a: 0, b: "b0" });
  assert.deepEqual(all[all.length - 1], { a: rows.length - 1, b: `b${rows.length - 1}` });
  await sql.close();
});

test("insertMany on no rows writes nothing rather than a statement with no values", async () => {
  const sql = new SqliteSql(new DatabaseSync(":memory:"));
  await sql.exec("create table t (a integer)");
  assert.equal(await insertMany(sql, "t", ["a"], []), 0);
  assert.equal((await sql.all("select * from t")).length, 0);
  await sql.close();
});
