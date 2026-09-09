/**
 * Seed a stalled run, so the run screen can be seen doing its job.
 *
 * A stall is the state the design cares most about and the hardest to produce
 * on demand: it needs a worker that died holding leases. This fabricates one.
 *
 *   node scripts/seed_stalled_run.mjs ./period.db
 *   node scripts/seed_stalled_run.mjs ./period.db --remove
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, ...rest] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/seed_stalled_run.mjs <db> [--remove]");
  process.exit(2);
}
const db = new DatabaseSync(dbPath);
db.exec("pragma foreign_keys = on");
const MARK = "stalled-demo";

if (rest.includes("--remove")) {
  const runs = db.prepare("select id from enrichment_runs where prompt_version = ?").all(MARK);
  for (const r of runs) {
    db.prepare("delete from enrichment_jobs where run_id = ?").run(r.id);
    db.prepare("delete from enrichment_runs where id = ?").run(r.id);
  }
  console.log(`removed ${runs.length} seeded run(s)`);
  process.exit(0);
}

const period = db.prepare(
  "select id from periods order by market_cap_as_of desc limit 1").get();
if (!period) { console.error("no period committed"); process.exit(1); }

const stamp = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace("T", " ").slice(0, 19);

db.prepare(
  `insert into enrichment_runs
     (period_id, status, budget_usd, spend_usd, model, prompt_version, mode, created_at)
   values (?, 'running', 25, 21.40, 'synthetic', ?, 'replay', ?)`,
).run(period.id, MARK, stamp(40 * 60 * 1000));
const run = db.prepare(
  "select id from enrichment_runs where prompt_version = ? order by rowid desc limit 1").get(MARK);

const companies = db.prepare("select id, canonical_name from companies limit 40").all();
if (companies.length < 4) {
  console.error("need at least four companies to make a run worth looking at");
  process.exit(1);
}

// Proportions, not fixed counts: the synthetic fixture has eight companies and
// the real workbook has 259, and both have to produce every interesting state.
const n = companies.length;
const abandoned = Math.max(1, Math.round(n * 0.08));
const leaking = Math.max(1, Math.round(n * 0.12));
const queued = Math.max(1, Math.round(n * 0.25));
const done = n - abandoned - leaking - queued;
const put = db.prepare(
  `insert into enrichment_jobs
     (run_id, company_id, field_group, state, attempts, leased_by, lease_expires_at,
      last_error, created_at, updated_at)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

let i = 0;
for (const c of companies) {
  // A lease eight minutes in the past is the signature of a worker that died.
  const [state, attempts, leasedBy, lease, error] =
    i < done ? ["completed", 1, null, null, null]
    : i < done + leaking ? ["researching", 1, "worker-3", stamp(8 * 60 * 1000), null]
    : i < done + leaking + queued ? ["queued", 0, null, null, null]
    : ["dead_letter", 3, null, null,
       "429 from the vendor on three consecutive attempts; the last was 11 minutes ago"];
  put.run(run.id, c.id, "identity_and_stage", state, attempts, leasedBy, lease, error,
          stamp(40 * 60 * 1000), stamp(9 * 60 * 1000));
  i++;
}

console.log(`seeded a stalled run: ${done} completed, ${leaking} leases expired, ` +
            `${queued} queued, ${abandoned} abandoned, on ${dbPath}`);
console.log("remove it again with --remove");
