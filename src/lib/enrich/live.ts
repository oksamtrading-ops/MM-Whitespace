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
import { currenciesMentioned, detectScale } from "./anchor.ts";
import {
  canonicalCommodities, canonicalErp, currencyCode, erpChangeStatus, namesCommodity, namesSystem,
} from "../format/fields.ts";
import { canonicalRegion } from "../publish/jurisdictions.ts";
import type { Mode } from "./cassette.ts";
import { DISCOVERY_MAX_SEARCHES, ROUTE_CONFIG } from "./client.ts";
import {
  asStored, edgarFindings, edgarIndexDocuments, edgarProxy, lookupEdgar, normalizeName, SEC_HOST, type EdgarRecord,
} from "./edgar.ts";
import { fetchDocument, type FetchDeps, type FetchedDocument } from "./fetch.ts";
import { buildPrompt, egressScan, PROMPT_VERSION, type PublicCompanyRow, type RestrictionSet } from "./prompt.ts";
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
/**
 * Pass 2's answer, thinking included. 16,000 stopped enCore Energy's on 20
 * October 2026, when the run's other 243 answers peaked at 11,849. This is
 * twice that, and at the ~100 tokens a second the run wrote, about four minutes:
 * inside the vendor's five-minute timeout, which the SDK retries twice.
 */
const EXTRACTION_MAX_TOKENS = 24_000;

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
   * Scales the TOKEN prices only. 0.5 for a request answered by the Batch API.
   *
   * Not the web-search charge: "Web search tool calls through the Messages
   * Batches API are priced the same as those in regular Messages API requests"
   * (the web search tool's own documentation, read 13 September 2026). The
   * discount is documented on tokens, and a search is billed per call whoever
   * asks. Scaling it too understated the two batched runs by half their search
   * charge -- $0.09 of run b5d3d9c3's 18 searches, $0.03 of run 4ba5d7d7's six
   * -- and would have understated Run 3's 229 companies by about $6.87. The
   * budget that HALTS a run reads this number, so understating it spends
   * further than the Analyst agreed to.
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
        cw5 * p.cw5 + Math.max(0, cw1h) * p.cw1h + (u.cache_read_input_tokens ?? 0) * p.cr) / 1e6)
      + searches * WEB_SEARCH_USD;
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
  /**
   * Told what each model call cost, as soon as it returns. A pass that is cut
   * off before it finishes has still been billed for the calls it made, and
   * without this none of them reached the run's spend.
   */
  spent?: (usd: number) => Promise<void>;
};

