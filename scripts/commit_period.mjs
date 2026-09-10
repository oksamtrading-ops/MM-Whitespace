/**
 * Commit a parsed period into a local database.
 *
 *   python3 -m mmparser.cli "<workbook>" --json /tmp/period.json
 *   node scripts/commit_period.mjs /tmp/period.json ./period.db
 *
 * The schema comes from supabase/migrations/, translated for SQLite. The
 * canonical dialect is Postgres; see src/lib/db/dialect.ts.
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../src/lib/db/schema.ts";
import { commitPeriod } from "../src/lib/db/commit.ts";
import { SqliteSql } from "../src/lib/db/sqlite.ts";

const [payloadPath, dbPath = "./period.db", ...rest] = process.argv.slice(2);
if (!payloadPath) {
  console.error("usage: node scripts/commit_period.mjs <period.json> [db path] [--fresh]");
  process.exit(2);
}
if (rest.includes("--fresh") && existsSync(dbPath)) unlinkSync(dbPath);

const raw = readFileSync(payloadPath, "utf8");
const payload = JSON.parse(raw);
const sha = createHash("sha256").update(raw).digest("hex");

const fresh = !existsSync(dbPath);
const handle = new DatabaseSync(dbPath);
const db = new SqliteSql(handle);
if (fresh) {
  const s = applySchema(handle);
  console.log(`schema applied: ${s.applied.join(", ")}  (skipped pg-only: ${s.skipped.join(", ")})`);
} else {
  handle.exec("pragma foreign_keys = on");
}

const t0 = performance.now();
const r = await commitPeriod(db, payload, { label: `Q3-2026 (${payload.period})`, sourceSha256: sha });
const ms = (performance.now() - t0).toFixed(0);

console.log(`\ncommitted "${r.label}" in ${ms}ms`);
console.table({
  companies: r.companies, identifiers: r.identifiers, facts: r.facts,
  "resolved values": r.values, "stage rows": r.stages, tiers: r.tiers,
  "trace rows": r.traces, "analyst values preserved": r.preserved,
});

const dist = handle.prepare(
  `select coalesce(cast(tier as text), status) as bucket, count(*) as n
     from tiers where period_id = ? group by bucket order by n desc`).all(r.periodId);
console.log("\ntier distribution as committed:");
for (const row of dist) console.log(`  ${String(row.n).padStart(4)}  ${row.bucket}`);

const fp = handle.prepare(
  `select footprint, count(*) n from tiers where period_id = ? group by footprint order by n desc`,
).all(r.periodId);
console.log("\nfootprint:");
for (const row of fp) console.log(`  ${String(row.n).padStart(4)}  ${row.footprint}`);

const internal = handle.prepare(
  `select count(*) n from company_period_field_values v
     join field_catalog f on f.key = v.field_key
    where f.classification = 'deloitte_internal'`).get();
console.log(`\nvalues stored against internal-classified fields: ${internal.n}`);
handle.close();
