/**
 * The companies table: its rows, its filters, its sort, and the words for both.
 *
 * ONE MODULE FOR THE SCREEN AND THE EXPORT. The table filters in the browser
 * and the export filters on the server, and if they each had their own idea
 * of what "Tier 2 or 3, head office in Ontario" means, a download would carry
 * rows the screen never showed. So both read the filter from the same URL
 * parameters through parseRosterParams, and both narrow through filterRows.
 *
 * No node imports: Roster.tsx is a client component. Keep it that way, or the
 * build fails deep in Turbopack with "does not support external modules".
 *
 * Stage is tri-state here as everywhere. A company whose stage evidence is
 * "none" was not researched: it is not "no stages", and it never matches a
 * stage filter. It has its own option, "Not researched".
 */
import { formatFee, formatFieldValue, STAGE_ORDER, type Money, type Stage } from "../format/fields.ts";
import { hqJurisdiction, provinceCode, provinceName, type HqGroup } from "../publish/jurisdictions.ts";

/* ------------------------------------------------------------- the row */

export type StageEvidence = "none" | "partial" | "complete";

export type MetaEntry = { field: string; label: string; text: string };

export type RosterRow = {
  companyId: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  tier: number | null;
  status: string;
  footprint: string;
  auditor: string | null;
  marketCap: number | null;
  /** Long form, as stored: "Ontario, Canada", "Colorado, United States", "Chile". */
  hqRegion: string | null;
  /** The city, where research found one. The workbook carries none. */
  hqCity: string | null;
  /** As stored: a Money, or a bare number from before currencies were kept. */
  auditFee: unknown;
  erp: string | null;
  /**
   * The stages this revision froze. null when the revision predates stage rows
   * (revisions 1-8): the table then says so rather than guessing from the tier.
   */
  stages: Stage[] | null;
  stageEvidence: StageEvidence;
  /** property_regions: bucket -> entries, e.g. CANADA -> [ON, QC]. */
  regions: Record<string, string[]>;
  /**
   * Where each cited value came from, by field key (extract, ai_accepted,
   * manual_override ...). A researched value links to its citation on the
   * company page; a researched value that is null is "Not found".
   */
  sources: Record<string, string>;
  /** Every public value with no column of its own, as text, for search. */
  meta: MetaEntry[];
};

/** The fields a column shows. Everything else public is searched through `meta`. */
export const COLUMN_FIELDS = new Set([
  "company_name", "root_ticker", "exchange", "tier", "footprint", "auditor", "market_cap_cad",
  "head_office_region", "head_office_location", "audit_fee", "incumbent_erp",
]);

/** Never searched: derived, or carried by a column under another name. */
export const META_EXCLUDED = new Set(["stage_evidence_state", "property_evidence_state", "dtt_market"]);

/* ------------------------------------------------------------ the words */

export const TIER_WORD: Record<string, string> = {
  unclassified_no_stage_evidence: "No stage research",
  unclassified_no_property_evidence: "No property evidence",
  unclassified_conflicting: "Conflicting",
};

export const FOOTPRINT_WORD: Record<string, string> = {
  canada_only: "Canada only", abroad: "Abroad only", canada_and_abroad: "Canada and abroad", none: "None",
};

export const STAGE_LABEL: Record<Stage, string> = {
  exploration: "Exploration", development: "Development",
  production: "Production", royalty_streaming: "Royalty / streaming",
};

/**
 * The stage a tier implies: the one that DECIDED it. Not the company's stages
 * -- a producer may explore too -- which is why the four flag columns exist.
 */
export const STAGE_OF_TIER: Record<number, Stage> = {
  1: "production", 2: "production", 3: "production", 4: "royalty_streaming", 5: "development", 6: "exploration",
};

/** The sentinel research writes for "a firm the filing does not name". */
export const UNNAMED_AUDITOR = "__other_unnamed__";

export function auditorWord(name: string | null): string {
  if (!name) return "Not known";
  return name === UNNAMED_AUDITOR ? "Other (not named)" : name;
}

/** "Toronto, ON", "ON", "Perth, Australia", "Chile" -- the workbook's short form. */
export function hqWord(row: Pick<RosterRow, "hqRegion" | "hqCity">): string | null {
  const j = hqJurisdiction(row.hqRegion);
  if (!j) return row.hqCity;
  return row.hqCity ? `${row.hqCity}, ${j.short}` : j.short;
}