/** Every request passes the egress scan first; a hit throws and nothing is sent. */
async function call(deps: LiveDeps, meter: Meter, request: Record<string, unknown>): Promise<VendorMessage> {
  egressScan(request, deps.restrictions);
  const msg = await deps.vendor.create(request);
  const before = meter.cost;
  meter.add(String(request.model), msg.usage ?? {});
  await deps.spent?.(meter.cost - before);
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
/**
 * What to read first, by where the issuer must print its audit fees.
 *
 * NI 52-110: a venture issuer (TSXV) puts its audit committee disclosure, the
 * fee table with it, in its management information circular (Form 52-110F2).
 * Any other issuer puts it in its AIF (Form 52-110F1), and its circular refers
 * the reader there. A 40-F carries the AIF as an exhibit; a 10-K or 20-F
 * prints the accountant's fees itself. The circular also carries the auditor's
 * tenure and the AIF the stage and head office, so both are read when there is
 * room: the order decides which is read first, inside the budget.
 *
 * Until 21 October 2026 every company read the circular first, and 60 TSX
 * companies abstained on the audit fee in Q4 pass 2.
 */
const VENTURE_PRIORITY: DocKind[] = [
  "information_circular", "annual_information_form", "change_of_auditor", "annual_financial_statements",
  "sec_annual_report", "annual_mdna", "interim_report", "news_release", "other",
];
const NON_VENTURE_PRIORITY: DocKind[] = [
  "annual_information_form", "sec_annual_report", "information_circular", "change_of_auditor",
  "annual_financial_statements", "annual_mdna", "interim_report", "news_release", "other",
];

/** The reading order for a company on this exchange. Anything but the TSX reads as a venture issuer, as all did before. */
export function kindPriority(exchange: string): readonly DocKind[] {
  return exchange === "TSX" ? NON_VENTURE_PRIORITY : VENTURE_PRIORITY;
}

/** The kinds that print the fee table, for a company on this exchange. */
function feeKinds(exchange: string): readonly DocKind[] {
  return exchange === "TSX" ? ["annual_information_form", "sec_annual_report"] : ["information_circular", "sec_annual_report"];
}

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

/**
 * The version of the live pipeline's OWN half of the prompt.
 *
 * A live request is two halves: prompt.ts's stable prefix, versioned by
 * PROMPT_VERSION, and the rules below, which until now were versioned by
 * nothing at all. Every finding the live pipeline made recorded the prefix's
 * version alone -- all 462 of them in production read "2026-09-04.1", a
 * number that describes a prompt none of them were asked with. Editing
 * DISCOVERY_RULES or EXTRACTION_RULES moved no version anywhere, so the record
 * could not tell a finding made before the edit from one made after.
 *
 * Raise this whenever either rules block, or FEE_SEARCH, changes.
 * promptVersionFor() composes it with the prefix's version, so a stored value
 * names both halves.
 *
 * 2026-10-21.1: pass 2 searches again, with FEE_SEARCH, when pass 1 found no
 * current filing of the kind the fees are printed in.
 * 2026-10-22.1: pass 2 asks whether the company is changing its ERP
 * (erp_change), named or not.
 */
export const LIVE_RULES_VERSION = "2026-10-22.1";

/**
 * What produced a finding, for the record: the prefix's version alone in
 * replay, and both halves in live.
 *
 * Composed rather than replaced, because a live finding really is subject to
 * both -- a change to the shared prefix has to show on live findings too.
 */
export function promptVersionFor(mode: Mode | undefined): string {
  return mode === "live" ? `${PROMPT_VERSION}+live.${LIVE_RULES_VERSION}` : PROMPT_VERSION;
}

const DISCOVERY_RULES = `
Find, for the company named in the message:
1. Its official website.
2. Whether it files with the US SEC, and its CIK if so.
3. Its most recent annual information form, audited annual financial statements, annual MD&A,
   management information circular, and any change-of-auditor notice or reporting package from the
   last 24 months.

Prefer the company's own website and SEC EDGAR. SEDAR+ must not be used. Do not state facts about the
company; another step reads the documents. Report with report_sources, once, at the end.`.trim();

/**
 * What pass 2 adds to the discovery message when pass 1's list has no current
 * filing of the kind the fees are printed in. Pass 1 asks for every kind at
 * once, and for 55 of the 78 venture issuers that abstained on the audit fee
 * in Q4 it had found no circular, AIF or SEC annual report from 2024 on.
 */
const FEE_SEARCH: Record<"venture" | "non_venture", string> = {
  venture: `
The documents already found for this company include no management information circular for its
most recent annual general meeting. Find that circular: as a venture issuer the company
prints its audit committee disclosure and the external auditor service fees there (Form 52-110F2).
Look on the company's own website, including its investor, AGM and shareholder meeting pages, and on
SEC EDGAR if it files there. Report any other document the rules ask for that you find on the way.`.trim(),
  non_venture: `
The documents already found for this company include no annual information form or SEC annual report
for its most recent fiscal year. Find its most recent annual information form: its audit committee section
prints the external auditor service fees (Form 52-110F1). If it files with the SEC, its latest 40-F
carries the AIF as an exhibit, and a 10-K or 20-F prints the fees itself. Report any other document
the rules ask for that you find on the way.`.trim(),
};

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
export function discoveryRequest(row: PublicCompanyRow, also?: string): Record<string, unknown> {
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
      { type: "web_search_20260209", name: "web_search", max_uses: DISCOVERY_MAX_SEARCHES,
        blocked_domains: EXCLUDED_DOMAINS },
      REPORT_TOOL,
    ],
    // In the message, not the rules: the system block stays one cached prefix.
    messages: [{ role: "user", content: also ? `${prompt.userContent}\n\n${also}` : prompt.userContent }],
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

export async function discover(row: PublicCompanyRow, deps: LiveDeps, meter: Meter, also?: string): Promise<Discovery> {
  const request = discoveryRequest(row, also);
  return continueDiscovery(request, await call(deps, meter, request), deps, meter);
}

/* ---------------------------------------------------------- identity pass */

/**
 * Does this text name the company -- its core name, a name it is also known
 * by, or its ticker as a word?
 *
 * The other names are the company's aliases: the workbook's and the TSX
 * list's spellings, and the names it filed under before it was renamed. A
 * filing from before a rename names the company only as it was then: of the
 * 76 documents Q4 pass 2 refused as naming someone else, most were the
 * company's own, under its old name. An alias must appear as whole words: a
 * short old name inside a longer word is not the company.
 */
export function namesCompany(
  text: string, row: Pick<PublicCompanyRow, "canonicalName" | "rootTicker"> & { aliases?: readonly string[] },
): number {
  const core = normalizeName(row.canonicalName);
  const hay = normalizeName(text.slice(0, 400_000));
  // Index into the ORIGINAL text, for a quote that anchors.
  const at = (name: string) => { const i = text.toLowerCase().indexOf(name.split(" ")[0]); return i >= 0 ? i : 0; };
  if (core && hay.includes(core)) return at(core);
  for (const alias of row.aliases ?? []) {
    const name = normalizeName(alias);
    if (name && ` ${hay} `.includes(` ${name} `)) return at(name);
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
      if (edgar.record.latestAnnual.form === "10-K" && edgar.record.latestProxy) {
        candidates.push(proxyCandidate(edgar.record.latestProxy));
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
  /commercial production|producing mine|production decision|construction decision|feasibility study|preliminary economic assessment|exploration[- ]stage|development[- ]stage|royalt(y|ies)|streaming/gi,
  /head office|registered office|principal (executive )?office|si[eè]ge social/gi,
  /(fiscal|financial) year|years? ended|exercice/gi,
  /change of auditor|reporting package|successor auditor|former auditor|resign(ed|ation) as auditor/gi,
];

/**
 * The fee table's labels. Kept apart from WINDOW_PATTERNS: the table comes
 * late -- in the audit committee section of an AIF, near the end of a
 * circular -- and in document order the cap cut it. Q4 pass 2, 21 October
 * 2026: 19 of the 27 TSX companies that abstained on the audit fee had been
 * given a filing whose fee table sat past the first 30,000 characters.
 */
const FEE_PATTERN = /audit fees|audit-related fees|tax fees|all other fees|external auditor service fees|honoraires/gi;
/** Room the fee windows are promised after the cover, before any other field's. */
const FEE_RESERVE = 9_000;

/**
 * Where a company names its ERP: mostly the internal-control section, when the
 * system changes, which is early in an MD&A. Kept apart from WINDOW_PATTERNS
 * on purpose -- see windowsOf.
 */
const ERP_PATTERN = /enterprise resource planning|\bERP\b|S\s*\/\s*4\s*HANA|\bSAP\b|JD Edwards|NetSuite|Dynamics 365|Oracle (?:E-Business|Fusion|Cloud)|Sage (?:Intacct|X3)|Pronto Xi|Epicor/gi;
const ERP_HITS = 2;

/** An ERP named or described, for checking a quote: ERP_PATTERN without the global flag's state. */
const ERP_TERM = new RegExp(ERP_PATTERN.source, "i");
/** Words that say a system is changing, not merely in use. */
const CHANGE_WORDS = /\b(?:new|implement\w*|select\w*|replac\w*|upgrad\w*|migrat\w*|transition\w*|go[- ]live|went live|deploy\w*|roll(?:ed|ing)?[- ]?out|conver(?:t|sion)\w*)\b/i;

/** Does a passage speak of an ERP changing? Naming the system is not required. */
export function describesErpChange(excerpt: string): boolean {
  return ERP_TERM.test(excerpt) && CHANGE_WORDS.test(excerpt);
}

/**
 * Where a filing says what the company mines: its description of the business,
 * usually near the start of an AIF or MD&A, and often already inside the cover
 * window. Placed last, like the ERP windows, so it can only use what is left.
 */
const COMMODITY_PATTERN = /nature of (?:the|its|our) business|description of (?:the )?business|principal products|(?:is|are) engaged in|focused on the (?:exploration|development|production)|primary (?:metals?|commodit(?:y|ies))/gi;
const COMMODITY_HITS = 2;

/**
 * The sentence that says what currency the statements are in -- "presented in
 * United States dollars" -- usually in the basis of presentation or on the
 * MD&A's first page. One is enough.
 */
const CURRENCY_PATTERN = /(?:presented|expressed|reported|stated) in (?:thousands of |millions of )?(?:canadian|united states|u\.s\.|us|australian) dollars|presentation currency|reporting currency/gi;
const CURRENCY_HITS = 1;

/**
 * Revenue, net income and total assets: best of all the MD&A's selected
 * annual information, which prints all three for the year in one table; then
 * the balance sheet's total assets and the statement of income or loss.
 */
const FINANCIALS_PATTERN = /selected (?:annual|financial|consolidated) (?:information|data|highlights|results)|summary of (?:annual|financial) results|financial highlights|total assets|consolidated statements? of (?:income|operations|earnings|loss|comprehensive (?:income|loss))/gi;
const FINANCIALS_HITS = 3;

/** The windows placed last, in this order, each only in what the rest left. */
const LAST: ReadonlyArray<readonly [RegExp, number]> = [
  [ERP_PATTERN, ERP_HITS], [COMMODITY_PATTERN, COMMODITY_HITS],
  [CURRENCY_PATTERN, CURRENCY_HITS], [FINANCIALS_PATTERN, FINANCIALS_HITS],
];

type Span = [number, number];
const SEPARATOR = "\n[...]\n";

/** The spans with one more added, merged where they meet: sorted and disjoint. */
function union(spans: readonly Span[], add: Span): Span[] {
  const merged: Span[] = [];
  for (const s of [...spans, add].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/** How long the spans print: every piece, and a separator between each two. */
const printed = (spans: readonly Span[]) =>
  spans.reduce((n, [a, b]) => n + (b - a), 0) + SEPARATOR.length * Math.max(0, spans.length - 1);

/**
 * The cover and every window that matters, verbatim, merged and capped.
 *
 * Chosen in order of need and printed in document order. The cover first;
 * then the fee table, its densest windows first, in FEE_RESERVE; then the
 * other fields' windows in document order, up to the first that will not fit;
 * then, LAST, the ERP windows, the business-description windows for
 * commodities, and the reporting currency's and the financial statements',
 * each in whatever the rest left.
 *
 * The fee table comes late in a filing, so in document order an earlier
 * passage -- an auditor's name, a stage word, an internal-controls note about
 * an ERP -- could push it past the cap. Placed before any of them, it cannot.
 * And a LAST field cannot take evidence from any other: a document that names
 * no ERP and has no business description reads as it did before they existed.
 *
 * `cap` is the most this document may print: MAX_CHARS_PER_DOCUMENT, or what
 * the earlier documents left of the request's budget.
 */
export function windowsOf(text: string, cap = MAX_CHARS_PER_DOCUMENT): string {
  const around = (at: number): Span => [Math.max(0, at - WINDOW_CHARS), Math.min(text.length, at + WINDOW_CHARS)];
  let kept: Span[] = [];
  const keep = (span: Span, limit = cap): boolean => {
    const next = union(kept, span);
    if (printed(next) > limit) return false;
    kept = next;
    return true;
  };
  const inView = (at: number) => kept.some(([a, b]) => at >= a && at < b);

  keep([0, Math.min(text.length, 3000, cap)]);

  // The window with the most fee labels in it first: the table itself, not a
  // charter's passing "pre-approve all audit fees".
  const fees = [...text.matchAll(FEE_PATTERN)].map((m) => m.index!);
  const densest = fees.map((at) => ({ at, near: fees.filter((o) => Math.abs(o - at) <= WINDOW_CHARS).length }))
    .sort((x, y) => (y.near - x.near) || (x.at - y.at));
  const feeLimit = Math.min(cap, printed(kept) + FEE_RESERVE);
  for (const { at } of densest) if (!inView(at)) keep(around(at), feeLimit);

  const others: Span[] = [];
  for (const re of WINDOW_PATTERNS) {
    let hits = 0;
    for (const m of text.matchAll(re)) {
      others.push(around(m.index!));
      if (++hits >= 6) break;
    }
  }
  for (const span of others.sort((a, b) => a[0] - b[0])) if (!keep(span)) break;

  for (const [pattern, most] of LAST) {
    let taken = 0;
    for (const m of text.matchAll(pattern)) {
      if (taken >= most) break;
      if (!inView(m.index!) && !keep(around(m.index!))) break;
      taken++;
    }
  }
  return kept.map(([a, b]) => text.slice(a, b)).join(SEPARATOR);
}

export const EXTRACTED_FIELDS = [
  "stage_evidence_state", "auditor", "auditor_since", "auditor_change", "fiscal_year_end",
  "head_office_location", "head_office_region", "audit_fee", "tax_fee", "incumbent_erp", "erp_change",
  "commodities", "audit_related_fee", "other_fee", "total_revenue", "net_income", "total_assets",
  "reporting_currency",
] as const;

/** The researched amounts: each {amount, currency, fiscal_year}, read and checked as a fee is. */
const MONEY_FIELDS = new Set(["audit_fee", "tax_fee", "audit_related_fee", "other_fee",
                              "total_revenue", "net_income", "total_assets"]);

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
- audit_related_fee, other_fee: fee, the same table's "audit-related fees" and "all other fees" lines,
  read exactly as audit_fee is. Abstain where the table has no such line.
- total_revenue, net_income, total_assets: fee (it holds any amount), for the most recent fiscal
  YEAR, never a quarter or a six-month period: total revenue (or sales) for the year; net income
  or loss for the year as the statement of income totals it, a loss as a NEGATIVE amount ("(12,345)"
  is -12345); total assets at the year end. From the consolidated statements or the MD&A's selected
  annual information, the amount EXACTLY as printed with the scale and currency they state.
  fiscal_year is the year the figure is for. A company with no revenue line abstains on revenue.
- reporting_currency: text_value, the ISO code (CAD, USD, AUD, GBP, EUR) of the currency the
  financial statements are presented in, quoting the sentence that says so ("presented in United
  States dollars", "expressed in thousands of Canadian dollars"). The excerpt must name the
  currency. A subsidiary's functional currency is not the reporting currency.
- incumbent_erp: text_value, the enterprise resource planning (ERP) system the COMPANY ITSELF runs
  for its own finance and operations, named as the document names it (SAP S/4HANA, Oracle JD
  Edwards, Microsoft Dynamics 365, Pronto Xi...). The excerpt must name the system. A system the
  company sells, implements for others, or mentions as a supplier's or customer's does not count;
  "a new ERP system" with no name is not a value. Abstain unless a document names the company's own.
- erp_change: whether the COMPANY ITSELF is changing its ERP (enterprise resource planning) system,
  named or not. text_value is "selecting" (choosing or planning a new system), "implementing" (the
  change is under way) or "completed" (finished within the 24 months before the period date);
  year_value is the go-live or completion year the passage gives, or null. The excerpt must say that
  the company is selecting, implementing or has completed a new or upgraded ERP system. A risk
  factor about what an implementation could do, a director's experience at other companies, a
  system the company sells or implements for others, and a system merely in use are not a change.
  Abstain unless a document says the company's own ERP is changing.
- commodities: text_value, the commodities the company explores for, develops or produces, comma
  separated, each named (gold, copper, lithium...). The excerpt must name every commodity you list,
  so choose the passage that describes the company's business. "Base metals" or "precious metals"
  alone names none. Commodities a company only buys, sells, trades or uses are not its own.

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

/** Whether a quote names this currency: its code, its symbol or its words. */
export function namesCurrency(excerpt: string, code: string): boolean {
  const t = excerpt.toLowerCase();
  return currenciesMentioned(t).includes(code) || new RegExp(`\\b${code.toLowerCase()}\\b`).test(t);
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
    case "head_office_location":
      return e.text_value ? { ...base, value: e.text_value.trim() } : null;
    case "head_office_region":
      // The workbook's spelling ("Quebec"), not the filing's ("Québec"): the
      // excerpt keeps the filing's words, the value is canonical.
      return e.text_value ? { ...base, value: canonicalRegion(e.text_value) } : null;
    case "incumbent_erp": {
      if (!e.text_value) return null;
      const system = canonicalErp(e.text_value);
      // The anchoring gate proves the quote is in the document; it cannot see
      // whether the quote names THIS system. "We implemented a new ERP" is
      // real text and no evidence of which -- so it is an abstention, kept
      // and visible, not a value.
      if (!e.evidence_excerpt || !namesSystem(e.evidence_excerpt, system)) {
        return { ...base, abstained: true,
                 abstention_reason: `The passage cited does not name the system ("${system}").` };
      }
      return { ...base, value: system };
    }
    case "erp_change": {
      const status = erpChangeStatus(e.text_value);
      if (!status) return null;
      // As for the named ERP, the gate proves the quote is in the document, not
      // that it says what the value says. A quote that does not speak of an ERP
      // changing -- "our ERP software", a director's past work -- is an
      // abstention, kept and visible, not a signal.
      if (!e.evidence_excerpt || !describesErpChange(e.evidence_excerpt)) {
        return { ...base, abstained: true,
                 abstention_reason: "The passage cited does not describe a change to the company's ERP." };
      }
      const year = e.year_value !== null && e.year_value >= 2000 && e.year_value <= 2040 ? e.year_value : null;
      return { ...base, value: { status, year } };
    }
    case "commodities": {
      if (!e.text_value) return null;
      // The same rule as ERP, per commodity: the gate proves the quote is in
      // the document, not that it names each thing listed. What the quote does
      // not name is dropped; a list it names none of is an abstention.
      const listed = canonicalCommodities(e.text_value);
      const named = e.evidence_excerpt ? listed.filter((c) => namesCommodity(e.evidence_excerpt!, c)) : [];
      if (named.length === 0) {
        return { ...base, abstained: true,
                 abstention_reason: listed.length
                   ? `The passage cited does not name ${listed.join(", ")}.`
                   : "No specific commodity was named." };
      }
      return { ...base, value: named };
    }
    case "reporting_currency": {
      const code = currencyCode(e.text_value);
      if (!code) return null;
      // As for ERP: the gate proves the quote is in the document, not that it
      // says THIS currency. A quote that does not name it is no evidence of it.
      if (!e.evidence_excerpt || !namesCurrency(e.evidence_excerpt, code)) {
        return { ...base, abstained: true,
                 abstention_reason: `The passage cited does not name the currency (${code}).` };
      }
      return { ...base, value: code };
    }
  }
  if (MONEY_FIELDS.has(e.field_key)) {
    if (!e.fee) return null;
    const units = e.fee.amount * SCALE[e.fee.scale];
    // An amount keeps its currency and year: "C$8,052,000 (FY2025)" and
    // "US$517,116" are different amounts, and Run 1's "$353,190" was a 2024
    // fee on a 2025 period. The gate checks the currency where the document
    // states one, and looks for the figure as printed -- a loss is stored
    // negative but printed "(12,345)", so it looks for 12,345.
    const currency = currencyCode(e.fee.currency);
    return { ...base, value: { amount: units, currency, fiscal_year: e.fee.fiscal_year ?? null },
             numeric: { value: Math.abs(units), scale: e.fee.scale, fiscalYear: e.fee.fiscal_year ?? undefined, currency } };
  }
  return null;
}

/**
 * A filing of the kind this company prints its fees in, from the latest annual
 * cycle: fiscal year no earlier than the one before the period's. A filing of
 * no stated year is not counted -- an EDGAR exhibit has none, and its annual
 * report beside it does.
 */
function printsFees(c: CandidateDoc, row: Pick<PublicCompanyRow, "exchange" | "periodAsOf">): boolean {
  return feeKinds(row.exchange).includes(c.kind) && c.fiscal_year !== null && c.fiscal_year >= currentFrom(row);
}

/** The earliest fiscal year still current for a period: the one before the period's own. */
function currentFrom(row: Pick<PublicCompanyRow, "periodAsOf">): number {
  return Number(row.periodAsOf.slice(0, 4)) - 1;
}

/**
 * The order filings are read in: current before stale, then by kind, then
 * newest, then seen in a search before merely reported.
 *
 * Kind came first until 21 October 2026, so an AIF of any age was read before
 * any current filing of another kind. Of the 24 fees the TSX run proposed that
 * day, 8 were for FY2023 or earlier -- Erdene's for FY2019. A stale filing is
 * still read, after every current one. A filing of no stated year counts as
 * current: an EDGAR exhibit has none, and is read beside its annual report.
 */
export function readingOrder(priority: readonly DocKind[], currentFrom: number) {
  const stale = (c: CandidateDoc) => (c.fiscal_year !== null && c.fiscal_year < currentFrom ? 1 : 0);
  return (a: CandidateDoc, b: CandidateDoc): number =>
    (stale(a) - stale(b)) ||
    (priority.indexOf(a.kind) - priority.indexOf(b.kind)) ||
    ((b.fiscal_year ?? 0) - (a.fiscal_year ?? 0)) ||
    // Seen in a search result beats merely reported: a transcribed URL may not exist.
    ((a.provenance === "reported" ? 1 : 0) - (b.provenance === "reported" ? 1 : 0));
}

/** A 10-K filer's proxy statement, read as its circular: Item 14's fee table is in it. */
function proxyCandidate(proxy: NonNullable<EdgarRecord["latestProxy"]>): CandidateDoc {
  return { url: proxy.url, kind: "information_circular", fiscal_year: Number(proxy.filed.slice(0, 4)) - 1,
           title: "DEF 14A", provenance: "edgar" };
}

function rankCandidates(
  candidates: CandidateDoc[], allow: Set<string>, order: (a: CandidateDoc, b: CandidateDoc) => number,
): CandidateDoc[] {
  const allowed = (url: string) => {
    const h = hostOf(url);
    return Boolean(h) && [...allow].some((a) => h === a || h!.endsWith(`.${a}`));
  };
  const seen = new Set<string>();
  return candidates
    .filter((c) => allowed(c.url))
    .filter((c) => { const k = canonicalUrl(c.url); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort(order);
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
export function linkedFilings(
  links: string[], allow: Set<string>, seen: Set<string>, order: (a: CandidateDoc, b: CandidateDoc) => number,
): CandidateDoc[] {
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
  found.sort(order);
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

  const searched = async (also?: string): Promise<CandidateDoc[]> => {
    const found = await discover(job.row, deps, meter, also);
    return (found.report.documents ?? []).map((d) => ({ ...d,
      provenance: found.seenUrls.has(canonicalUrl(d.url)) ? "search_result" as const : "reported" as const }));
  };
  const order = readingOrder(kindPriority(job.row.exchange), currentFrom(job.row));
  let candidates = job.priorCandidates ?? [];
  if (candidates.length === 0) {
    candidates = await searched();
  }

  // A 10-K's fee table is in the proxy statement it incorporates (Item 14).
  // A list from before pass 1 recorded the proxy lacks it, so EDGAR is asked:
  // a free read, no model call. International Tower Hill, 21 October: three
  // filings read, not one with "audit fees" in it.
  const tenK = candidates.find((c) => c.provenance === "edgar" && c.title === "10-K");
  const cik = tenK && /\/edgar\/data\/(\d+)\//.exec(tenK.url)?.[1];
  if (cik && !candidates.some((c) => c.title === "DEF 14A")) {
    const proxy = await edgarProxy(cik, deps.fetch);
    if (proxy) {
      candidates = [...candidates, proxyCandidate(proxy)];
      notes.push(`added the 10-K's proxy statement: ${proxy.url}`);
    }
  }

  if (candidates.length > 0 && !rankCandidates(candidates, allow, order).some((c) => printsFees(c, job.row))) {
    const venture = job.row.exchange !== "TSX";
    const what = venture ? "circular" : "AIF or SEC annual report";
    // Search again only for a company known to publish the filing: pass 1
    // listed one, of an earlier year or on a host pass 2 cannot read. On 21
    // October, of 56 companies searched again, the 28 whose list held no such
    // filing of any year, anywhere, found no fee by it (US$8.70 between them);
    // the other 28 found 4. Magna's current AIF, for one, was listed only on a
    // news site, and the second search found its circular on its own site.
    if (candidates.some((c) => feeKinds(job.row.exchange).includes(c.kind))) {
      candidates = [...candidates, ...await searched(FEE_SEARCH[venture ? "venture" : "non_venture"])];
      notes.push(`searched again: pass 1 found no current ${what}`);
    } else {
      notes.push(`not searched again: pass 1 found no ${what} of any year, anywhere`);
    }
  }

  const docs: FetchedDocument[] = [];
  const queue = rankCandidates(candidates, allow, order);
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
      const linked = linkedFilings(doc.links ?? [], allow, seen, order);
      if (linked.length > 0) {
        // Into the reading order, not ahead of it. Put first, a page of 2023
        // filings had Andina read four of them before anything current.
        queue.push(...linked);
        queue.sort(order);
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
    // What is left of the budget is this document's cap, so a later document
    // still gets its fee windows first rather than losing its tail to a cut.
    const w = windowsOf(d.text, Math.min(MAX_CHARS_PER_DOCUMENT, Math.max(0, budget)));
    budget -= w.length;
    return { type: "text", text: `<document index="${i}" url="${d.finalUrl}">\n${w}\n</document>` };
  });

  const cfg = ROUTE_CONFIG.extract_general;
  const prompt = buildPrompt("extract_general", job.row);
  return {
    kind: "request",
    request: {
      model: cfg.model, max_tokens: EXTRACTION_MAX_TOKENS, thinking: { type: "adaptive" },
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
