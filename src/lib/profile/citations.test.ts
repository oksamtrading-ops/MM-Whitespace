import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod, PublishUncited } from "../publish/snapshot.ts";
import { recordDecision } from "../review/decide.ts";
import { standingValueDecision, standingValueDecisions } from "../review/resolve.ts";
import { citationsForPeriod, citeKey, safeHref, uncited, urlIn } from "./citations.ts";
import { listCompanies, readCompanyProfile } from "./company.ts";

function company(over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: "NRTH", exchange: "TSX", name: "Northco Mining Corp.", ordinal: 1,
    market_cap: 5_000_000_000,
    stages: [], stage_evidence: "none", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada only",
    ...over,
  } as ParsedCompany;
}

async function committed() {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [company()] }, { label: "P1 (2026-05-31)" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  const companyId = (await db.get("select id from companies") as { id: string }).id;
  return { db, periodId, companyId };
}

/** A finding as the worker persists it: a quote, and the documents it came from. */
async function finding(db: Sql, periodId: string, companyId: string, fieldKey: string, value: unknown, opts: {
  excerpt?: string | null; urls?: string[]; abstained?: string;
} = {}) {
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test-model', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };
  const id = (await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, evidence_excerpt, abstained, abstention_reason, state, model, prompt_version)
     values (?, ?, 1, ?, ?, ?, 0.85, 'exact_normalized', ?, ?, ?, ?, 'test-model', 'test') returning id`,
    run.id, job.id, companyId, fieldKey, JSON.stringify(value),
    opts.excerpt === undefined ? "Audit fees: C$1,200,000 for fiscal 2025." : opts.excerpt,
    opts.abstained ? 1 : 0, opts.abstained ?? null, opts.abstained ? "abstained" : "proposed") as { id: string }).id;
  for (const url of opts.urls ?? []) {
    await db.run(`insert into finding_sources (finding_id, url, title, source_tier, doc_type, retrieved_at)
        values (?, ?, 'Management Information Circular 2026', 1, 'circular', '2026-09-12 10:00:00')`, id, url);
  }
  return id;
}

test("every kind of value cites its kind of source", async () => {
  const { db, periodId, companyId } = await committed();
  const fee = await finding(db, periodId, companyId, "audit_fee",
    { amount: 1_200_000, currency: "CAD", fiscal_year: 2025 }, { urls: ["https://northco.example/circular.pdf"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "accept", findingId: fee });
  const none = await finding(db, periodId, companyId, "tax_fee", null,
    { excerpt: null, abstained: "None of the supplied documents contain a tax fee disclosure." });
  await recordDecision(db, { periodId, companyId, fieldKey: "tax_fee", decision: "accept", findingId: none });
  await recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "override",
    overrideValue: "KPMG", reason: "Named in the 2026 AIF, https://northco.example/aif.pdf." });

  const cites = await citationsForPeriod(db, periodId);
  const of = (field: string) => cites.get(citeKey(companyId, field))!;

  const doc = of("audit_fee");
  assert.equal(doc.citation.kind, "document");
  assert.equal(doc.citation.kind === "document" && doc.citation.documents[0].url, "https://northco.example/circular.pdf");
  assert.match(doc.excerpt ?? "", /Audit fees/);

  const searched = of("tax_fee");
  assert.equal(searched.citation.kind, "searched", "a null accepted is a search that found nothing");
  assert.match(searched.citation.kind === "searched" ? searched.citation.reason ?? "" : "", /tax fee/);

  const review = of("auditor");
  assert.equal(review.citation.kind, "review");
  assert.equal(review.citation.kind === "review" && review.citation.url, "https://northco.example/aif.pdf",
               "the reviewer's cited address, without its trailing full stop");

  assert.equal(of("market_cap_cad").citation.kind, "workbook");
  assert.equal(of("tier").citation.kind, "rule");
  assert.deepEqual(uncited(cites), []);
});

test("the batched standing decision is the single one, field by field", async () => {
  const { db, periodId, companyId } = await committed();
  const a = await finding(db, periodId, companyId, "website", "https://a.example", { urls: ["https://a.example"] });
  const b = await finding(db, periodId, companyId, "website", "https://b.example", { urls: ["https://b.example"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "website", decision: "accept", findingId: a });
  await recordDecision(db, { periodId, companyId, fieldKey: "website", decision: "accept", findingId: b });
  await recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue: "EY", reason: "x" });
  const batched = await standingValueDecisions(db, periodId);
  for (const field of ["website", "auditor", "tax_fee"]) {
    const single = await standingValueDecision(db, periodId, companyId, field);
    assert.equal(batched.get(citeKey(companyId, field))?.finding_id ?? null, single?.finding_id ?? null, field);
    assert.equal(batched.get(citeKey(companyId, field))?.decision ?? null, single?.decision ?? null, field);
  }
});

test("a researched value with neither a document nor a quote refuses publish, by name", async () => {
  const { db, periodId, companyId } = await committed();
  const bare = await finding(db, periodId, companyId, "website", "https://northco.example", { excerpt: null });
  await recordDecision(db, { periodId, companyId, fieldKey: "website", decision: "accept", findingId: bare });
  await assert.rejects(publishPeriod(db, periodId, { overrideReason: "test" }),
    (err: unknown) => err instanceof PublishUncited && err.values.some((v) => v.company === "Northco Mining Corp." && v.field === "website"));
  assert.equal((await db.get("select count(*) n from period_publications") as { n: number }).n, 0,
               "nothing was written");
});

test("a quote alone is a citation: the excerpt or the link", async () => {
  const { db, periodId, companyId } = await committed();
  const quoted = await finding(db, periodId, companyId, "fiscal_year_end", "12-31",
    { excerpt: "for the year ended December 31, 2025" });
  await recordDecision(db, { periodId, companyId, fieldKey: "fiscal_year_end", decision: "accept", findingId: quoted });
  const r = await publishPeriod(db, periodId, { overrideReason: "test" });
  assert.equal(r.revision, 1);
});

test("only http(s) is ever a link", async () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("https://ok.example/a"), "https://ok.example/a");
  assert.equal(urlIn("see javascript:alert(1) and nothing else"), null);
  const { db, periodId, companyId } = await committed();
  const f = await finding(db, periodId, companyId, "website", "https://northco.example", { urls: ["javascript:alert(1)"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "website", decision: "accept", findingId: f });
  const c = (await citationsForPeriod(db, periodId)).get(citeKey(companyId, "website"))!;
  assert.equal(c.citation.kind === "document" && c.citation.documents[0].url, null);
});

test("publish freezes the citation and the stage rows; a Viewer's page reads them", async () => {
  const { db, periodId, companyId } = await committed();
  const fee = await finding(db, periodId, companyId, "audit_fee",
    { amount: 1_200_000, currency: "CAD", fiscal_year: 2025 }, { urls: ["https://northco.example/circular.pdf"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "accept", findingId: fee });
  const stage = await finding(db, periodId, companyId, "stage_evidence_state",
    { exploration: true, development: false, production: true, royalty_streaming: false },
    { excerpt: "an exploration and production company", urls: ["https://northco.example/aif.pdf"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "stage_evidence_state", decision: "accept", findingId: stage });

  const r = await publishPeriod(db, periodId, { overrideReason: "test" });
  assert.equal(r.cited, r.values, "every value frozen with a citation");
  assert.equal(r.stages, 2);

  const frozen = await db.get(`select excerpt, sources, evidence_strength, finding_id from published_period_values
      where publication_id = ? and field_key = 'audit_fee'`, r.publicationId) as Record<string, unknown>;
  assert.match(String(frozen.excerpt), /Audit fees/);
  assert.match(String(frozen.sources), /circular\.pdf/);
  assert.equal(Number(frozen.evidence_strength), 0.85);
  assert.equal(frozen.finding_id, fee);

  const page = await readCompanyProfile(db, companyId, { allowDraft: false });
  const shown = page!.values.find((v) => v.fieldKey === "audit_fee")!;
  assert.equal(shown.citation?.kind, "document");
  assert.deepEqual(shown.sources, ["https://northco.example/circular.pdf"]);
  assert.deepEqual(page!.stages, ["exploration", "production"]);
  assert.equal(page!.stageEvidence, "complete");

  const [row] = await listCompanies(db, { allowDraft: false });
  assert.deepEqual(row.stages, ["exploration", "production"]);
  assert.equal(row.sources.audit_fee, "ai_accepted");
});

test("a draft resolves its citations live, the same way publish will", async () => {
  const { db, periodId, companyId } = await committed();
  const fee = await finding(db, periodId, companyId, "audit_fee",
    { amount: 1_200_000, currency: "CAD", fiscal_year: 2025 }, { urls: ["https://northco.example/circular.pdf"] });
  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "accept", findingId: fee });
  const page = await readCompanyProfile(db, companyId, { allowDraft: true });
  assert.equal(page!.publication, null);
  assert.equal(page!.values.find((v) => v.fieldKey === "audit_fee")!.citation?.kind, "document");
});

test("a revision published before stage rows existed says so, rather than showing no stages", async () => {
  const { db, periodId, companyId } = await committed();
  const r = await publishPeriod(db, periodId, { overrideReason: "test" });
  // What revisions 1-8 look like: values frozen with no citations, no stage rows.
  await db.run("update published_period_values set sources = null where publication_id = ?", r.publicationId);
  const [row] = await listCompanies(db, { allowDraft: false });
  assert.equal(row.stages, null);
  const page = await readCompanyProfile(db, companyId, { allowDraft: false });
  assert.equal(page!.stages, null);
  assert.equal(page!.values.find((v) => v.fieldKey === "market_cap_cad")!.citation, null);
});
