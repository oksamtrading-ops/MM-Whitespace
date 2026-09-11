import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { resetTickerCache } from "./edgar.ts";
import type { HttpResponse } from "./fetch.ts";
import { claimJobs, ensureSlots } from "./ledger.ts";
import {
  canonicalAuditor, collectSearchUrls, Meter, toFinding, windowsOf, type LiveDeps, type Vendor, type VendorMessage,
} from "./live.ts";
import { EgressViolation } from "./prompt.ts";
import { extractPdf } from "./pdf.ts";
import { createRun, JobFailed, processJob, storeDocument } from "./worker.ts";
import { seedFixtureDatabase, PERIOD_AS_OF } from "../../../tests/cassettes/build_cassettes.mjs";
import { makePdf } from "../../../tests/fixtures/make_pdf.mjs";

const CASSETTE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

/* ------------------------------------------------------------ the world */
// Fabricated throughout: a company that does not exist, on a reserved TLD.

const CIRCULAR = makePdf([
  "Northco Mining Corp.\nManagement Information Circular 2026",
  "Appointment of Auditor\nDeloitte LLP, Chartered Professional Accountants, have been the auditors of the Corporation since 2015.",
  "External Auditor Service Fees\nAll amounts are expressed in thousands of Canadian dollars.\n" +
  "                        2025     2024\nAudit fees               412      388\nTax fees                 118      102",
]);
const SOMEONE_ELSE = makePdf(["Southco Resources Ltd.\nAnnual Information Form\nAudit fees 999"]);

const EDGAR_RECORD = JSON.stringify({
  cik: "1234567", name: "NORTHCO MINING CORP", fiscalYearEnd: "1231", website: "northco.invalid",
  addresses: {
    mailing: { city: "WILMINGTON", stateOrCountryDescription: "DE" },
    business: { street1: "1 King St W", city: "TORONTO", stateOrCountry: "A6", stateOrCountryDescription: "ONTARIO, CANADA" },
  },
  filings: { recent: {
    form: ["6-K", "40-F"], filingDate: ["2026-05-01", "2026-03-20"],
    accessionNumber: ["0001234567-26-000010", "0001234567-26-000004"], primaryDocument: ["d6k.htm", "d40f.htm"],
  } },
});

const PAGES: Record<string, { type: string; body: Uint8Array | string }> = {
  "https://northco.invalid/": { type: "text/html",
    body: "<html><body><h1>Northco Mining Corp.</h1><p>TSX: NRTH. Gold in Ontario and Peru.</p></body></html>" },
  "https://northco.invalid/docs/circular-2026.pdf": { type: "application/pdf", body: CIRCULAR },
  "https://northco.invalid/docs/southco-aif.pdf": { type: "application/pdf", body: SOMEONE_ELSE },
  "https://www.sec.gov/files/company_tickers.json": { type: "application/json",
    body: JSON.stringify({ 0: { cik_str: 1234567, ticker: "NRTH", title: "NORTHCO MINING CORP" },
                           1: { cik_str: 7654321, ticker: "STHC", title: "SOUTHCO RESOURCES LTD" } }) },
  "https://data.sec.gov/submissions/CIK0001234567.json": { type: "application/json", body: EDGAR_RECORD },
  "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/index.json": { type: "application/json",
    body: JSON.stringify({ directory: { item: [{ name: "d40f.htm", size: "900" }, { name: "ex99-1.htm", size: "90000" }] } }) },
};

function world() {
  const fetched: string[] = [];
  const fetchDeps = {
    resolve: async () => ["93.184.216.34"],
    http: async (url: string): Promise<HttpResponse> => {
      fetched.push(url);
      const page = PAGES[url];
      if (!page) return { status: 404, headers: {}, body: new Uint8Array() };
      const body = typeof page.body === "string" ? new TextEncoder().encode(page.body) : page.body;
      return { status: 200, headers: { "content-type": page.type }, body };
    },
    extractors: { pdf: extractPdf },
  };
  return { fetched, fetchDeps };
}

const DISCOVERY_REPORT = {
  official_website: "https://northco.invalid",
  sec_cik: null,
  documents: [
    { url: "https://northco.invalid/docs/circular-2026.pdf", kind: "information_circular", fiscal_year: 2025, title: "Circular" },
    { url: "https://northco.invalid/docs/southco-aif.pdf", kind: "annual_information_form", fiscal_year: 2025, title: "AIF" },
    // A lookalike off the allowlist: reported, never fetched.
    { url: "https://northco-mining.invalid/aif.pdf", kind: "annual_information_form", fiscal_year: 2025, title: "AIF" },
  ],
  notes: "",
};

