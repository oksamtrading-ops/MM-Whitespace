import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { computeCoverage, evaluateGate, unresolvedConflicts } from "./gate.ts";
import { publishPeriod, PublishBlocked, readPublished } from "./snapshot.ts";

function company(over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: "NRTH", exchange: "TSX", name: "Northco Mining Corp.", ordinal: 1,
    market_cap: 5_000_000_000,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] },
    region_provenance: { CANADA: "extract", "LATIN AMERICA": "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: "Deloitte", auditor_class: "big4", entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada & Abroad",
    ...over,
  };
}

/** A period where every company is fully researched, so the gate opens. */
function fullyResearched(n = 4): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const companies = Array.from({ length: n }, (_, i) =>
    company({ ticker: `C${i}`, name: `Company ${i} Ltd.` }));
  commitPeriod(db, { period: "2026-05-31", companies }, { label: "P1" });
  return db;
}

function periodId(db: DatabaseSync): string {
  return (db.prepare("select id from periods order by rowid desc limit 1")
    .get() as { id: string }).id;
}

// ------------------------------------------------------------------- gate

test("a fully researched period opens the gate", () => {
  const db = fullyResearched();
  const gate = evaluateGate(db, periodId(db));
  assert.equal(gate.publishable, true, JSON.stringify(gate.blockers));
  assert.equal(gate.blockers.length, 0);
});

test("unresearched stage closes the gate, which is the day-one state", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  // 242 of 259 companies look like this on day one: blank stage, which means
  // "nobody has looked", not "pre-exploration".
  commitPeriod(db, {
    period: "2026-05-31",
    companies: Array.from({ length: 10 }, (_, i) =>
      company({ ticker: `U${i}`, name: `Unresearched ${i} Ltd.`,
                stages: [], stage_evidence: "none" })),
  }, { label: "P1" });

  const gate = evaluateGate(db, periodId(db));
  assert.equal(gate.publishable, false);
  const tier = gate.coverage.find((c) => c.chart === "tier_distribution")!;
  assert.equal(tier.resolved, 0);
  assert.equal(tier.meetsFloor, false);
  assert.ok(gate.blockers.some((b) => b.kind === "coverage" && b.chart === "tier_distribution"));
});

test("a footprint of none counts as RESOLVED, because it is the honest answer", () => {
  // The twelve royalty companies with no properties are not unresolved -- 'none'
  // is the fourth footprint value the workbook never emitted, and adding it is
  // the whole correction. Counting them as unresolved would block a publish for
  // getting something right.
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({
      ticker: "ROYL", name: "Royalco Streaming Inc.",
      stages: ["royalty_streaming"], stage_evidence: "complete",
      regions: {}, region_provenance: {}, property_evidence: "none",
    })],
  }, { label: "P1" });

  const gate = evaluateGate(db, periodId(db));
  const fp = gate.coverage.find((c) => c.chart === "footprint")!;
  assert.equal(fp.resolved, 0, "no property evidence is genuinely unresolved");

  // ...whereas a company that HAS been looked at and has no properties is resolved.
  const db2 = fullyResearched(1);
  const fp2 = computeCoverage(db2, periodId(db2)).find((c) => c.chart === "footprint")!;
  assert.equal(fp2.resolved, 1);
});

test("the fee views never block a publish", () => {
  const db = fullyResearched();
  const fees = computeCoverage(db, periodId(db)).find((c) => c.chart === "fee_views")!;
  assert.equal(fees.floorPct, null, "fee coverage is a named count, never a percentage");
  assert.equal(fees.blocksPublish, false);
  assert.equal(fees.meetsFloor, true, "no floor cannot be missed");
});

