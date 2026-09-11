/**
 * Evaluate the publish gate for a committed period, and publish it.
 *
 *   node scripts/publish_period.mjs ./period.db              # evaluate only
 *   node scripts/publish_period.mjs ./period.db --publish
 *   node scripts/publish_period.mjs ./period.db --publish --override "reason"
 *
 * With no path, it publishes the database the application itself would read --
 * MM_DATABASE_URL, DATABASE_URL or POSTGRES_URL -- through the same code the
 * Publish button runs:
 *
 *   node scripts/publish_period.mjs --publish --override "reason" --actor admin@example
 *
 * `--actor` names the Admin the publication is recorded against. Without it an
 * override is recorded with nobody behind it, which the audit trail exists to
 * prevent.
 */
import { DatabaseSync } from "node:sqlite";
import { evaluateGate } from "../src/lib/publish/gate.ts";
import { publishPeriod, PublishBlocked, readPublished } from "../src/lib/publish/snapshot.ts";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { databaseUrl, openSql } from "../src/lib/db/open.ts";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dbPath = args[0] && !args[0].startsWith("--") ? args[0] : null;
const doPublish = args.includes("--publish");
const overrideReason = flag("--override");
const actorEmail = flag("--actor");

let db;
if (dbPath) {
  const handle = new DatabaseSync(dbPath);
  handle.exec("pragma foreign_keys = on");
  db = new SqliteSql(handle);
} else if (databaseUrl()) {
  db = openSql();
} else {
  console.error("usage: node scripts/publish_period.mjs [period.db] [--publish] " +
                "[--override <reason>] [--actor <email>]\n" +
                "  with no path, set MM_DATABASE_URL to publish the application's database");
  process.exit(2);
}

// The newest period by its as-of date: rowid exists only in SQLite.
const period = await db.get(
  "select id, label, status from periods order by market_cap_as_of desc limit 1");
console.log(`database: ${db.dialect}`);
console.log(`period: ${period.label}  (${period.status})\n`);

let actorId = null;
if (actorEmail) {
  const actor = await db.get(
    "select id, role, is_active from app_users where lower(email) = lower(?)", actorEmail);
  if (!actor || !actor.is_active || actor.role !== "admin") {
    console.error(`--actor ${actorEmail} is not an active Admin; only an Admin may publish ` +
                  "through a closed gate");
    process.exit(1);
  }
  actorId = actor.id;
}

const gate = await evaluateGate(db, period.id);
const pad = (s, n) => String(s).padEnd(n);
console.log(`  ${pad("chart", 27)}${pad("resolved", 20)}${pad("floor", 8)}state`);
for (const c of gate.coverage) {
  const state = c.floorPct === null ? "no floor" : (c.meetsFloor ? "ok" : "BELOW FLOOR");
  console.log(`  ${pad(c.label, 27)}${pad(`${c.resolved}/${c.population} (${c.actualPct}%)`, 20)}` +
              `${pad(c.floorPct === null ? "-" : `${c.floorPct}%`, 8)}${state}`);
}

console.log(`\n  unresolved values on ${gate.unresolvedCount} companies`);
if (gate.publishable) {
  console.log("\n  GATE OPEN - this period may be published.");
} else {
  console.log("\n  GATE CLOSED:");
  for (const b of gate.blockers) console.log(`    - ${b.detail}`);
}

if (doPublish) {
  try {
    const r = await publishPeriod(db, period.id, {
      overrideReason,
      actorId,
      amendmentReason: overrideReason ? null : "re-publish",
    });
    console.log(`\n  published revision ${r.revision}: ${r.companies} companies, ` +
                `${r.values} values, ${r.aggregates} aggregates`);
    if (r.banner) console.log(`\n  DASHBOARD HEADER:\n    ${r.banner}`);

    const snap = await readPublished(db, period.id);
    console.log("\n  what a dashboard now reads (single-table group-by):");
    for (const [kind, rows] of Object.entries(snap.aggregates)) {
      if (kind === "coverage") continue;
      console.log(`    ${kind}:`);
      for (const row of rows.slice(0, 6)) {
        console.log(`      ${String(row.n).padStart(5)}  ${row.bucket}` +
                    (row.sub !== "-" ? ` / ${row.sub}` : ""));
      }
    }
  } catch (err) {
    if (err instanceof PublishBlocked) {
      console.error(`\n  refused to publish.\n${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
await db.close();
