/**
 * Evaluate the publish gate for a committed period, and publish it.
 *
 *   node scripts/publish_period.mjs ./period.db              # evaluate only
 *   node scripts/publish_period.mjs ./period.db --publish
 *   node scripts/publish_period.mjs ./period.db --publish --override "reason"
 */
import { DatabaseSync } from "node:sqlite";
import { evaluateGate } from "../src/lib/publish/gate.ts";
import { publishPeriod, PublishBlocked, readPublished } from "../src/lib/publish/snapshot.ts";
import { SqliteSql } from "../src/lib/db/sqlite.ts";

const [dbPath, ...rest] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/publish_period.mjs <period.db> [--publish] [--override <reason>]");
  process.exit(2);
}
const doPublish = rest.includes("--publish");
const oi = rest.indexOf("--override");
const overrideReason = oi >= 0 ? rest[oi + 1] : null;

const handle = new DatabaseSync(dbPath);
handle.exec("pragma foreign_keys = on");
const db = new SqliteSql(handle);
const period = handle.prepare("select id, label, status from periods order by rowid desc limit 1").get();
console.log(`period: ${period.label}  (${period.status})\n`);

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
handle.close();
