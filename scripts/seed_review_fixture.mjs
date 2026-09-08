/**
 * Seed a SYNTHETIC review queue.
 *
 * DEVELOPMENT ONLY. These are not model outputs -- no request has ever been
 * sent to the vendor from this build. They exist so the review grid can be
 * driven, the way the cassettes exist so the pipeline can be. Every finding is
 * written with prompt_version "synthetic-fixture" so it is distinguishable from
 * a real proposal at a glance and in a query.
 *
 *   node scripts/seed_review_fixture.mjs ./period.db
 */
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/seed_review_fixture.mjs <period.db>");
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
db.exec("pragma foreign_keys = on");

const period = db.prepare(
  "select id, label from periods order by market_cap_as_of desc limit 1").get();
if (!period) { console.error("no period committed"); process.exit(1); }

db.prepare(
  `delete from enrichment_findings where prompt_version = 'synthetic-fixture'`).run();
db.prepare(
  `insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode, status)
   values (?, 25, 'synthetic', 'synthetic-fixture', 'replay', 'completed')`).run(period.id);
const run = db.prepare(
  "select id from enrichment_runs order by rowid desc limit 1").get();

const companies = db.prepare(
  "select id, canonical_name from companies order by canonical_name").all();

const AUDITORS = ["Deloitte", "PwC", "KPMG", "Ernst & Young", "BDO", "Grant Thornton"];
const STAGES = [
  { exploration: true, development: false, production: false, royalty_streaming: false },
  { exploration: false, development: true, production: false, royalty_streaming: false },
  { exploration: false, development: false, production: true, royalty_streaming: false },
  { exploration: true, development: true, production: false, royalty_streaming: false },
];

const insJob = db.prepare(
  "insert into enrichment_jobs (run_id, company_id, field_group, state) values (?, ?, ?, 'completed')");
const insFinding = db.prepare(
  `insert into enrichment_findings
     (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
      evidence_version, model_self_confidence, anchor_mode, anchor_document_hash,
      evidence_excerpt, abstained, abstention_reason, state, model, prompt_version)
   values (?, ?, 1, ?, ?, ?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, ?, 'synthetic', 'synthetic-fixture')`);
const insSource = db.prepare(
  `insert into finding_sources (finding_id, url, title, source_tier) values (?, ?, ?, ?)`);

// Findings reference this by hash, so it must exist before them.
db.prepare(
  `insert into documents (content_hash, url, extractor, extractor_version,
                          normalization_version, text_content, source_tier, has_text_layer)
   values ('sha256:synthetic', 'https://issuer.invalid/doc.html', 'fixture', '1.0.0',
           '1.0.0', 'synthetic document text', 1, 1)
   on conflict (content_hash) do nothing`).run();

let made = 0;
const shape = (i) => {
  // A deliberate spread, so every queue bucket and every bulk-accept refusal is
  // reachable in the interface rather than only in the tests.
  if (i % 17 === 0) return { kind: "quarantined", anchor: "label_only", state: "anchor_mismatch", strength: 0.55, sources: 1 };
  if (i % 13 === 0) return { kind: "no_sources", anchor: "none", state: "unsupported", strength: 0.41, sources: 0 };
  if (i % 11 === 0) return { kind: "abstained", anchor: "none", state: "abstained", strength: 0.40, sources: 1 };
  if (i % 7 === 0) return { kind: "conflict", anchor: "exact_normalized", state: "proposed", strength: 0.88, sources: 2 };
  if (i % 3 === 0) return { kind: "weak", anchor: "proximity", state: "proposed", strength: 0.52, sources: 1 };
  return { kind: "strong", anchor: "exact_normalized", state: "proposed", strength: 0.86 + (i % 9) / 100, sources: 2 };
};

for (const [i, company] of companies.entries()) {
  for (const field of ["auditor", "stage_evidence_state"]) {
    const s = shape(i + (field === "auditor" ? 0 : 5));
    insJob.run(run.id, company.id, field);
    const job = db.prepare("select id from enrichment_jobs order by rowid desc limit 1").get();

    const abstained = s.kind === "abstained";
    let value = null;
    if (!abstained) {
      value = field === "auditor"
        ? JSON.stringify(AUDITORS[i % AUDITORS.length])
        : JSON.stringify(STAGES[i % STAGES.length]);
    }
    // The conflict case proposes an auditor the extract disagrees with.
    if (s.kind === "conflict" && field === "auditor") {
      value = JSON.stringify(AUDITORS[(i + 1) % AUDITORS.length]);
    }

    insFinding.run(
      run.id, job.id, company.id, field, value,
      Math.min(0.99, s.strength),
      Math.min(0.99, s.strength + 0.08),
      s.anchor,
      s.anchor === "none" ? null : "sha256:synthetic",
      abstained ? null
        : field === "auditor"
          ? "…the auditor of the Company is a firm of chartered professional accountants…"
          : "…commenced commercial production during the year under review…",
      abstained ? 1 : 0,
      abstained ? "the document does not disclose this" : null,
      s.state);
    const finding = db.prepare(
      "select id from enrichment_findings order by rowid desc limit 1").get();
    for (let n = 0; n < s.sources; n++) {
      insSource.run(finding.id, `https://issuer-${i}.invalid/doc-${n}.html`,
                    "Synthetic source", 1 + n);
    }
    made++;
  }
}

console.log(`seeded ${made} SYNTHETIC findings across ${companies.length} companies`);
console.log(`  period: ${period.label}`);
console.log("  these are not model outputs; prompt_version = 'synthetic-fixture'");
db.close();
