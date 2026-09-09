/**
 * Seed a company that is really an earlier name of another one.
 *
 * The real workbook is a single period, so no rename has happened in it yet
 * and there is nothing for the merge screen to find. This fabricates the case
 * the screen exists for: a prior period in which one of the population went by
 * a different name.
 *
 *   node scripts/seed_duplicate.mjs ./period.db
 *   node scripts/seed_duplicate.mjs ./period.db --remove
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, ...rest] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/seed_duplicate.mjs <db> [--remove]");
  process.exit(2);
}
const db = new DatabaseSync(dbPath);
db.exec("pragma foreign_keys = on");

const MARK = "merge-demo";
const OLD_NAME = "Northcliff Exploration Corp.";
const OLD_NORM = "northcliff exploration corp";

if (rest.includes("--remove")) {
  const co = db.prepare("select id from companies where name_normalized = ?").get(OLD_NORM);
  if (co) {
    for (const t of ["company_period_facts", "company_period_field_values", "tiers",
                     "tier_traces", "company_identifiers", "company_aliases"]) {
      db.prepare(`delete from ${t} where company_id = ?`).run(co.id);
    }
    db.prepare("delete from company_aliases where name_normalized = ?").run(OLD_NORM);
    db.prepare("delete from companies where id = ?").run(co.id);
  }
  const period = db.prepare("select id from periods where label like ?").get(`%${MARK}%`);
  if (period) {
    db.prepare("delete from company_period_facts where period_id = ?").run(period.id);
    db.prepare("delete from periods where id = ?").run(period.id);
  }
  console.log("removed the seeded duplicate");
  process.exit(0);
}

// The company it is really an earlier name of: one that carries an identifier,
// so the pair is found on evidence rather than on a resemblance.
const target = db.prepare(
  `select c.id, c.canonical_name, i.scheme, i.value
     from companies c join company_identifiers i on i.company_id = c.id
    where c.status = 'active' order by c.canonical_name limit 1`).get();
if (!target) { console.error("no company carries an identifier"); process.exit(1); }

db.prepare(
  `insert into periods (label, market_cap_as_of, rule_set_version)
   values (?, '2026-02-28', '1.0.0')`).run(`Q2-2026 (${MARK})`);
const prior = db.prepare("select id from periods where label = ?").get(`Q2-2026 (${MARK})`);

db.prepare(
  `insert into companies (canonical_name, name_normalized, first_seen_period_id)
   values (?, ?, ?)`).run(OLD_NAME, OLD_NORM, prior.id);
const oldCo = db.prepare("select id from companies where name_normalized = ?").get(OLD_NORM);

db.prepare(
  `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
   values (?, ?, 'company_name', ?, ?, 'asserted')`,
).run(prior.id, oldCo.id, OLD_NAME, JSON.stringify(OLD_NAME));
db.prepare(
  `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
   values (?, ?, 'auditor', 'KPMG', '"KPMG"', 'asserted')`).run(prior.id, oldCo.id);

// The same identifier, an interval earlier: what makes this evidence.
db.prepare(
  `insert into company_identifiers (company_id, scheme, value, valid_from, valid_to, source)
   values (?, ?, ?, '2025-11-30', '2026-02-28', 'extract')`,
).run(oldCo.id, target.scheme, target.value);

console.log(`seeded “${OLD_NAME}” as an earlier name of “${target.canonical_name}”`);
console.log(`  they share ${target.scheme} ${target.value}`);
console.log("remove it again with --remove");
