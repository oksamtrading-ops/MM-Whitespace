import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { regionFrom, resetTickerCache, titleAddress } from "./edgar.ts";
import type { HttpResponse } from "./fetch.ts";
import { claimJobs, ensureSlots } from "./ledger.ts";
import { drain, settleReady } from "./drain.ts";
import { tick } from "./tick.ts";
import type { BatchHandle, BatchRequest, BatchResult, BatchVendor } from "./batch.ts";
import {
  BATCH_DISCOUNT, WEB_SEARCH_USD, LIVE_RULES_VERSION, promptVersionFor,
  canonicalAuditor, collectSearchUrls, kindFromUrl, linkedFilings, Meter, toFinding, windowsOf,
  type LiveDeps, type Vendor, type VendorMessage,
} from "./live.ts";
import { EgressViolation, PROMPT_VERSION } from "./prompt.ts";
import { extractPdf } from "./pdf.ts";
import { createRun, JobFailed, loadDocuments, processJob, storeDocument } from "./worker.ts";
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
  // An investors page: where discovery stops when its searches run out.
  "https://northco.invalid/investors/": { type: "text/html", body:
    `<html><body><h1>Northco Mining Corp. Investors</h1>
     <a href="/docs/circular-2026.pdf">2026 Management Information Circular</a>
     <a href="/docs/Form-of-Proxy-2026.pdf">Form of proxy</a>
     <a href="https://elsewhere.invalid/northco-aif-2025.pdf">Mirror</a>
     <a href="/about/">About us</a></body></html>` },
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