/** A researched value that research looked for and did not find. */
export function notFound(row: RosterRow, field: string, value: unknown): boolean {
  return (value === null || value === undefined) && row.sources[field] === "ai_accepted";
}

/** A value that came from research or a reviewer, so it has a citation to link to. */
export function cited(row: RosterRow, field: string): boolean {
  const s = row.sources[field];
  return s === "ai_accepted" || s === "manual_override";
}

/* ----------------------------------------------------------- the filter */

export type SortKey =
  | "name" | "ticker" | "tier" | "stage" | "footprint" | "hq" | "auditor" | "auditFee" | "erp" | "marketCap";

export type RosterFilter = {
  q: string;
  tier: string[];
  hq: string[];
  stage: string[];
  auditor: string[];
  footprint: string[];
  prop: string[];
  /** Whitespace only: companies Deloitte does not audit, unknown auditors included. */
  ws: boolean;
  sort: SortKey;
  dir: 1 | -1;
};

/** Market cap, largest first: the names that matter on the first screen. */
export const DEFAULT_SORT: { sort: SortKey; dir: 1 | -1 } = { sort: "marketCap", dir: -1 };

export const EMPTY_FILTER: RosterFilter = {
  q: "", tier: [], hq: [], stage: [], auditor: [], footprint: [], prop: [], ws: false, ...DEFAULT_SORT,
};

const MULTI = ["tier", "hq", "stage", "auditor", "footprint", "prop"] as const;
type Multi = typeof MULTI[number];

const SORT_KEYS: readonly SortKey[] =
  ["name", "ticker", "tier", "stage", "footprint", "hq", "auditor", "auditFee", "erp", "marketCap"];

const TIER_TOKENS = ["1", "2", "3", "4", "5", "6", "no_stage", "no_property", "conflicting", "unclassified"];
const STAGE_TOKENS = [...STAGE_ORDER, "none"];
const FOOTPRINT_TOKENS = Object.keys(FOOTPRINT_WORD);

/** A tier, or the reason there is none, as one filter token. */
export function tierToken(row: Pick<RosterRow, "tier" | "status">): string {
  if (row.tier !== null) return String(row.tier);
  switch (row.status) {
    case "unclassified_no_stage_evidence": return "no_stage";
    case "unclassified_no_property_evidence": return "no_property";
    case "unclassified_conflicting": return "conflicting";
    default: return "unclassified";
  }
}

const TIER_TOKEN_WORD: Record<string, string> = {
  no_stage: "No stage research", no_property: "No property evidence",
  conflicting: "Conflicting", unclassified: "Unclassified",
};

export function tierTokenWord(token: string): string {
  return /^\d$/.test(token) ? `Tier ${token}` : TIER_TOKEN_WORD[token] ?? token;
}

/** "CANADA:ON". Canadian entries fold through provinceCode, so NWT and NT are one place. */
export function propToken(bucket: string, entry: string): string {
  return `${bucket}:${bucket === "CANADA" ? provinceCode(entry) : entry}`;
}

function propTokensOf(row: Pick<RosterRow, "regions">): string[] {
  const out: string[] = [];
  for (const [bucket, entries] of Object.entries(row.regions)) {
    for (const e of entries) out.push(propToken(bucket, e));
  }
  return out;
}

function hqTokenOf(row: Pick<RosterRow, "hqRegion">): string {
  return hqJurisdiction(row.hqRegion)?.key ?? "unknown";
}

function auditorTokenOf(row: Pick<RosterRow, "auditor">): string {
  return row.auditor ?? "unknown";
}

