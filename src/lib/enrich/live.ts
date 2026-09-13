/**
 * Live research: two passes, website first.
 *
 * Approved 11 September 2026. The model DISCOVERS; the application FETCHES,
 * checks and quotes; a person ACCEPTS. Nothing here writes a value -- every
 * result is a proposal the review workspace shows with its source and quote.
 *
 *   Pass 1, identity. For every company: find the official website, the SEC
 *   registration if there is one, and the recent filings. The website is
 *   verified by fetching the homepage and finding the company named on it;
 *   the SEC record is fetched from EDGAR and its name must match. A website
 *   only unlocks fetching once an Analyst accepts it (or it came from the
 *   workbook) -- the model never widens what the application trusts.
 *
 *   Pass 2, fields. For a company with a known website: fetch the filings from
 *   that domain and from EDGAR, keep only documents that name the company,
 *   cut windows around what each field needs, and extract every field with
 *   a verbatim quote. The anchoring gate then checks each quote against the
 *   stored document, exactly as it does for a recording.
 *
 * SEDAR+ is legally excluded (decision 1). It is blocked in the search tool,
 * and never on any allowlist.
 */
import { detectScale } from "./anchor.ts";
import { currencyCode } from "../format/fields.ts";
import { ROUTE_CONFIG } from "./client.ts";
import { asStored, edgarFindings, edgarIndexDocuments, lookupEdgar, normalizeName, SEC_HOST } from "./edgar.ts";
import { fetchDocument, type FetchDeps, type FetchedDocument } from "./fetch.ts";
import { buildPrompt, egressScan, type PublicCompanyRow, type RestrictionSet } from "./prompt.ts";
import type { Pass } from "./scope.ts";
import type { CassetteBody, ProposedFinding } from "./worker.ts";

export type { Pass } from "./scope.ts";

/**
 * Hosts that serve issuers' investor-relations documents on the issuer's
 * behalf. A document there is still refused unless it names the company.
 */
export const IR_PLATFORM_HOSTS = ["q4cdn.com"];
/** Never searched, never fetched. Decision 1. */
export const EXCLUDED_DOMAINS = ["sedarplus.ca", "sedarplus.com", "sedar.com"];

const MAX_DOCUMENTS = 5;
const WINDOW_CHARS = 1200;
const MAX_CHARS_PER_DOCUMENT = 30_000;
const MAX_CHARS_TOTAL = 100_000;

/* ------------------------------------------------------------- the vendor */

/** The one method the pipeline needs. The SDK in production; a fake in tests. */
export type Vendor = { create(request: Record<string, unknown>): Promise<VendorMessage> };
export type VendorMessage = {
  content: Array<Record<string, unknown>>;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  usage: {
    input_tokens?: number; output_tokens?: number;
    cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
    server_tool_use?: { web_search_requests?: number } | null;
  };
};

export async function sdkVendor(): Promise<Vendor> {
  // Dynamic, so the test suite and replay never load the SDK.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Five minutes a request; the SDK's own retries cover a dropped connection,
  // and routeFailure decides everything after that.
  const client = new Anthropic({ timeout: 5 * 60_000, maxRetries: 2 });
  return { create: (request) => client.messages.create(request as never) as unknown as Promise<VendorMessage> };
}

/** $/MTok, from the published price list, 11 September 2026. */
export const PRICES: Record<string, { in: number; out: number; cw5: number; cw1h: number; cr: number }> = {
  "claude-opus-5": { in: 5, out: 25, cw5: 6.25, cw1h: 10, cr: 0.5 },
  "claude-sonnet-5": { in: 2, out: 10, cw5: 2.5, cw1h: 4, cr: 0.2 },
};
export const WEB_SEARCH_USD = 0.01;

/**
 * The Batch API's discount, from scope.ts so the meter and the pre-flight
 * estimate cannot disagree about what a batched company costs. A meter that did
 * not know would overstate a run's spend twofold, and the budget that halts a
 * run reads that number.
 */
export { BATCH_DISCOUNT } from "./scope.ts";

/** Usage and cost across every call a job makes. */
export class Meter {
  usage: Record<string, number> = {};
  cost = 0;
  /**
   * Scales every price. 0.5 for a request answered by the Batch API.
   *
   * A plain field assigned in the body, not a parameter property: `node --test`
   * strips types rather than compiling them, and refuses that syntax.
   */
  readonly rate: number;
  constructor(rate = 1) { this.rate = rate; }

  /**
   * Carry a suspended pass's spend across the gap.
   *
   * A batched pass is metered by two processes -- the one that fetched and
   * submitted, and the one that reads the answer hours later. Without this the
   * first half's cost is simply lost from the run's total.
   */
  seed(usage: Record<string, number> | undefined, cost: number | undefined): void {
    for (const [k, v] of Object.entries(usage ?? {})) this.usage[k] = (this.usage[k] ?? 0) + Number(v || 0);
    this.cost += cost ?? 0;
  }

