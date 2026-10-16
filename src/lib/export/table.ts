/**
 * The companies table as filtered on screen, as a workbook.
 *
 * Not the period export. That one carries the WORKING period, values nobody
 * has published, so it is an Analyst's (period.ts). This one carries exactly
 * what the companies table showed -- the published snapshot, or the draft for
 * an Analyst looking at one, which the header then says -- narrowed by the
 * filter in the URL, through the same roster.ts the screen narrows with. So a
 * Viewer may have it: it holds nothing they could not already read.
 *
 * A deloitte_internal field never reaches it: listCompanies drops those before
 * any row is built.
 */
import type { Sql } from "../db/sql.ts";
import { citationOf, listCompanies, rosterBasis } from "../profile/company.ts";
import { citationsForPeriod, citationWords, citeKey } from "../profile/citations.ts";
import {
  auditorWord, describeFilter, dropUnknown, facetOptions, filterRows, FOOTPRINT_WORD, hqWord,
  parseRosterParams, sortRows, STAGE_LABEL, STAGE_OF_TIER, stageMark, TIER_WORD, type RosterRow,
} from "../profile/roster.ts";
import { STAGE_ORDER } from "../format/fields.ts";
import { buildFile, contentTypeOf, ExportFailed } from "./period.ts";

type Column = { key: string; label: string; kind: "text" | "fee" | "stage" | "money"; field?: string };

/** One citation the export can name: what was read, and the passage. */
export type TableCitation = {
  kind: string; title: string | null; url: string | null; retrieved: string | null; quote: string | null;
};
/** Citations by company, then field. Supplied by the citation resolver. */
export type CitationLookup = (companyId: string, field: string) => TableCitation | null;

const BASE_COLUMNS: Column[] = [
  { key: "name", label: "Company", kind: "text" },
  { key: "ticker", label: "Ticker", kind: "text" },
  { key: "exchange", label: "Exchange", kind: "text" },
  { key: "tier", label: "Tier", kind: "text" },
  { key: "stage", label: "Stage (deciding the tier)", kind: "text" },
  ...STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABEL[s], kind: "stage" as const })),
  { key: "footprint", label: "Footprint", kind: "text" },
  { key: "commodities", label: "Commodities", kind: "text", field: "commodities" },
  { key: "hq", label: "Company HQ", kind: "text", field: "head_office_region" },
  { key: "auditor", label: "Auditor", kind: "text", field: "auditor" },
  { key: "audit_fee", label: "Audit fees", kind: "fee", field: "audit_fee" },
  { key: "erp", label: "Incumbent ERP", kind: "text", field: "incumbent_erp" },
  { key: "market_cap", label: "Market cap (CAD)", kind: "money" },
];

/** Only links that are links: a stored value that is not http(s) is never written as one. */
export function safeUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function cellsOf(r: RosterRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: r.name, ticker: r.ticker, exchange: r.exchange,
    tier: r.tier === null ? TIER_WORD[r.status] ?? "Unclassified" : `Tier ${r.tier}`,
    stage: r.tier === null ? null : STAGE_LABEL[STAGE_OF_TIER[r.tier]],
    footprint: FOOTPRINT_WORD[r.footprint] ?? r.footprint,
    commodities: r.commodities.length ? r.commodities.join(", ") : null,
    hq: hqWord(r),
    auditor: r.auditor ? auditorWord(r.auditor) : null,
    audit_fee: r.auditFee ?? null,
    erp: r.erp,
    market_cap: r.marketCap,
  };
  for (const s of STAGE_ORDER) out[s] = stageMark(r, s);
  for (const m of r.meta) out[`meta:${m.field}`] = m.text;
  return out;
}

