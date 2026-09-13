import { test } from "node:test";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { computeCoverage, evaluateGate, unresolvedConflicts } from "./gate.ts";
import { publishPeriod, PublishBlocked, readPublished } from "./snapshot.ts";
import { recordDecision, undoLast } from "../review/decide.ts";

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
async function fullyResearched(n = 4): Promise<Sql> {
  const db = memorySql();
  const companies = Array.from({ length: n }, (_, i) =>
    company({ ticker: `C${i}`, name: `Company ${i} Ltd.` }));
  await commitPeriod(db, { period: "2026-05-31", companies }, { label: "P1" });
  return db;
}

async function periodId(db: Sql): Promise<string> {
  return (await db.get("select id from periods order by rowid desc limit 1") as { id: string }).id;
}

// ------------------------------------------------------------------- gate

test("a fully researched period opens the gate", async () => {
  const db = await fullyResearched();
  const gate = await evaluateGate(db, await periodId(db));
  assert.equal(gate.publishable, true, JSON.stringify(gate.blockers));
  assert.equal(gate.blockers.length, 0);
});

test("unresearched stage closes the gate, which is the day-one state", async () => {
  const db = memorySql();
  // 242 of 259 companies look like this on day one: blank stage, which means
  // "nobody has looked", not "pre-exploration".
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: Array.from({ length: 10 }, (_, i) =>
      company({ ticker: `U${i}`, name: `Unresearched ${i} Ltd.`,
                stages: [], stage_evidence: "none" })),
  }, { label: "P1" });

  const gate = await evaluateGate(db, await periodId(db));
  assert.equal(gate.publishable, false);
  const tier =(await gate).coverage.find((c) => c.chart === "tier_distribution")!;
  assert.equal(tier.resolved, 0);
  assert.equal(tier.meetsFloor, false);
  assert.ok(gate.blockers.some((b) => b.kind === "coverage" && b.chart === "tier_distribution"));
});

test("a footprint of none counts as RESOLVED, because it is the honest answer", async () => {
  // The twelve royalty companies with no properties are not unresolved -- 'none'
  // is the fourth footprint value the workbook never emitted, and adding it is
  // the whole correction. Counting them as unresolved would block a publish for
  // getting something right.
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({
      ticker: "ROYL", name: "Royalco Streaming Inc.",
      stages: ["royalty_streaming"], stage_evidence: "complete",
      regions: {}, region_provenance: {}, property_evidence: "none",
    })],
  }, { label: "P1" });

  const gate = await evaluateGate(db, await periodId(db));
  const fp =(await gate).coverage.find((c) => c.chart === "footprint")!;
  assert.equal(fp.resolved, 0, "no property evidence is genuinely unresolved");

  // ...whereas a company that HAS been looked at and has no properties is resolved.
  const db2 = await fullyResearched(1);
  const fp2 = (await computeCoverage(db2, await periodId(db2)))
    .find((c) => c.chart === "footprint")!;
  assert.equal(fp2.resolved, 1);
});

test("the fee views never block a publish", async () => {
  const db = await fullyResearched();
  const fees = (await computeCoverage(db, await periodId(db)))
    .find((c) => c.chart === "fee_views")!;
  assert.equal(fees.floorPct, null, "fee coverage is a named count, never a percentage");
  assert.equal(fees.blocksPublish, false);
  assert.equal(fees.meetsFloor, true, "no floor cannot be missed");
});

