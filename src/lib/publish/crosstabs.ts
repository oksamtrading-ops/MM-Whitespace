/**
 * Two cross-tabs the dashboard draws, read from the frozen snapshot.
 *
 * These are not precomputed at publish. Every other aggregate is, because
 * doc 09 budgets a dashboard query at under a second and a group-by that
 * accumulates across periods has to stay flat. These two are a single pass
 * over one publication's 259 rows, which costs nothing and — the reason that
 * matters — means an already-published revision grows the views without being
 * republished. They still read `published_period_values` and nothing else, so
 * they are as frozen as the rest of the page.
 *
 * The bands come from the period's own threshold rather than a constant: the
 * threshold is a per-period parameter, and a hardcoded bottom band would
 * silently misreport the population the first time it changed.
 */
import { formatMoney } from "../format/fields.ts";
import type { Sql } from "../db/sql.ts";

/** The firms the matrix names, in fixed order. Deloitte first: it is the accent. */
export const FIRMS = ["Deloitte", "PwC", "KPMG", "Ernst & Young"] as const;
export const OTHER_FIRMS = "Other firms";
export const UNKNOWN = "Not yet known";
export type FirmBucket = (typeof FIRMS)[number] | typeof OTHER_FIRMS | typeof UNKNOWN;
export const FIRM_ORDER: FirmBucket[] = [...FIRMS, OTHER_FIRMS, UNKNOWN];

export type Band = {
  key: string;
  label: string;
  /** Combined market capitalisation of the companies in the band. */
  cap: number | null;
  companies: number;
  /** Company count per firm, in FIRM_ORDER. */
  cells: number[];
};

export type Matrix = {
  bands: Band[];
  totals: number[];
  population: number;
  /** True when no company carried a market cap, so the bands cannot be drawn. */
  capMissing: boolean;
};

type Row = { company_id: string; field_key: string; value: string };

function parse(v: string): unknown {
  try { return JSON.parse(v); } catch { return null; }
}

function firmOf(auditor: unknown): FirmBucket {
  if (typeof auditor !== "string" || auditor.trim() === "") return UNKNOWN;
  return (FIRMS as readonly string[]).includes(auditor) ? (auditor as FirmBucket) : OTHER_FIRMS;
}

/**
 * Market-cap band by incumbent auditor.
 *
 * The cross-tab the workbook builds by hand. Read down a column for one
 * firm's book; read across a row to see who holds a size band. It needs no
 * enrichment: both inputs come from the extract, so it is populated on day
 * one when the tier views are not.
 */
export async function whitespaceMatrix(
  db: Sql, publicationId: string, thresholdAmount: number, currency: string,
): Promise<Matrix> {
  const rows = await db.all(
    `select company_id, field_key, cast(value as text) as value
       from published_period_values
      where publication_id = ? and field_key in ('market_cap_cad', 'auditor')`,
    publicationId) as Row[];

  const caps = new Map<string, number>();
  const auditors = new Map<string, unknown>();
  for (const r of rows) {
    if (r.field_key === "market_cap_cad") {
      const n = parse(r.value);
      if (typeof n === "number" && Number.isFinite(n)) caps.set(r.company_id, n);
    } else {
      auditors.set(r.company_id, parse(r.value));
    }
  }

  // Bands above the threshold, largest first. The bottom band starts at the
  // period's own threshold and is named from it.
  const money = (n: number) => formatMoney(n, currency, { compact: true });
  const edges = [10e9, 2e9, 500e6].filter((e) => e > thresholdAmount);
  const specs: Array<{ key: string; label: string; lo: number; hi: number }> = [];
  let hi = Infinity;
  for (const e of edges) {
    specs.push({ key: `b${e}`, label: hi === Infinity ? `${money(e)} and above` : `${money(e)} – ${money(hi)}`, lo: e, hi });
    hi = e;
  }
  specs.push({ key: "bmin", label: `${money(thresholdAmount)} – ${money(hi)}`, lo: thresholdAmount, hi });

  const bands: Band[] = specs.map((sp) => ({
    key: sp.key, label: sp.label, cap: 0, companies: 0, cells: FIRM_ORDER.map(() => 0),
  }));
  const totals = FIRM_ORDER.map(() => 0);
  let population = 0;
  let placed = 0;

  for (const [companyId, cap] of caps) {
    population++;
    const i = specs.findIndex((sp) => cap >= sp.lo && cap < sp.hi);
    // Below the threshold is not a band: it is a company the period should
    // not contain, and it is counted in the population but drawn nowhere.
    if (i < 0) continue;
    placed++;
    const firm = FIRM_ORDER.indexOf(firmOf(auditors.get(companyId)));
    bands[i].companies++;
    bands[i].cap = (bands[i].cap ?? 0) + cap;
    bands[i].cells[firm]++;
    totals[firm]++;
  }

  return {
    bands: bands.filter((b) => b.companies > 0),
    totals,
    population: placed,
    capMissing: caps.size === 0,
  };
}

export type MarketRow = {
  market: string;
  companies: number;
  deloitte: number;
  /** No Deloitte market: shown last, never sorted into the ranking. */
  terminal: boolean;
};

/**
 * Companies by Deloitte market, and how many of each that Deloitte audits.
 *
 * The bar used to say only how many companies sit in a market. The question
 * the page exists to answer is how many of them are not ours, so the mark
 * carries both: the full length is the market, the inner length is the book.
 */
export async function marketPenetration(
  db: Sql, publicationId: string, foreignLabel: string,
): Promise<{ rows: MarketRow[]; population: number }> {
  const rows = await db.all(
    `select company_id, field_key, cast(value as text) as value
       from published_period_values
      where publication_id = ? and field_key in ('dtt_market', 'auditor')`,
    publicationId) as Row[];

  const market = new Map<string, string>();
  const auditors = new Map<string, unknown>();
  for (const r of rows) {
    if (r.field_key === "dtt_market") {
      const v = parse(r.value);
      market.set(r.company_id, typeof v === "string" && v.trim() !== "" ? v : foreignLabel);
    } else {
      auditors.set(r.company_id, parse(r.value));
    }
  }

  const byMarket = new Map<string, MarketRow>();
  for (const [companyId, name] of market) {
    const row = byMarket.get(name)
      ?? { market: name, companies: 0, deloitte: 0, terminal: name === foreignLabel };
    row.companies++;
    if (auditors.get(companyId) === "Deloitte") row.deloitte++;
    byMarket.set(name, row);
  }

  const list = [...byMarket.values()].sort((a, b) =>
    Number(a.terminal) - Number(b.terminal) || b.companies - a.companies);
  return { rows: list, population: market.size };
}
