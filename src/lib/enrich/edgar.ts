/**
 * SEC EDGAR: the one source that answers three fields without a model.
 *
 * For a company that files with the SEC -- roughly 110 of the population are
 * interlisted -- EDGAR's own record states whether it is a registrant, under
 * what form, its fiscal year-end and its business address. The application
 * fetches that record itself, verifies the name, and quotes it. No prompt is
 * involved, so nothing here can be fabricated; the anchoring gate checks each
 * quote against the stored record like any other document.
 *
 * Which company is which is the only judgement, and it is made twice: the
 * candidate CIK must come from EDGAR's own ticker list or a model's proposal,
 * AND the registrant's name on the record must match the company's. A ticker
 * alone is not enough -- a TSX root and a US ticker can belong to different
 * issuers.
 *
 * EDGAR's fair-access policy asks for a contact in the User-Agent and at most
 * ten requests a second. transport.ts supplies the first; one worker making a
 * handful of requests per company is far inside the second.
 */
import type { StoredDocument } from "./anchor.ts";
import { fetchDocument, type FetchDeps, type FetchedDocument } from "./fetch.ts";
import type { ProposedFinding } from "./worker.ts";

export const SEC_HOST = "sec.gov";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;

/** Forms that are an annual report, most authoritative first. */
const ANNUAL_FORMS = ["40-F", "20-F", "10-K"];

/** Corporate suffixes that say nothing about which company it is. */
const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "ltd", "limited", "plc", "co", "company",
  "the", "sa", "nv", "ag", "llc", "lp", "ltee", "limitee", "ltée", "limitée", "holdings",
]);

export function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
}

/** Same core name, or near enough that the tokens overwhelmingly agree. */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  const union = new Set([...tx, ...ty]).size;
  return inter / union >= 0.75;
}

export type TickerEntry = { cik_str: number; ticker: string; title: string };

/** EDGAR's list of every registrant with a ticker. Cached for the life of the process. */
let tickerCache: { at: number; entries: TickerEntry[] } | null = null;

export async function edgarTickers(deps: FetchDeps): Promise<TickerEntry[]> {
  if (tickerCache && Date.now() - tickerCache.at < 6 * 3600_000) return tickerCache.entries;
  const doc = await fetchDocument(TICKERS_URL, new Set([SEC_HOST]), deps);
  const entries = Object.values(JSON.parse(doc.text) as Record<string, TickerEntry>);
  tickerCache = { at: Date.now(), entries };
  return entries;
}

export function resetTickerCache(): void { tickerCache = null; }

/**
 * The CIK for a company, if EDGAR knows it. A model's proposal is tried
 * first and then EDGAR's own list; either way the name must match.
 */
export function findCik(
  entries: readonly TickerEntry[], company: { name: string; ticker: string },
): string | null {
  const ticker = company.ticker.toUpperCase();
  const byTicker = entries.find((e) => e.ticker.toUpperCase() === ticker && namesMatch(e.title, company.name));
  if (byTicker) return String(byTicker.cik_str);
  const byName = entries.find((e) => normalizeName(e.title) === normalizeName(company.name));
  return byName ? String(byName.cik_str) : null;
}

export type EdgarRecord = {
  cik: string;
  name: string;
  /** EDGAR's own record of the website, often empty. Corroborates, never proposes. */
  website: string | null;
  fiscalYearEnd: string | null;
  businessCity: string | null;
  businessRegion: string | null;
  latestAnnual: { form: string; filed: string; url: string; indexUrl: string } | null;
};