const searchBlock = (urls: string[]) => ({
  type: "web_search_tool_result", tool_use_id: "s1",
  content: urls.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "x", page_age: null })),
});

/** The extraction a model would return over the circular -- one real fee, one fabricated. */
const EXTRACTION = { findings: [
  { field_key: "auditor", document_index: 0, abstained: false, abstention_reason: null, self_confidence: 0.9,
    evidence_excerpt: "Deloitte LLP, Chartered Professional Accountants, have been the auditors of the Corporation since 2015.",
    text_value: "Deloitte LLP", year_value: null, stage: null, auditor_change: null, fee: null },
  { field_key: "auditor_since", document_index: 0, abstained: false, abstention_reason: null, self_confidence: 0.85,
    evidence_excerpt: "have been the auditors of the Corporation since 2015",
    text_value: null, year_value: 2015, stage: null, auditor_change: null, fee: null },
  { field_key: "auditor_change", document_index: 0, abstained: false, abstention_reason: null, self_confidence: 0.7,
    evidence_excerpt: "have been the auditors of the Corporation since 2015",
    text_value: null, year_value: null, stage: null,
    auditor_change: { changed: false, date: null, previous_auditor: null }, fee: null },
  { field_key: "audit_fee", document_index: 0, abstained: false, abstention_reason: null, self_confidence: 0.84,
    evidence_excerpt: "Audit fees 412", text_value: null, year_value: null, stage: null, auditor_change: null,
    fee: { amount: 412, scale: "thousands", fiscal_year: 2025, currency: "CAD" } },
  // Fabricated: 265 appears nowhere in the circular.
  { field_key: "tax_fee", document_index: 0, abstained: false, abstention_reason: null, self_confidence: 0.93,
    evidence_excerpt: "Tax fees 265", text_value: null, year_value: null, stage: null, auditor_change: null,
    fee: { amount: 265, scale: "thousands", fiscal_year: 2025, currency: "CAD" } },
  { field_key: "stage_evidence_state", document_index: null, abstained: true,
    abstention_reason: "the circular does not describe operations", self_confidence: 0.2, evidence_excerpt: null,
    text_value: null, year_value: null, stage: null, auditor_change: null, fee: null },
] };

function vendor(opts: { pauseFirst?: boolean; refuse?: boolean } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  let discoveries = 0;
  const v: Vendor = {
    async create(request) {
      requests.push(JSON.parse(JSON.stringify(request)));
      const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0,
                      cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 } };
      if (opts.refuse) return { content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage };
      const tools = (request.tools ?? []) as Array<{ name: string }>;
      if (tools.some((t) => t.name === "report_sources")) {
        discoveries++;
        if (opts.pauseFirst && discoveries === 1) {
          return { content: [searchBlock(["https://northco.invalid/"])], stop_reason: "pause_turn", usage } as VendorMessage;
        }
        return { stop_reason: "tool_use", usage, content: [
          searchBlock(["https://northco.invalid/", "https://northco.invalid/docs/circular-2026.pdf",
                       "https://northco.invalid/docs/southco-aif.pdf"]),
          { type: "tool_use", id: "t1", name: "report_sources", input: DISCOVERY_REPORT },
        ] } as VendorMessage;
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(EXTRACTION) }],
               usage: { input_tokens: 8000, output_tokens: 900 } } as VendorMessage;
    },
  };
  return { v, requests };
}

