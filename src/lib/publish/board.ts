/**
 * The dashboard's three views (doc 19), as plain counts over one published
 * revision: the companies by tier, their head offices by province and tier,
 * and their auditors by head office and by tier.
 *
 * Fixed, not filtered: the page shows the whole period every time, so every
 * view here takes the period's companies and nothing else. Each count says
 * which companies it holds by carrying the tokens the Companies page filters
 * on (`tokens`), so a figure can open exactly those companies there.
 *
 * Every row of every view sums to its own total, and every view sums to the
 * period: a company with no tier, no head office on record or no known
 * auditor is counted in a row of its own, never dropped.
 */
import { CANADA_SUBDIVISIONS } from "./jurisdictions.ts";
import { DELOITTE, UNNAMED, type AtlasCompany } from "./lens.ts";

export type BoardCompany = Pick<AtlasCompany, "tier" | "auditor" | "hqToken">;

/* ---------------------------------------------------------------- tiers */

export const TIER_KEYS = ["1", "2", "3", "4", "5", "6", "none"] as const;
export type TierKey = (typeof TIER_KEYS)[number];
export type TierCounts = Record<TierKey, number>;

export function tierKeyOf(c: Pick<BoardCompany, "tier">): TierKey {
  const k = c.tier === null ? "none" : String(c.tier);
  return (TIER_KEYS as readonly string[]).includes(k) ? k as TierKey : "none";
}

const noTiers = (): TierCounts => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, none: 0 });

/** Companies in each tier, and in none. */
export function tierCounts(cs: readonly BoardCompany[]): TierCounts {
  const out = noTiers();
  for (const c of cs) out[tierKeyOf(c)]++;
  return out;
}

/** Companies files a company with no tier under the reason it has none: all four are "no tier" here. */
export const NO_TIER_TOKENS = ["unclassified", "no_stage", "no_property", "conflicting"] as const;

export function tierTokens(t: TierKey): string[] {
  return t === "none" ? [...NO_TIER_TOKENS] : [t];
}

/* ---------------------------------------------------------- head offices */

/**
 * Where a head office counts. A province is itself; a head office research
 * placed in Canada with no province is Canada's but no province's; one
 * outside Canada is "outside", and one with no region on record is "unknown",
 * which is also the token Companies files it under.
 */
export type PlaceKind = "province" | "canada" | "rest" | "outside" | "unknown";
export type Place = {
  key: string;
  kind: PlaceKind;
  /** "BC" for a province; null otherwise. */
  code: string | null;
  label: string;
  /** The column heading: "BC", "Rest", "Outside". */
  short: string;
  /** The Company HQ tokens Companies filters these companies on. */
  tokens: string[];
};

const CANADA_KEY = "Canada";
const UNKNOWN_HQ = "unknown";

function placeOf(c: Pick<BoardCompany, "hqToken">): { key: string; kind: PlaceKind; token: string } {
  const t = c.hqToken;
  if (!t) return { key: UNKNOWN_HQ, kind: "unknown", token: UNKNOWN_HQ };
  if (t.startsWith("CA:") && Object.hasOwn(CANADA_SUBDIVISIONS, t.slice(3))) return { key: t, kind: "province", token: t };
  if (t === CANADA_KEY || t.startsWith("CA:")) return { key: CANADA_KEY, kind: "canada", token: t };
  return { key: "outside", kind: "outside", token: t };
}

const sorted = (s: Iterable<string>) => [...new Set(s)].sort();

export type HqRow = Place & { n: number; tiers: TierCounts };

/**
 * Head offices by province, each split by tier: every province with one,
 * most first; then Canada with no province, outside Canada, and not on
 * record, each only when it holds a company. The rows sum to the period.
 */
export function headOffices(cs: readonly BoardCompany[]): { rows: HqRow[]; canada: number; outside: number; unknown: number } {
  const rows = new Map<string, HqRow>();
  for (const c of cs) {
    const p = placeOf(c);
    const row = rows.get(p.key) ?? {
      key: p.key, kind: p.kind, code: p.kind === "province" ? p.key.slice(3) : null,
      label: p.kind === "province" ? CANADA_SUBDIVISIONS[p.key.slice(3)]
        : p.kind === "canada" ? "Canada, no province" : p.kind === "outside" ? "Outside Canada" : "Not on record",
      short: p.kind === "province" ? p.key.slice(3) : p.kind === "canada" ? "Canada" : p.kind === "outside" ? "Outside" : "Not on record",
      tokens: [], n: 0, tiers: noTiers(),
    };
    row.n++;
    row.tiers[tierKeyOf(c)]++;
    if (!row.tokens.includes(p.token)) row.tokens.push(p.token);
    rows.set(p.key, row);
  }
  const order: Record<PlaceKind, number> = { province: 0, canada: 1, rest: 1, outside: 2, unknown: 3 };
  const out = [...rows.values()]
    .map((r) => ({ ...r, tokens: sorted(r.tokens) }))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.n - a.n || a.label.localeCompare(b.label));
  const sum = (kinds: PlaceKind[]) => out.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.n, 0);
  return { rows: out, canada: sum(["province", "canada"]), outside: sum(["outside"]), unknown: sum(["unknown"]) };
}

/* ---------------------------------------------------------- attest firms */