export function parseSubmissions(text: string): EdgarRecord {
  const j = JSON.parse(text) as {
    cik: string | number; name: string; fiscalYearEnd?: string | null; website?: string | null;
    addresses?: { business?: { city?: string | null; stateOrCountryDescription?: string | null } };
    filings?: { recent?: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
  };
  const cik = String(j.cik).replace(/^0+/, "");
  const recent = j.filings?.recent;
  let latestAnnual: EdgarRecord["latestAnnual"] = null;
  if (recent) {
    for (let i = 0; i < recent.form.length; i++) {
      if (!ANNUAL_FORMS.includes(recent.form[i])) continue;
      const acc = recent.accessionNumber[i].replace(/-/g, "");
      const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}`;
      latestAnnual = { form: recent.form[i], filed: recent.filingDate[i],
                       url: `${folder}/${recent.primaryDocument[i]}`, indexUrl: `${folder}/index.json` };
      break;   // EDGAR lists recent filings newest first
    }
  }
  const title = (s: string | null | undefined) =>
    s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  return {
    cik, name: j.name,
    website: j.website ? String(j.website).trim() || null : null,
    fiscalYearEnd: j.fiscalYearEnd && /^\d{4}$/.test(j.fiscalYearEnd)
      ? `${j.fiscalYearEnd.slice(0, 2)}-${j.fiscalYearEnd.slice(2)}` : null,
    businessCity: title(j.addresses?.business?.city),
    businessRegion: title(j.addresses?.business?.stateOrCountryDescription),
    latestAnnual,
  };
}

/** The exact text of the first match, so the quote anchors against the stored record. */
function quote(text: string, re: RegExp): string | null {
  return text.match(re)?.[0] ?? null;
}

/**
 * Findings from a verified EDGAR record. Each quotes the record verbatim and
 * names it as the document, at source tier 1.
 */
export function edgarFindings(record: EdgarRecord, doc: FetchedDocument): ProposedFinding[] {
  const base = {
    document_hash: doc.contentHash, source_url: doc.finalUrl, source_tier: 1 as const,
    document_age_days: 0, corroborating_sources: 1, model_self_confidence: null,
  };
  const out: ProposedFinding[] = [];
  out.push({
    ...base, field_key: "sec_registrant",
    value: { registrant: true, form: record.latestAnnual?.form ?? null, cik: record.cik },
    evidence_excerpt: quote(doc.text, /"cik"\s*:\s*"?0*\d+"?/),
  });
  if (record.fiscalYearEnd) {
    out.push({ ...base, field_key: "fiscal_year_end", value: record.fiscalYearEnd,
               evidence_excerpt: quote(doc.text, /"fiscalYearEnd"\s*:\s*"\d{4}"/) });
  }
  const business = quote(doc.text, /"business"\s*:\s*\{[^}]*\}/);
  if (record.businessCity && business) {
    out.push({ ...base, field_key: "head_office_location", value: record.businessCity,
               evidence_excerpt: quote(business, /"city"\s*:\s*"[^"]*"/) });
  }
  if (record.businessRegion && business) {
    out.push({ ...base, field_key: "head_office_region", value: record.businessRegion,
               evidence_excerpt: quote(business, /"stateOrCountryDescription"\s*:\s*"[^"]*"/) });
  }
  return out;
}

/** EDGAR's record for a company, verified against its name; null when EDGAR does not know it. */
export async function lookupEdgar(
  company: { name: string; ticker: string }, proposedCik: string | null, deps: FetchDeps,
): Promise<{ record: EdgarRecord; doc: FetchedDocument } | null> {
  const candidates = [proposedCik, findCik(await edgarTickers(deps), company)]
    .filter((c): c is string => Boolean(c && /^\d{1,10}$/.test(c)));
  for (const cik of [...new Set(candidates.map((c) => c.replace(/^0+/, "")))]) {
    let doc: FetchedDocument;
    try {
      doc = await fetchDocument(submissionsUrl(cik), new Set([SEC_HOST]), deps);
    } catch {
      continue;
    }
    const record = parseSubmissions(doc.text);
    if (namesMatch(record.name, company.name)) return { record, doc };
  }
  return null;
}

/**
 * The exhibits of an annual filing that carry the substance.
 *
 * A 40-F's primary document is a cover form; the annual information form,
 * the audited statements and the MD&A are filed as exhibits 99.1 to 99.3.
 * The filing's index names them, and nothing else about the filing is used.
 */
export async function edgarIndexDocuments(indexUrl: string, deps: FetchDeps): Promise<string[]> {
  let doc: FetchedDocument;
  try {
    doc = await fetchDocument(indexUrl, new Set([SEC_HOST]), deps);
  } catch {
    return [];
  }
  let items: Array<{ name: string; size?: string | number }> = [];
  try {
    items = (JSON.parse(doc.text) as { directory?: { item?: Array<{ name: string; size?: string | number }> } })
      .directory?.item ?? [];
  } catch {
    return [];
  }
  const folder = indexUrl.replace(/\/index\.json$/, "");
  return items
    .filter((i) => /ex(hibit)?[-_]?99/i.test(i.name) && /\.(htm|html|pdf|txt)$/i.test(i.name))
    .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))
    .slice(0, 3)
    .map((i) => `${folder}/${i.name}`);
}

/** The fetched document, as the anchoring gate reads it. */
export function asStored(doc: FetchedDocument, scalePhrase: string | null = null): StoredDocument & {
  url: string; sourceTier: 1 | 2 | 3 | 4 | 5; docType?: string;
} {
  return {
    contentHash: doc.contentHash, text: doc.text, pageCount: doc.pageCount,
    charsPerPage: doc.charsPerPage, hasTextLayer: doc.hasTextLayer, scalePhrase,
    url: doc.finalUrl, sourceTier: doc.sourceTier, docType: doc.docType,
  };
}