  add(model: string, u: VendorMessage["usage"]): void {
    const p = PRICES[model] ?? PRICES["claude-opus-5"];
    const cw5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    // Without the breakdown, price every cache write at the dearer 1-hour rate.
    const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? ((u.cache_creation_input_tokens ?? 0) - cw5);
    const searches = u.server_tool_use?.web_search_requests ?? 0;
    this.cost += this.rate *
      (((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out +
        cw5 * p.cw5 + Math.max(0, cw1h) * p.cw1h + (u.cache_read_input_tokens ?? 0) * p.cr) / 1e6
       + searches * WEB_SEARCH_USD);
    for (const [k, v] of Object.entries({
      input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens,
      web_search_requests: searches, requests: 1,
    })) this.usage[k] = (this.usage[k] ?? 0) + (Number(v) || 0);
  }
}

export type LiveDeps = {
  vendor: Vendor;
  fetch: FetchDeps;
  /** Persist a fetched document's text (worker.storeDocument). */
  store: (doc: FetchedDocument) => Promise<unknown>;
  /**
   * Read documents back by content hash, in the order asked for.
   *
   * The counterpart of store, and the reason a pass can be suspended between
   * its fetching and its extraction: a batch submitted now is answered by a
   * different worker minutes later, with nothing of this one's memory.
   */
  load: (hashes: readonly string[]) => Promise<FetchedDocument[]>;
  restrictions: RestrictionSet;
};

/** Every request passes the egress scan first; a hit throws and nothing is sent. */
async function call(deps: LiveDeps, meter: Meter, request: Record<string, unknown>): Promise<VendorMessage> {
  egressScan(request, deps.restrictions);
  const msg = await deps.vendor.create(request);
  meter.add(String(request.model), msg.usage ?? {});
  // A refusal arrives as HTTP 200. Read nothing from it.
  if (msg.stop_reason === "refusal") {
    throw new Error(`the model declined (${msg.stop_details?.category ?? "no category given"})`);
  }
  return msg;
}

/* -------------------------------------------------------------- discovery */

export type CandidateDoc = {
  url: string; kind: DocKind; fiscal_year: number | null; title: string;
  provenance: "search_result" | "reported" | "edgar";
};
export type DocKind =
  | "annual_information_form" | "annual_financial_statements" | "annual_mdna" | "information_circular"
  | "change_of_auditor" | "interim_report" | "news_release" | "sec_annual_report" | "other";

const DOC_KINDS: DocKind[] = [
  "annual_information_form", "annual_financial_statements", "annual_mdna", "information_circular",
  "change_of_auditor", "interim_report", "news_release", "sec_annual_report", "other",
];
/** What to read first. The circular carries auditor, tenure and fees; the AIF carries stage and head office. */
const KIND_PRIORITY: DocKind[] = [
  "information_circular", "annual_information_form", "change_of_auditor", "annual_financial_statements",
  "sec_annual_report", "annual_mdna", "interim_report", "news_release", "other",
];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

const REPORT_TOOL = {
  name: "report_sources",
  description:
    "Report what you found. Call this exactly once, at the end. Use null where you found nothing; " +
    "an honest null is a correct answer and a guess is not.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      official_website: { ...nullable({ type: "string" }),
        description: "The company's own website, as https://host. Not a directory, news or exchange page." },
      sec_cik: { ...nullable({ type: "string" }),
        description: "The company's SEC Central Index Key if it files with the SEC, digits only." },
      documents: {
        type: "array",
        description: "Its most recent primary documents, newest first. URLs exactly as you found them.",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            kind: { type: "string", enum: DOC_KINDS },
            fiscal_year: nullable({ type: "integer" }),
            title: { type: "string" },
          },
          required: ["url", "kind", "fiscal_year", "title"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "One or two sentences on anything uncertain." },
    },
    required: ["official_website", "sec_cik", "documents", "notes"],
    additionalProperties: false,
  },
};

const DISCOVERY_RULES = `
Find, for the company named in the message:
1. Its official website.
2. Whether it files with the US SEC, and its CIK if so.
3. Its most recent annual information form, audited annual financial statements, annual MD&A,
   management information circular, and any change-of-auditor notice or reporting package from the
   last 24 months.

Prefer the company's own website and SEC EDGAR. SEDAR+ must not be used. Do not state facts about the
company; another step reads the documents. Report with report_sources, once, at the end.`.trim();

export type Discovery = { report: { official_website: string | null; sec_cik: string | null;
  documents: Array<Omit<CandidateDoc, "provenance">>; notes: string };
  seenUrls: Set<string>; seenHosts: Set<string> };

export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
const canonicalUrl = (u: string) => { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } };

