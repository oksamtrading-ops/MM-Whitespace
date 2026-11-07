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
import {
  formatFee, formatFieldValue, formatInteger, formatMoney, formatMonthDay, STAGE_ORDER, type Money, type Stage,
} from "../format/fields.ts";
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
  /** Tax fees billed by the audit firm (NI 52-110's "Tax fees"), stored as auditFee is. */
  taxFee: unknown;
  /** What the company mines, as stored: TSX's list from the workbook, or research once accepted. */
  commodities: string[];
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
  /**
   * The values behind "More columns" (MORE_FIELDS), by field key, as stored.
   * They stay in `meta` too: the export carries every public value, and a
   * search finds them whether or not their column is shown.
   */
  more?: Record<string, unknown>;
};

/** The fields "More columns" reads. Never dtt_market: Viewers must not see it. */
export const MORE_FIELDS = [
  "website", "venture_graduate", "fiscal_year_end", "reporting_currency", "sec_registrant", "auditor_change",
  "auditor_since", "net_income", "total_assets", "audit_related_fee", "other_fee", "total_revenue",
] as const;

/** The fields a column shows. Everything else public is searched through `meta`. */
export const COLUMN_FIELDS = new Set([
  "company_name", "root_ticker", "exchange", "tier", "footprint", "auditor", "market_cap_cad",
  "head_office_region", "head_office_location", "audit_fee", "tax_fee", "commodities",
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

/**
 * The columns that can be shown or not; Company always shows. The four stage
 * columns go together.
 *
 * LEGACY_COLS is frozen: it is the table as it was when the URL said which
 * columns were HIDDEN (?hide=). Such a URL -- in a bookmark or a saved report
 * -- means "these, minus what it hides", and must keep meaning exactly that
 * however many columns are added. New columns go in MORE_COLS, hidden until
 * somebody picks them.
 */
export const LEGACY_COLS = [
  "marketCap", "ticker", "tier", "stage", "stages", "footprint", "commodities", "hq", "auditor", "auditFee", "taxFee",
] as const;
export const MORE_COLS = [
  "exchange", "website", "props", "venture", "sec", "fye", "repCur", "revenue", "netIncome", "totalAssets",
  "auditorSince", "auditorChange", "auditRelatedFee", "otherFee",
] as const;
export const COL_KEYS = [...LEGACY_COLS, ...MORE_COLS] as const;
export type ColKey = typeof COL_KEYS[number];
export type MoreColKey = typeof MORE_COLS[number];
/** What a table with no `cols` and no `hide` shows: the table as it always was. */
export const DEFAULT_COLS: readonly ColKey[] = LEGACY_COLS;
/** In a `cols` URL: no column but Company. */
export const NO_COLS = "~";

export type SortKey = "name" | Exclude<ColKey, "stages">;

export type RosterFilter = {
  q: string;
  tier: string[];
  hq: string[];
  stage: string[];
  auditor: string[];
  footprint: string[];
  /** Any of these commodities: OR, as every other filter is within itself. */
  commodity: string[];
  prop: string[];
  /** The Ticker column's exchange: TSX, TSXV ... or "unknown". */
  exchange: string[];
  /** The Stage column: the stage that decided the tier, or "none" for a company with no tier. */
  decides: string[];
  /** Each Stage of operations column: yes, no, unknown, not_researched, not_recorded. */
  exploration: string[];
  development: string[];
  production: string[];
  royalty_streaming: string[];
  /** Whitespace only: companies Deloitte does not audit, unknown auditors included. */
  ws: boolean;
  /** Company column: the name contains this. */
  name: string;
  /** Ticker column: the ticker contains this. */
  ticker: string;
  /** Ticker column: has one, or has none. */
  tickerHas: TextPresence;
  /** Website column: the address contains this; has one, or has none. */
  website: string;
  websiteHas: TextPresence;
  /** Venture graduate, SEC registrant, auditor change: yes/no (changed/no_change), not_found, unknown. */
  venture: string[];
  sec: string[];
  audchg: string[];
  /** Fiscal year-end ("12-31") and reporting currency ("USD"), or not_found, unknown. */
  fye: string[];
  repcur: string[];
  auditFee: RangeFilter;
  taxFee: RangeFilter;
  marketCap: RangeFilter;
  revenue: RangeFilter;
  netIncome: RangeFilter;
  totalAssets: RangeFilter;
  auditRelatedFee: RangeFilter;
  otherFee: RangeFilter;
  auditorSince: RangeFilter;
  /** The columns shown (and exported), in the table's order. Company always shows. */
  cols: ColKey[];
  sort: SortKey;
  dir: 1 | -1;
};

export type TextPresence = "" | "value" | "empty";
/** "" any; "value" has one; "empty" has none; "not_found" researched and not found (fees only). */
export type Presence = "" | "value" | "empty" | "not_found";

/**
 * A numeric column's filter. Amounts compare as stored, each in its own
 * currency: there is no FX table, so a reader who wants like with like picks
 * the currency too.
 */
export type RangeFilter = { min: number | null; max: number | null; cur: string[]; fy: string[]; has: Presence };

export const EMPTY_RANGE: RangeFilter = { min: null, max: null, cur: [], fy: [], has: "" };

/** Market cap, largest first: the names that matter on the first screen. */
export const DEFAULT_SORT: { sort: SortKey; dir: 1 | -1 } = { sort: "marketCap", dir: -1 };

export const EMPTY_FILTER: RosterFilter = {
  q: "", tier: [], hq: [], stage: [], auditor: [], footprint: [], commodity: [], prop: [],
  exchange: [], decides: [], exploration: [], development: [], production: [], royalty_streaming: [],
  ws: false, name: "", ticker: "", tickerHas: "", website: "", websiteHas: "",
  venture: [], sec: [], audchg: [], fye: [], repcur: [],
  auditFee: EMPTY_RANGE, taxFee: EMPTY_RANGE, marketCap: EMPTY_RANGE, revenue: EMPTY_RANGE, netIncome: EMPTY_RANGE,
  totalAssets: EMPTY_RANGE, auditRelatedFee: EMPTY_RANGE, otherFee: EMPTY_RANGE, auditorSince: EMPTY_RANGE,
  cols: [...DEFAULT_COLS],
  ...DEFAULT_SORT,
};

export const MULTI = [
  "tier", "hq", "stage", "auditor", "footprint", "commodity", "prop",
  "exchange", "decides", "exploration", "development", "production", "royalty_streaming",
  "venture", "sec", "audchg", "fye", "repcur",
] as const;
export type Multi = typeof MULTI[number];

/** The numeric columns, and the URL prefix each one's filter is written under. */
export const RANGES = {
  auditFee: "audit", taxFee: "tax", marketCap: "cap", revenue: "rev", netIncome: "ni", totalAssets: "assets",
  auditRelatedFee: "arf", otherFee: "oth", auditorSince: "since",
} as const;
export type RangeKey = keyof typeof RANGES;
/** The amounts printed in the company's own currency for a fiscal year: fees and financials. */
export const MONEY_KEYS = ["auditFee", "taxFee", "revenue", "netIncome", "totalAssets", "auditRelatedFee", "otherFee"] as const;
export type MoneyKey = typeof MONEY_KEYS[number];
const isMoneyKey = (k: string): k is MoneyKey => (MONEY_KEYS as readonly string[]).includes(k);

/** The stored field behind each numeric column. */
export const RANGE_FIELD: Record<RangeKey, string> = {
  auditFee: "audit_fee", taxFee: "tax_fee", marketCap: "market_cap_cad", revenue: "total_revenue",
  netIncome: "net_income", totalAssets: "total_assets", auditRelatedFee: "audit_related_fee", otherFee: "other_fee",
  auditorSince: "auditor_since",
};

/** The stored field behind each column of "More columns". */
export const MORE_FIELD: Record<MoreColKey, string> = {
  exchange: "exchange", website: "website", props: "property_regions", venture: "venture_graduate",
  sec: "sec_registrant", fye: "fiscal_year_end", repCur: "reporting_currency", revenue: "total_revenue",
  netIncome: "net_income", totalAssets: "total_assets", auditorSince: "auditor_since",
  auditorChange: "auditor_change", auditRelatedFee: "audit_related_fee", otherFee: "other_fee",
};

const SORT_KEYS: readonly SortKey[] = ["name", ...(COL_KEYS.filter((k) => k !== "stages") as SortKey[])];

/** The yes/no columns' filters, and the field each reads. */
const PICK_FIELD = {
  venture: "venture_graduate", sec: "sec_registrant", audchg: "auditor_change",
  fye: "fiscal_year_end", repcur: "reporting_currency",
} as const;
type PickKey = keyof typeof PICK_FIELD;
const PICK_KEYS = Object.keys(PICK_FIELD) as PickKey[];
const YES_NO_TOKENS = ["yes", "no", "not_found", "unknown"];
const CHANGE_TOKENS = ["changed", "no_change", "not_found", "unknown"];
export const PICK_WORD: Record<string, string> = {
  yes: "Yes", no: "No", changed: "Changed", no_change: "No change",
  not_found: "Researched, not found", unknown: "Not known",
};

/** One stage column's cell, as a filter token. */
export const MARK_TOKENS = ["yes", "no", "unknown", "not_researched", "not_recorded"] as const;
export const MARK_WORD: Record<string, string> = {
  yes: "Yes", no: "No", unknown: "Not known", not_researched: "Not researched", not_recorded: "Not recorded",
};
/** "Commodities: none recorded", as a token no commodity can be. */
export const NO_COMMODITY = "~none";
/** A fee stored before currencies were kept. */
export const NO_CURRENCY = "~";

export const TIER_TOKENS = ["1", "2", "3", "4", "5", "6", "no_stage", "no_property", "conflicting", "unclassified"];
const STAGE_TOKENS = [...STAGE_ORDER, "none"];
const DECIDES_TOKENS = [...STAGE_ORDER, "none"];
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

function exchangeTokenOf(row: Pick<RosterRow, "exchange">): string {
  return row.exchange ?? "unknown";
}

function decidesTokenOf(row: Pick<RosterRow, "tier">): string {
  return row.tier === null ? "none" : STAGE_OF_TIER[row.tier] ?? "none";
}

function commodityTokensOf(row: Pick<RosterRow, "commodities">): string[] {
  return row.commodities.length ? row.commodities : [NO_COMMODITY];
}

/**
 * A stored value by field key: the row's own fields for the columns that
 * always were, `more` for the rest. Properties with nothing in them are none.
 */
export function fieldValue(row: RosterRow, field: string): unknown {
  switch (field) {
    case "audit_fee": return row.auditFee ?? null;
    case "tax_fee": return row.taxFee ?? null;
    case "market_cap_cad": return row.marketCap;
    case "exchange": return row.exchange;
    case "property_regions":
      return Object.values(row.regions).some((v) => v.length > 0) ? row.regions : null;
    default: return row.more?.[field] ?? null;
  }
}

/** A website as a link: only http(s), shown by its host. */
export function siteOf(v: unknown): { href: string; host: string } | null {
  if (typeof v !== "string" || !/^https?:\/\//i.test(v.trim())) return null;
  try {
    const u = new URL(v.trim());
    return { href: u.href, host: u.host.replace(/^www\./, "") };
  } catch { return null; }
}

/** What a "More columns" cell says, or null when it holds nothing. */
export function cellWord(row: RosterRow, key: MoreColKey): string | null {
  const v = fieldValue(row, MORE_FIELD[key]);
  if (v === null || v === undefined) return null;
  const o = typeof v === "object" ? v as Record<string, unknown> : null;
  switch (key) {
    case "exchange": case "repCur": return typeof v === "string" && v.trim() ? v : null;
    case "website": return siteOf(v)?.host ?? null;
    case "props": return formatFieldValue("property_regions", v);
    case "venture": return typeof v === "boolean" ? (v ? "Yes" : "No") : null;
    case "sec":
      return o && "registrant" in o ? (o.registrant ? `Yes${o.form ? ` · ${o.form}` : ""}` : "No") : null;
    case "fye": return typeof v === "string" ? formatMonthDay(v) : null;
    case "auditorSince": return typeof v === "number" ? String(v) : null;
    case "auditorChange":
      return o && "changed" in o
        ? (o.changed ? `Changed${o.date ? ` ${o.date}` : ""}${o.previous_auditor ? ` from ${o.previous_auditor}` : ""}`
          : "No change")
        : null;
    default: return moneyParts(v) ? formatFee(v) : null;
  }
}

/** A yes/no column's filter token: its value, or why there is none. */
function pickTokenOf(row: RosterRow, key: PickKey): string {
  const field = PICK_FIELD[key];
  const v = fieldValue(row, field);
  const o = v && typeof v === "object" ? v as Record<string, unknown> : null;
  const absent = notFound(row, field, null) ? "not_found" : "unknown";
  switch (key) {
    case "venture": return typeof v === "boolean" ? (v ? "yes" : "no") : absent;
    case "sec": return o && "registrant" in o ? (o.registrant ? "yes" : "no") : absent;
    case "audchg": return o && "changed" in o ? (o.changed ? "changed" : "no_change") : absent;
    case "fye": case "repcur": return typeof v === "string" && v.trim() ? v.trim() : absent;
  }
}

/** stageMark as a filter token: "blank" is a no. */
function markTokenOf(row: RosterRow, stage: Stage): string {
  const m = stageMark(row, stage);
  return m === "blank" ? "no" : m;
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
 * checked against it; data-driven ones (head office, auditor, commodity, property) are
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
  const range = (key: RangeKey): RangeFilter => {
    const pre = RANGES[key];
    const num = (k: string) => {
      const raw = all(params, `${pre}_${k}`)[0];
      if (raw === undefined || raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
    };
    const many = (k: string, ok: (v: string) => boolean) =>
      [...new Set(all(params, `${pre}_${k}`).map(clean).filter((v) => v && ok(v)))];
    const hasRaw = all(params, `${pre}_has`)[0] ?? "";
    const presences: Presence[] = key === "marketCap" ? ["value", "empty"] : ["value", "empty", "not_found"];
    const money = isMoneyKey(key);
    return {
      min: num("min"), max: num("max"),
      cur: money ? many("cur", (v) => v === NO_CURRENCY || /^[A-Z]{3}$/.test(v)) : [],
      fy: money ? many("fy", (v) => /^(19|20)\d\d$/.test(v) || v === NO_CURRENCY) : [],
      has: (presences as string[]).includes(hasRaw) ? hasRaw as Presence : "",
    };
  };
  const presence = (key: string): TextPresence => {
    const v = all(params, key)[0] ?? "";
    return v === "value" || v === "empty" ? v : "";
  };
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
    commodity: pick("commodity"),
    prop: [...new Set(prop)],
    exchange: pick("exchange"),
    decides: pick("decides", DECIDES_TOKENS),
    exploration: pick("exploration", MARK_TOKENS),
    development: pick("development", MARK_TOKENS),
    production: pick("production", MARK_TOKENS),
    royalty_streaming: pick("royalty_streaming", MARK_TOKENS),
    ws: ["1", "true", "yes"].includes(all(params, "ws")[0] ?? ""),
    name: clean(all(params, "name")[0] ?? ""),
    ticker: clean(all(params, "ticker")[0] ?? ""),
    tickerHas: presence("ticker_has"),
    website: clean(all(params, "web")[0] ?? ""),
    websiteHas: presence("web_has"),
    venture: pick("venture", YES_NO_TOKENS),
    sec: pick("sec", YES_NO_TOKENS),
    audchg: pick("audchg", CHANGE_TOKENS),
    fye: pick("fye"),
    repcur: pick("repcur"),
    auditFee: range("auditFee"), taxFee: range("taxFee"), marketCap: range("marketCap"),
    revenue: range("revenue"), netIncome: range("netIncome"), totalAssets: range("totalAssets"),
    auditRelatedFee: range("auditRelatedFee"), otherFee: range("otherFee"), auditorSince: range("auditorSince"),
    cols: colsOf(params),
    sort, dir,
  };
}

/**
 * The columns a URL shows. `cols` lists them (NO_COLS for none). Before it
 * there was `hide`, which listed what was taken off the table as it then was:
 * that is LEGACY_COLS minus the hidden, whatever columns exist now. Neither:
 * the default. Always in the table's order, so one view has one URL.
 */
function colsOf(params: Params): ColKey[] {
  const isCol = (v: string): v is ColKey => (COL_KEYS as readonly string[]).includes(v);
  const listed = all(params, "cols");
  if (listed.length) {
    const shown = new Set(listed.filter(isCol));
    if (shown.size > 0 || listed.includes(NO_COLS)) return COL_KEYS.filter((k) => shown.has(k));
  }
  const hidden = new Set(all(params, "hide"));
  if (hidden.size) return LEGACY_COLS.filter((k) => !hidden.has(k));
  return [...DEFAULT_COLS];
}

/** Whether a filter shows the default columns, which its URL then leaves out. */
function defaultCols(cols: readonly ColKey[]): boolean {
  return cols.length === DEFAULT_COLS.length && DEFAULT_COLS.every((k) => cols.includes(k));
}

/** The URL for a filter, defaults omitted, keys in a stable order. Round-trips. */
export function toRosterParams(f: RosterFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (f.q) out.set("q", f.q);
  for (const key of MULTI) for (const v of f[key]) out.append(key, v);
  if (f.ws) out.set("ws", "1");
  if (f.name) out.set("name", f.name);
  if (f.ticker) out.set("ticker", f.ticker);
  if (f.tickerHas) out.set("ticker_has", f.tickerHas);
  if (f.website) out.set("web", f.website);
  if (f.websiteHas) out.set("web_has", f.websiteHas);
  for (const key of Object.keys(RANGES) as RangeKey[]) {
    const r = f[key]; const pre = RANGES[key];
    if (r.min !== null) out.set(`${pre}_min`, String(r.min));
    if (r.max !== null) out.set(`${pre}_max`, String(r.max));
    for (const c of r.cur) out.append(`${pre}_cur`, c);
    for (const y of r.fy) out.append(`${pre}_fy`, y);
    if (r.has) out.set(`${pre}_has`, r.has);
  }
  if (!defaultCols(f.cols)) {
    const shown = COL_KEYS.filter((k) => f.cols.includes(k));
    if (shown.length) for (const k of shown) out.append("cols", k);
    else out.set("cols", NO_COLS);
  }
  if (f.sort !== DEFAULT_SORT.sort || f.dir !== DEFAULT_SORT.dir) {
    out.set("sort", f.sort);
    out.set("dir", f.dir === 1 ? "asc" : "desc");
  }
  return out;
}

export function rangeSet(r: RangeFilter): boolean {
  return r.min !== null || r.max !== null || r.cur.length > 0 || r.fy.length > 0 || r.has !== "";
}

/** Whether a filter keeps fewer than every row. Which columns show narrows nothing. */
export function isNarrowed(f: RosterFilter): boolean {
  return Boolean(f.q) || f.ws || MULTI.some((k) => f[k].length > 0) ||
    Boolean(f.name) || Boolean(f.ticker) || f.tickerHas !== "" || Boolean(f.website) || f.websiteHas !== "" ||
    (Object.keys(RANGES) as RangeKey[]).some((k) => rangeSet(f[k]));
}

/**
 * "250k", "1.5M", "C$2,000,000", "3 bn" -> a number; "" -> null; anything else
 * -> undefined, which the field says is not an amount rather than guessing.
 */
export function parseAmount(text: string): number | null | undefined {
  const t = text.trim().toLowerCase().replace(/[\s,_]/g, "").replace(/^(c|ca|us|a|au)?\$/, "");
  if (!t) return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?|-?\.\d+)(k|m|mm|bn|b)?$/);
  if (!m) return undefined;
  const scale = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9 }[m[2] ?? ""] ?? 1;
  const n = Number(m[1]) * scale;
  // The URL keeps nothing this large (parseRosterParams), so neither does the box.
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? Math.round(n * 100) / 100 : undefined;
}

