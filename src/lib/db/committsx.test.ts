import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "./open.ts";
import type { Sql } from "./sql.ts";
import { commitPeriod, type ParsedCompany } from "./commit.ts";
import { commitTsxPeriod } from "./committsx.ts";
import { baseLeftovers, loadTsxPlan, type TsxIssuer } from "../ingest/tsx.ts";
import { publishPeriod } from "../publish/snapshot.ts";
import { recordDecision, undoLast } from "../review/decide.ts";
import { citationsForPeriod } from "../profile/citations.ts";
import { listCompanies, readCompanyProfile } from "../profile/company.ts";

const Q3 = "Q3-2026 (2026-05-31)";
const Q4 = "Q4-2026 (2026-08-31)";

/** The workbook's period: six companies, as the synthetic workbook has them. */
function workbook(ticker: string, exchange: string, name: string, market_cap: number,
                  over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker, exchange, name, ordinal: 1, market_cap,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false, auditor: "KPMG LLP", auditor_class: "big4",
    entity_id: null, website: `https://${ticker.toLowerCase()}.example.com`,
    dtt_market: "Ontario", head_office_region: "Ontario, Canada",
    tier_workbook: null, footprint_workbook: null, ...over,
  } as ParsedCompany;
}

const issuer = (ticker: string, exchange: string, name: string, market_cap: number,
                over: Partial<TsxIssuer> = {}): TsxIssuer => ({
  ticker, exchange, name, market_cap, regions: { CANADA: ["ON"] }, commodities: ["Gold"],
  venture_graduate: false, head_office_region: "Ontario, Canada", ...over,
});

const list = (period: string, companies: TsxIssuer[]) => ({
  kind: "tsx_list" as const, period, companies,
  report: { blocking: [], warnings: [], info: [], proofs: {}, totals: {} },
});

const AUGUST = list("2026-08-31", [
  issuer("NRTH", "TSX", "Northco Mining Corp.", 5.4e9,
         { regions: { CANADA: ["ON", "QC"], "LATIN AMERICA": ["Peru"] }, commodities: ["Gold", "Copper"] }),
  issuer("SOCO", "TSX", "Southco Resources Ltd.", 3.1e9, { regions: { CANADA: ["BC"] } }),
  issuer("ROYL", "TSX", "Royalco Streaming Inc.", 8.1e9, { regions: {}, head_office_region: "British Columbia, Canada" }),
  issuer("CARY", "TSX", "Carryco Minerals Inc.", 5.2e8, { regions: { CANADA: ["NT"] } }),
  issuer("NEWC", "TSX", "Newco Copper Corp.", 6.5e8,
         { regions: { CANADA: ["BC"] }, head_office_region: "British Columbia, Canada", commodities: ["Copper"] }),
  issuer("EDGE", "TSXV", "Edgeco Metals Inc.", 2.03e8, { regions: { CANADA: ["MB"] }, head_office_region: "Manitoba, Canada" }),
  issuer("DEVL", "TSXV", "Devco Development Ltd.", 1.5e8, { regions: { CANADA: ["SK"] } }),
  issuer("WSTC", "TSX", "Westco Gold Ltd.", 1.9e8, { regions: { USA: ["NV"] } }),
]);