/** Every URL that appeared in a search result or a search citation, wherever it sits in the response. */
export function collectSearchUrls(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) { for (const n of node) collectSearchUrls(n, into); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if ((o.type === "web_search_result" || o.type === "web_search_result_location") && typeof o.url === "string") {
    into.add(canonicalUrl(o.url));
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collectSearchUrls(v, into);
}

/**
 * The discovery request, built and not sent.
 *
 * Separated from the sending so the SAME request can go to the Batch API. The
 * web searches happen inside this one call -- the tool is server-side -- so
 * one request is the whole of discovery in the ordinary case: in Run 2 all 30
 * identity jobs and 40 of 41 field jobs made exactly one vendor call. The loop
 * below exists for the company where it does not.
 */
export function discoveryRequest(row: PublicCompanyRow): Record<string, unknown> {
  const cfg = ROUTE_CONFIG.discovery;
  const prompt = buildPrompt("discovery", row);
  return {
    model: cfg.model, max_tokens: 16000, thinking: { type: "adaptive" },
    output_config: { effort: cfg.effort },
    system: [{ type: "text", text: `${prompt.stablePrefix}\n\n${DISCOVERY_RULES}`,
               cache_control: { type: "ephemeral", ttl: "1h" } }],
    // A constant tools block: a per-company domain list here would rebuild the
    // cache for every company (docs/design/06).
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 6, blocked_domains: EXCLUDED_DOMAINS },
      REPORT_TOOL,
    ],
    messages: [{ role: "user", content: prompt.userContent }],
  };
}

/** The report out of one answer, or null when the model has not filed one yet. */
function reportIn(msg: VendorMessage): Discovery["report"] | null {
  const block = msg.content.find((b) => b.type === "tool_use" && b.name === "report_sources");
  return block ? block.input as Discovery["report"] : null;
}

/**
 * Read the report out of the first answer, forcing one if it is missing.
 *
 * Both the synchronous path and the batch's resume come through here, so a
 * batched discovery and a live one cannot diverge -- and a batch result that
 * arrived without a report is finished synchronously rather than thrown away.
 */
export async function continueDiscovery(
  request: Record<string, unknown>, first: VendorMessage, deps: LiveDeps, meter: Meter,
): Promise<Discovery> {
  const messages = [...(request.messages as Array<Record<string, unknown>>)];
  const seenUrls = new Set<string>();
  let msg = first;

  for (let turn = 0; turn < 6; turn++) {
    collectSearchUrls(msg.content, seenUrls);
    const report = reportIn(msg);
    if (report) {
      const seenHosts = new Set([...seenUrls].map(hostOf).filter((h): h is string => Boolean(h)));
      return { report, seenUrls, seenHosts };
    }
    if (msg.stop_reason === "max_tokens") throw new Error("discovery ran out of output tokens before reporting");
    messages.push({ role: "assistant", content: msg.content });
    // A paused server-side loop resumes on its own when the turn is resent.
    if (msg.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Call report_sources now with what you found. Use null where you found nothing." });
    }
    msg = await call(deps, meter, { ...request, messages });
  }
  throw new Error("discovery did not report its sources within six turns");
}

export async function discover(row: PublicCompanyRow, deps: LiveDeps, meter: Meter): Promise<Discovery> {
  const request = discoveryRequest(row);
  return continueDiscovery(request, await call(deps, meter, request), deps, meter);
}

/* ---------------------------------------------------------- identity pass */

/** Does this text name the company -- its core name, or its ticker as a word? */
export function namesCompany(text: string, row: Pick<PublicCompanyRow, "canonicalName" | "rootTicker">): number {
  const core = normalizeName(row.canonicalName);
  const hay = normalizeName(text.slice(0, 400_000));
  if (core && hay.includes(core)) {
    // Index into the ORIGINAL text, for a quote that anchors.
    const first = core.split(" ")[0];
    const at = text.toLowerCase().indexOf(first);
    return at >= 0 ? at : 0;
  }
  const t = row.rootTicker.trim();
  if (t.length >= 2) {
    const m = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(text);
    if (m) return m.index;
  }
  return -1;
}

/** A verbatim slice of the text around an index, trimmed to whole words. */
export function quoteAround(text: string, at: number, width = 220): string {
  const start = Math.max(0, at - 40);
  const slice = text.slice(start, start + width);
  return slice.replace(/^\S*\s/, "").replace(/\s\S*$/, "").trim() || slice.trim();
}

