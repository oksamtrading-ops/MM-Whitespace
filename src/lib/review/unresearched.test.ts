import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { parseFieldInput } from "../format/fields.ts";
import { citationsForPeriod, citeKey } from "../profile/citations.ts";
import { recordDecision, researched, unresearchedOverrideRefusal } from "./decide.ts";
import { fieldRows, unresearched } from "./queue.ts";

const STAGE = "stage_evidence_state";

function company(ticker: string, name: string, ordinal: number): ParsedCompany {
  return {
    ticker, exchange: "TSX", name, ordinal,
    market_cap: 500_000_000,
    stages: [], stage_evidence: "none", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: null, footprint_workbook: "Canada only",
  } as ParsedCompany;
}

/** Two companies; research reached Northco's stage and never reached Southco's. */
async function period() {
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-08-31",
    companies: [company("NRTH", "Northco Mining Corp.", 1), company("STHC", "Southco Gold Corp.", 2)],
  }, { label: "Q4-2026" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  const id = async (ticker: string) => (await db.get(`select company_id from company_identifiers
      where scheme = 'root_ticker' and value = ?`, ticker) as { company_id: string }).company_id;
  const north = await id("NRTH"), south = await id("STHC");

  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test-model', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, north) as { id: string };
  const finding = (await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, evidence_excerpt, state, model, prompt_version)
     values (?, ?, 1, ?, ?, ?, 0.85, 'exact_normalized', 'The Company is in the exploration stage.',
             'proposed', 'test-model', 'test') returning id`,
    run.id, job.id, north, STAGE,
    JSON.stringify({ exploration: true, development: null, production: false, royalty_streaming: null }),
  ) as { id: string }).id;
  return { db, periodId, north, south, finding };
}

test("Q4 2026: a company research never reached is listed, with nothing recorded", async () => {
  const { db, periodId, north, south } = await period();
  const rows = await fieldRows(db, periodId, STAGE, "all");
  assert.deepEqual(rows.map((r) => r.companyId), [north], "rows are findings");

  const list = await unresearched(db, periodId, STAGE, rows);
  assert.deepEqual(list, [{ companyId: south, companyName: "Southco Gold Corp.", decided: null, sourceUrl: null }]);
});

test("Q4 2026: its override must name a public page, and that page is its citation", async () => {
  const { db, periodId, north, south } = await period();
  const refused = await unresearchedOverrideRefusal(db, { periodId, companyId: south, fieldKey: STAGE, reason: null });
  assert.match(refused ?? "", /public page/, "nothing stands behind a value research never saw");
  assert.equal(await unresearchedOverrideRefusal(db, { periodId, companyId: south, fieldKey: STAGE,
                                                       reason: "I read it somewhere" }), refused?.toString(),
               "a reason with no address is no source");
  assert.equal(await unresearchedOverrideRefusal(db, { periodId, companyId: north, fieldKey: STAGE, reason: null }),
               null, "where research reached the company, the finding stands behind the override");

  const source = "Public source: https://southco.example/aif-2025.pdf";
  assert.equal(await unresearchedOverrideRefusal(db, { periodId, companyId: south, fieldKey: STAGE, reason: source }),
               null);
  const parsed = parseFieldInput(STAGE, "production + exploration");
  assert.ok(parsed.ok);
  await recordDecision(db, { periodId, companyId: south, fieldKey: STAGE, decision: "override",
                             overrideValue: parsed.value, reason: source });

  const value = await db.get(`select value from company_period_field_values
      where period_id = ? and company_id = ? and field_key = ?`, periodId, south, STAGE) as { value: string };
  assert.notEqual(value.value, '"none"', "stage evidence now exists, which is what the publish floor counts");
  const tier = await db.get("select tier from tiers where period_id = ? and company_id = ?", periodId, south) as
    { tier: number | null };
  assert.equal(tier.tier, 2, "a producer in Canada only: the classifier ran on the override");

  const [listed] = await unresearched(db, periodId, STAGE, await fieldRows(db, periodId, STAGE, "all"));
  assert.equal(listed.companyId, south, "still unresearched: an override is not a finding");
  assert.match(listed.decided ?? "", /production/i);
  assert.equal(listed.sourceUrl, "https://southco.example/aif-2025.pdf");

  const c = (await citationsForPeriod(db, periodId)).get(citeKey(south, STAGE))!;
  assert.equal(c.citation.kind, "review");
  assert.equal(c.citation.kind === "review" && c.citation.url, "https://southco.example/aif-2025.pdf");
});

test("Q4 2026: a field no run researched lists every company, and a sourced region override retiers", async () => {
  const { db, periodId, south } = await period();
  const REGIONS = "property_regions";
  const rows = await fieldRows(db, periodId, REGIONS, "all");
  assert.equal(rows.length, 0, "no finding for this field at all");
  assert.equal((await unresearched(db, periodId, REGIONS, rows)).length, 2, "both companies can still be reached");

  // Discovery: a producer whose workbook regions held only its abroad project.
  const source = "Public source: https://southco.example/q2-2026-results.pdf";
  const stage = parseFieldInput(STAGE, "production + exploration");
  assert.ok(stage.ok);
  await recordDecision(db, { periodId, companyId: south, fieldKey: STAGE, decision: "override",
                             overrideValue: stage.value, reason: source });
  const abroad = parseFieldInput(REGIONS, "Latin America: Mexico");
  assert.ok(abroad.ok);
  await recordDecision(db, { periodId, companyId: south, fieldKey: REGIONS, decision: "override",
                             overrideValue: abroad.value, reason: source });
  const tier = async () => await db.get("select tier, footprint from tiers where period_id = ? and company_id = ?",
                                        periodId, south) as { tier: number | null; footprint: string };
  assert.equal((await tier()).tier, 3, "production abroad only");

  assert.match(await unresearchedOverrideRefusal(db, { periodId, companyId: south, fieldKey: REGIONS, reason: null }) ?? "",
               /public page/);
  const both = parseFieldInput(REGIONS, "Canada: ON · Latin America: Mexico");
  assert.ok(both.ok);
  await recordDecision(db, { periodId, companyId: south, fieldKey: REGIONS, decision: "override",
                             overrideValue: both.value, reason: source });
  assert.deepEqual(await tier(), { tier: 1, footprint: "canada_and_abroad" });
});

test("Q4 2026: a superseded finding is not research that reached the company", async () => {
  const { db, periodId, north, finding } = await period();
  assert.equal(await researched(db, periodId, north, STAGE), true);
  await db.run("update enrichment_findings set state = 'superseded' where id = ?", finding);
  assert.equal(await researched(db, periodId, north, STAGE), false, "the review screens no longer show it");
});
