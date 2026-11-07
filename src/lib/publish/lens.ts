/**
 * The dashboard's views: pure functions over the published companies.
 *
 * The page filters one list in the browser -- a firm, a tier, a commodity, a
 * place, a size band -- and every view below is recomputed from what is left,
 * so the globe, the league, the matrix and their proof bars always describe
 * the same companies. Each view returns the numbers it draws and the count it
 * draws them from, so a proof bar can sum what the chart shows.
 *
 * Nothing here scores a company. A signal is a published fact a partner may
 * want to know before a conversation, with the count of companies it holds
 * for and the count research could check it for; which ones matter is the
 * partner's call (doc 01: the tool does not decide which companies to pursue).
 *
 * The types live here, not in atlas.ts, so a client component can import them
 * without the database read.
 */

export type FirmClass = "big4" | "national" | "regional" | "other";

/** An auditor named in the filing but not by name in the research. */
export const UNNAMED = "__other_unnamed__";
export const DELOITTE = "Deloitte";

export type AtlasCompany = {
  id: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  /** Market capitalisation in the period's currency, as published. */
  cap: number | null;
  tier: number | null;
  /** classified, or the reason there is no tier. */
  status: string;
  footprint: string | null;
  /** The tier the prior period published; null for an entrant or one it left unclassified. */
  priorTier: number | null;
  /** Canonical firm, UNNAMED, or null when research has not found it. */
  auditor: string | null;
  /** null when the auditor is not known. */
  firmClass: FirmClass | null;
  /** The head office as a globe key ("CA:BC"), null when it cannot be placed. */
  hq: string | null;
  /** The head office as the roster filters it ("CA:BC", "Australia"). */
  hqToken: string | null;
  hqRegion: string | null;
  hqCity: string | null;
  /** Globe keys of every jurisdiction holding a property. */
  places: string[];
  /** Jurisdictions the geometry cannot draw, in words: "OTHER: Atlantis". */
  unplaced: string[];
  commodities: string[];
  /** null before stage rows were published (Q3 revision 9). */
  stages: string[] | null;
  /** The year the incumbent was first appointed. */
  since: number | null;
  /** A change of auditor research found, with its date as the filing gave it. */
  change: { date: string | null; from: string | null } | null;
  /** Research looked for a change of auditor (and found one or not). */
  changeKnown: boolean;
  /** Files with the SEC: true, false, or null when research has not looked. */
  sec: boolean | null;
  secForm: string | null;
  /** "MM-DD". */
  yearEnd: string | null;
  fee: { amount: number; currency: string | null; year: number | null } | null;
  /** In the prior period's snapshot; null for an entrant. */
  prior: { cap: number | null; auditor: string | null } | null;
};

export type AtlasPeriod = {
  id: string;
  label: string;
  asOf: string;
  threshold: number;
  currency: string;
  operator: string;
};

export type Atlas = {
  period: AtlasPeriod;
  publication: { id: string; revision: number; publishedAt: string; overrideReason: string | null; amendmentReason: string | null };
  /** The period before this one, if one was published. */
  prior: (AtlasPeriod & { revision: number; companies: number; capTotal: number }) | null;
  companies: AtlasCompany[];
  /** In the prior period, not in this one. */
  leavers: Array<{ id: string; name: string; ticker: string | null; cap: number | null; auditor: string | null }>;
  /**
   * Globe key to every property token the roster files it under: a country
   * listed in two groups, or one place spelled two ways, is one shape on the
   * globe and has to be every one of its tokens in a drill-down link.
   */
  placeTokens: Record<string, string[]>;
  firmClasses: Record<string, FirmClass>;
};

/* ------------------------------------------------------------------ lens */

/**
 * "whitespace" is a company audited by a firm research has found that is not
 * Deloitte. A company whose auditor is not yet known is neither Deloitte's
 * nor another firm's, and is counted apart rather than called whitespace.
 */
export type FirmLens = "all" | "deloitte" | "whitespace";

export type Lens = {
  firm: FirmLens;
  /** A tier token: "1".."6", or "unclassified". */
  tier: string | null;
  commodity: string | null;
  /** A property's globe key. */
  place: string | null;
  /** A head office's globe key. */
  hq: string | null;
  /** A canonical firm, or "unknown". */
  auditor: string | null;
  band: BandKey | null;
};