/** Any token, capped: a URL is typed by people and pasted into emails. */
const clean = (v: string) => v.trim().slice(0, 80);

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function all(params: Params, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/**
 * The filter in a URL. Repeated keys are the multi-select (?tier=1&tier=2),
 * OR within a key and AND across keys. Tokens with a fixed vocabulary are
 * checked against it; data-driven ones (head office, auditor, property) are
 * kept and checked against what the rows hold by dropUnknown.
 *
 * ?province=ON is the dashboard map's link, from before there was a property
 * filter, and still works: it is prop=CANADA:ON.
 */
export function parseRosterParams(params: Params): RosterFilter {
  const pick = (key: Multi, allowed?: readonly string[]) => {
    const seen = new Set<string>();
    // Repeated keys ARE the multi-select. Values are never split on commas:
    // a firm or a place may contain one.
    for (const raw of all(params, key)) {
      const v = clean(raw);
      if (v && (!allowed || allowed.includes(v))) seen.add(v);
    }
    return [...seen];
  };
  const prop = pick("prop");
  for (const p of all(params, "province")) {
    const code = provinceCode(clean(p));
    if (code) prop.push(propToken("CANADA", code));
  }
  const sortRaw = all(params, "sort")[0];
  const sort = SORT_KEYS.includes(sortRaw as SortKey) ? sortRaw as SortKey : DEFAULT_SORT.sort;
  const dirRaw = all(params, "dir")[0];
  const dir: 1 | -1 = dirRaw === "asc" ? 1 : dirRaw === "desc" ? -1
    : sort === DEFAULT_SORT.sort ? DEFAULT_SORT.dir : 1;
  return {
    q: clean(all(params, "q")[0] ?? ""),
    tier: pick("tier", TIER_TOKENS),
    hq: pick("hq"),
    stage: pick("stage", STAGE_TOKENS),
    auditor: pick("auditor"),
    footprint: pick("footprint", FOOTPRINT_TOKENS),
    prop: [...new Set(prop)],
    ws: ["1", "true", "yes"].includes(all(params, "ws")[0] ?? ""),
    sort, dir,
  };
}

/** The URL for a filter, defaults omitted, keys in a stable order. Round-trips. */
export function toRosterParams(f: RosterFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (f.q) out.set("q", f.q);
  for (const key of MULTI) for (const v of f[key]) out.append(key, v);
  if (f.ws) out.set("ws", "1");
  if (f.sort !== DEFAULT_SORT.sort || f.dir !== DEFAULT_SORT.dir) {
    out.set("sort", f.sort);
    out.set("dir", f.dir === 1 ? "asc" : "desc");
  }
  return out;
}

export function isNarrowed(f: RosterFilter): boolean {
  return Boolean(f.q) || f.ws || MULTI.some((k) => f[k].length > 0);
}

/* ------------------------------------------------------------ narrowing */

/**
 * The deciding stage when this revision carries no stage rows, else the
 * stages it froze. Used for the stage filter and its sort.
 */
function stagesKnown(row: RosterRow): Stage[] {
  if (row.stages) return row.stages;
  return row.tier === null ? [] : [STAGE_OF_TIER[row.tier]];
}

function matchesStage(row: RosterRow, wanted: string[]): boolean {
  return wanted.some((w) => w === "none"
    ? row.stageEvidence === "none"
    : stagesKnown(row).includes(w as Stage));
}

/** What the visible cells say, so a search for something on screen needs no hint. */
function visibleText(row: RosterRow): string {
  return [row.name, row.ticker, row.exchange, hqWord(row), row.hqRegion, auditorWord(row.auditor), row.erp,
          row.auditFee === null || row.auditFee === undefined ? null : formatFee(row.auditFee)]
    .filter(Boolean).join(" ").toLowerCase();
}

export type Shown = { row: RosterRow; matched: MetaEntry | null };

/** The rows a filter keeps, each with the hidden value it matched on, if any. */
export function filterRows(rows: RosterRow[], f: RosterFilter): Shown[] {
  const q = f.q.trim().toLowerCase();
  const out: Shown[] = [];
  for (const row of rows) {
    if (f.ws && row.auditor === "Deloitte") continue;
    if (f.tier.length && !f.tier.includes(tierToken(row))) continue;
    if (f.hq.length && !f.hq.includes(hqTokenOf(row))) continue;
    if (f.stage.length && !matchesStage(row, f.stage)) continue;
    if (f.auditor.length && !f.auditor.includes(auditorTokenOf(row))) continue;
    if (f.footprint.length && !f.footprint.includes(row.footprint)) continue;
    if (f.prop.length) {
      const held = propTokensOf(row);
      if (!f.prop.some((p) => held.includes(p))) continue;
    }
    let matched: MetaEntry | null = null;
    if (q) {
      if (!visibleText(row).includes(q)) {
        matched = row.meta.find((m) => m.text.toLowerCase().includes(q)) ?? null;
        if (!matched) continue;
      }
    }
    out.push({ row, matched });
  }
  return out;
}

/**
 * Fees in one currency compare; fees in two do not, and there is no FX table
 * to pretend otherwise. So currency first, then amount within it.
 */
function feeKey(v: unknown): [string, number] | null {
  if (v && typeof v === "object" && typeof (v as Money).amount === "number") {
    return [(v as Money).currency ?? "~", (v as Money).amount];
  }
  if (typeof v === "number") return ["~", v];
  return null;
}

/** Sorted, with what has no value always last whichever way the column runs. */
export function sortRows(list: Shown[], sort: SortKey, dir: 1 | -1): Shown[] {
  const key = (r: RosterRow): string | number | [string, number] | null => {
    switch (sort) {
      case "name": return r.name;
      case "ticker": return r.ticker;
      case "tier": return r.tier;
      case "stage": {
        const s = stagesKnown(r)[0];
        return s ? STAGE_ORDER.indexOf(s) : null;
      }
      case "footprint": return FOOTPRINT_WORD[r.footprint] ?? r.footprint;
      case "hq": return hqWord(r);
      case "auditor": return r.auditor ? auditorWord(r.auditor) : null;
      case "auditFee": return feeKey(r.auditFee);
      case "erp": return r.erp;
      case "marketCap": return r.marketCap;
    }
  };
  const cmp = (x: NonNullable<ReturnType<typeof key>>, y: NonNullable<ReturnType<typeof key>>): number => {
    if (Array.isArray(x) && Array.isArray(y)) return x[0].localeCompare(y[0]) || x[1] - y[1];
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), "en-CA");
  };
  return [...list].sort((a, b) => {
    const [x, y] = [key(a.row), key(b.row)];
    if (x === null && y === null) return a.row.name.localeCompare(b.row.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return cmp(x, y) * dir || a.row.name.localeCompare(b.row.name);
  });
}