async function finding(db: Sql, periodId: string, companyId: string, fieldKey: string, value: unknown) {
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };
  const id = (await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, evidence_excerpt, state, model, prompt_version)
     values (?, ?, 1, ?, ?, ?, 0.9, 'exact_normalized', ?, 'proposed', 'test', 'test') returning id`,
    run.id, job.id, companyId, fieldKey, JSON.stringify(value), `the passage that says ${JSON.stringify(value)}`) as
    { id: string }).id;
  await db.run(`insert into finding_sources (finding_id, url, title, doc_type, source_tier)
      values (?, 'https://example.com/aif.pdf', 'Annual Information Form 2025', 'aif', 1)`, id);
  return id;
}

const periodId = async (db: Sql, label: string) =>
  String((await db.get("select id from periods where label = ?", label) as { id: string }).id);
const companyId = async (db: Sql, name: string) =>
  String((await db.get("select id from companies where canonical_name = ?", name) as { id: string }).id);
const valueOf = async (db: Sql, label: string, name: string, key: string) =>
  await db.get(`select value, source, evidence_state, source_period_id from company_period_field_values
      where period_id = ? and company_id = ? and field_key = ?`,
    await periodId(db, label), await companyId(db, name), key) as
    { value: string; source: string; evidence_state: string; source_period_id: string | null } | undefined;

/** Q3 from the workbook, researched a little, and published. */
async function publishedQ3(): Promise<Sql> {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [
    workbook("NRTH", "TSX", "Northco Mining Corp.", 5e9, { regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] } }),
    workbook("STHC", "TSX", "Southco Resources Ltd.", 3.2e9, { regions: { CANADA: ["BC"] } }),
    // An analyst-added region the list will not mark.
    workbook("ROYL", "TSX", "Royalco Streaming Inc.", 8.4e9,
             { stages: ["royalty_streaming"], regions: { CANADA: ["QC"] } }),
    workbook("CARY", "TSXV", "Carryco Minerals Inc.", 3.1e8, { regions: { CANADA: ["NT"] } }),
    workbook("DEVL", "TSXV", "Devco Development Ltd.", 4.5e8, { stages: ["development"], regions: { CANADA: ["SK"] } }),
    workbook("BLNK", "TSX", "Blankco Holdings Inc.", 7.8e8, { regions: { CANADA: ["QC"] } }),
  ] }, { label: Q3 });
  const q3 = await periodId(db, Q3);
  const nrth = await companyId(db, "Northco Mining Corp.");
  // Research settles Northco's commodities and fiscal year end in Q3.
  await recordDecision(db, { periodId: q3, companyId: nrth, fieldKey: "commodities", decision: "accept",
                             findingId: await finding(db, q3, nrth, "commodities", ["Gold", "Silver"]) });
  await recordDecision(db, { periodId: q3, companyId: nrth, fieldKey: "fiscal_year_end", decision: "accept",
                             findingId: await finding(db, q3, nrth, "fiscal_year_end", "12-31") });
  await publishPeriod(db, q3, { overrideReason: "test" });
  return db;
}

test("next quarter's period is the last published one rolled forward from TSX's list", async () => {
  const db = await publishedQ3();
  const plan = await loadTsxPlan(db, AUGUST);
  assert.deepEqual(plan.blocking, []);
  assert.deepEqual(plan.continuing.map((p) => p.issuer.ticker), ["NRTH", "SOCO", "ROYL", "CARY"]);
  assert.deepEqual(plan.entrants.map((p) => p.issuer.ticker), ["NEWC", "EDGE"]);
  assert.deepEqual(plan.dropOuts.map((d) => [d.ticker, d.reason]), [["BLNK", "not_listed"], ["DEVL", "below_threshold"]]);

  const r = await commitTsxPeriod(db, AUGUST, { label: Q4, sourceSha256: "abc123" });
  assert.equal(r.population, 6);
  assert.deepEqual(r.basedOn, { label: Q3, revision: 1 });
  assert.deepEqual(r.unmappedMarkets, ["Edgeco Metals Inc. (EDGE): Manitoba, Canada"]);
  const q3 = await periodId(db, Q3);
  const q4 = await db.get("select id, source_kind, threshold_amount, status from periods where label = ?", Q4) as
    { id: string; source_kind: string; threshold_amount: number; status: string };
  assert.equal(q4.source_kind, "tsx_list");
  assert.equal(Number(q4.threshold_amount), 200_000_000, "the Admin's threshold, copied onto the period");
  assert.equal(q4.status, "draft");

  // TSX's own fields come from the list...
  const cap = await valueOf(db, Q4, "Northco Mining Corp.", "market_cap_cad");
  assert.equal(JSON.parse(cap!.value), 5.4e9);
  assert.equal(cap!.source, "extract");
  assert.deepEqual(JSON.parse((await valueOf(db, Q4, "Northco Mining Corp.", "property_regions"))!.value),
                   { CANADA: ["ON", "QC"], "LATIN AMERICA": ["Peru"] });
  // ...unless review settled them last quarter: research beats the list.
  const commodities = await valueOf(db, Q4, "Northco Mining Corp.", "commodities");
  assert.deepEqual(JSON.parse(commodities!.value), ["Gold", "Silver"]);
  assert.equal(commodities!.source, "inherited");
  assert.equal(commodities!.source_period_id, q3);
  // Silence keeps the last period's value: Royalco's analyst-added region.
  const royl = await valueOf(db, Q4, "Royalco Streaming Inc.", "property_regions");
  assert.deepEqual(JSON.parse(royl!.value), { CANADA: ["QC"] });
  assert.equal(royl!.source, "inherited");
  assert.equal(JSON.parse((await valueOf(db, Q4, "Royalco Streaming Inc.", "head_office_region"))!.value),
               "British Columbia, Canada", "a head office the list does give is the list's");

  // Everything else is carried, marked with where it came from.
  for (const key of ["auditor", "website", "fiscal_year_end", "dtt_market", "stage_evidence_state"]) {
    const v = await valueOf(db, Q4, "Northco Mining Corp.", key);
    assert.equal(v?.source, "inherited", key);
    assert.equal(v?.source_period_id, q3, key);
  }
  const stages = await db.all(`select stage from company_period_stages where period_id = ? and company_id = ?`,
    q4.id, await companyId(db, "Northco Mining Corp.")) as Array<{ stage: string }>;
  assert.deepEqual(stages.map((s) => s.stage), ["production"], "the stage rows come with the stage state");

  // Identity: a new ticker and a graduation each close one interval and open another.
  const sthc = await companyId(db, "Southco Resources Ltd.");
  const tickers = await db.all(`select value, exchange, valid_to from company_identifiers
      where company_id = ? and scheme = 'root_ticker' order by valid_from`, sthc) as
    Array<{ value: string; exchange: string; valid_to: string | null }>;
  assert.deepEqual(tickers.map((t) => [t.value, t.valid_to ? String(t.valid_to).slice(0, 10) : null]),
                   [["STHC", "2026-08-31"], ["SOCO", null]]);
  assert.equal(JSON.parse((await valueOf(db, Q4, "Carryco Minerals Inc.", "exchange"))!.value), "TSX");

  // New companies: the list's fields, nothing researched, the market the head office implies.
  assert.equal(JSON.parse((await valueOf(db, Q4, "Newco Copper Corp.", "dtt_market"))!.value), "British Columbia");
  assert.equal((await valueOf(db, Q4, "Newco Copper Corp.", "dtt_market"))!.source, "derived");
  assert.equal(JSON.parse((await valueOf(db, Q4, "Edgeco Metals Inc.", "dtt_market"))!.value), null);
  assert.equal(JSON.parse((await valueOf(db, Q4, "Newco Copper Corp.", "stage_evidence_state"))!.value), "none");

  // Who left has no row in the new period.
  for (const name of ["Devco Development Ltd.", "Blankco Holdings Inc."]) {
    assert.equal(await valueOf(db, Q4, name, "company_name"), undefined, name);
  }
  assert.equal(await db.get("select 1 as x from companies where canonical_name = 'Westco Gold Ltd.'"), undefined,
               "an issuer under the line is not created at all");

  // Tiers, recomputed: Northco now holds Quebec too, and is still classified.
  const tiers = await db.all(`select c.canonical_name, t.tier, t.footprint from tiers t join companies c on c.id = t.company_id
      where t.period_id = ? order by c.canonical_name`, q4.id) as Array<{ canonical_name: string; tier: number | null; footprint: string }>;
  assert.equal(tiers.length, 6);
  const q3tier = await db.get(`select tier from tiers where period_id = ? and company_id = ?`, q3,
                              await companyId(db, "Northco Mining Corp.")) as { tier: number | null };
  assert.equal(tiers.find((t) => t.canonical_name === "Northco Mining Corp.")?.tier, q3tier.tier);
  assert.equal(tiers.find((t) => t.canonical_name === "Newco Copper Corp.")?.tier, null,
               "a new company with no stage research is unclassified");

  // The audit row says what was done.
  const audit = await db.get("select detail from audit_log where event = 'import_committed' and period_id = ?", q4.id) as
    { detail: string };
  assert.equal(JSON.parse(audit.detail).kind, "tsx_list");
  assert.equal(JSON.parse(audit.detail).dropOutsNotListed, 1);
});

test("a carried value cites what it cited where it came from, and its age outlives the publish", async () => {
  const db = await publishedQ3();
  await commitTsxPeriod(db, AUGUST, { label: Q4, sourceSha256: "abc123" });
  const q4 = await periodId(db, Q4);
  const nrth = await companyId(db, "Northco Mining Corp.");
  const cites = await citationsForPeriod(db, q4, { companyId: nrth });

  const fye = cites.get(`${nrth}|fiscal_year_end`)!;
  assert.equal(fye.citation.kind, "prior_period");
  assert.ok(fye.citation.kind === "prior_period" && fye.citation.origin?.kind === "document");
  assert.equal(fye.excerpt, 'the passage that says "12-31"', "the quote travels with the value");
  const cap = cites.get(`${nrth}|market_cap_cad`)!.citation;
  assert.ok(cap.kind === "workbook" && cap.source === "tsx_list", "a value read from the list cites the list");
  const auditor = cites.get(`${nrth}|auditor`)!.citation;
  assert.ok(auditor.kind === "prior_period" && auditor.origin?.kind === "workbook");

  const draft = await readCompanyProfile(db, nrth, { allowDraft: true });
  const ageOf = (p: typeof draft, key: string) => p?.values.find((v) => v.fieldKey === key)?.inheritedFrom;
  assert.deepEqual(ageOf(draft, "fiscal_year_end"), { label: Q3, asOf: "2026-05-31", ageDays: 92 });
  assert.equal(ageOf(draft, "market_cap_cad"), null);

  await publishPeriod(db, q4, { overrideReason: "test" });
  const published = await readCompanyProfile(db, nrth, { allowDraft: false });
  assert.equal(published?.period.label, Q4);
  assert.deepEqual(ageOf(published, "fiscal_year_end"), { label: Q3, asOf: "2026-05-31", ageDays: 92 },
                   "the frozen citation still says where and when it came from");
  const frozen = published?.values.find((v) => v.fieldKey === "fiscal_year_end");
  assert.deepEqual(frozen?.sources, ["https://example.com/aif.pdf"], "and links the filing it was read from");
});

test("Viewers keep the published quarter until the rolled-forward one is published", async () => {
  const db = await publishedQ3();
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  const viewer = await listCompanies(db, { allowDraft: false });
  assert.equal(viewer.length, 6, "Q3's six, not Q4's draft");
  assert.ok(viewer.some((r) => r.name === "Blankco Holdings Inc."));
  const analyst = await listCompanies(db, { allowDraft: true });
  assert.equal(analyst.length, 6);
  assert.ok(analyst.some((r) => r.name === "Newco Copper Corp."));
});

test("undoing a decision on a carried value goes back to the carried value", async () => {
  const db = await publishedQ3();
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  const q4 = await periodId(db, Q4);
  const nrth = await companyId(db, "Northco Mining Corp.");

  await recordDecision(db, { periodId: q4, companyId: nrth, fieldKey: "auditor", decision: "accept",
                             findingId: await finding(db, q4, nrth, "auditor", "PricewaterhouseCoopers LLP") });
  assert.equal((await valueOf(db, Q4, "Northco Mining Corp.", "auditor"))!.source, "ai_accepted");
  await undoLast(db, q4, "auditor", null);
  const back = await valueOf(db, Q4, "Northco Mining Corp.", "auditor");
  assert.equal(JSON.parse(back!.value), "KPMG LLP", "not emptied: the file never carried it here");
  assert.equal(back!.source, "inherited");

  // Stage: the rows come back with the state.
  await recordDecision(db, { periodId: q4, companyId: nrth, fieldKey: "stage_evidence_state", decision: "override",
    overrideValue: { exploration: true, development: false, production: false, royalty_streaming: false },
    reason: "test" });
  assert.deepEqual((await db.all("select stage from company_period_stages where period_id = ? and company_id = ?", q4, nrth) as
    Array<{ stage: string }>).map((r) => r.stage), ["exploration"]);
  await undoLast(db, q4, "stage_evidence_state", null);
  const rows = await db.all("select stage from company_period_stages where period_id = ? and company_id = ?", q4, nrth) as
    Array<{ stage: string }>;
  assert.deepEqual(rows.map((r) => r.stage), ["production"]);
  assert.equal(JSON.parse((await valueOf(db, Q4, "Northco Mining Corp.", "stage_evidence_state"))!.value), "complete");
});

test("a second quarter carries from where a value first came, and still keeps research over the list", async () => {
  const db = await publishedQ3();
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  await publishPeriod(db, await periodId(db, Q4), { overrideReason: "test" });
  const NOVEMBER = list("2026-11-30", AUGUST.companies.map((c) => ({ ...c, market_cap: (c.market_cap ?? 0) * 1.1 })));
  await commitTsxPeriod(db, NOVEMBER, { label: "Q1-2027 (2026-11-30)" });

  const q3 = await periodId(db, Q3);
  const fye = await valueOf(db, "Q1-2027 (2026-11-30)", "Northco Mining Corp.", "fiscal_year_end");
  assert.equal(fye?.source_period_id, q3, "six months old, not three: it came from Q3");
  const commodities = await valueOf(db, "Q1-2027 (2026-11-30)", "Northco Mining Corp.", "commodities");
  assert.deepEqual(JSON.parse(commodities!.value), ["Gold", "Silver"], "Q3's research still outranks the list");
  assert.equal(commodities!.source_period_id, q3);
  const newc = await valueOf(db, "Q1-2027 (2026-11-30)", "Newco Copper Corp.", "dtt_market");
  assert.equal(newc?.source, "inherited", "Newco is continuing now, so its market is carried");
  assert.equal(newc?.source_period_id, await periodId(db, Q4));
});

test("a list is refused without a published period, after a draft, or under a name in use", async () => {
  const empty = memorySql();
  await assert.rejects(commitTsxPeriod(empty, AUGUST, { label: Q4 }), /No period has been published yet/);

  const db = await publishedQ3();
  await assert.rejects(commitTsxPeriod(db, AUGUST, { label: Q3 }), /already named/);
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  const again = await loadTsxPlan(db, list("2026-09-30", AUGUST.companies));
  assert.match(again.blocking.join(" "), /is already committed after Q3-2026/);
  await assert.rejects(commitTsxPeriod(db, list("2026-09-30", AUGUST.companies), { label: "Q4b" }),
                       /already committed after/);

  // And the workbook path: a label names one period, at one date.
  await assert.rejects(commitPeriod(db, { period: "2026-09-30", companies: [] }, { label: Q4 }),
                       /already named "Q4-2026 \(2026-08-31\)", as of 2026-08-31/);
});

test("what the last period still holds is said before the commit leaves it behind", async () => {
  const db = await publishedQ3();
  const q3 = await periodId(db, Q3);
  const base = (await loadTsxPlan(db, AUGUST)).base;
  assert.deepEqual(await baseLeftovers(db, base), [], "freshly published, nothing to leave");

  const nrth = await companyId(db, "Northco Mining Corp.");
  await recordDecision(db, { periodId: q3, companyId: nrth, fieldKey: "auditor", decision: "accept",
                             findingId: await finding(db, q3, nrth, "auditor", "Ernst & Young LLP") });
  await finding(db, q3, nrth, "audit_fee", { amount: 1, currency: "CAD" });
  const left = await baseLeftovers(db, base);
  assert.deepEqual(left.map((w) => w.code), ["base_unpublished_changes", "base_review_waiting"]);
  assert.match(left[0].detail, /1 company has changes in Q3-2026/);
});