export const NO_LENS: Lens = { firm: "all", tier: null, commodity: null, place: null, hq: null, auditor: null, band: null };

export type BandKey = "10b" | "2b" | "500m" | "floor";
export const BAND_EDGES: Array<{ key: BandKey; min: number }> = [
  { key: "10b", min: 10e9 }, { key: "2b", min: 2e9 }, { key: "500m", min: 500e6 }, { key: "floor", min: -Infinity },
];

export function bandOf(cap: number | null): BandKey | null {
  if (cap === null) return null;
  return BAND_EDGES.find((b) => cap >= b.min)!.key;
}

export function bandLabel(key: BandKey, threshold: number, currency: string): string {
  const m = (n: number) => fmtCap(n, currency);
  switch (key) {
    case "10b": return `${m(10e9)} and above`;
    case "2b": return `${m(2e9)} to ${m(10e9)}`;
    case "500m": return `${m(500e6)} to ${m(2e9)}`;
    case "floor": return `${m(threshold)} to ${m(500e6)}`;
  }
}

export function tierKey(c: Pick<AtlasCompany, "tier">): string {
  return c.tier === null ? "unclassified" : String(c.tier);
}

export function applyLens(companies: readonly AtlasCompany[], lens: Lens): AtlasCompany[] {
  return companies.filter((c) =>
    (lens.firm === "all" || (lens.firm === "deloitte" ? c.auditor === DELOITTE : another(c))) &&
    (lens.tier === null || tierKey(c) === lens.tier) &&
    (lens.commodity === null || c.commodities.includes(lens.commodity)) &&
    (lens.place === null || c.places.includes(lens.place)) &&
    (lens.hq === null || c.hq === lens.hq) &&
    (lens.auditor === null || (lens.auditor === "unknown" ? c.auditor === null : c.auditor === lens.auditor)) &&
    (lens.band === null || bandOf(c.cap) === lens.band));
}

/** Audited by a firm research has found, and not Deloitte. */
export function another(c: Pick<AtlasCompany, "auditor">): boolean {
  return c.auditor !== null && c.auditor !== DELOITTE;
}

export function lensIsEmpty(lens: Lens): boolean {
  return lens.firm === "all" && lens.tier === null && lens.commodity === null && lens.place === null &&
    lens.hq === null && lens.auditor === null && lens.band === null;
}

/* ------------------------------------------------------------- headline */

export type Headline = {
  companies: number;
  cap: number;
  /** Companies with no published market cap; the cap figures leave them out. */
  capUnknown: number;
  deloitte: number;
  deloitteCap: number;
  auditorUnknown: number;
};

export function headline(cs: readonly AtlasCompany[]): Headline {
  let cap = 0, capUnknown = 0, deloitte = 0, deloitteCap = 0, auditorUnknown = 0;
  for (const c of cs) {
    if (c.cap === null) capUnknown++; else cap += c.cap;
    if (c.auditor === DELOITTE) { deloitte++; deloitteCap += c.cap ?? 0; }
    if (c.auditor === null) auditorUnknown++;
  }
  return { companies: cs.length, cap, capUnknown, deloitte, deloitteCap, auditorUnknown };
}

/* --------------------------------------------------------------- league */

export type FirmRow = {
  firm: string;
  label: string;
  cls: FirmClass | "unknown";
  n: number;
  cap: number;
  ours: boolean;
};

/** Every firm by the number of companies it audits; the unnamed and the unknown last. */
export function league(cs: readonly AtlasCompany[]): FirmRow[] {
  const rows = new Map<string, FirmRow>();
  for (const c of cs) {
    const firm = c.auditor ?? "unknown";
    const row = rows.get(firm) ?? {
      firm, label: firmLabel(c.auditor), cls: c.firmClass ?? "unknown", n: 0, cap: 0, ours: c.auditor === DELOITTE,
    };
    row.n++;
    row.cap += c.cap ?? 0;
    rows.set(firm, row);
  }
  const last = (r: FirmRow) => (r.firm === "unknown" ? 2 : r.firm === UNNAMED ? 1 : 0);
  return [...rows.values()].sort((a, b) => last(a) - last(b) || b.n - a.n || b.cap - a.cap || a.label.localeCompare(b.label));
}