async function seeded(opts: { website?: string } = {}) {
  resetTickerCache();
  const { db, periodId, companies } = seedFixtureDatabase() as {
    db: Sql; periodId: string; companies: Array<{ id: string; name: string }>;
  };
  const northco = companies.find((c) => c.name === "Northco Mining Corp.")!;
  if (opts.website) {
    await db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
        values (?, ?, 'website', ?, 'extract', 'asserted')`, periodId, northco.id, JSON.stringify(opts.website));
  }
  return { db, periodId, northco };
}

async function runOne(db: Sql, periodId: string, companyId: string, fieldGroup: string, live: LiveDeps) {
  const { runId } = await createRun(db, periodId, [companyId], { cassetteDir: CASSETTE_DIR, fieldGroup, mode: "live" });
  await ensureSlots(db, 1);
  const [job] = await claimJobs(db, runId, "w1", 1);
  const outcome = await processJob(db, runId, job, PERIOD_AS_OF, { mode: "live", cassetteDir: CASSETTE_DIR, live });
  const findings = await db.all(`select field_key, state, anchor_mode, proposed_value, anchor_document_hash
      from enrichment_findings where run_id = ? order by field_key`, runId) as Array<Record<string, string>>;
  return { runId, outcome, findings, by: Object.fromEntries(findings.map((f) => [f.field_key, f])) };
}

function deps(db: Sql, v: Vendor, fetchDeps: LiveDeps["fetch"], terms: string[] = []): LiveDeps {
  return { vendor: v, fetch: fetchDeps, store: (doc) => storeDocument(db, doc),
           restrictions: { terms, restrictedCompanyNames: [] } };
}

process.env.MM_SEC_CONTACT = "research-contact@example.invalid";

/* ----------------------------------------------------------------- tests */

test("PASS 1: the website is verified on its own homepage, and EDGAR answers three fields by itself", async () => {
  const { db, periodId, northco } = await seeded();
  const { v, requests } = vendor();
  const { fetched, fetchDeps } = world();
  const { outcome, by } = await runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps));

  assert.equal(outcome.jobState, "completed");
  assert.equal(by.website.state, "proposed", "verified: the homepage names the company");
  assert.equal(by.website.anchor_mode, "exact_normalized");
  assert.equal(JSON.parse(by.website.proposed_value), "https://northco.invalid");

  // EDGAR, found by ticker and confirmed by name, quoted verbatim. No model involved.
  assert.deepEqual(JSON.parse(by.sec_registrant.proposed_value), { registrant: true, form: "40-F", cik: "1234567" });
  assert.equal(by.sec_registrant.state, "proposed");
  assert.equal(JSON.parse(by.fiscal_year_end.proposed_value), "12-31");
  assert.equal(JSON.parse(by.head_office_location.proposed_value), "Toronto");
  assert.equal(JSON.parse(by.head_office_region.proposed_value), "Ontario, Canada");
  for (const k of ["sec_registrant", "fiscal_year_end", "head_office_location", "head_office_region"]) {
    assert.equal(by[k].anchor_mode, "exact_normalized", `${k} quotes the EDGAR record`);
  }

  // One discovery call, SEDAR+ blocked in the tool, nothing fetched off-list.
  assert.equal(requests.length, 1);
  const tools = requests[0].tools as Array<Record<string, unknown>>;
  assert.deepEqual(tools[0].blocked_domains, ["sedarplus.ca", "sedarplus.com", "sedar.com"]);
  assert.ok(!fetched.some((u) => u.includes("northco-mining.invalid")));

  // The candidates pass 2 will read: the reported filings plus EDGAR's annual report and exhibit.
  const raw = JSON.parse((await db.get("select raw from enrichment_job_results") as { raw: string }).raw);
  const urls = raw.candidates.map((c: { url: string }) => c.url);
  assert.ok(urls.includes("https://northco.invalid/docs/circular-2026.pdf"));
  assert.ok(urls.includes("https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/d40f.htm"));
  assert.ok(urls.includes("https://www.sec.gov/Archives/edgar/data/1234567/000123456726000004/ex99-1.htm"));
  assert.ok(raw.cost_usd > 0.02, "tokens plus two searches at $0.01");
});

test("PASS 2: filings from the trusted domain only, the wrong company's filing refused, the fabricated fee rejected", async () => {
  const { db, periodId, northco } = await seeded({ website: "https://northco.invalid" });
  const { v, requests } = vendor();
  const { fetched, fetchDeps } = world();
  const { outcome, by } = await runOne(db, periodId, northco.id, "general", deps(db, v, fetchDeps));
  assert.equal(outcome.jobState, "completed");

  // A document on the company's own domain that names someone else is not its document.
  assert.ok(fetched.includes("https://northco.invalid/docs/southco-aif.pdf"));
  const docs = await db.all("select url, extractor from documents") as Array<{ url: string; extractor: string }>;
  assert.ok(!docs.some((d) => d.url.includes("southco")), "the wrong company's filing is never stored");
  assert.ok(docs.some((d) => d.url.endsWith("circular-2026.pdf") && d.extractor === "unpdf"));
  assert.ok(!fetched.some((u) => u.includes("northco-mining.invalid")), "off the allowlist: never fetched");

  // The extraction saw windows of the circular, not the whole file, and quoted it.
  const extraction = requests.find((r) => (r.output_config as Record<string, unknown>)?.format)!;
  assert.match(JSON.stringify(extraction.messages), /External Auditor Service Fees/);

  assert.equal(JSON.parse(by.auditor.proposed_value), "Deloitte", "the firm is named as the auditors table spells it");
  assert.equal(by.auditor.state, "proposed");
  assert.equal(JSON.parse(by.auditor_since.proposed_value), 2015);
  assert.deepEqual(JSON.parse(by.auditor_change.proposed_value), { changed: false, date: null, previous_auditor: null });
  assert.equal(by.audit_fee.state, "proposed");
  assert.equal(by.audit_fee.anchor_mode, "proximity", "412 under an in-thousands header, label in another cell");
  assert.equal(JSON.parse(by.audit_fee.proposed_value), 412000);
  assert.notEqual(by.tax_fee.state, "proposed", "265 appears nowhere in the circular");
  assert.equal(by.stage_evidence_state.state, "abstained");
});

test("pass 2 reads the documents pass 1 found instead of searching again", async () => {
  const { db, periodId, northco } = await seeded();
  const { v, requests } = vendor();
  const { fetchDeps } = world();
  await runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps));
  await db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
      values (?, ?, 'website', '"https://northco.invalid"', 'ai_accepted', 'asserted')
      on conflict (period_id, company_id, field_key) do update set value = excluded.value`, periodId, northco.id);
  requests.length = 0;
  await runOne(db, periodId, northco.id, "general", deps(db, v, fetchDeps));
  assert.equal(requests.length, 1, "one extraction call and no second discovery");
  assert.ok((requests[0].output_config as Record<string, unknown>).format);
});

