/**
 * Research one company end to end, in replay mode.
 *
 *   node scripts/research.mjs                 # the fixture companies
 *   node scripts/research.mjs "Northco Mining Corp."
 *
 * Nothing is sent anywhere. Live mode is disabled in this build pending the
 * risk and legal review under decision 1; the recordings in tests/cassettes/
 * are synthesised, not captured vendor responses.
 */
import { budgetState } from "../src/lib/enrich/ledger.ts";
import { createRun, researchOneCompany } from "../src/lib/enrich/worker.ts";
import {
  seedFixtureDatabase, PERIOD_AS_OF, CASSETTE_DIR,
} from "../tests/cassettes/build_cassettes.mjs";

const want = process.argv[2];
const { db, periodId, companies } = seedFixtureDatabase();
const targets = want ? companies.filter((c) => c.name === want) : companies;

if (targets.length === 0) {
  console.error(`no such company: ${want}`);
  console.error(`available: ${companies.map((c) => c.name).join(", ")}`);
  process.exit(2);
}

const pad = (s, n) => String(s).padEnd(n);
const STATE_MARK = {
  proposed: "ok  ", abstained: "abst", anchor_mismatch: "HELD", unsupported: "REJ ",
  no_text_layer: "SCAN", source_unreachable: "UNRE",
};

for (const company of targets) {
  console.log(`\n${company.name}  (${company.ticker})`);
  console.log("-".repeat(74));

  const { runId, jobIds } = await createRun(db, periodId, [company.id], {
    cassetteDir: CASSETTE_DIR, budgetUsd: 5, mode: "replay",
  });

  const before = db.handle.prepare("select state from enrichment_jobs where id = ?").get(jobIds[0]);
  process.stdout.write(`  ledger: ${before.state}`);

  const outcome = await researchOneCompany(db, runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });
  console.log(` -> claimed -> researching -> persisting -> ${outcome.jobState}`);

  const raw = db.handle.prepare(
    "select count(*) n from enrichment_job_results where job_id = ?").get(outcome.jobId);
  console.log(`  raw responses stored before any finding was derived: ${raw.n}`);

  console.log("");
  console.log(`  ${pad("field", 27)}${pad("state", 19)}${pad("anchor", 18)}${pad("evid", 7)}bulk`);
  const rows = db.handle.prepare(
    `select field_key, state, anchor_mode, evidence_strength, model_self_confidence,
            abstained, anchor_document_hash
       from enrichment_findings where run_id = ? order by field_key`).all(runId);

  for (const r of rows) {
    const bulk = r.state === "proposed" && r.anchor_mode !== "label_only" ? "yes" : "no";
    const mark = STATE_MARK[r.state] ?? "?   ";
    console.log(
      `  ${mark} ${pad(r.field_key, 22)}${pad(r.state, 19)}` +
      `${pad(r.anchor_mode, 18)}${pad(Number(r.evidence_strength).toFixed(3), 7)}${bulk}`);
  }

  const held = rows.filter((r) => r.state !== "proposed" && r.state !== "abstained");
  if (held.length) {
    console.log("");
    for (const r of held) {
      console.log(`  ${r.field_key}: ${r.state} -- quarantined, never bulk-acceptable.`);
      console.log(`     self-reported confidence was ${Number(r.model_self_confidence).toFixed(2)},`);
      console.log(`     evidence strength ${Number(r.evidence_strength).toFixed(3)}. The threshold reads the second.`);
    }
  }

  const b = await budgetState(db, runId);
  console.log(`\n  spend $${b.spend.toFixed(3)} of $${b.budget.toFixed(2)} budget` +
              `${b.warn ? "  (WARN >=80%)" : ""}`);
}

console.log("\nNo request was sent. Replay mode reads tests/cassettes/ only.\n");
await db.close();
