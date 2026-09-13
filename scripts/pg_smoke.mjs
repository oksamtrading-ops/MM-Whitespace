/**
 * Prove the Postgres adapter against a real database.
 *
 *   MM_DATABASE_URL="postgresql://..." node scripts/pg_smoke.mjs
 *
 * The connection string stays in the shell. This script never prints it, and
 * never writes it anywhere.
 *
 * What it checks, in order:
 *   1. it can connect, over verified TLS;
 *   2. the schema ledger is current;
 *   3. every value comes back in the SAME SHAPE SQLite returns -- text for
 *      jsonb and timestamps, numbers for numeric and count(*), 1/0 for
 *      booleans. This is the check that matters: a difference here is silent,
 *      and surfaces later as JSON.parse receiving "[object Object]";
 *   4. the real read paths return the real population;
 *   5. a transaction rolls back;
 *   6. `set local role` works, so the S5 policies apply to a request;
 *   7. every retention rule runs here, as a DRY RUN. The job drove node:sqlite
 *      directly until 13 September 2026, so the one database that accumulates
 *      anything was the one it could not sweep. This is where that stays true.
 *
 * It writes nothing. Step 5 inserts inside a transaction it then rolls back,
 * and step 7 is a dry run.
 */
import { PostgresSql } from "../src/lib/db/postgres.ts";
import { migrationFiles } from "../src/lib/db/schema.ts";
import { run as retention } from "./retention.mjs";

const url = process.env.MM_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("set MM_DATABASE_URL (or DATABASE_URL) and run again");
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const db = new PostgresSql({ connectionString: url });

try {
  // 1 -----------------------------------------------------------------
  const who = await db.get("select current_user as u, version() as v");
  check("connected", Boolean(who?.u), "no row from current_user");
  console.log(`        as ${who.u}`);
  const ssl = await db.get("select ssl from pg_stat_ssl where pid = pg_backend_pid()");
  check("the connection is TLS", ssl?.ssl === 1 || ssl?.ssl === true,
        "pg_stat_ssl says this session is not encrypted");

  // 2 -----------------------------------------------------------------
  const applied = (await db.all("select file from schema_migrations")).map((r) => String(r.file));
  const onDisk = migrationFiles();
  const missing = onDisk.filter((f) => !applied.includes(f));
  check("the schema is current", missing.length === 0,
        `not applied: ${missing.join(", ")} — run: node scripts/migrate.mjs "$MM_DATABASE_URL"`);

  // 3 -----------------------------------------------------------------
  const shapes = await db.get(`select
      (select value from company_period_field_values limit 1)          as jsonb_col,
      (select market_cap_as_of from periods limit 1)                   as date_col,
      (select created_at from periods limit 1)                         as ts_col,
      (select threshold_amount from periods limit 1)                   as numeric_col,
      (select revision from periods limit 1)                           as int_col,
      (select is_active from app_users limit 1)                        as bool_col,
      (select count(*) from companies)                                 as count_col`);
  check("jsonb comes back as text", shapes.jsonb_col === null || typeof shapes.jsonb_col === "string",
        `got ${typeof shapes.jsonb_col} — JSON.parse would fail on this`);
  check("date comes back as text", shapes.date_col === null || typeof shapes.date_col === "string",
        `got ${typeof shapes.date_col}`);
  check("timestamptz comes back as text", shapes.ts_col === null || typeof shapes.ts_col === "string",
        `got ${typeof shapes.ts_col}`);
  check("numeric comes back as a number",
        shapes.numeric_col === null || typeof shapes.numeric_col === "number",
        `got ${typeof shapes.numeric_col} — arithmetic on it would concatenate`);
  check("int comes back as a number", shapes.int_col === null || typeof shapes.int_col === "number",
        `got ${typeof shapes.int_col}`);
  check("boolean comes back as 1/0 the way SQLite gives it",
        shapes.bool_col === null || shapes.bool_col === 1 || shapes.bool_col === 0,
        `got ${JSON.stringify(shapes.bool_col)}`);
  check("count(*) comes back as a number", typeof shapes.count_col === "number",
        `got ${typeof shapes.count_col} — int8 is a string unless it is parsed`);

  // 4 -----------------------------------------------------------------
  const counts = await db.get(`select
      (select count(*) from companies)                    as companies,
      (select count(*) from company_period_field_values)  as values,
      (select count(*) from tiers)                        as tiers,
      (select count(*) from tier_traces)                  as traces`);
  console.log(`        ${counts.companies} companies · ${counts.values} values · ` +
              `${counts.tiers} tiers · ${counts.traces} traces`);
  check("the population is readable", Number(counts.companies) > 0);

  // 5 -----------------------------------------------------------------
  const before = Number((await db.get("select count(*) n from audit_log")).n);
  await db.tx(async (tx) => {
    await tx.run("insert into audit_log (event, detail) values ('pg_smoke', '{}')");
    throw new Error("rollback on purpose");
  }).catch(() => {});
  const after = Number((await db.get("select count(*) n from audit_log")).n);
  check("a failed transaction leaves nothing behind", before === after,
        `audit_log went from ${before} to ${after}`);

  // 6 -----------------------------------------------------------------
  for (const role of ["app_viewer", "app_analyst", "enrichment_worker"]) {
    try {
      const n = await db.txAs(role, async (tx) =>
        (await tx.get("select count(*) n from companies")).n);
      check(`set local role ${role}`, true);
      console.log(`        as ${role}: companies reads ${n}`);
    } catch (err) {
      check(`set local role ${role}`, false, String(err.message).split("\n")[0]);
    }
  }
  // 7 -----------------------------------------------------------------
  const { results } = await retention(db, { apply: false, exportPath: null });
  for (const r of results) {
    check(`retention: ${r.label}`, !r.refused && Number.isInteger(r.examined), r.note);
    if (!r.refused) console.log(`        ${r.examined} row(s) beyond retention — ${r.note}`);
  }
} finally {
  await db.close();
}

console.log(failures === 0
  ? "\nthe Postgres adapter behaves as the application expects."
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
