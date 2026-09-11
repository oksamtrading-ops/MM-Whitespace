import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod, readPublished } from "../publish/snapshot.ts";
import { recordDecision, undoLast } from "./decide.ts";

/** A company as it arrives on day one: stage blank, properties known. */
function unresearched(over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: "NRTH", exchange: "TSX", name: "Northco Mining Corp.", ordinal: 1,
    market_cap: 5_000_000_000,
    stages: [], stage_evidence: "none", property_evidence: "complete",
    regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] },
    region_provenance: { CANADA: "extract", "LATIN AMERICA": "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada & Abroad",
    ...over,
  } as ParsedCompany;
}

async function committed(over: Partial<ParsedCompany> = {}) {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [unresearched(over)] }, { label: "P1" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  const companyId = (await db.get("select id from companies") as { id: string }).id;
  return { db, periodId, companyId };
}

/** A research finding, as the worker would have persisted it. */
async function finding(db: Sql, periodId: string, companyId: string, fieldKey: string, value: unknown) {
  await db.run(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test', 'test', 'replay')`, periodId);
  const run = await db.get("select id from enrichment_runs order by created_at desc limit 1") as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };
  return (await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, state, model, prompt_version)
     values (?, ?, 1, ?, ?, ?, 0.9, 'exact_normalized', 'proposed', 'test', 'test') returning id`,
    run.id, job.id, companyId, fieldKey, JSON.stringify(value)) as { id: string }).id;
}

const tierOf = async (db: Sql, periodId: string, companyId: string) =>
  await db.get("select tier, status, footprint from tiers where period_id = ? and company_id = ?",
               periodId, companyId) as { tier: number | null; status: string; footprint: string };

const valueOf = async (db: Sql, periodId: string, companyId: string, key: string) =>
  await db.get(`select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, key) as
    { value: string; source: string } | undefined;

test("ACCEPTING RESEARCHED STAGE MOVES THE TIER, which is the whole point of research", async () => {
  const { db, periodId, companyId } = await committed();
  assert.equal((await tierOf(db, periodId, companyId)).status, "unclassified_no_stage_evidence");

  const f = await finding(db, periodId, companyId, "stage_evidence_state",
    { exploration: true, development: true, production: true, royalty_streaming: false });
  await recordDecision(db, { periodId, companyId, fieldKey: "stage_evidence_state",
                             decision: "accept", findingId: f, findingAttempt: 1 });

  const t = await tierOf(db, periodId, companyId);
  assert.equal(t.status, "classified", "a researched company is no longer unclassified");
  assert.notEqual(t.tier, null);
  const stages = await db.all(`select stage from company_period_stages
      where period_id = ? and company_id = ? order by stage`, periodId, companyId) as Array<{ stage: string }>;
  assert.deepEqual(stages.map((s) => s.stage), ["development", "exploration", "production"]);
  assert.equal((await valueOf(db, periodId, companyId, "stage_evidence_state"))!.value, '"complete"');
  assert.equal((await valueOf(db, periodId, companyId, "tier"))!.value, String(t.tier));
  const trace = await db.get("select count(*) n from tier_traces where period_id = ? and company_id = ?",
                             periodId, companyId) as { n: number };
  assert.ok(trace.n > 0, "the new tier carries its rule trace");
});

test("undoing that accept puts the company back exactly as the file had it", async () => {
  const { db, periodId, companyId } = await committed();
  const f = await finding(db, periodId, companyId, "stage_evidence_state",
    { exploration: false, development: false, production: true, royalty_streaming: false });
  await recordDecision(db, { periodId, companyId, fieldKey: "stage_evidence_state",
                             decision: "accept", findingId: f, findingAttempt: 1 });
  assert.equal((await tierOf(db, periodId, companyId)).status, "classified");

  await undoLast(db, periodId, "stage_evidence_state", null);
  assert.equal((await tierOf(db, periodId, companyId)).status, "unclassified_no_stage_evidence");
  const stages = await db.get("select count(*) n from company_period_stages where company_id = ?", companyId) as { n: number };
  assert.equal(stages.n, 0);
  const v = (await valueOf(db, periodId, companyId, "stage_evidence_state"))!;
  assert.equal(v.value, '"none"');
  assert.equal(v.source, "extract");
});