export function firmLabel(auditor: string | null): string {
  if (auditor === null) return "Not yet known";
  return auditor === UNNAMED ? "Another firm, not named" : auditor;
}

/** The five parts every auditor view sums to: Deloitte, the other Big 4, the national firms, every other firm, not yet known. */
export type FirmPart = { key: "deloitte" | "big4" | "national" | "other" | "unknown"; label: string; n: number; cap: number };

export function firmParts(cs: readonly AtlasCompany[]): FirmPart[] {
  const parts: FirmPart[] = [
    { key: "deloitte", label: "Deloitte", n: 0, cap: 0 },
    { key: "big4", label: "PwC, KPMG and Ernst & Young", n: 0, cap: 0 },
    { key: "national", label: "National firms", n: 0, cap: 0 },
    { key: "other", label: "Regional and other firms", n: 0, cap: 0 },
    { key: "unknown", label: "Not yet known", n: 0, cap: 0 },
  ];
  for (const c of cs) {
    const p = parts[partIndex(c)];
    p.n++;
    p.cap += c.cap ?? 0;
  }
  return parts;
}

function partIndex(c: AtlasCompany): number {
  if (c.auditor === null) return 4;
  if (c.auditor === DELOITTE) return 0;
  if (c.firmClass === "big4") return 1;
  if (c.firmClass === "national") return 2;
  return 3;
}

/* --------------------------------------------------------------- matrix */

export const MATRIX_FIRMS = ["Deloitte", "PwC", "KPMG", "Ernst & Young", "national", "other", "unknown"] as const;
export type MatrixFirm = (typeof MATRIX_FIRMS)[number];
export const MATRIX_FIRM_LABEL: Record<MatrixFirm, string> = {
  Deloitte: "Deloitte", PwC: "PwC", KPMG: "KPMG", "Ernst & Young": "EY",
  national: "National firms", other: "Regional and other", unknown: "Not yet known",
};

export type MatrixRow = { band: BandKey; label: string; n: number; cells: Record<MatrixFirm, number> };

export function matrixFirm(c: AtlasCompany): MatrixFirm {
  if (c.auditor === null) return "unknown";
  if ((MATRIX_FIRMS as readonly string[]).includes(c.auditor)) return c.auditor as MatrixFirm;
  if (c.firmClass === "national") return "national";
  return "other";
}

/** Size band by firm. Companies with no published market cap are counted apart, never in a band. */
export function matrix(cs: readonly AtlasCompany[], threshold: number, currency: string): { rows: MatrixRow[]; unsized: number } {
  const rows: MatrixRow[] = BAND_EDGES.map((b) => ({
    band: b.key, label: bandLabel(b.key, threshold, currency), n: 0,
    cells: Object.fromEntries(MATRIX_FIRMS.map((f) => [f, 0])) as Record<MatrixFirm, number>,
  }));
  let unsized = 0;
  for (const c of cs) {
    const band = bandOf(c.cap);
    if (band === null) { unsized++; continue; }
    const row = rows.find((r) => r.band === band)!;
    row.n++;
    row.cells[matrixFirm(c)]++;
  }
  return { rows, unsized };
}

/* --------------------------------------------------------------- places */

export type PlaceCount = { key: string; n: number; deloitte: number; cap: number };

/** Companies with a property in each place. A company counts once per place, so places do not sum to the population. */
export function propertyCounts(cs: readonly AtlasCompany[]): PlaceCount[] {
  const out = new Map<string, PlaceCount>();
  for (const c of cs) for (const key of c.places) {
    const p = out.get(key) ?? { key, n: 0, deloitte: 0, cap: 0 };
    p.n++;
    if (c.auditor === DELOITTE) p.deloitte++;
    p.cap += c.cap ?? 0;
    out.set(key, p);
  }
  return [...out.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export type HeadOfficeCount = PlaceCount & { cities: Array<{ city: string; n: number }> };

/** Head offices by place. Each company has one, so these do sum to the companies placed. */
export function headOfficeCounts(cs: readonly AtlasCompany[]): { rows: HeadOfficeCount[]; unplaced: number } {
  const out = new Map<string, HeadOfficeCount & { cityMap: Map<string, number> }>();
  let unplaced = 0;
  for (const c of cs) {
    if (!c.hq) { unplaced++; continue; }
    const p = out.get(c.hq) ?? { key: c.hq, n: 0, deloitte: 0, cap: 0, cities: [], cityMap: new Map() };
    p.n++;
    if (c.auditor === DELOITTE) p.deloitte++;
    p.cap += c.cap ?? 0;
    if (c.hqCity) p.cityMap.set(c.hqCity, (p.cityMap.get(c.hqCity) ?? 0) + 1);
    out.set(c.hq, p);
  }
  const rows = [...out.values()].map(({ cityMap, ...r }) => ({
    ...r, cities: [...cityMap].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n || a.city.localeCompare(b.city)),
  }));
  return { rows: rows.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)), unplaced };
}