async function verifyWebsite(
  proposed: string | null, row: PublicCompanyRow, seenHosts: Set<string>, deps: LiveDeps,
): Promise<{ finding: ProposedFinding; doc: FetchedDocument | null }> {
  const host = proposed ? hostOf(proposed.startsWith("http") ? proposed : `https://${proposed}`) : null;
  if (!host) {
    return { finding: { field_key: "website", value: null, abstained: true,
      abstention_reason: "no official website found" }, doc: null };
  }
  const value = `https://${host}`;
  if (!seenHosts.has(host) || EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    // Proposed but never seen in a search result: nothing to check it against.
    return { finding: { field_key: "website", value, source_url: value, source_tier: 5,
      model_self_confidence: null, evidence_excerpt: null }, doc: null };
  }
  let doc: FetchedDocument;
  try {
    // A verification fetch: this one host, the homepage, nothing else.
    doc = await fetchDocument(value, new Set([host]), deps.fetch);
  } catch {
    return { finding: { field_key: "website", value, source_url: value, source_tier: 2,
      evidence_excerpt: null }, doc: null };
  }
  const at = namesCompany(doc.text, row);
  if (at < 0) {
    // Fetched, and the company is not named on it. Not a fabrication -- the
    // site may render its name as an image -- but not verified either, so it
    // names no document and goes to an Analyst unanchored.
    return { finding: { field_key: "website", value, source_url: doc.finalUrl, source_tier: 2,
      evidence_excerpt: null }, doc: null };
  }
  return {
    finding: {
      field_key: "website", value, source_url: doc.finalUrl, source_tier: 2,
      document_hash: doc.contentHash, document_age_days: 0,
      evidence_excerpt: quoteAround(doc.text, at),
      // The homepage naming the company is one corroboration; search is the other.
      corroborating_sources: 2,
    },
    doc,
  };
}

export type LiveJob = {
  pass: Pass;
  row: PublicCompanyRow;
  /** The website the application already trusts: the workbook's, or an accepted one. */
  website: string | null;
  /** Documents pass 1 found, reused by pass 2 instead of searching again. */
  priorCandidates: CandidateDoc[] | null;
};

export type LiveBody = CassetteBody & { candidates?: CandidateDoc[]; notes?: string[] };

/**
 * A pass, cut in half at its model call.
 *
 * Everything before the call is `prepare`; everything after it is `resume`.
 * The synchronous path is prepare, call, resume -- so there is ONE
 * implementation of each pass, and a batched company and a live one cannot
 * drift apart. A pass that finishes without needing the model at all (pass 2
 * where nothing was fetchable) returns its body from prepare.
 */
export type Prepared =
  | { kind: "request"; request: Record<string, unknown>; context: PassContext }
  | { kind: "done"; body: LiveBody };

/** What resume needs and the worker that submitted the batch will not be alive to hold. */
export type PassContext = {
  /** Documents pass 2 fetched, by content hash, in the order the prompt indexes them. */
  docHashes?: string[];
  notes?: string[];
};

export function identityPrepare(job: LiveJob): Prepared {
  return { kind: "request", request: discoveryRequest(job.row), context: {} };
}

export async function identityResume(
  job: LiveJob, _context: PassContext, first: VendorMessage, deps: LiveDeps, meter: Meter,
): Promise<LiveBody> {
  const found = await continueDiscovery(discoveryRequest(job.row), first, deps, meter);
  const findings: ProposedFinding[] = [];
  const documents: NonNullable<CassetteBody["documents"]> = [];
  const notes: string[] = [];
  if (found.report.notes) notes.push(found.report.notes);

  let verifiedHost: string | null = job.website ? hostOf(job.website) : null;
  if (!job.website) {
    const w = await verifyWebsite(found.report.official_website, job.row, found.seenHosts, deps);
    findings.push(w.finding);
    if (w.doc) { await deps.store(w.doc); documents.push(asStored(w.doc)); }
    if (w.finding.evidence_excerpt) verifiedHost = hostOf(String(w.finding.value));
  }

  const candidates: CandidateDoc[] = (found.report.documents ?? [])
    .filter((d) => DOC_KINDS.includes(d.kind))
    .map((d) => ({ ...d, provenance: found.seenUrls.has(canonicalUrl(d.url)) ? "search_result" as const : "reported" as const }));

  const edgar = await lookupEdgar({ name: job.row.canonicalName, ticker: job.row.rootTicker },
                                  found.report.sec_cik, deps.fetch);
  if (edgar) {
    await deps.store(edgar.doc);
    documents.push(asStored(edgar.doc));
    const fromEdgar = edgarFindings(edgar.record, edgar.doc);
    // EDGAR's own record of the website corroborates the verified one.
    const website = findings.find((f) => f.field_key === "website");
    if (website && verifiedHost && edgar.record.website && hostOf(edgar.record.website) === verifiedHost) {
      website.corroborating_sources = (website.corroborating_sources ?? 0) + 1;
    }
    findings.push(...fromEdgar);
    if (edgar.record.latestAnnual) {
      candidates.push({ url: edgar.record.latestAnnual.url, kind: "sec_annual_report",
        fiscal_year: Number(edgar.record.latestAnnual.filed.slice(0, 4)) - 1, title: edgar.record.latestAnnual.form,
        provenance: "edgar" });
      for (const url of await edgarIndexDocuments(edgar.record.latestAnnual.indexUrl, deps.fetch)) {
        candidates.push({ url, kind: "sec_annual_report", fiscal_year: null, title: "annual report exhibit", provenance: "edgar" });
      }
    }
  } else {
    findings.push({ field_key: "sec_registrant", value: null, abstained: true,
      abstention_reason: "EDGAR has no registrant whose name matches this company" });
  }

  return { findings, documents, usage: meter.usage, cost_usd: meter.cost, candidates, notes };
}