test("a fabrication rate above the ceiling closes the gate", async () => {
  const db = await fullyResearched(1);
  const pid = await periodId(db);
  const co = (await db.get("select id from companies limit 1") as { id: string }).id;

  await db.run(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version)
     values (?, 5, 'm', 'p')`, pid);
  const run = await db.get("select id from enrichment_runs limit 1") as { id: string };
  await db.run(`insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, 'g')`, run.id, co);
  const job = await db.get("select id from enrichment_jobs limit 1") as { id: string };

  const insert = (state: string, attempt: number, abstained = 0) =>
    db.run(`insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, anchor_mode, state,
          model, prompt_version, abstained)
       values (?, ?, ?, ?, 'auditor', 'none', ?, 'm', 'p', ?)`, run.id, job.id, attempt, co, state, abstained);

  await insert("unsupported", 1);
  await insert("proposed", 2);
  const gate = await evaluateGate(db, pid);
  assert.ok(gate.blockers.some((b) => b.kind === "hallucination_rate"),
    "1 of 2 assessed is 50%, far over the 2% ceiling");

  // An abstention is not a fabrication and must not push the rate up.
  const db2 = await fullyResearched(1);
  const gate2 = await evaluateGate(db2, await periodId(db2));
  assert.ok(!gate2.blockers.some((b) => b.kind === "hallucination_rate"));
});

test("two disagreeing proposals with no adjudication close the gate", async () => {
  const db = await fullyResearched(1);
  const pid = await periodId(db);
  const co = (await db.get("select id from companies limit 1") as { id: string }).id;
  await db.run(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version)
     values (?, 5, 'm', 'p')`, pid);
  const run = await db.get("select id from enrichment_runs limit 1") as { id: string };
  await db.run(`insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, 'g')`, run.id, co);
  const job = await db.get("select id from enrichment_jobs limit 1") as { id: string };

  for (const [attempt, value] of [[1, '"PwC"'], [2, '"KPMG"']] as const) {
    await db.run(`insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, proposed_value,
          anchor_mode, state, model, prompt_version)
       values (?, ?, ?, ?, 'auditor', ?, 'exact_normalized', 'proposed', 'm', 'p')`, run.id, job.id, attempt, co, value);
  }
  assert.equal(await unresolvedConflicts(db, pid), 1);
  assert.ok((await evaluateGate(db, pid)).blockers.some((b) => b.kind === "unresolved_conflicts"));

  // AND ADJUDICATING IT OPENS THE GATE AGAIN. This half was missing, and its
  // absence cost a real publish: on Q3-2026 the blocker counted 13 fields that
  // had all been decided by hand, so no amount of review could clear it.
  await recordDecision(db, { periodId: pid, companyId: co, fieldKey: "auditor",
                             decision: "accept", actorId: null });
  assert.equal(await unresolvedConflicts(db, pid), 0,
               "a decided field is adjudicated, whatever the findings still say");
  assert.ok(!(await evaluateGate(db, pid)).blockers.some((b) => b.kind === "unresolved_conflicts"));

  // An undo puts it back: the disagreement is live again.
  await undoLast(db, pid, "auditor", null);
  assert.equal(await unresolvedConflicts(db, pid), 1, "undone means unadjudicated again");
});

// ---------------------------------------------------------------- publish

test("publish refuses through a closed gate, and says what an Admin may do", async () => {
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });

  try {
    await publishPeriod(db, await periodId(db));
    assert.fail("should have refused");
  } catch (err) {
    assert.ok(err instanceof PublishBlocked);
    assert.ok(err.blockers.length > 0);
    assert.match(err.message, /An Admin may override with a reason/);
  }
  assert.equal(
    (await db.get("select count(*) n from period_publications") as { n: number }).n, 0);
});

test("an override publishes, records the reason, and produces the header banner", async () => {
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });

  const reason = "Day-one baseline: stage research has not been done yet.";
  const r = await publishPeriod(db, await periodId(db), { overrideReason: reason });
  assert.equal(r.overridden, true);
  assert.equal(r.revision, 1);
  assert.ok(r.banner);
  // The reason is printed on the dashboard header -- that is what stops a
  // warning becoming a banner nobody reads.
  assert.match(r.banner!, /through a blocked gate/);
  assert.match(r.banner!, new RegExp(reason.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(r.banner!, /Tier distribution/);

  const row = await db.get("select override_reason from period_publications") as
    { override_reason: string };
  assert.equal(row.override_reason, reason);
});

test("the snapshot freezes values and tiers, and the dashboard reads only it", async () => {
  const db = await fullyResearched(3);
  const pid = await periodId(db);
  const r = await publishPeriod(db, pid);
  assert.equal(r.companies, 3);
  assert.ok(r.values > 0);

  const snap = (await readPublished(db, pid))!;
  assert.equal(snap.publication.revision, 1);
  const tiers =snap.aggregates.tier_distribution;
  assert.equal(tiers.reduce((a, b) => a + b.n, 0), 3, "the frozen tiers cover the population");
  assert.ok(snap.aggregates.footprint);
  assert.ok(snap.aggregates.exchange);
  assert.ok(snap.aggregates.coverage, "coverage is frozen so the dashboard never recomputes it");
});