/* --------------------------------------------------------------- stages */

/**
 * A company's stage as its tier says it: producing (Tiers 1 to 3),
 * development (5), exploration (6), royalty and streaming (4), or no tier.
 * Stage is published per company, not per property, so a producer is
 * producing wherever it holds ground, including where it only explores.
 */
export type StageGroup = "producing" | "development" | "exploration" | "royalty" | "unclassified";
export const STAGE_GROUPS: readonly StageGroup[] = ["producing", "development", "exploration", "royalty", "unclassified"];

export function stageGroup(c: Pick<AtlasCompany, "tier">): StageGroup {
  if (c.tier === null) return "unclassified";
  if (c.tier <= 3) return "producing";
  return c.tier === 4 ? "royalty" : c.tier === 5 ? "development" : "exploration";
}

export type StageCount = { key: string; n: number } & Record<StageGroup, number>;

/** The country a jurisdiction is in: a province is Canada, a state the United States, a country itself. */
export function countryOf(key: string): string {
  return key.startsWith("CA:") ? "Canada" : key.startsWith("US:") ? "United States" : key;
}

/**
 * The country of ground the globe cannot draw, from its words ("AFRICA:
 * Atlantis" is Atlantis; "CANADA: Somewhere" is Canada), so a summary by
 * country keeps it rather than dropping it.
 */
export function countryOfUnplaced(entry: string): string | null {
  const at = entry.indexOf(":");
  if (at < 0) return entry.trim() || null;
  const group = entry.slice(0, at).trim().toUpperCase();
  if (group === "CANADA") return "Canada";
  if (group === "USA") return "United States";
  return entry.slice(at + 1).trim() || null;
}

/**
 * Companies with ground in each place, split by stage. `placesOf` says where
 * a company counts; it counts once per place it names, so the places do not
 * sum to the population, but in every row the stages sum to its companies.
 */
export function groundByStage(cs: readonly AtlasCompany[], placesOf: (c: AtlasCompany) => Iterable<string>): StageCount[] {
  const out = new Map<string, StageCount>();
  for (const c of cs) {
    const g = stageGroup(c);
    for (const key of new Set(placesOf(c))) {
      const row = out.get(key) ?? { key, n: 0, producing: 0, development: 0, exploration: 0, royalty: 0, unclassified: 0 };
      row.n++;
      row[g]++;
      out.set(key, row);
    }
  }
  return [...out.values()].sort((a, b) => b.n - a.n || b.producing - a.producing || a.key.localeCompare(b.key));
}

/** Every country a company holds ground in, drawn or not. */
export function countriesOf(c: Pick<AtlasCompany, "places" | "unplaced">): string[] {
  return [...new Set([...c.places.map(countryOf), ...c.unplaced.map(countryOfUnplaced).filter((k): k is string => k !== null)])];
}

/**
 * The links a selected place draws on the globe: from a head office to every
 * place its companies hold ground, or from a place to every head office of
 * the companies holding ground there. One link per pair of places, carrying
 * the companies behind it.
 */
export type Link = { from: string; to: string; n: number; deloitte: number };

export function linksOf(cs: readonly AtlasCompany[], key: string, side: "hq" | "place"): Link[] {
  const out = new Map<string, Link>();
  for (const c of cs) {
    if (!c.hq) continue;
    if (side === "hq" && c.hq !== key) continue;
    if (side === "place" && !c.places.includes(key)) continue;
    const ends = side === "hq" ? c.places.filter((p) => p !== c.hq) : c.hq === key ? [] : [c.hq];
    for (const end of ends) {
      const [from, to] = side === "hq" ? [key, end] : [end, key];
      const id = `${from}>${to}`;
      const l = out.get(id) ?? { from, to, n: 0, deloitte: 0 };
      l.n++;
      if (c.auditor === DELOITTE) l.deloitte++;
      out.set(id, l);
    }
  }
  return [...out.values()].sort((a, b) => b.n - a.n);
}