/** A number as a reader would type it back: 250000 -> "250k", 1500000 -> "1.5M". */
export function amountText(n: number | null): string {
  if (n === null) return "";
  const abs = Math.abs(n);
  const fit = (v: number, s: string) => `${Number(v.toFixed(3))}${s}`;
  if (abs >= 1e9 && abs % 1e7 === 0) return fit(n / 1e9, "B");
  if (abs >= 1e6 && abs % 1e4 === 0) return fit(n / 1e6, "M");
  if (abs >= 1e3 && abs % 10 === 0) return fit(n / 1e3, "k");
  return String(n);
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

/** What each searchable cell says, with the column it is in. */
function cellTexts(row: RosterRow): Array<{ col: ColKey | null; field: string; label: string; text: string }> {
  const fee = (v: unknown) => (v === null || v === undefined ? "" : formatFee(v));
  return [
    { col: null, field: "name", label: "Company", text: row.name },
    { col: "ticker", field: "ticker", label: "Ticker", text: [row.ticker, row.exchange].filter(Boolean).join(" ") },
    { col: "hq", field: "hq", label: "HQ", text: [hqWord(row), row.hqRegion].filter(Boolean).join(" ") },
    { col: "auditor", field: "auditor", label: "Auditor", text: auditorWord(row.auditor) },
    { col: "commodities", field: "commodities", label: "Commodities", text: row.commodities.join(", ") },
    { col: "auditFee", field: "audit_fee", label: "Audit fees", text: fee(row.auditFee) },
    { col: "taxFee", field: "tax_fee", label: "Tax fees paid to audit firm", text: fee(row.taxFee) },
    ...MORE_COLS.map((k) => ({
      col: k, field: MORE_FIELD[k], label: COL_WORD[k],
      text: k === "website" ? String(fieldValue(row, "website") ?? "") : cellWord(row, k) ?? "",
    })),
  ];
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
    if (f.commodity.length && !f.commodity.some((c) => commodityTokensOf(row).includes(c))) continue;
    if (f.exchange.length && !f.exchange.includes(exchangeTokenOf(row))) continue;
    if (f.decides.length && !f.decides.includes(decidesTokenOf(row))) continue;
    if (STAGE_ORDER.some((s) => f[s].length > 0 && !f[s].includes(markTokenOf(row, s)))) continue;
    if (f.name && !row.name.toLowerCase().includes(f.name.trim().toLowerCase())) continue;
    if (f.ticker && !(row.ticker ?? "").toLowerCase().includes(f.ticker.trim().toLowerCase())) continue;
    if (f.tickerHas === "value" && !row.ticker) continue;
    if (f.tickerHas === "empty" && row.ticker) continue;
    const site = siteOf(fieldValue(row, "website"));
    if (f.website && !(site?.href ?? "").toLowerCase().includes(f.website.trim().toLowerCase())) continue;
    if (f.websiteHas === "value" && !site) continue;
    if (f.websiteHas === "empty" && site) continue;
    if (PICK_KEYS.some((k) => f[k].length > 0 && !f[k].includes(pickTokenOf(row, k)))) continue;
    if ((Object.keys(RANGES) as RangeKey[]).some((k) => !inRange(row, k, f[k]))) continue;
    if (f.prop.length) {
      const held = propTokensOf(row);
      if (!f.prop.some((p) => held.includes(p))) continue;
    }
    let matched: MetaEntry | null = null;
    if (q) {
      // A match in a column the table hides is explained like any hidden value.
      const cells = cellTexts(row).filter((c) => c.text);
      const seen = cells.filter((c) => !c.col || f.cols.includes(c.col));
      if (!seen.some((c) => c.text.toLowerCase().includes(q))) {
        const tucked = cells.find((c) => c.col && !f.cols.includes(c.col) && c.text.toLowerCase().includes(q));
        matched = tucked ? { field: tucked.field, label: tucked.label, text: tucked.text }
          : row.meta.find((m) => m.text.toLowerCase().includes(q)) ?? null;
        if (!matched) continue;
      }
    }
    out.push({ row, matched });
  }
  return out;
}