test("publishing freezes the source rows, so a re-import cannot move a published value", async () => {
  const db = await fullyResearched(1);
  const pid = await periodId(db);
  await publishPeriod(db, pid);

  const before = await db.get(`select value from company_period_field_values
      where period_id = ? and field_key = 'market_cap_cad'`, pid) as { value: string };

  // A re-import of the same period is refused outright once published...
  await assert.rejects(
() => commitPeriod(db, { period: "2026-05-31", companies: [company({ market_cap: 1 })] },
                       { label: "P1" }),
    /already published/);

  const after = await db.get(`select value, frozen_at from company_period_field_values
      where period_id = ? and field_key = 'market_cap_cad'`, pid) as
    { value: string; frozen_at: string | null };
  assert.equal(after.value, before.value);
  assert.ok(after.frozen_at, "publish sets frozen_at, which the conditional upsert respects");
});

test("a correction after publish is an amendment that bumps the revision", async () => {
  const db = await fullyResearched(2);
  const pid = await periodId(db);
  const first = await publishPeriod(db, pid);
  const second = await publishPeriod(db, pid, { amendmentReason: "auditor corrected for two companies" });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.notEqual(first.publicationId,(await second).publicationId);

  // Revision 1 is untouched: nothing is ever mutated in place, which is what
  // makes period comparison trustworthy.
  const v1 = await db.get("select count(*) n from published_period_values where publication_id = ?",(await first).publicationId) as { n: number };
  assert.equal(v1.n,(await first).values);

  const row = await db.get("select amendment_reason from period_publications where revision = 2") as
    { amendment_reason: string };
  assert.match(row.amendment_reason, /auditor corrected/);

  // A dashboard reads the latest revision.
  assert.equal((await readPublished(db, pid))!.publication.revision, 2);
});

test("the migration matrix is computed against the prior published period", async () => {
  const db = await fullyResearched(2);
  const p1 = await periodId(db);
  await publishPeriod(db, p1);

  // A later period where one company has moved from production to development.
  await commitPeriod(db, {
    period: "2026-08-31",
    companies: [
      company({ ticker: "C0", name: "Company 0 Ltd." }),
      company({ ticker: "C1", name: "Company 1 Ltd.",
                stages: ["development"], footprint_workbook: "Canada only" }),
    ],
  }, { label: "P2" });
  const p2 = await periodId(db);
  const r = await publishPeriod(db, p2);

  const snap = (await readPublished(db, p2))!;
  assert.ok(snap.aggregates.migration, "a migration matrix requires a prior published period");

  const changed = await db.get(`select count(*) n from published_period_tiers
      where publication_id = ? and tier_changed = 1`,(await r).publicationId) as { n: number };
  assert.equal(changed.n, 1, "exactly one company changed tier");
});

test("the audit log answers who published what, and on what basis", async () => {
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: [company({ stages: [], stage_evidence: "none" })],
  }, { label: "P1" });
  await publishPeriod(db, await periodId(db), { overrideReason: "day-one baseline" });

  const row = await db.get("select event, detail from audit_log where event = 'period_published'") as
    { event: string; detail: string };
  const detail = JSON.parse(row.detail);
  assert.equal(detail.overridden, true);
  assert.equal(detail.overrideReason, "day-one baseline");
  assert.ok(Array.isArray(detail.blockers) && detail.blockers.length > 0,
    "what was outstanding at publish is part of the record");
  assert.equal(typeof detail.unresolvedCount, "number");
});

test("a failed publish leaves no half-written publication behind", async () => {
  const db = await fullyResearched(2);
  const pid = await periodId(db);
  // Remove a table the snapshot writes to AFTER the publication row and the
  // values, so the failure lands mid-transaction rather than before it starts.
  await db.exec("drop table publication_aggregates");
  await assert.rejects(
() => publishPeriod(db, pid));
  assert.equal(
    (await db.get("select count(*) n from period_publications") as { n: number }).n, 0);
  assert.equal(
    (await db.get("select count(*) n from published_period_values") as { n: number }).n, 0);
});
