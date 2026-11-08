/**
 * The published companies as the dashboard and Brief me read them, and the
 * pure counts they draw: the headline, places, stages, dates and figures.
 *
 * Nothing here scores a company or says which to approach (doc 01: the tool
 * does not decide which companies to pursue). Every count says what it is a
 * count of, so a figure can sum to what it shows.
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

/* ---------------------------------------------------------------- dates */

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