/* ---------------------------------------------------------------- moves */

export type Move = { company: AtlasCompany; from: string | null; to: string | null; date: string | null };
export type FirmMoves = { firm: string; won: number; lost: number };

/** "2025-09-03", "2025-05" or "2025" to the first day it could mean; null when unreadable. */
export function earliestDay(date: string | null): string | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}

/** "2025-09-03", "2025-05" or "2025" to the last day it could mean; null when unreadable. */
export function latestDay(date: string | null): string | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  if (m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
  const month = m[2] ? Number(m[2]) : 12;
  const last = new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
  return `${m[1]}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-31" -> "31 Aug 2026", "2025-05" -> "May 2025", "2025" -> "2025".
 * Written out rather than left to Intl, so the server and the browser print
 * the same day and hydration has nothing to disagree about.
 */
export function dayLabel(date: string | null): string {
  if (!date) return "undated";
  const m = date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return date;
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : null;
  if (!month) return m[1];
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

export function monthsBefore(asOf: string, months: number): string {
  const [y, m, d] = asOf.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12), month = (total % 12) + 1;
  // The 29th of February two years back is the 28th: a day the month has.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Changes of auditor research found, dated within `months` of the period's
 * as-of date. A date given only as a year or a month counts only when every
 * day it could mean is inside the window, so a change is never claimed for it
 * on a date that may fall outside; those are counted apart, as are undated
 * changes.
 */
export function moves(cs: readonly AtlasCompany[], asOf: string, months = 24): {
  moves: Move[]; byFirm: FirmMoves[]; undated: number; straddling: number; looked: number; since: string;
} {
  const since = monthsBefore(asOf, months);
  const list: Move[] = [];
  let undated = 0, straddling = 0, looked = 0;
  for (const c of cs) {
    if (c.changeKnown) looked++;
    if (!c.change) continue;
    // A rename or a re-spelling of the incumbent is not a change of firm.
    if (c.change.from && c.change.from === c.auditor) continue;
    const first = earliestDay(c.change.date), last = latestDay(c.change.date);
    if (first === null || last === null) { undated++; continue; }
    if (last < since || first > asOf) continue;
    if (first < since || last > asOf) { straddling++; continue; }
    list.push({ company: c, from: c.change.from, to: c.auditor, date: c.change.date });
  }
  list.sort((a, b) => (earliestDay(b.date) ?? "").localeCompare(earliestDay(a.date) ?? "") || (b.company.cap ?? 0) - (a.company.cap ?? 0));
  const firms = new Map<string, FirmMoves>();
  const at = (firm: string) => firms.get(firm) ?? firms.set(firm, { firm, won: 0, lost: 0 }).get(firm)!;
  for (const m of list) {
    if (m.to && m.to !== UNNAMED && m.to !== m.from) at(m.to).won++;
    if (m.from && m.from !== UNNAMED && m.from !== m.to) at(m.from).lost++;
  }
  const byFirm = [...firms.values()].sort((a, b) => (b.won + b.lost) - (a.won + a.lost) || (b.won - b.lost) - (a.won - a.lost) || a.firm.localeCompare(b.firm));
  return { moves: list, byFirm, undated, straddling, looked, since };
}

/** Companies whose published auditor differs from the prior period's, both known. */
function differs(cs: readonly AtlasCompany[]): AtlasCompany[] {
  return cs.filter((c) => c.prior && c.prior.auditor && c.auditor && c.prior.auditor !== c.auditor);
}

/**
 * Companies whose published auditor differs from the prior period's, both
 * known. "Another firm, not named" is someone outside the Big 4: it differs
 * from a Big 4 firm, but beside any other firm it may be that same firm, so
 * that pair is not counted as a change.
 */
export function switchedSincePrior(cs: readonly AtlasCompany[], classes: Readonly<Record<string, FirmClass>> = {}): Move[] {
  const big4 = (firm: string) => classes[firm] === "big4";
  return differs(cs)
    .filter((c) => {
      const [from, to] = [c.prior!.auditor!, c.auditor!];
      return from === UNNAMED ? big4(to) : to === UNNAMED ? big4(from) : true;
    })
    .map((c) => ({ company: c, from: c.prior!.auditor, to: c.auditor, date: null }))
    .sort((a, b) => (b.company.cap ?? 0) - (a.company.cap ?? 0));
}

/* -------------------------------------------------------------- signals */

export type Signal = {
  id: "large" | "producers" | "tenure" | "sec" | "moved";
  title: string;
  /** What the count is a count of, and out of what, in one sentence. */
  rule: string;
  companies: AtlasCompany[];
  /** The companies the rule could be checked for: the denominator, on the numerator's own population. */
  of: number;
};

const OUTSIDE = new Set<FirmClass>(["regional", "other"]);

/** A firm whose class the firm list records: named, and not "another firm, not named". */
const classed = (c: AtlasCompany) => c.auditor !== null && c.auditor !== UNNAMED && c.firmClass !== null;

/**
 * Published facts a partner may want before a conversation. Each is a count
 * of companies out of the companies it could be checked for, both drawn from
 * one population, with the companies behind it. None is a score, none says
 * what a company needs, and none is combined with another.
 */
export function signals(cs: readonly AtlasCompany[], asOf: string, currency: string): Signal[] {
  const year = Number(asOf.slice(0, 4));
  const byCap = (list: AtlasCompany[]) => list.sort((a, b) => (b.cap ?? 0) - (a.cap ?? 0) || a.name.localeCompare(b.name));
  const line = fmtCap(500e6, currency);
  const sized = cs.filter((c) => c.cap !== null && c.cap >= 500e6 && classed(c));
  const producers = cs.filter((c) => c.tier !== null && c.tier <= 3 && classed(c));
  const tenured = cs.filter((c) => c.since !== null && another(c));
  const sec = cs.filter((c) => c.sec !== null && another(c));
  const recent = moves(cs, asOf).moves.map((m) => m.company);
  return [
    { id: "large", title: `${line} or more, outside the Big 4 and the national firms`,
      rule: `Audited outside the Big 4 and the national firms, of the companies worth ${line} or more whose auditor is named and classed.`,
      companies: byCap(sized.filter((c) => OUTSIDE.has(c.firmClass!))), of: sized.length },
    { id: "producers", title: "Producers outside the Big 4 and the national firms",
      rule: "Audited outside the Big 4 and the national firms, of the companies in production (Tier 1 to 3) whose auditor is named and classed.",
      companies: byCap(producers.filter((c) => OUTSIDE.has(c.firmClass!))), of: producers.length },
    { id: "tenure", title: "Ten years or more with one auditor",
      rule: `Appointed in ${year - 10} or earlier, of the companies audited by another firm whose appointment year is known.`,
      companies: byCap(tenured.filter((c) => year - c.since! >= 10)), of: tenured.length },
    { id: "sec", title: "Files with the SEC",
      rule: "Registered with the US SEC (a 40-F, 20-F or 10-K filer), of the companies audited by another firm whose SEC status is known.",
      companies: byCap(sec.filter((c) => c.sec === true)), of: sec.length },
    { id: "moved", title: "Changed auditor in the last two years",
      rule: `A change of auditor dated between ${dayLabel(monthsBefore(asOf, 24))} and ${dayLabel(asOf)}, of the companies research checked for one.`,
      companies: byCap(recent), of: cs.filter((c) => c.changeKnown).length },
  ];
}

/** Fiscal year-ends by month, 1 to 12, with the count research has not found. */
export function yearEnds(cs: readonly AtlasCompany[]): { months: number[]; unknown: number } {
  const months = Array(12).fill(0) as number[];
  let unknown = 0;
  for (const c of cs) {
    const m = c.yearEnd ? Number(c.yearEnd.slice(0, 2)) : NaN;
    if (m >= 1 && m <= 12) months[m - 1]++; else unknown++;
  }
  return { months, unknown };
}

/* ----------------------------------------------------------------- fees */

export type FeeRow = { firm: string; byCurrency: Array<{ currency: string; sum: number; n: number }>; n: number };

/**
 * Audit fees on record, by firm and currency. Never summed across currencies:
 * there is no FX table, and a CAD and a USD fee added together is a number
 * nobody filed. A fee with no currency is counted apart.
 */
export function fees(cs: readonly AtlasCompany[]): { rows: FeeRow[]; known: number; noCurrency: number } {
  const rows = new Map<string, FeeRow>();
  let known = 0, noCurrency = 0;
  for (const c of cs) {
    if (!c.fee) continue;
    known++;
    if (!c.fee.currency) { noCurrency++; continue; }
    const firm = c.auditor ?? "unknown";
    const row = rows.get(firm) ?? { firm, byCurrency: [], n: 0 };
    row.n++;
    const cur = row.byCurrency.find((b) => b.currency === c.fee!.currency) ??
      (row.byCurrency.push({ currency: c.fee.currency, sum: 0, n: 0 }), row.byCurrency.at(-1)!);
    cur.sum += c.fee.amount;
    cur.n++;
    rows.set(firm, row);
  }
  for (const r of rows.values()) r.byCurrency.sort((a, b) => b.n - a.n || a.currency.localeCompare(b.currency));
  return { rows: [...rows.values()].sort((a, b) => b.n - a.n || a.firm.localeCompare(b.firm)), known, noCurrency };
}

/* ---------------------------------------------------------------- delta */

export type Delta = {
  entrants: AtlasCompany[];
  continuing: number;
  /** Combined cap of the continuing companies, now and then, where both are known. */
  capNow: number;
  capThen: number;
  /** How many continuing companies have a cap both now and then: what capNow and capThen add up. */
  paired: number;
  tierUp: number;
  tierDown: number;
  switched: Move[];
  /** Went between "another firm, not named" and a firm outside the Big 4: perhaps no change at all. */
  unclear: number;
};

export function delta(atlas: Pick<Atlas, "companies" | "prior"> & { firmClasses?: Atlas["firmClasses"] }): Delta | null {
  if (!atlas.prior) return null;
  const entrants: AtlasCompany[] = [];
  let continuing = 0, capNow = 0, capThen = 0, paired = 0, tierUp = 0, tierDown = 0;
  for (const c of atlas.companies) {
    if (!c.prior) { entrants.push(c); continue; }
    continuing++;
    if (c.cap !== null && c.prior.cap !== null) { capNow += c.cap; capThen += c.prior.cap; paired++; }
    if (c.tier !== null && c.priorTier !== null && c.tier !== c.priorTier) {
      if (c.tier < c.priorTier) tierUp++; else tierDown++;
    }
  }
  const switched = switchedSincePrior(atlas.companies, atlas.firmClasses);
  return {
    entrants, continuing, capNow, capThen, paired, tierUp, tierDown, switched,
    unclear: differs(atlas.companies).length - switched.length,
  };
}

/* ----------------------------------------------------------- formatting */

const PREFIX: Record<string, string> = { CAD: "C$", USD: "US$", AUD: "A$", GBP: "£", EUR: "€" };

/** 1.3462e12 -> "C$1.35T"; 2.003e11 -> "C$200.3B"; 5e8 -> "C$500M". */
export function fmtCap(n: number, currency: string): string {
  const p = PREFIX[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const a = Math.abs(n);
  const cut = (x: number, d: number) => String(Math.round(x * 10 ** d) / 10 ** d);
  // The unit is chosen by the figure as it prints: 999.97M rounds to a
  // thousand millions, so it is "C$1B", never "C$1000M".
  const body = a >= 999.95e9 ? `${cut(a / 1e12, 2)}T` : a >= 999.95e6 ? `${cut(a / 1e9, 1)}B` : a >= 999.95e3 ? `${cut(a / 1e6, 1)}M`
    : a >= 999.5 ? `${cut(a / 1e3, 1)}K` : String(Math.round(a));
  return `${n < 0 ? "-" : ""}${p}${body}`;
}

/** 0.0718 -> "7.2%". */
export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  // Multiplied before dividing, as views.ts does: 201/400 is 50.25% exactly,
  // and (201 / 400) * 1000 is 502.49999... in floating point, which read 50.2%.
  return `${Math.round((1000 * part) / whole) / 10}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-CA")} ${n === 1 ? one : many}`;
}