test("a fabrication rate above the ceiling closes the gate", () => {
  const db = fullyResearched(1);
  const pid = periodId(db);
  const co = (db.prepare("select id from companies limit 1").get() as { id: string }).id;

  db.prepare(
    `insert into enrichment_runs (period_id, budget_usd, model, prompt_version)
     values (?, 5, 'm', 'p')`).run(pid);
  const run = db.prepare("select id from enrichment_runs limit 1").get() as { id: string };
  db.prepare(
    `insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, 'g')`,
  ).run(run.id, co);
  const job = db.prepare("select id from enrichment_jobs limit 1").get() as { id: string };

  const insert = (state: string, attempt: number, abstained = 0) =>
    db.prepare(
      `insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, anchor_mode, state,
          model, prompt_version, abstained)
       values (?, ?, ?, ?, 'auditor', 'none', ?, 'm', 'p', ?)`,
    ).run(run.id, job.id, attempt, co, state, abstained);

  insert("unsupported", 1);
  insert("proposed", 2);
  const gate = evaluateGate(db, pid);
  assert.ok(gate.blockers.some((b) => b.kind === "hallucination_rate"),
    "1 of 2 assessed is 50%, far over the 2% ceiling");

  // An abstention is not a fabrication and must not push the rate up.
  const db2 = fullyResearched(1);
  const gate2 = evaluateGate(db2, periodId(db2));
  assert.ok(!gate2.blockers.some((b) => b.kind === "hallucination_rate"));
});

test("two disagreeing proposals with no adjudication close the gate", () => {
  const db = fullyResearched(1);
  const pid = periodId(db);
  const co = (db.prepare("select id from companies limit 1").get() as { id: string }).id;
  db.prepare(
    `insert into enrichment_runs (period_id, budget_usd, model, prompt_version)
     values (?, 5, 'm', 'p')`).run(pid);
  const run = db.prepare("select id from enrichment_runs limit 1").get() as { id: string };
  db.prepare(`insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, 'g')`)
    .run(run.id, co);
  const job = db.prepare("select id from enrichment_jobs limit 1").get() as { id: string };

  for (const [attempt, value] of [[1, '"PwC"'], [2, '"KPMG"']] as const) {
    db.prepare(
      `insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, proposed_value,
          anchor_mode, state, model, prompt_version)
       values (?, ?, ?, ?, 'auditor', ?, 'exact_normalized', 'proposed', 'm', 'p')`,
    ).run(run.id, job.id, attempt, co, value);
  }
  assert.equal(unresolvedConflicts(db, pid), 1);
  assert.ok(evaluateGate(db, pid).blockers.some((b) => b.kind === "unresolved_conflicts"));
});

// ---------------------------------------------------------------- publish

test("publish refuses through a closed gate, and says what an Admin may do", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });

  try {
    publishPeriod(db, periodId(db));
    assert.fail("should have refused");
  } catch (err) {
    assert.ok(err instanceof PublishBlocked);
    assert.ok(err.blockers.length > 0);
    assert.match(err.message, /An Admin may override with a reason/);
  }
  assert.equal(
    (db.prepare("select count(*) n from period_publications").get() as { n: number }).n, 0);
});

test("an override publishes, records the reason, and produces the header banner", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });

  const reason = "Day-one baseline: stage research has not been done yet.";
  const r = publishPeriod(db, periodId(db), { overrideReason: reason });
  assert.equal(r.overridden, true);
  assert.equal(r.revision, 1);
  assert.ok(r.banner);
  // The reason is printed on the dashboard header -- that is what stops a
  // warning becoming a banner nobody reads.
  assert.match(r.banner!, /through a blocked gate/);
  assert.match(r.banner!, new RegExp(reason.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(r.banner!, /Tier distribution/);

  const row = db.prepare("select override_reason from period_publications").get() as
    { override_reason: string };
  assert.equal(row.override_reason, reason);
});

test("the snapshot freezes values and tiers, and the dashboard reads only it", () => {
  const db = fullyResearched(3);
  const pid = periodId(db);
  const r = publishPeriod(db, pid);
  assert.equal(r.companies, 3);
  assert.ok(r.values > 0);

  const snap = readPublished(db, pid)!;
  assert.equal(snap.publication.revision, 1);
  const tiers = snap.aggregates.tier_distribution;
  assert.equal(tiers.reduce((a, b) => a + b.n, 0), 3, "the frozen tiers cover the population");
  assert.ok(snap.aggregates.footprint);
  assert.ok(snap.aggregates.exchange);
  assert.ok(snap.aggregates.coverage, "coverage is frozen so the dashboard never recomputes it");
});