/* ---------------------------------------------------------- the options */

export type FacetOption = { value: string; label: string; count: number };
export type FacetGroup = { label: string; options: FacetOption[] };
export type Facets = Record<Multi, FacetGroup[]>;

function tally(rows: RosterRow[], tokensOf: (r: RosterRow) => string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) for (const t of new Set(tokensOf(r))) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

const PROP_BUCKET_WORD: Record<string, string> = {
  CANADA: "Canada", USA: "United States", "LATIN AMERICA": "Latin America", "UK/EUROPE": "UK and Europe",
  AFRICA: "Africa", ASIA: "Asia", "AUS/NZ/PNG": "Australia, NZ and PNG", OTHER: "Other",
};

/**
 * What each filter can be set to, built from the rows rather than written
 * down, so an option never names a value nobody holds -- with how many hold it.
 */
export function facetOptions(rows: RosterRow[]): Facets {
  const one = (label: string, counts: Map<string, number>, order: string[], word: (v: string) => string): FacetGroup[] =>
    [{ label, options: order.filter((v) => counts.has(v)).map((v) => ({ value: v, label: word(v), count: counts.get(v)! })) }];

  const tiers = tally(rows, (r) => [tierToken(r)]);
  const stages = tally(rows, (r) => r.stageEvidence === "none" ? ["none"] : stagesKnown(r));
  const footprints = tally(rows, (r) => [r.footprint]);

  const auditors = tally(rows, (r) => [auditorTokenOf(r)]);
  const firmOrder = [...auditors.keys()].filter((k) => k !== "unknown")
    .sort((a, b) => (a === "Deloitte" ? -1 : b === "Deloitte" ? 1 : auditorWord(a).localeCompare(auditorWord(b))));
  if (auditors.has("unknown")) firmOrder.push("unknown");

  const hqs = tally(rows, (r) => [hqTokenOf(r)]);
  const hqGroups = new Map<HqGroup | "Not known", FacetOption[]>();
  for (const [key, count] of hqs) {
    const j = key === "unknown" ? null
      : hqJurisdiction(rows.find((r) => hqTokenOf(r) === key)?.hqRegion);
    const group = j?.group ?? "Not known";
    const label = j ? (j.group === "Other countries" ? j.label : `${j.label} (${j.short})`) : "Not known";
    if (!hqGroups.has(group)) hqGroups.set(group, []);
    hqGroups.get(group)!.push({ value: key, label, count });
  }
  const hq: FacetGroup[] = (["Canada", "United States", "Other countries", "Not known"] as const)
    .filter((g) => hqGroups.has(g))
    .map((g) => ({ label: g, options: hqGroups.get(g)!.sort((a, b) => a.label.localeCompare(b.label)) }));

  const props = tally(rows, propTokensOf);
  const byBucket = new Map<string, FacetOption[]>();
  for (const [token, count] of props) {
    const i = token.indexOf(":");
    const bucket = token.slice(0, i); const entry = token.slice(i + 1);
    const label = bucket === "CANADA" ? `${provinceName(entry)} (${entry})` : entry;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push({ value: token, label, count });
  }
  const prop: FacetGroup[] = Object.keys(PROP_BUCKET_WORD).filter((b) => byBucket.has(b))
    .map((b) => ({ label: PROP_BUCKET_WORD[b], options: byBucket.get(b)!.sort((a, c) => a.label.localeCompare(c.label)) }));

  return {
    tier: one("Tier", tiers, TIER_TOKENS, tierTokenWord),
    hq,
    stage: one("Stage of operations", stages, STAGE_TOKENS,
               (v) => v === "none" ? "Not researched" : STAGE_LABEL[v as Stage]),
    auditor: one("Auditor", auditors, firmOrder, (v) => v === "unknown" ? "Not known" : auditorWord(v)),
    footprint: one("Footprint", footprints, FOOTPRINT_TOKENS, (v) => FOOTPRINT_WORD[v]),
    prop,
  };
}