function vendor(opts: { pauseFirst?: boolean; refuse?: boolean; perCompany?: boolean;
                        report?: Record<string, unknown> } = {}) {
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
        // Answer the company that was actually asked about. Two companies that
        // get identical answers cannot expose a result matched to the wrong
        // request, which is the whole risk the Batch API introduces.
        if (opts.perCompany) {
          const asked = JSON.stringify(request.messages ?? "");
          const who = asked.includes("Royalco") ? "royalco" : "northco";
          return { stop_reason: "tool_use", usage, content: [
            searchBlock([`https://${who}.invalid/`]),
            { type: "tool_use", id: "t1", name: "report_sources",
              input: { ...DISCOVERY_REPORT, official_website: `https://${who}.invalid`,
                       sec_cik: null, documents: [] } },
          ] } as VendorMessage;
        }
        if (opts.pauseFirst && discoveries === 1) {
          return { content: [searchBlock(["https://northco.invalid/"])], stop_reason: "pause_turn", usage } as VendorMessage;
        }
        return { stop_reason: "tool_use", usage, content: [
          searchBlock(["https://northco.invalid/", "https://northco.invalid/docs/circular-2026.pdf",
                       "https://northco.invalid/docs/southco-aif.pdf"]),
          { type: "tool_use", id: "t1", name: "report_sources", input: opts.report ?? DISCOVERY_REPORT },
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
           load: (hashes) => loadDocuments(db, hashes),
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
  assert.deepEqual(JSON.parse(by.audit_fee.proposed_value), { amount: 412000, currency: "CAD", fiscal_year: 2025 },
                   "the fee keeps its currency and its year");
  assert.notEqual(by.tax_fee.state, "proposed", "265 appears nowhere in the circular");
  assert.equal(by.stage_evidence_state.state, "abstained");
});

test("pass 2 follows an index page's links to the filings, and reads only those", async () => {
  const { db, periodId, northco } = await seeded({ website: "https://northco.invalid" });
  const { v } = vendor({ report: { ...DISCOVERY_REPORT, documents: [
    { url: "https://northco.invalid/investors/", kind: "other", fiscal_year: null, title: "Investors" },
  ] } });
  const { fetched, fetchDeps } = world();
  const { by, runId } = await runOne(db, periodId, northco.id, "general", deps(db, v, fetchDeps));

  assert.ok(fetched.includes("https://northco.invalid/docs/circular-2026.pdf"), "the circular was found by following the page");
  assert.ok(!fetched.some((u) => u.includes("Form-of-Proxy")), "a proxy form is not a filing");
  assert.ok(!fetched.some((u) => u.includes("elsewhere.invalid")), "a link off the allowlist is never followed");
  const stored = await db.all("select url from documents") as Array<{ url: string }>;
  assert.ok(!stored.some((d) => d.url.endsWith("/investors/")), "the index page is not read as a document");
  assert.equal(by.audit_fee.state, "proposed");
  const raw = JSON.parse((await db.get(`select r.raw from enrichment_job_results r join enrichment_jobs j on j.id = r.job_id
      where j.run_id = ?`, runId) as { raw: string }).raw);
  assert.ok(raw.notes.some((n: string) => /followed 1 filing link/.test(n)));
});

test("a linked file's kind comes from its address, and forms that are not filings are skipped", () => {
  assert.equal(kindFromUrl("https://x.invalid/files/WDO-2026-Circular-Revised.pdf"), "information_circular");
  assert.equal(kindFromUrl("https://x.invalid/Wesdome-Gold-Mines-AIF-2025.pdf"), "annual_information_form");
  assert.equal(kindFromUrl("https://x.invalid/2025/q4/Wesdome-MDA-2025-Final.pdf"), "annual_mdna");
  assert.equal(kindFromUrl("https://x.invalid/2024/q1/FS-Q1-2024-FINAL.pdf"), "interim_report");
  assert.equal(kindFromUrl("https://x.invalid/agm/2026/Form-of-Proxy.pdf"), null);
  assert.equal(kindFromUrl("https://x.invalid/brochure.pdf"), null);
  const seen = new Set<string>();
  const picked = linkedFilings([
    "https://x.invalid/2024-AIF.pdf", "https://x.invalid/2025-AIF.pdf", "https://x.invalid/2026-Circular.pdf",
    "https://y.invalid/2026-Circular.pdf",
  ], new Set(["x.invalid"]), seen);
  assert.deepEqual(picked.map((p) => p.url),
    ["https://x.invalid/2026-Circular.pdf", "https://x.invalid/2025-AIF.pdf", "https://x.invalid/2024-AIF.pdf"]);
  assert.deepEqual(linkedFilings(["https://x.invalid/2026-Circular.pdf"], new Set(["x.invalid"]), seen), [],
    "nothing is followed twice");
});

test("EDGAR's profile attributes are shown, scored below bulk accept, with a US state written out", async () => {
  assert.equal(regionFrom("CO", "CO"), "Colorado, United States");
  assert.equal(regionFrom("A6", "ONTARIO, CANADA"), "Ontario, Canada");
  assert.equal(regionFrom(null, null), null);
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  const { runId } = await runOne(db, periodId, northco.id, "identity", deps(db, v, fetchDeps));
  const rows = await db.all(`select field_key, evidence_strength from enrichment_findings
      where run_id = ? and field_key in ('head_office_location', 'head_office_region', 'fiscal_year_end')`, runId) as
    Array<{ field_key: string; evidence_strength: number }>;
  const s = Object.fromEntries(rows.map((r) => [r.field_key, Number(r.evidence_strength)]));
  // The address and the fiscal year-end are both profile attributes the filer
  // maintains, and both go stale while the filings stay current (Run 2: First
  // Quantum's 30 November against its own circular's 31 December). So neither
  // is bulk-acceptable on EDGAR's word alone.
  assert.ok(s.head_office_location < 0.8 && s.head_office_region < 0.8, JSON.stringify(s));
  assert.ok(s.fiscal_year_end < 0.8, `EDGAR's profile is not strong evidence: ${JSON.stringify(s)}`);
  // Registrant status IS a fact about the record itself, and stays tier 1.
  const registrant = await db.get(`select evidence_strength from enrichment_findings
      where run_id = ? and field_key = 'sec_registrant'`, runId) as { evidence_strength: number };
  assert.ok(Number(registrant.evidence_strength) >= 0.8, "registrant status is current by construction");
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

test("a finding records the prompt that was actually put to the model", () => {
  // The live prompt is two halves -- prompt.ts's stable prefix and this
  // module's rules -- and only the prefix was ever versioned. Every live
  // finding in production recorded "2026-09-04.1", the prefix's version,
  // which describes a prompt none of them were asked with. Editing the rules
  // moved no version anywhere, so the record could not date a change.
  assert.equal(promptVersionFor("replay"), PROMPT_VERSION,
               "replay is the prefix alone, and must not move");
  assert.equal(promptVersionFor(undefined), PROMPT_VERSION, "no mode is replay");

  const live = promptVersionFor("live");
  assert.notEqual(live, PROMPT_VERSION, "live must not answer the prefix's version");
  assert.ok(live.includes(PROMPT_VERSION),
            "a change to the shared prefix has to show on live findings too");
  assert.ok(live.includes(LIVE_RULES_VERSION), "and so does a change to the rules");
  assert.equal(live, `${PROMPT_VERSION}+live.${LIVE_RULES_VERSION}`);
});

test("the batch discount halves the tokens and leaves the searches alone", () => {
  // "Web search tool calls through the Messages Batches API are priced the
  // same as those in regular Messages API requests" -- the web search tool's
  // documentation. The batched meter had scaled the search charge too, which
  // understated every batched run by half of what its searches cost, and the
  // budget that halts a run reads that number.
  const m = new Meter(BATCH_DISCOUNT);
  m.add("claude-sonnet-5", {
    input_tokens: 1_000_000, output_tokens: 0,
    server_tool_use: { web_search_requests: 6 },
  });
  // $2 of tokens, halved; six searches at a full cent each.
  assert.equal(m.cost.toFixed(4), (1 + 0.06).toFixed(4));

  // Run b5d3d9c3, the first real batch: 18 searches over three companies.
  // It recorded $0.3936 having charged nine cents of search; the eighteen
  // cents it should have charged make the run $0.4836.
  const searchOnly = new Meter(BATCH_DISCOUNT);
  searchOnly.add("claude-opus-5", { input_tokens: 0, output_tokens: 0,
    server_tool_use: { web_search_requests: 18 } });
  assert.equal(searchOnly.cost.toFixed(4), "0.1800");
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

test("a character a model wrote as its escape is put back before the quote is checked", () => {
  const base = { document_index: null, abstained: false, abstention_reason: null, self_confidence: 0.5,
                 year_value: null, stage: null, auditor_change: null, fee: null };
  const f = toFinding({ ...base, field_key: "head_office_location",
    evidence_excerpt: "the Kiena mine, located in Val-d\\u2019Or, Quebec", text_value: "Val-d\\u2019Or" }, [])!;
  assert.equal(f.evidence_excerpt, "the Kiena mine, located in Val-d’Or, Quebec");
  assert.equal(f.value, "Val-d’Or");
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


/* --------------------------------------------------------- the Batch API */

/**
 * A Batch API backed by the same fake vendor the synchronous tests use.
 *
 * Answering batched requests with the identical vendor is the point: any
 * difference the tests below find is a difference in OUR two paths, not in
 * two fakes. Results come back reversed, because the real API returns them in
 * any order and position must never be load-bearing.
 */
function batchVendor(v: Vendor, opts: { expire?: boolean; error?: unknown } = {}) {
  const batches = new Map<string, BatchResult[]>();
  let n = 0;
  const vendor: BatchVendor = {
    async create(requests: BatchRequest[]): Promise<BatchHandle> {
      const id = `msgbatch_${++n}`;
      const answers: BatchResult[] = [];
      for (const r of requests) {
        if (opts.expire) { answers.push({ custom_id: r.custom_id, result: { type: "expired" } }); continue; }
        if (opts.error) { answers.push({ custom_id: r.custom_id, result: { type: "errored", error: opts.error } }); continue; }
        answers.push({ custom_id: r.custom_id,
                       result: { type: "succeeded", message: await v.create(r.params) } });
      }
      batches.set(id, answers.reverse());
      return { id, processing_status: "in_progress" };
    },
    async retrieve(id) { return { id, processing_status: "ended" }; },
    async results(id) { return (batches.get(id) ?? [])[Symbol.iterator]() as unknown as AsyncIterable<BatchResult>; },
  };
  return { vendor, batches };
}

async function drainBatched(db: Sql, live: LiveDeps, vendor: BatchVendor) {
  return drain(db, { deadlineSeconds: 30, mode: "live", cassetteDir: CASSETTE_DIR,
                     batch: true, batchVendor: vendor, live, workerId: `w-${Math.random()}` });
}

async function findingsOf(db: Sql, runId: string) {
  return await db.all(`select field_key, state, anchor_mode, proposed_value
      from enrichment_findings where run_id = ? order by field_key`, runId) as Array<Record<string, string>>;
}

test("BATCH: a batched pass produces exactly what the synchronous one does", async () => {
  // The whole reason each pass is cut in half at its model call rather than
  // reimplemented: the two paths run the same code on either side of the gap.
  const run = async (batched: boolean) => {
    const { db, periodId, northco } = await seeded();
    const { v } = vendor();
    const { fetchDeps } = world();
    const live = deps(db, v, fetchDeps);
    const { runId } = await createRun(db, periodId, [northco.id],
      { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
    if (!batched) {
      await ensureSlots(db, 1);
      const [job] = await claimJobs(db, runId, "w1", 1);
      await processJob(db, runId, job, PERIOD_AS_OF, { mode: "live", cassetteDir: CASSETTE_DIR, live });
    } else {
      const { vendor: bv } = batchVendor(v);
      const submit = await drainBatched(db, live, bv);
      assert.equal(submit.jobsBatched, 1, "the job was handed to the batch, not researched");
      assert.equal(
        (await db.get("select state from enrichment_jobs where run_id = ?", runId) as { state: string }).state,
        "awaiting_batch", "and it waits there rather than completing");
      assert.deepEqual(await findingsOf(db, runId), [], "nothing is derived before the answer arrives");

      const settle = await drainBatched(db, live, bv);
      assert.equal(settle.jobsSettled, 1);
    }
    const state = (await db.get("select state from enrichment_jobs where run_id = ?", runId) as { state: string }).state;
    assert.equal(state, "completed", batched ? "batched" : "synchronous");
    return findingsOf(db, runId);
  };

  assert.deepEqual(await run(true), await run(false),
                   "the same company, the same findings, whichever path asked");
});

test("BATCH: an expired request goes back to the queue and is charged no attempt", async () => {
  // A batch has 24 hours and the world sometimes takes longer. That is not the
  // company's fault, and must not eat one of its three attempts.
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  const live = deps(db, v, fetchDeps);
  const { runId } = await createRun(db, periodId, [northco.id],
    { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
  const { vendor: bv } = batchVendor(v, { expire: true });

  await drainBatched(db, live, bv);
  const submitted = await db.get("select state, attempts from enrichment_jobs where run_id = ?", runId) as
    { state: string; attempts: number };
  assert.equal(submitted.state, "awaiting_batch");
  assert.equal(submitted.attempts, 1, "entering research charges one");

  // settleReady rather than a whole drain: a drain would requeue the job and
  // then immediately claim and re-submit it, which is right but hides the one
  // thing under test.
  await settleReady(db, bv, { deadlineSeconds: 30, mode: "live", cassetteDir: CASSETTE_DIR, live });
  const after = await db.get("select state, attempts, batch_id from enrichment_jobs where run_id = ?", runId) as
    { state: string; attempts: number; batch_id: string | null };
  assert.equal(after.state, "queued", "it is claimable again");
  assert.equal(after.attempts, 0, "and the attempt was given back");
  assert.equal(after.batch_id, null, "and it is no longer pointed at a batch that never answered");

  // And a worker picks it straight back up rather than leaving it for a tick.
  await drainBatched(db, live, bv);
  assert.equal(
    (await db.get("select state from enrichment_jobs where run_id = ?", runId) as { state: string }).state,
    "awaiting_batch", "it is asked again");
});

test("a live run stamps both halves on the run AND on every finding it makes", async () => {
  // The unit above proves the composer; this proves the wiring, which is the
  // half that was actually wrong. worker.ts recorded prompt.ts's constant at
  // both sites regardless of mode, so 462 live findings in production carry a
  // version describing a prompt they were never asked with.
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  const { runId } = await createRun(db, periodId, [northco.id],
    { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
  await ensureSlots(db, 1);
  const [job] = await claimJobs(db, runId, `w-${Math.random()}`, 1);
  await processJob(db, runId, job, PERIOD_AS_OF,
    { mode: "live", cassetteDir: CASSETTE_DIR, live: deps(db, v, fetchDeps) });

  const expected = `${PROMPT_VERSION}+live.${LIVE_RULES_VERSION}`;
  const run = await db.get(
    "select prompt_version from enrichment_runs where id = ?", runId) as { prompt_version: string };
  assert.equal(run.prompt_version, expected, "the run says which prompt it will use");

  const rows = await db.all(
    "select distinct prompt_version from enrichment_findings where run_id = ?", runId) as
      Array<{ prompt_version: string }>;
  assert.ok(rows.length > 0, "the fixture must produce findings, or this proves nothing");
  assert.deepEqual(rows.map((r) => r.prompt_version), [expected],
                   "and every finding says which prompt made it");
});

test("BATCH: the discount is in the ledger, and it stops at the searches", async () => {
  // The budget that halts a run reads this number. A meter that priced a
  // batched request at full rate would halt a run at half its budget.
  //
  // But the discount reaches the TOKENS only: "Web search tool calls through
  // the Messages Batches API are priced the same as those in regular Messages
  // API requests". This test asserted a flat half and so held the meter's own
  // error in place -- the fixture searches twice, and those two cents are due
  // whoever asks.
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  const live = deps(db, v, fetchDeps);
  const spend = async (batched: boolean) => {
    const { runId } = await createRun(db, periodId, [northco.id],
      { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
    if (batched) {
      const { vendor: bv } = batchVendor(v);
      await drainBatched(db, live, bv);
      await drainBatched(db, live, bv);
    } else {
      await ensureSlots(db, 1);
      const [job] = await claimJobs(db, runId, `w-${Math.random()}`, 1);
      await processJob(db, runId, job, PERIOD_AS_OF, { mode: "live", cassetteDir: CASSETTE_DIR, live });
    }
    const r = await db.get("select spend_usd from enrichment_runs where id = ?", runId) as { spend_usd: number };
    const u = await db.get(`select sum((jr.usage ->> 'web_search_requests')) searches
                              from enrichment_job_results jr
                              join enrichment_jobs j on j.id = jr.job_id
                             where j.run_id = ?`, runId) as { searches: number | null };
    return { spend: Number(r.spend_usd), searches: Number(u.searches ?? 0) };
  };
  const batched = await spend(true);
  const liveRun = await spend(false);
  assert.ok(batched.spend > 0 && liveRun.spend > 0, `${batched.spend} / ${liveRun.spend}`);
  assert.ok(liveRun.searches > 0, "the fixture must search, or this proves nothing");
  assert.equal(batched.searches, liveRun.searches, "the same work either way");

  // Half the tokens, all of the searches.
  const searchCharge = liveRun.searches * WEB_SEARCH_USD;
  const expected = (liveRun.spend - searchCharge) * BATCH_DISCOUNT + searchCharge;
  assert.ok(Math.abs(batched.spend - expected) < 1e-9,
            `batched ${batched.spend}, expected ${expected} `
            + `(${liveRun.searches} searches at full price inside ${liveRun.spend})`);
  assert.ok(batched.spend > liveRun.spend / 2,
            "a flat half would understate it, which is the bug this replaced");
});

test("BATCH: an open batch is work, so the tick still invokes a worker", async () => {
  // Once every job is submitted nothing is queued. Without counting batches
  // the tick would conclude "nothing to do" and the answers would never be
  // collected -- a period that stops advancing, with no error anywhere.
  const { db, periodId, northco } = await seeded();
  const { v } = vendor();
  const { fetchDeps } = world();
  const { vendor: bv } = batchVendor(v);
  await createRun(db, periodId, [northco.id],
    { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
  await drainBatched(db, deps(db, v, fetchDeps), bv);

  const queued = await db.get("select count(*) n from enrichment_jobs where state = 'queued'") as { n: number };
  assert.equal(Number(queued.n), 0, "nothing is queued");
  const t = await tick(db, { kick: async () => ({ ok: true, note: "kicked" }) });
  assert.equal(t.pending, 0);
  assert.equal(t.openBatches, 1);
  assert.equal(t.invokedWorker, true, "a worker is still invoked, to collect the answer");
});

test("BATCH: two companies in one batch are told apart by custom_id, never by position", async () => {
  // The worst output this system can produce is a well-cited value from the
  // wrong company's filing, and reading results by position is how that would
  // happen: the API returns them in ANY order. The fake returns them reversed.
  resetTickerCache();
  const { db, periodId, companies } = seedFixtureDatabase() as {
    db: Sql; periodId: string; companies: Array<{ id: string; name: string }>;
  };
  assert.ok(companies.length >= 2, "this test needs two companies");
  const { v } = vendor({ perCompany: true });
  const { fetchDeps } = world();
  const live = deps(db, v, fetchDeps);
  const { vendor: bv } = batchVendor(v);

  const ids = companies.slice(0, 2).map((c) => c.id);
  await createRun(db, periodId, ids, { cassetteDir: CASSETTE_DIR, fieldGroup: "identity", mode: "live" });
  const submit = await drainBatched(db, live, bv);
  assert.equal(submit.jobsBatched, 2, "both went in one batch");
  await drainBatched(db, live, bv);

  // Each company's own answer must land on its own row. The two answers name
  // different websites, so a result read by position lands the wrong one.
  const rows = await db.all(`select c.canonical_name as name, e.proposed_value as value
       from enrichment_findings e join companies c on c.id = e.company_id
      where e.field_key = 'website' order by c.canonical_name`) as
    Array<{ name: string; value: string }>;
  assert.equal(rows.length, 2, `both companies proposed a website: ${JSON.stringify(rows)}`);
  for (const r of rows) {
    const expected = r.name.startsWith("Royalco") ? "royalco" : "northco";
    assert.match(String(r.value), new RegExp(expected),
      `${r.name} was given ${r.value}, which is the other company's answer`);
  }
});


test("EDGAR shouts, and a subdivision code cased down is not a word", async () => {
  // Alkane's head office came back from the first batched run as "Perth, Wa":
  // EDGAR's city field held "PERTH, WA" and title-casing the lot ruined the
  // state. Length alone cannot decide it — "ST LOUIS" starts with two letters
  // that ARE a word — so the comma does: a short segment of its own is a code.
  assert.equal(titleAddress("PERTH, WA"), "Perth, WA");
  assert.equal(titleAddress("VANCOUVER, BC"), "Vancouver, BC");
  assert.equal(titleAddress("SYDNEY, NSW"), "Sydney, NSW");
  assert.equal(titleAddress("LONDON, UK"), "London, UK");

  // A short word INSIDE a longer segment is a word, not a code.
  assert.equal(titleAddress("ST LOUIS"), "St Louis");
  assert.equal(titleAddress("ST. JOHN'S"), "St. John's");
  assert.equal(titleAddress("O'BRIEN"), "O'Brien", "only a lone trailing s goes back down");
  assert.equal(titleAddress("RIO DE JANEIRO"), "Rio De Janeiro");

  // The ordinary cases, unchanged.
  assert.equal(titleAddress("TORONTO"), "Toronto");
  assert.equal(titleAddress("ONTARIO, CANADA"), "Ontario, Canada");
  assert.equal(titleAddress("  "), null);
  assert.equal(titleAddress(null), null);
  // Whitespace around a segment is tidied rather than preserved.
  assert.equal(titleAddress("PERTH ,   WA "), "Perth, WA");

  // regionFrom goes through the same rule, so the two cannot diverge.
  assert.equal(regionFrom("A6", "ONTARIO, CANADA"), "Ontario, Canada");
  assert.equal(regionFrom(null, "NEW SOUTH WALES, AU"), "New South Wales, AU");
  assert.equal(regionFrom("CO", "CO"), "Colorado, United States");
});