test("a paused search resumes by resending the turn, with no invented user message", async () => {
  const { db, periodId, northco } = await seeded();
  const { v, requests } = vendor({ pauseFirst: true });
  const { fetchDeps } = world();
  const { outcome } = await runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps));
  assert.equal(outcome.jobState, "completed");
  assert.equal(requests.length, 2);
  const second = requests[1].messages as Array<{ role: string }>;
  assert.deepEqual(second.map((m) => m.role), ["user", "assistant"]);
});

test("the egress scan stops a request before the vendor sees it", async () => {
  const { db, periodId, northco } = await seeded();
  const { v, requests } = vendor();
  const { fetchDeps } = world();
  await assert.rejects(
    () => runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps, ["Northco"])),
    (err: unknown) => err instanceof JobFailed && (err.cause as Error) instanceof EgressViolation);
  assert.equal(requests.length, 0, "nothing was sent");
});

test("a refusal abandons the job, and reads nothing from the response", async () => {
  const { db, periodId, northco } = await seeded();
  const { v } = vendor({ refuse: true });
  const { fetchDeps } = world();
  await assert.rejects(() => runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps)),
    (err: unknown) => err instanceof JobFailed && err.outcome === "dead_letter" && /declined \(cyber\)/.test(err.message));
});

test("the fields pass refuses a company with no trusted website", async () => {
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  await assert.rejects(() => runOne(db, periodId, northco.id, "general", deps(db, v, fetchDeps)),
    /needs a website the application trusts/);
});

test("cost counts tokens at each model's price and every search at a cent", () => {
  const m = new Meter();
  m.add("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 });
  assert.equal(m.cost.toFixed(2), (2 + 1 + 0.2).toFixed(2));
  m.add("claude-opus-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } });
  assert.equal(m.cost.toFixed(2), "3.23");
  assert.equal(m.usage.requests, 2);
});

test("search URLs are collected wherever they sit, including citations", () => {
  const seen = new Set<string>();
  collectSearchUrls([
    searchBlock(["https://a.invalid/x#frag"]),
    { type: "text", text: "t", citations: [{ type: "web_search_result_location", url: "https://b.invalid/y/" }] },
  ], seen);
  assert.deepEqual([...seen].sort(), ["https://a.invalid/x", "https://b.invalid/y"]);
});

test("windows keep the cover and what each field needs, verbatim and capped", () => {
  const filler = "lorem ipsum ".repeat(20_000);
  const text = `Cover page of Northco. ${filler} Audit fees 412 ${filler} Head office: Toronto ${filler}`;
  const w = windowsOf(text);
  assert.ok(w.startsWith("Cover page of Northco."));
  assert.ok(w.includes("Audit fees 412") && w.includes("Head office: Toronto"));
  assert.ok(w.length <= 30_000 + 20, `capped, got ${w.length}`);
});

test("values that do not fit their field are dropped, not stored", () => {
  const base = { document_index: null, evidence_excerpt: null, abstained: false, abstention_reason: null,
                 self_confidence: 0.5, text_value: null, year_value: null, stage: null, auditor_change: null, fee: null };
  assert.equal(toFinding({ ...base, field_key: "fiscal_year_end", text_value: "December 31" }, []), null);
  assert.equal(toFinding({ ...base, field_key: "fiscal_year_end", text_value: "12-31" }, [])!.value, "12-31");
  assert.equal(canonicalAuditor("PricewaterhouseCoopers LLP"), "PwC");
  assert.equal(canonicalAuditor("Ernst & Young LLP"), "Ernst & Young");
  assert.equal(canonicalAuditor("Some Regional Firm LLP"), "Some Regional Firm LLP");
});