/**
 * A filter's data-driven tokens kept only where some row holds them, so a
 * stale link narrows by what still exists rather than to nothing for a reason
 * nobody can see.
 */
export function dropUnknown(f: RosterFilter, facets: Facets): RosterFilter {
  const known = (key: Multi) => new Set(facets[key].flatMap((g) => g.options.map((o) => o.value)));
  const keep = (key: Multi) => f[key].filter((v) => known(key).has(v));
  return { ...f, hq: keep("hq"), auditor: keep("auditor"), prop: keep("prop") };
}

export const FILTER_LABEL: Record<Multi, string> = {
  tier: "Tier", hq: "Company HQ", stage: "Stage of operations", auditor: "Auditor",
  footprint: "Footprint", prop: "Properties in",
};

/** The filter in words, for the export's header and the screen's status line. */
export function describeFilter(f: RosterFilter, facets: Facets): string {
  const word = (key: Multi, v: string) =>
    facets[key].flatMap((g) => g.options).find((o) => o.value === v)?.label ?? v;
  const parts: string[] = [];
  for (const key of MULTI) {
    if (f[key].length) parts.push(`${FILTER_LABEL[key]}: ${f[key].map((v) => word(key, v)).join(" or ")}`);
  }
  if (f.ws) parts.push("Not audited by Deloitte");
  if (f.q) parts.push(`Matching “${f.q}”`);
  return parts.length ? parts.join(" · ") : "Every company in the period";
}

/* -------------------------------------------------------------- columns */

/** The table's columns, in order. The export writes the same ones first. */
export const ROSTER_COLUMNS: Array<{ key: SortKey | Stage; label: string; numeric?: boolean; stage?: boolean }> = [
  { key: "name", label: "Company" },
  { key: "ticker", label: "Ticker" },
  { key: "tier", label: "Tier" },
  { key: "stage", label: "Stage" },
  ...STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABEL[s], stage: true })),
  { key: "footprint", label: "Footprint" },
  { key: "hq", label: "Company HQ" },
  { key: "auditor", label: "Auditor" },
  { key: "auditFee", label: "Audit fees" },
  { key: "erp", label: "Incumbent ERP" },
  { key: "marketCap", label: "Market cap", numeric: true },
];

/**
 * One stage cell. "yes" and "blank" only where the evidence is complete; under
 * partial evidence an absent stage is genuinely unknown; with none, nothing
 * was researched and the row says so once rather than four times.
 */
export function stageMark(row: RosterRow, stage: Stage): "yes" | "blank" | "unknown" | "not_researched" | "not_recorded" {
  if (row.stageEvidence === "none") return "not_researched";
  if (row.stages === null) return "not_recorded";
  if (row.stages.includes(stage)) return "yes";
  return row.stageEvidence === "complete" ? "blank" : "unknown";
}

/** Every public value with no column, as search sees it. */
export function metaFor(values: Array<{ field: string; label: string; value: unknown }>): MetaEntry[] {
  return values
    .filter((v) => !COLUMN_FIELDS.has(v.field) && !META_EXCLUDED.has(v.field) && v.value !== null && v.value !== undefined)
    .map((v) => ({ field: v.field, label: v.label, text: formatFieldValue(v.field, v.value) }))
    .filter((m) => m.text && m.text !== "—");
}