/** A fee's parts, whichever shape it was stored in; null when there is no amount. */
export function moneyParts(v: unknown): { amount: number; currency: string; fy: string } | null {
  if (v && typeof v === "object" && typeof (v as Money).amount === "number") {
    const m = v as Money;
    return { amount: m.amount, currency: m.currency ?? NO_CURRENCY,
             fy: m.fiscal_year ? String(m.fiscal_year) : NO_CURRENCY };
  }
  if (typeof v === "number") return { amount: v, currency: NO_CURRENCY, fy: NO_CURRENCY };
  return null;
}

/** A numeric column's value as an amount: market cap in CAD, a year as itself, money as printed. */
function rangeValue(row: RosterRow, key: RangeKey): { amount: number; currency: string; fy: string } | null {
  const raw = fieldValue(row, RANGE_FIELD[key]);
  if (isMoneyKey(key)) return moneyParts(raw);
  return typeof raw === "number" ? { amount: raw, currency: key === "marketCap" ? "CAD" : NO_CURRENCY, fy: NO_CURRENCY } : null;
}

function inRange(row: RosterRow, key: RangeKey, r: RangeFilter): boolean {
  if (!rangeSet(r)) return true;
  const m = rangeValue(row, key);
  if (r.has === "value" && !m) return false;
  if (r.has === "empty" && m) return false;
  if (r.has === "not_found" && (m || !notFound(row, RANGE_FIELD[key], null))) return false;
  const wantsValue = r.min !== null || r.max !== null || r.cur.length > 0 || r.fy.length > 0;
  if (!wantsValue) return true;
  if (!m) return false;
  if (r.min !== null && m.amount < r.min) return false;
  if (r.max !== null && m.amount > r.max) return false;
  if (r.cur.length && !r.cur.includes(m.currency)) return false;
  if (r.fy.length && !r.fy.includes(m.fy)) return false;
  return true;
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
      case "commodities": return r.commodities.length ? r.commodities.join(", ") : null;
      case "hq": return hqWord(r);
      case "auditor": return r.auditor ? auditorWord(r.auditor) : null;
      case "marketCap": return r.marketCap;
      case "auditorSince": {
        const y = fieldValue(r, "auditor_since");
        return typeof y === "number" ? y : null;
      }
      default:
        if (isMoneyKey(sort)) return feeKey(fieldValue(r, RANGE_FIELD[sort]));
        return cellWord(r, sort);
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
/** Each filter's options; and each amount's currencies and fiscal years ("auditFeeCur"), for its range filter. */
export type Facets = Record<Multi, FacetGroup[]> & Record<`${MoneyKey}Cur` | `${MoneyKey}Fy`, FacetGroup[]>;

function tally<T>(rows: T[], tokensOf: (r: T) => string[]): Map<string, number> {
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
  const commodities = tally(rows, commodityTokensOf);
  const commodityOrder = [...commodities.keys()].filter((c) => c !== NO_COMMODITY)
    .sort((a, b) => a.localeCompare(b, "en-CA"));
  if (commodities.has(NO_COMMODITY)) commodityOrder.push(NO_COMMODITY);

  const exchanges = tally(rows, (r) => [exchangeTokenOf(r)]);
  const exchangeOrder = [...exchanges.keys()].filter((k) => k !== "unknown").sort();
  if (exchanges.has("unknown")) exchangeOrder.push("unknown");
  const decides = tally(rows, (r) => [decidesTokenOf(r)]);
  const marks = (s: Stage) => one(STAGE_LABEL[s], tally(rows, (r) => [markTokenOf(r, s)]), [...MARK_TOKENS],
                                  (v) => MARK_WORD[v]);
  const feeFacets = (key: MoneyKey) => {
    const parts = rows.map((r) => moneyParts(fieldValue(r, RANGE_FIELD[key]))).filter((m): m is NonNullable<typeof m> => m !== null);
    const cur = tally(parts, (m) => [m.currency]);
    const fy = tally(parts, (m) => [m.fy]);
    const order = (counts: Map<string, number>, desc: boolean) => {
      const keys = [...counts.keys()].filter((k) => k !== NO_CURRENCY).sort();
      if (desc) keys.reverse();
      if (counts.has(NO_CURRENCY)) keys.push(NO_CURRENCY);
      return keys;
    };
    return {
      cur: one("Currency", cur, order(cur, false), (v) => v === NO_CURRENCY ? "Not recorded" : v),
      fy: one("Fiscal year", fy, order(fy, true), (v) => v === NO_CURRENCY ? "Not recorded" : `FY${v}`),
    };
  };
  const money = Object.fromEntries(MONEY_KEYS.flatMap((k) => {
    const f = feeFacets(k);
    return [[`${k}Cur`, f.cur], [`${k}Fy`, f.fy]];
  })) as Record<`${MoneyKey}Cur` | `${MoneyKey}Fy`, FacetGroup[]>;
  const picks = (key: PickKey, fixed: string[] | null, word: (v: string) => string) => {
    const counts = tally(rows, (r) => [pickTokenOf(r, key)]);
    const order = fixed ?? [
      ...[...counts.keys()].filter((v) => v !== "not_found" && v !== "unknown").sort(),
      "not_found", "unknown",
    ];
    return one(FILTER_LABEL[key], counts, order, word);
  };

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
    commodity: one("Commodity", commodities, commodityOrder, (v) => v === NO_COMMODITY ? "None recorded" : v),
    prop,
    exchange: one("Exchange", exchanges, exchangeOrder, (v) => v === "unknown" ? "Not known" : v),
    decides: one("Stage", decides, DECIDES_TOKENS, (v) => v === "none" ? "No tier" : STAGE_LABEL[v as Stage]),
    exploration: marks("exploration"), development: marks("development"),
    production: marks("production"), royalty_streaming: marks("royalty_streaming"),
    venture: picks("venture", YES_NO_TOKENS, (v) => PICK_WORD[v]),
    sec: picks("sec", YES_NO_TOKENS, (v) => PICK_WORD[v]),
    audchg: picks("audchg", CHANGE_TOKENS, (v) => PICK_WORD[v]),
    // Month-day sorts as the calendar does: "03-31" before "12-31".
    fye: picks("fye", null, (v) => PICK_WORD[v] ?? formatMonthDay(v)),
    repcur: picks("repcur", null, (v) => PICK_WORD[v] ?? v),
    ...money,
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
  const keepIn = (list: string[], groups: FacetGroup[]) => {
    const held = new Set(groups.flatMap((g) => g.options.map((o) => o.value)));
    return list.filter((v) => held.has(v));
  };
  // A currency or year no amount holds any more would narrow to nothing,
  // with no box left to untick.
  const amounts = Object.fromEntries(MONEY_KEYS.map((k) => [k, {
    ...f[k], cur: keepIn(f[k].cur, facets[`${k}Cur`]), fy: keepIn(f[k].fy, facets[`${k}Fy`]),
  }])) as Record<MoneyKey, RangeFilter>;
  return { ...f, hq: keep("hq"), auditor: keep("auditor"), commodity: keep("commodity"), prop: keep("prop"),
           exchange: keep("exchange"), fye: keep("fye"), repcur: keep("repcur"), ...amounts };
}

export const FILTER_LABEL: Record<Multi, string> = {
  tier: "Tier", hq: "Company HQ", stage: "Stage of operations", auditor: "Auditor",
  footprint: "Footprint", commodity: "Commodity", prop: "Properties in",
  exchange: "Exchange", decides: "Stage (deciding the tier)",
  exploration: "Exploration", development: "Development", production: "Production",
  royalty_streaming: "Royalty / streaming",
  venture: "Venture graduate", sec: "SEC registrant", audchg: "Auditor change",
  fye: "Fiscal year-end", repcur: "Reporting currency",
};

export const RANGE_LABEL: Record<RangeKey, string> = {
  auditFee: "Audit fees", taxFee: "Tax fees paid to audit firm", marketCap: "Market cap",
  revenue: "Revenue", netIncome: "Net income", totalAssets: "Total assets",
  auditRelatedFee: "Audit-related fees", otherFee: "Other fees", auditorSince: "Auditor since",
};

const PRESENCE_WORD: Record<string, string> = {
  value: "has a value", empty: "no value", not_found: "researched, not found",
};

/** "C$100,000 to C$500,000", "at least 250,000" -- a range in words, in its currency when it has one. */
function rangeWords(key: RangeKey, r: RangeFilter): string {
  const cur = key === "marketCap" ? "CAD" : r.cur.length === 1 && r.cur[0] !== NO_CURRENCY ? r.cur[0] : null;
  // A year is not a quantity: 2017, never 2,017.
  const amt = (n: number) => key === "auditorSince" ? String(n)
    : !cur ? formatInteger(n) : formatMoney(n, cur, { compact: key === "marketCap" });
  const parts: string[] = [];
  if (r.min !== null && r.max !== null) parts.push(`${amt(r.min)} to ${amt(r.max)}`);
  else if (r.min !== null) parts.push(`at least ${amt(r.min)}`);
  else if (r.max !== null) parts.push(`at most ${amt(r.max)}`);
  if (r.cur.length) parts.push(`in ${r.cur.map((c) => c === NO_CURRENCY ? "no recorded currency" : c).join(" or ")}`);
  if (r.fy.length) parts.push(r.fy.map((y) => y === NO_CURRENCY ? "year not recorded" : `FY${y}`).join(" or "));
  if (r.has) parts.push(PRESENCE_WORD[r.has]);
  return parts.join(", ");
}

/** The filter in words, for the export's header and the screen's status line. */
export function describeFilter(f: RosterFilter, facets: Facets): string {
  // A fixed choice no row holds today still reads as words, not as its token.
  const word = (key: Multi, v: string) =>
    facets[key].flatMap((g) => g.options).find((o) => o.value === v)?.label ??
    ((PICK_KEYS as readonly string[]).includes(key) ? PICK_WORD[v] : undefined) ?? v;
  const parts: string[] = [];
  for (const key of MULTI) {
    if (f[key].length) parts.push(`${FILTER_LABEL[key]}: ${f[key].map((v) => word(key, v)).join(" or ")}`);
  }
  if (f.name) parts.push(`Company contains “${f.name}”`);
  if (f.ticker) parts.push(`Ticker contains “${f.ticker}”`);
  if (f.tickerHas) parts.push(f.tickerHas === "value" ? "Has a ticker" : "No ticker");
  if (f.website) parts.push(`Website contains “${f.website}”`);
  if (f.websiteHas) parts.push(f.websiteHas === "value" ? "Has a website" : "No website");
  for (const key of Object.keys(RANGES) as RangeKey[]) {
    if (rangeSet(f[key])) parts.push(`${RANGE_LABEL[key]}: ${rangeWords(key, f[key])}`);
  }
  if (f.ws) parts.push("Not audited by Deloitte");
  if (f.q) parts.push(`Matching “${f.q}”`);
  return parts.length ? parts.join(" · ") : "Every company in the period";
}

/* -------------------------------------------------------------- columns */

/** Which shown-or-not unit a column belongs to; null for Company, which always shows. */
export function colKeyOf(key: SortKey | Stage): ColKey | null {
  if (key === "name") return null;
  if ((STAGE_ORDER as readonly string[]).includes(key)) return "stages";
  return key as ColKey;
}

export const COL_WORD: Record<ColKey, string> = {
  ticker: "Ticker", tier: "Tier", stage: "Stage", stages: "Stage of operations (four columns)",
  footprint: "Footprint", commodities: "Commodities", hq: "Company HQ", auditor: "Auditor",
  auditFee: "Audit fees", taxFee: "Tax fees paid to audit firm", marketCap: "Market cap",
  exchange: "Exchange", website: "Website", props: "Properties in", venture: "Venture graduate",
  sec: "SEC registrant", fye: "Fiscal year-end", repCur: "Reporting currency", revenue: "Revenue",
  netIncome: "Net income", totalAssets: "Total assets", auditorSince: "Auditor since",
  auditorChange: "Auditor change", auditRelatedFee: "Audit-related fees", otherFee: "Other fees",
};

/**
 * How many rows hold something in each column, so a column most companies
 * leave empty reads as sparse in the picker rather than broken on the page.
 */
export function columnCoverage(rows: RosterRow[]): Record<ColKey, number> {
  const has = (k: ColKey, r: RosterRow): boolean => {
    switch (k) {
      case "marketCap": return r.marketCap !== null;
      case "ticker": return Boolean(r.ticker);
      case "tier": case "stage": return r.tier !== null;
      case "stages": return r.stageEvidence !== "none";
      case "footprint": return Boolean(r.footprint);
      case "commodities": return r.commodities.length > 0;
      case "hq": return Boolean(r.hqRegion || r.hqCity);
      case "auditor": return Boolean(r.auditor);
      case "auditFee": case "taxFee": return moneyParts(fieldValue(r, RANGE_FIELD[k])) !== null;
      default: return cellWord(r, k) !== null;
    }
  };
  return Object.fromEntries(COL_KEYS.map((k) => [k, rows.filter((r) => has(k, r)).length])) as Record<ColKey, number>;
}

/** The table's columns, in order. The export writes the same ones first. */
export const ROSTER_COLUMNS: Array<{ key: SortKey | Stage; label: string; numeric?: boolean; stage?: boolean }> = [
  { key: "name", label: "Company" },
  { key: "marketCap", label: "Market cap", numeric: true },
  { key: "ticker", label: "Ticker" },
  { key: "exchange", label: "Exchange" },
  { key: "website", label: "Website" },
  { key: "tier", label: "Tier" },
  { key: "stage", label: "Stage" },
  ...STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABEL[s], stage: true })),
  { key: "footprint", label: "Footprint" },
  { key: "props", label: "Properties in" },
  { key: "commodities", label: "Commodities" },
  { key: "hq", label: "Company HQ" },
  { key: "venture", label: "Venture graduate" },
  { key: "sec", label: "SEC registrant" },
  { key: "fye", label: "Fiscal year-end" },
  { key: "repCur", label: "Reporting currency" },
  { key: "revenue", label: "Revenue" },
  { key: "netIncome", label: "Net income" },
  { key: "totalAssets", label: "Total assets" },
  { key: "auditor", label: "Auditor" },
  { key: "auditorSince", label: "Auditor since" },
  { key: "auditorChange", label: "Auditor change" },
  { key: "auditFee", label: "Audit fees" },
  { key: "auditRelatedFee", label: "Audit-related fees" },
  { key: "taxFee", label: "Tax fees paid to audit firm" },
  { key: "otherFee", label: "Other fees" },
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