test("undo restores the file's value, not the one that was taken back", async () => {
  const { db, periodId, companyId } = await committed({ website: "https://northco.example" });
  const f = await finding(db, periodId, companyId, "website", "https://northco-mining.example");
  await recordDecision(db, { periodId, companyId, fieldKey: "website", decision: "accept", findingId: f });
  assert.equal((await valueOf(db, periodId, companyId, "website"))!.value, '"https://northco-mining.example"');

  await undoLast(db, periodId, "website", null);
  const v = (await valueOf(db, periodId, companyId, "website"))!;
  assert.equal(v.value, '"https://northco.example"');
  assert.equal(v.source, "extract");
});

test("undo on a field the file never carried leaves it empty", async () => {
  const { db, periodId, companyId } = await committed();
  // head_office_location is in the catalogue and no workbook column fills it.
  const f = await finding(db, periodId, companyId, "head_office_location", "Toronto, Ontario");
  await recordDecision(db, { periodId, companyId, fieldKey: "head_office_location", decision: "accept", findingId: f });
  assert.equal((await valueOf(db, periodId, companyId, "head_office_location"))!.value, '"Toronto, Ontario"');
  await undoLast(db, periodId, "head_office_location", null);
  assert.equal((await valueOf(db, periodId, companyId, "head_office_location"))!.value, "null");
});

test("a flag leaves the value alone: it asks a question, it does not answer one", async () => {
  const { db, periodId, companyId } = await committed();
  const f = await finding(db, periodId, companyId, "head_office_location", "Toronto, Ontario");
  await recordDecision(db, { periodId, companyId, fieldKey: "head_office_location", decision: "accept", findingId: f });
  await recordDecision(db, { periodId, companyId, fieldKey: "head_office_location", decision: "flag",
                             reason: "the AIF says Vancouver" });
  assert.equal((await valueOf(db, periodId, companyId, "head_office_location"))!.value, '"Toronto, Ontario"');
});

test("A DECISION AMENDS A PUBLISHED PERIOD; the published revision itself never moves", async () => {
  const { db, periodId, companyId } = await committed();
  const first = await publishPeriod(db, periodId, { overrideReason: "day-one baseline for the test" });
  const publishedTier = await db.get(`select status from published_period_tiers
      where publication_id = ? and company_id = ?`, first.publicationId, companyId) as { status: string };
  assert.equal(publishedTier.status, "unclassified_no_stage_evidence");

  const f = await finding(db, periodId, companyId, "stage_evidence_state",
    { exploration: true, development: false, production: false, royalty_streaming: false });
  await recordDecision(db, { periodId, companyId, fieldKey: "stage_evidence_state", decision: "accept", findingId: f });

  // The working tables move...
  assert.equal((await tierOf(db, periodId, companyId)).status, "classified");
  // ...revision 1 does not...
  const still = await db.get(`select status from published_period_tiers
      where publication_id = ? and company_id = ?`, first.publicationId, companyId) as { status: string };
  assert.equal(still.status, "unclassified_no_stage_evidence", "a published revision is immutable");
  // ...and revision 2 carries the correction.
  const second = await publishPeriod(db, periodId, {
    overrideReason: "amendment for the test", amendmentReason: "stage researched" });
  assert.equal(second.revision, 2);
  const amended = await db.get(`select status from published_period_tiers
      where publication_id = ? and company_id = ?`, second.publicationId, companyId) as { status: string };
  assert.equal(amended.status, "classified");
  void readPublished;
});

test("an overridden region set re-derives the footprint and the tier", async () => {
  const { db, periodId, companyId } = await committed({ stages: ["production"], stage_evidence: "complete" });
  const before = await tierOf(db, periodId, companyId);
  assert.equal(before.footprint, "canada_and_abroad");
  await recordDecision(db, { periodId, companyId, fieldKey: "property_regions", decision: "override",
                             overrideValue: { CANADA: ["ON", "QC"] } });
  assert.equal((await tierOf(db, periodId, companyId)).footprint, "canada_only");
});