/** The four, always shown, Deloitte first; the other three by how many they audit. */
export const BIG_FOUR = [DELOITTE, "PwC", "KPMG", "Ernst & Young"] as const;
const FIRM_LABEL: Record<string, string> = { "Ernst & Young": "EY" };

export type FirmKind = "deloitte" | "big4" | "named" | "other" | "unknown";
export type FirmRow = {
  key: string;
  kind: FirmKind;
  label: string;
  /** The Auditor tokens Companies filters these companies on. */
  tokens: string[];
  /** For "Other firms": how many firms research named among them. */
  firms: number;
  n: number;
  /** By the keys of `places`. */
  places: Record<string, number>;
  tiers: TierCounts;
};

export type FirmGrid = { places: Place[]; rows: FirmRow[]; known: number; unknown: number };

/**
 * Auditors by head office and by tier. A row for each of the four, for each
 * other firm auditing at least `firmMin` companies, for every other firm
 * together ("Other firms", with the firms research did not name), and for
 * the companies whose auditor is not yet known. The head-office columns are
 * the provinces holding at least `provinceMin` head offices, then the rest of
 * Canada, outside Canada and not on record, each only when it holds one.
 * Every row's places and its tiers each sum to the row.
 */
export function attestFirms(cs: readonly BoardCompany[], opts: { firmMin?: number; provinceMin?: number } = {}): FirmGrid {
  const firmMin = opts.firmMin ?? 10, provinceMin = opts.provinceMin ?? 10;

  const hq = headOffices(cs).rows;
  const named = hq.filter((r) => r.kind === "province" && r.n >= provinceMin);
  const restRows = hq.filter((r) => (r.kind === "province" && r.n < provinceMin) || r.kind === "canada");
  const places: Place[] = named.map(({ key, kind, code, label, short, tokens }) => ({ key, kind, code, label, short, tokens }));
  if (restRows.length) {
    // With no province of its own, the rest of Canada is Canada.
    const all = named.length === 0;
    places.push({ key: "rest", kind: "rest", code: null, label: all ? "Canada" : "Rest of Canada", short: all ? "Canada" : "Rest",
                  tokens: sorted(restRows.flatMap((r) => r.tokens)) });
  }
  for (const r of hq.filter((x) => x.kind === "outside" || x.kind === "unknown")) {
    places.push({ key: r.key, kind: r.kind, code: null, label: r.label, short: r.short, tokens: r.tokens });
  }
  const columnOf = (c: BoardCompany) => {
    const p = placeOf(c);
    return named.some((r) => r.key === p.key) ? p.key : p.kind === "province" || p.kind === "canada" ? "rest" : p.key;
  };

  const perFirm = new Map<string, number>();
  for (const c of cs) if (c.auditor !== null) perFirm.set(c.auditor, (perFirm.get(c.auditor) ?? 0) + 1);
  const big = new Set<string>(BIG_FOUR);
  const own = [...perFirm].filter(([f, n]) => !big.has(f) && f !== UNNAMED && n >= firmMin)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
  const rowKey = (c: BoardCompany) => c.auditor === null ? "unknown"
    : big.has(c.auditor) || own.includes(c.auditor) ? c.auditor : "other";

  const blank = (key: string, kind: FirmKind, label: string, tokens: string[]): FirmRow =>
    ({ key, kind, label, tokens, firms: 0, n: 0, places: Object.fromEntries(places.map((p) => [p.key, 0])), tiers: noTiers() });
  const rows = new Map<string, FirmRow>();
  for (const f of BIG_FOUR) rows.set(f, blank(f, f === DELOITTE ? "deloitte" : "big4", FIRM_LABEL[f] ?? f, [f]));
  for (const f of own) rows.set(f, blank(f, "named", FIRM_LABEL[f] ?? f, [f]));
  const others = sorted([...perFirm.keys()].filter((f) => !big.has(f) && !own.includes(f)));
  rows.set("other", { ...blank("other", "other", "Other firms", others), firms: others.filter((f) => f !== UNNAMED).length });
  rows.set("unknown", blank("unknown", "unknown", "Not yet known", ["unknown"]));
  for (const c of cs) {
    const row = rows.get(rowKey(c))!;
    row.n++;
    row.places[columnOf(c)]++;
    row.tiers[tierKeyOf(c)]++;
  }

  const [deloitte, ...threeBig] = BIG_FOUR.map((f) => rows.get(f)!);
  threeBig.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const out = [deloitte, ...threeBig, ...own.map((f) => rows.get(f)!), rows.get("other")!, rows.get("unknown")!]
    .filter((r) => r.kind === "deloitte" || r.kind === "big4" || r.n > 0);
  const unknown = rows.get("unknown")!.n;
  return { places, rows: out, known: cs.length - unknown, unknown };
}

/* ----------------------------------------------------------------- links */

/**
 * The Companies page narrowed to the companies a figure counts, in the
 * parameters it reads: repeated keys are its multi-selects. A figure for
 * every company is the page unfiltered.
 */
export function companiesHref(f: { tier?: TierKey; hq?: readonly string[]; auditor?: readonly string[] }): string {
  const q = new URLSearchParams();
  if (f.tier) for (const t of tierTokens(f.tier)) q.append("tier", t);
  for (const h of f.hq ?? []) q.append("hq", h);
  for (const a of f.auditor ?? []) q.append("auditor", a);
  const s = q.toString();
  return s ? `/companies?${s}` : "/companies";
}