test("publishing freezes the source rows, so a re-import cannot move a published value", () => {
  const db = fullyResearched(1);
  const pid = periodId(db);
  publishPeriod(db, pid);

  const before = db.prepare(
    `select value from company_period_field_values
      where period_id = ? and field_key = 'market_cap_cad'`).get(pid) as { value: string };

  // A re-import of the same period is refused outright once published...
  assert.throws(
    () => commitPeriod(db, { period: "2026-05-31", companies: [company({ market_cap: 1 })] },
                       { label: "P1" }),
    /already published/);

  const after = db.prepare(
    `select value, frozen_at from company_period_field_values
      where period_id = ? and field_key = 'market_cap_cad'`).get(pid) as
    { value: string; frozen_at: string | null };
  assert.equal(after.value, before.value);
  assert.ok(after.frozen_at, "publish sets frozen_at, which the conditional upsert respects");
});

test("a correction after publish is an amendment that bumps the revision", () => {
  const db = fullyResearched(2);
  const pid = periodId(db);
  const first = publishPeriod(db, pid);
  const second = publishPeriod(db, pid, { amendmentReason: "auditor corrected for two companies" });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.notEqual(first.publicationId, second.publicationId);

  // Revision 1 is untouched: nothing is ever mutated in place, which is what
  // makes period comparison trustworthy.
  const v1 = db.prepare(
    "select count(*) n from published_period_values where publication_id = ?")
    .get(first.publicationId) as { n: number };
  assert.equal(v1.n, first.values);

  const row = db.prepare(
    "select amendment_reason from period_publications where revision = 2").get() as
    { amendment_reason: string };
  assert.match(row.amendment_reason, /auditor corrected/);

  // A dashboard reads the latest revision.
  assert.equal(readPublished(db, pid)!.publication.revision, 2);
});

test("the migration matrix is computed against the prior published period", () => {
  const db = fullyResearched(2);
  const p1 = periodId(db);
  publishPeriod(db, p1);

  // A later period where one company has moved from production to development.
  commitPeriod(db, {
    period: "2026-08-31",
    companies: [
      company({ ticker: "C0", name: "Company 0 Ltd." }),
      company({ ticker: "C1", name: "Company 1 Ltd.",
                stages: ["development"], footprint_workbook: "Canada only" }),
    ],
  }, { label: "P2" });
  const p2 = periodId(db);
  const r = publishPeriod(db, p2);

  const snap = readPublished(db, p2)!;
  assert.ok(snap.aggregates.migration, "a migration matrix requires a prior published period");

  const changed = db.prepare(
    `select count(*) n from published_period_tiers
      where publication_id = ? and tier_changed = 1`).get(r.publicationId) as { n: number };
  assert.equal(changed.n, 1, "exactly one company changed tier");
});

test("the audit log answers who published what, and on what basis", () => {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });
  publishPeriod(db, periodId(db), { overrideReason: "day-one baseline" });

  const row = db.prepare(
    "select event, detail from audit_log where event = 'period_published'").get() as
    { event: string; detail: string };
  const detail = JSON.parse(row.detail);
  assert.equal(detail.overridden, true);
  assert.equal(detail.overrideReason, "day-one baseline");
  assert.ok(Array.isArray(detail.blockers) && detail.blockers.length > 0,
    "what was outstanding at publish is part of the record");
  assert.equal(typeof detail.unresolvedCount, "number");
});

test("a failed publish leaves no half-written publication behind", () => {
  const db = fullyResearched(2);
  const pid = periodId(db);
  // Remove a table the snapshot writes to AFTER the publication row and the
  // values, so the failure lands mid-transaction rather than before it starts.
  db.exec("drop table publication_aggregates");
  assert.throws(() => publishPeriod(db, pid));
  assert.equal(
    (db.prepare("select count(*) n from period_publications").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("select count(*) n from published_period_values").get() as { n: number }).n, 0);
});