/** The payload api/workbook.py builds the table from. Pure, so it can be tested without Python. */
export function tablePayload(opts: {
  rows: RosterRow[]; total: number; filterWords: string;
  basis: { label: string; revision: number | null };
  cite?: CitationLookup;
}) {
  const metaColumns = new Map<string, string>();
  for (const r of opts.rows) for (const m of r.meta) if (!metaColumns.has(m.field)) metaColumns.set(m.field, m.label);
  const columns: Column[] = [
    ...BASE_COLUMNS,
    ...[...metaColumns].sort((a, b) => a[1].localeCompare(b[1]))
      .map(([field, label]) => ({ key: `meta:${field}`, label, kind: "text" as const })),
  ];
  const sources: Array<Record<string, unknown>> = [];
  const rows = opts.rows.map((r) => {
    const links: Record<string, string> = {};
    const cells = cellsOf(r);
    for (const c of columns) {
      if (!c.field || !opts.cite) continue;
      const source = r.sources[c.field];
      if (source !== "ai_accepted" && source !== "manual_override") continue;
      const citation = opts.cite(r.companyId, c.field);
      if (!citation) continue;
      const url = safeUrl(citation.url);
      if (url) links[c.field] = url;
      sources.push({
        company: r.name, field: c.label, value: cells[c.key] === null ? "Not found" : displayOf(c, cells[c.key]),
        kind: citation.kind, title: citation.title, url, retrieved: citation.retrieved, quote: citation.quote,
      });
    }
    return { ...cells, links };
  });
  const basis = opts.basis.revision === null
    ? `Draft of ${opts.basis.label} — not published, so a Viewer would not see these values`
    : `Published revision ${opts.basis.revision} of ${opts.basis.label}`;
  return {
    period: { label: opts.basis.label, basis, revision: opts.basis.revision },
    filter: opts.filterWords, count: opts.rows.length, total: opts.total,
    columns, rows, sources,
  };
}

function displayOf(c: Column, v: unknown): string {
  if (c.kind === "fee" && v && typeof v === "object") {
    const m = v as { amount?: number; currency?: string | null; fiscal_year?: number | null };
    return `${m.currency ?? ""} ${m.amount ?? ""}${m.fiscal_year ? ` FY${m.fiscal_year}` : ""}`.trim();
  }
  return v === null || v === undefined ? "" : String(v);
}

/** "Q3-2026 (2026-05-31)" -> "Market Assessment Tool Q3-2026 companies.xlsx". */
export function tableFilename(label: string, format: "xlsx" | "csv"): string {
  const name = String(label).replace(/\s*\([^)]*\)\s*$/, "").trim() || "period";
  return `Market Assessment Tool ${name.replace(/[^A-Za-z0-9 ._-]/g, "-")} companies.${format}`;
}

/** Read, narrow, build. The route is only who may ask and the audit line. */
export async function exportTable(db: Sql, opts: {
  allowDraft: boolean; params: URLSearchParams; format: "xlsx" | "csv"; cite?: CitationLookup;
}) {
  const basis = await rosterBasis(db, { allowDraft: opts.allowDraft });
  const all = await listCompanies(db, { allowDraft: opts.allowDraft });
  if (!basis || all.length === 0) throw new ExportFailed("Nothing has been published, so there is no table to export.");
  const facets = facetOptions(all);
  const filter = dropUnknown(parseRosterParams(opts.params), facets);
  const shown = sortRows(filterRows(all, filter), filter.sort, filter.dir).map((s) => s.row);
  const filterWords = describeFilter(filter, facets);
  const cite = opts.cite ?? await citationLookup(db, basis);
  const payload = tablePayload({ rows: shown, total: all.length, filterWords, basis, cite });
  const bytes = await buildFile(payload, { format: opts.format, kind: "table" });
  return {
    filename: tableFilename(basis.label, opts.format), contentType: contentTypeOf(opts.format), bytes,
    periodId: basis.periodId, revision: basis.revision, rows: shown.length, total: all.length,
    filter, filterWords,
  };
}

/**
 * The citations the table's rows carry: frozen with the revision when it is
 * published -- exactly what the screen shows -- and resolved live for a draft.
 */
async function citationLookup(db: Sql, basis: { periodId: string; publicationId: string | null }): Promise<CitationLookup> {
  const byKey = new Map<string, TableCitation>();
  if (basis.publicationId) {
    for (const r of await db.all(`select company_id, field_key, sources, excerpt from published_period_values
        where publication_id = ? and sources is not null`, basis.publicationId) as
        Array<{ company_id: string; field_key: string; sources: string; excerpt: string | null }>) {
      const c = citationOf(typeof r.sources === "string" ? JSON.parse(r.sources) : r.sources);
      if (c) byKey.set(citeKey(String(r.company_id), r.field_key), { ...citationWords(c), quote: r.excerpt ?? null });
    }
  } else {
    for (const [key, c] of await citationsForPeriod(db, basis.periodId)) {
      byKey.set(key, { ...citationWords(c.citation), quote: c.excerpt });
    }
  }
  return (companyId, field) => byKey.get(citeKey(companyId, field)) ?? null;
}