export async function identityPass(job: LiveJob, deps: LiveDeps, meter: Meter): Promise<LiveBody> {
  const prepared = identityPrepare(job);
  if (prepared.kind === "done") return prepared.body;
  const msg = await call(deps, meter, prepared.request);
  return identityResume(job, prepared.context, msg, deps, meter);
}

/* ------------------------------------------------------------ fields pass */

/** Where in a filing each field's evidence lives. */
const WINDOW_PATTERNS: RegExp[] = [
  /independent auditor|chartered professional accountants|auditors? of the (company|corporation)|appointed .{0,40}auditor|auditor since|nomination de l.auditeur/gi,
  /audit fees|audit-related fees|tax fees|all other fees|external auditor service fees|honoraires/gi,
  /commercial production|producing mine|production decision|construction decision|feasibility study|preliminary economic assessment|exploration[- ]stage|development[- ]stage|royalt(y|ies)|streaming/gi,
  /head office|registered office|principal (executive )?office|si[eè]ge social/gi,
  /(fiscal|financial) year|years? ended|exercice/gi,
  /change of auditor|reporting package|successor auditor|former auditor|resign(ed|ation) as auditor/gi,
];

/** The cover and every window that matters, verbatim, merged and capped. */
export function windowsOf(text: string): string {
  const spans: Array<[number, number]> = [[0, Math.min(text.length, 3000)]];
  for (const re of WINDOW_PATTERNS) {
    let hits = 0;
    for (const m of text.matchAll(re)) {
      spans.push([Math.max(0, m.index! - WINDOW_CHARS), Math.min(text.length, m.index! + WINDOW_CHARS)]);
      if (++hits >= 6) break;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  let out = "";
  for (const [a, b] of merged) {
    const piece = text.slice(a, b);
    if (out.length + piece.length > MAX_CHARS_PER_DOCUMENT) break;
    out += (out ? "\n[...]\n" : "") + piece;
  }
  return out;
}

export const EXTRACTED_FIELDS = [
  "stage_evidence_state", "auditor", "auditor_since", "auditor_change", "fiscal_year_end",
  "head_office_location", "head_office_region", "audit_fee", "tax_fee",
] as const;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field_key: { type: "string", enum: EXTRACTED_FIELDS },
          document_index: nullable({ type: "integer" }),
          evidence_excerpt: nullable({ type: "string" }),
          abstained: { type: "boolean" },
          abstention_reason: nullable({ type: "string" }),
          self_confidence: { type: "number" },
          text_value: nullable({ type: "string" }),
          year_value: nullable({ type: "integer" }),
          stage: nullable({
            type: "object",
            properties: {
              exploration: nullable({ type: "boolean" }), development: nullable({ type: "boolean" }),
              production: nullable({ type: "boolean" }), royalty_streaming: nullable({ type: "boolean" }),
            },
            required: ["exploration", "development", "production", "royalty_streaming"],
            additionalProperties: false,
          }),
          auditor_change: nullable({
            type: "object",
            properties: {
              changed: { type: "boolean" }, date: nullable({ type: "string" }),
              previous_auditor: nullable({ type: "string" }),
            },
            required: ["changed", "date", "previous_auditor"],
            additionalProperties: false,
          }),
          fee: nullable({
            type: "object",
            properties: {
              amount: { type: "number" },
              scale: { type: "string", enum: ["units", "thousands", "millions"] },
              fiscal_year: nullable({ type: "integer" }),
              currency: nullable({ type: "string" }),
            },
            required: ["amount", "scale", "fiscal_year", "currency"],
            additionalProperties: false,
          }),
        },
        required: ["field_key", "document_index", "evidence_excerpt", "abstained", "abstention_reason",
                   "self_confidence", "text_value", "year_value", "stage", "auditor_change", "fee"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

const EXTRACTION_RULES = `
Return one finding for EVERY field listed, in this form:
- stage_evidence_state: the stage object. production = commercial production declared or revenue
  from mining; development = construction decision or feasibility-stage project; exploration =
  exploration properties; royalty_streaming = royalty or stream interests the company holds as a
  business. true only where a document says so; false where it says otherwise; null where it does
  not say. The evidence_excerpt must name the most advanced stage you set true (production, then
  royalty or streaming, then development, then exploration): a quote about exploration does not
  support royalty_streaming.
- auditor: text_value, the firm's name as printed.
- auditor_since: year_value, the year the current auditor was first appointed.
- auditor_change: whether the auditor changed in the 24 months before the period date. If it did
  not, quote the passage that establishes the current auditor's tenure; if nothing does, abstain.
- fiscal_year_end: text_value as MM-DD.
- head_office_location: text_value, the city. head_office_region: text_value, "Province or State,
  Country".
- audit_fee, tax_fee: fee, the most recent fiscal year, with the amount EXACTLY as printed and the
  scale the table states (units, thousands or millions). fiscal_year is the year of the column or
  sentence the amount is for, not the year of the filing. currency is the ISO code (CAD, USD, AUD,
  GBP, EUR) the amount is in: from its own symbol (C$, US$), the table heading, or the document's
  statement of reporting currency. A Canadian issuer's plain "$" with no other currency stated is
  CAD. null only if nothing in the documents says.

evidence_excerpt must be copied character for character from the document it cites, at most 300
characters, and document_index must name that document. If the documents do not state a value,
set abstained true and say why. Abstaining is a correct answer; a guess is not.`.trim();

/** Canonical firm names, as the auditors table spells them. */
const AUDITOR_NAMES: Array<[RegExp, string]> = [
  [/deloitte/i, "Deloitte"], [/pricewaterhouse|\bpwc\b/i, "PwC"], [/\bkpmg\b/i, "KPMG"],
  [/ernst\s*&\s*young|\bey\b/i, "Ernst & Young"], [/\bbdo\b/i, "BDO"], [/grant thornton/i, "Grant Thornton"],
  [/\bmnp\b/i, "MNP"], [/davidson/i, "Davidson & Company"], [/mcgovern/i, "McGovern Hurley"],
  [/crowe/i, "Crowe MacKay"], [/kingston ross/i, "Kingston Ross Pasnak"], [/\bms partners\b/i, "MS Partners"],
  [/d\s*\+\s*h/i, "D+H Group"], [/zeifmans/i, "Zeifmans"], [/smythe/i, "Smythe"], [/\bdntw\b/i, "DNTW"],
];
export function canonicalAuditor(name: string): string {
  return AUDITOR_NAMES.find(([re]) => re.test(name))?.[1] ?? name.trim();
}

const SCALE: Record<string, number> = { units: 1, thousands: 1_000, millions: 1_000_000 };

type Extracted = {
  field_key: typeof EXTRACTED_FIELDS[number]; document_index: number | null; evidence_excerpt: string | null;
  abstained: boolean; abstention_reason: string | null; self_confidence: number;
  text_value: string | null; year_value: number | null;
  stage: Record<string, boolean | null> | null;
  auditor_change: { changed: boolean; date: string | null; previous_auditor: string | null } | null;
  fee: { amount: number; scale: "units" | "thousands" | "millions"; fiscal_year: number | null; currency: string | null } | null;
};

/**
 * A model sometimes writes a character as its escape -- Val-d, backslash,
 * u2019, Or -- inside an otherwise verbatim quote (Run 1, pass 2).
 * The quote is still the document's; this puts the character back. It
 * changes nothing a model could use to pass off text that is not there.
 */
export function unescapeModelText(s: string | null): string | null {
  if (s === null) return null;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** One extraction item as a proposed finding, citing the document it names. */
export function toFinding(raw: Extracted, docs: FetchedDocument[]): ProposedFinding | null {
  const e = { ...raw, evidence_excerpt: unescapeModelText(raw.evidence_excerpt),
              text_value: unescapeModelText(raw.text_value) };
  const doc = e.document_index !== null ? docs[e.document_index] ?? null : null;
  const base: ProposedFinding = {
    field_key: e.field_key, value: null,
    evidence_excerpt: e.evidence_excerpt, model_self_confidence: e.self_confidence,
    abstained: e.abstained, abstention_reason: e.abstention_reason,
    source_url: doc?.finalUrl ?? null, source_tier: doc?.sourceTier ?? 5,
    document_hash: doc?.contentHash ?? null, document_age_days: null,
    corroborating_sources: doc ? 1 : 0,
  };
  if (e.abstained) return base;
  switch (e.field_key) {
    case "stage_evidence_state":
      return e.stage ? { ...base, value: e.stage } : null;
    case "auditor":
      return e.text_value ? { ...base, value: canonicalAuditor(e.text_value) } : null;
    case "auditor_since":
      return e.year_value ? { ...base, value: e.year_value } : null;
    case "auditor_change":
      return e.auditor_change ? { ...base, value: e.auditor_change } : null;
    case "fiscal_year_end":
      return e.text_value && /^\d{2}-\d{2}$/.test(e.text_value) ? { ...base, value: e.text_value } : null;
    case "head_office_location": case "head_office_region":
      return e.text_value ? { ...base, value: e.text_value.trim() } : null;
    case "audit_fee": case "tax_fee": {
      if (!e.fee) return null;
      const units = e.fee.amount * SCALE[e.fee.scale];
      // The fee keeps its currency and year: "C$8,052,000 (FY2025)" and
      // "US$517,116" are different amounts, and Run 1's "$353,190" was a 2024
      // fee on a 2025 period. The gate checks the currency where the
      // document states one.
      const currency = currencyCode(e.fee.currency);
      return { ...base, value: { amount: units, currency, fiscal_year: e.fee.fiscal_year ?? null },
               numeric: { value: units, scale: e.fee.scale, fiscalYear: e.fee.fiscal_year ?? undefined, currency } };
    }
  }
  return null;
}

function rankCandidates(candidates: CandidateDoc[], allow: Set<string>): CandidateDoc[] {
  const allowed = (url: string) => {
    const h = hostOf(url);
    return Boolean(h) && [...allow].some((a) => h === a || h!.endsWith(`.${a}`));
  };
  const seen = new Set<string>();
  return candidates
    .filter((c) => allowed(c.url))
    .filter((c) => { const k = canonicalUrl(c.url); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) =>
      (KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind)) ||
      ((b.fiscal_year ?? 0) - (a.fiscal_year ?? 0)) ||
      // Seen in a search result beats merely reported: a transcribed URL may not exist.
      ((a.provenance === "reported" ? 1 : 0) - (b.provenance === "reported" ? 1 : 0)));
}

/** Most fetches a pass-2 job makes, index pages included: bounded work per company. */
const MAX_FETCHES = 12;
/** Most filings taken from one index page. */
const MAX_LINKS_PER_PAGE = 6;

/** What a linked file most likely is, from its address. */
export function kindFromUrl(url: string): DocKind | null {
  const u = decodeURIComponent(url).toLowerCase();
  if (/form[-_ ]?of[-_ ]?proxy|voting[-_ ]?instruction|\bvif\b|notice[-_ ]?and[-_ ]?access/.test(u)) return null;
  const interim = /\bq[123]\b|q[123][-_]|[-_]q[123]|interim|quarter/.test(u);
  if (/circular|\bmic\b|proxy/.test(u)) return "information_circular";
  if (/\baif\b|aif[-_]|[-_]aif|annual[-_ ]?information/.test(u)) return "annual_information_form";
  if (/change[-_ ]?of[-_ ]?auditor|auditor[-_ ]?change|reporting[-_ ]?package/.test(u)) return "change_of_auditor";
  if (/financial[-_ ]?statements|\bfs\b|fs[-_]|[-_]fs\b/.test(u)) return interim ? "interim_report" : "annual_financial_statements";
  if (/md[-_&]?a\b|mda[-_]|management[-_ ]?s?[-_ ]?discussion/.test(u)) return interim ? "interim_report" : "annual_mdna";
  if (/annual[-_ ]?report/.test(u)) return "annual_financial_statements";
  return null;
}

/**
 * The filings an index page links to, on hosts already trusted, most useful
 * first. A link to anything that is not plausibly a filing is ignored.
 */
export function linkedFilings(links: string[], allow: Set<string>, seen: Set<string>): CandidateDoc[] {
  const allowed = (url: string) => {
    const h = hostOf(url);
    return Boolean(h) && [...allow].some((a) => h === a || h!.endsWith(`.${a}`));
  };
  const found: CandidateDoc[] = [];
  for (const url of links) {
    const key = canonicalUrl(url);
    if (seen.has(key) || !allowed(url) || !/\.pdf($|\?)/i.test(url)) continue;
    const kind = kindFromUrl(url);
    if (!kind) continue;
    const years = [...url.matchAll(/20\d\d/g)].map((m) => Number(m[0]));
    found.push({ url, kind, fiscal_year: years.length ? Math.max(...years) : null, title: "linked from the company's page",
                 provenance: "reported" });
  }
  found.sort((a, b) =>
    (KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind)) || ((b.fiscal_year ?? 0) - (a.fiscal_year ?? 0)));
  const picked = found.slice(0, MAX_LINKS_PER_PAGE);
  for (const p of picked) seen.add(canonicalUrl(p.url));
  return picked;
}

export async function fieldsPrepare(job: LiveJob, deps: LiveDeps, meter: Meter): Promise<Prepared> {
  const siteHost = job.website ? hostOf(job.website) : null;
  if (!siteHost) {
    throw new Error("the fields pass needs a website the application trusts; run the identity pass and accept its website first");
  }
  const allow = new Set([siteHost, SEC_HOST, ...IR_PLATFORM_HOSTS]);
  const notes: string[] = [];

  let candidates = job.priorCandidates ?? [];
  if (candidates.length === 0) {
    const found = await discover(job.row, deps, meter);
    candidates = (found.report.documents ?? []).map((d) => ({ ...d,
      provenance: found.seenUrls.has(canonicalUrl(d.url)) ? "search_result" as const : "reported" as const }));
  }

  const docs: FetchedDocument[] = [];
  const queue = rankCandidates(candidates, allow);
  const seen = new Set(queue.map((c) => canonicalUrl(c.url)));
  let fetches = 0;
  while (queue.length > 0 && docs.length < MAX_DOCUMENTS && fetches < MAX_FETCHES) {
    const c = queue.shift()!;
    fetches++;
    let doc: FetchedDocument;
    try {
      doc = await fetchDocument(c.url, allow, deps.fetch);
    } catch (err) {
      notes.push(`not fetched: ${c.url} (${(err as Error).message.slice(0, 120)})`);
      continue;
    }
    // A page on the company's own site that links to its filings is an index:
    // discovery often stops at "Investors" or "AGM materials" when its search
    // budget runs out (Run 1, Radisson). Follow its links, read none of it.
    if (doc.docType === "html") {
      const linked = linkedFilings(doc.links ?? [], allow, seen);
      if (linked.length > 0) {
        queue.unshift(...linked);
        notes.push(`followed ${linked.length} filing link(s) from ${c.url}`);
        continue;
      }
    }
    if (!doc.hasTextLayer) { notes.push(`no text layer: ${c.url}`); continue; }
    // The worst output this system can produce is a well-cited fee from the
    // wrong company's filing. A document that does not name the company is
    // not this company's document.
    if (namesCompany(doc.text, job.row) < 0) { notes.push(`does not name the company: ${c.url}`); continue; }
    await deps.store(doc);
    docs.push(doc);
  }
  if (docs.length === 0) {
    // Nothing to read, so nothing to ask. This pass finishes without a model
    // call, which is why prepare may return a finished body.
    return { kind: "done",
             body: { findings: [], documents: [], usage: meter.usage, cost_usd: meter.cost, notes } };
  }

  let budget = MAX_CHARS_TOTAL;
  const blocks = docs.map((d, i) => {
    const w = windowsOf(d.text).slice(0, Math.max(0, budget));
    budget -= w.length;
    return { type: "text", text: `<document index="${i}" url="${d.finalUrl}">\n${w}\n</document>` };
  });

  const cfg = ROUTE_CONFIG.extract_general;
  const prompt = buildPrompt("extract_general", job.row);
  return {
    kind: "request",
    request: {
      model: cfg.model, max_tokens: 16000, thinking: { type: "adaptive" },
      output_config: { effort: cfg.effort, format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
      system: [{ type: "text", text: `${prompt.stablePrefix}\n\n${EXTRACTION_RULES}`,
                 cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: [...blocks, { type: "text", text: prompt.userContent }] }],
    },
    // The documents are named by hash rather than carried: the worker that
    // reads the answer is not the one that fetched them. They are already
    // stored -- deps.store above -- so the hash is enough.
    context: { docHashes: docs.map((d) => d.contentHash), notes },
  };
}

export async function fieldsResume(
  _job: LiveJob, context: PassContext, msg: VendorMessage, deps: LiveDeps, meter: Meter,
): Promise<LiveBody> {
  const notes = context.notes ?? [];
  const docs = await deps.load(context.docHashes ?? []);
  if (docs.length !== (context.docHashes ?? []).length) {
    // document_index in the answer points into THIS list. A short list would
    // silently attribute a finding to the wrong filing, which is the worst
    // output this system can produce.
    throw new Error(
      `the extraction cited ${(context.docHashes ?? []).length} document(s) but only ` +
      `${docs.length} could be read back; refusing to map findings onto a different list`);
  }
  if (msg.stop_reason === "max_tokens") throw new Error("extraction ran out of output tokens");
  const text = msg.content.filter((b) => b.type === "text").map((b) => String(b.text)).join("");
  let parsed: { findings: Extracted[] };
  try { parsed = JSON.parse(text); } catch { throw new Error("extraction did not return valid JSON"); }

  const findings = parsed.findings.map((e) => toFinding(e, docs)).filter((f): f is ProposedFinding => f !== null);
  const documents = docs.map((d) => asStored(d, detectScale(d.text) ?? null));
  return { findings, documents, usage: meter.usage, cost_usd: meter.cost, notes };
}

export async function fieldsPass(job: LiveJob, deps: LiveDeps, meter: Meter): Promise<LiveBody> {
  const prepared = await fieldsPrepare(job, deps, meter);
  if (prepared.kind === "done") return prepared.body;
  const msg = await call(deps, meter, prepared.request);
  return fieldsResume(job, prepared.context, msg, deps, meter);
}

/** Prepare one pass: everything up to, but not including, its model call. */
export async function preparePass(job: LiveJob, deps: LiveDeps, meter: Meter): Promise<Prepared> {
  return job.pass === "identity" ? identityPrepare(job) : fieldsPrepare(job, deps, meter);
}

/** Finish one pass from the answer to that call, whoever obtained it. */
export async function resumePass(
  job: LiveJob, context: PassContext, msg: VendorMessage, deps: LiveDeps, meter: Meter,
): Promise<LiveBody> {
  return job.pass === "identity"
    ? identityResume(job, context, msg, deps, meter)
    : fieldsResume(job, context, msg, deps, meter);
}

export async function researchLive(job: LiveJob, deps: LiveDeps): Promise<LiveBody> {
  const meter = new Meter();
  return job.pass === "identity" ? identityPass(job, deps, meter) : fieldsPass(job, deps, meter);
}
