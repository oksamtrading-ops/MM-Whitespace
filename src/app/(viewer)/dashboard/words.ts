/**
 * The dashboard's words and the state it keeps in the URL: pure, so the
 * sentences a partner reads aloud are tested rather than proof-read.
 *
 * Every sentence here states a count and what it is a count of. None of them
 * ranks a company, recommends one, or calls one an opportunity (doc 01: the
 * tool does not decide which companies are worth pursuing); the test holds
 * the brief to that word by word.
 */
import { CANADA_SUBDIVISIONS, US_STATES } from "../../../lib/publish/jurisdictions.ts";
import type { Proof } from "../../../lib/publish/views.ts";
import {
  BAND_EDGES, bandLabel, countriesOf, dayLabel, DELOITTE, firmLabel, fmtCap, groundByStage, headline, NO_LENS, pct,
  headOfficeCounts, plural, propertyCounts, UNNAMED,
  type Atlas, type AtlasCompany, type BandKey, type Lens, type StageCount,
} from "../../../lib/publish/lens.ts";

export type MapMode = "ground" | "hq";
export type Frame = "americas" | "canada" | "world";

export const TIER_RULE: Record<string, string> = {
  "1": "production in Canada and abroad",
  "2": "production in Canada only",
  "3": "production abroad only",
  "4": "royalty, streaming and processing",
  "5": "development",
  "6": "exploration",
  unclassified: "no tier yet",
};

/** "CA:BC" -> "British Columbia"; a country is its own name. */
export function nameOf(key: string): string {
  if (key.startsWith("CA:")) return CANADA_SUBDIVISIONS[key.slice(3)] ?? key.slice(3);
  if (key.startsWith("US:")) return US_STATES[key.slice(3)] ?? key.slice(3);
  return key;
}

/** A commodity inside a sentence: "gold", but "PGM" stays as written. */
export function commodityWord(c: string): string {
  return c === c.toUpperCase() ? c : c.toLowerCase();
}

/** The lens without the firm: what the headline counts Deloitte's share of. */
export function baseOf(lens: Lens): Lens {
  return { ...lens, firm: "all", auditor: null };
}

/** What the companies in view are, after "of N": "Tier 1 gold companies with ground in Nevada"; "company" when N is one. */
export function scopeWords(lens: Lens, threshold: number, currency: string, n?: number): string {
  const words: string[] = [];
  if (lens.tier) words.push(lens.tier === "unclassified" ? "unclassified" : `Tier ${lens.tier}`);
  if (lens.commodity) words.push(commodityWord(lens.commodity));
  words.push(n === 1 ? "company" : "companies");
  if (lens.place) words.push(`with ground in ${nameOf(lens.place)}`);
  if (lens.hq) words.push(`${lens.place ? "and " : ""}run from ${nameOf(lens.hq)}`);
  if (lens.band) words.push(`worth ${bandLabel(lens.band, threshold, currency)}`);
  return words.join(" ");
}

/** A firm as it reads after "audited by": the unnamed firm is a description, not a name, so it takes no capital. */
function byWhom(auditor: string): string {
  return auditor === UNNAMED ? "another firm, not named" : firmLabel(auditor);
}

/**
 * Who audits what the lens shows, said after the headline, which is always
 * Deloitte's share: the words either side of the count, or null when the page
 * has said it already (Deloitte's count, or the count not yet known). Another
 * firm is many firms, so it never takes a singular verb.
 */
export function subjectWords(lens: Pick<Lens, "firm" | "auditor">, n: number): [string, string] | null {
  if (lens.auditor === DELOITTE || lens.auditor === "unknown") return null;
  if (lens.auditor === UNNAMED) return ["“Another firm, not named” audits", "of them."];
  if (lens.auditor) return [`${lens.auditor} audits`, "of them."];
  if (lens.firm === "whitespace") return [n === 1 ? "A firm other than Deloitte audits" : "Firms other than Deloitte audit", "of them."];
  return null;
}

/** Whose companies the globe's fill counts, after "Companies with ground here,". */
export function legendWords(lens: Pick<Lens, "firm" | "auditor">): string {
  if (lens.firm === "deloitte" || lens.auditor === DELOITTE) return "audited by Deloitte";
  if (lens.auditor === "unknown") return "whose auditor is not yet known";
  if (lens.auditor) return `audited by ${byWhom(lens.auditor)}`;
  return lens.firm === "whitespace" ? "audited by another firm" : "any auditor";
}

/** The chips a lens shows, each with the change that removes it. */
export function chipsOf(lens: Lens, threshold: number, currency: string): Array<{ key: keyof Lens; label: string }> {
  const out: Array<{ key: keyof Lens; label: string }> = [];
  if (lens.firm !== "all") out.push({ key: "firm", label: lens.firm === "deloitte" ? "Audited by Deloitte" : "Audited by another firm" });
  if (lens.auditor) out.push({ key: "auditor", label: lens.auditor === "unknown" ? "Auditor not yet known" : `Audited by ${byWhom(lens.auditor)}` });
  if (lens.tier) out.push({ key: "tier", label: lens.tier === "unclassified" ? "Unclassified" : `Tier ${lens.tier}` });
  if (lens.commodity) out.push({ key: "commodity", label: lens.commodity });
  if (lens.place) out.push({ key: "place", label: `Ground in ${nameOf(lens.place)}` });
  if (lens.hq) out.push({ key: "hq", label: `Run from ${nameOf(lens.hq)}` });
  if (lens.band) out.push({ key: "band", label: bandLabel(lens.band, threshold, currency) });
  return out;
}

/* ------------------------------------------------------------------ URL */

type Params = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const first = (v: string | string[] | undefined) => all(v)[0] ?? null;

export type View = { lens: Lens; mode: MapMode; frame: Frame };
export const DEFAULT_VIEW: View = { lens: NO_LENS, mode: "ground", frame: "americas" };

type Source = Pick<Atlas, "companies" | "placeTokens">;

/**
 * The dashboard's state from its URL. Places and head offices travel as the
 * Companies page writes them ("CANADA:ON", "CA:BC"), so a place copied from
 * one page means the same ground on the other; anything unrecognised is
 * dropped rather than guessed.
 */
export function viewFromParams(params: Params, atlas: Source): View {
  const byProp = new Map(Object.entries(atlas.placeTokens).flatMap(([key, tokens]) => tokens.map((t) => [t, key] as const)));
  const byHq = new Map(atlas.companies.filter((c) => c.hq && c.hqToken).map((c) => [c.hqToken!, c.hq!]));
  const tier = first(params.tier);
  const band = first(params.band);
  const firm = first(params.firm);
  const commodity = first(params.commodity);
  const auditor = first(params.auditor);
  const commodities = new Set(atlas.companies.flatMap((c) => c.commodities));
  const firms = new Set(atlas.companies.map((c) => c.auditor ?? "unknown"));
  const lens: Lens = {
    firm: firm === "deloitte" ? "deloitte" : firm === "another" ? "whitespace" : "all",
    tier: tier && Object.hasOwn(TIER_RULE, tier) ? tier : null,
    commodity: commodity && commodities.has(commodity) ? commodity : null,
    place: all(params.prop).map((t) => byProp.get(t)).find(Boolean) ?? null,
    hq: byHq.get(first(params.hq) ?? "") ?? null,
    auditor: auditor && firms.has(auditor) ? auditor : null,
    band: BAND_EDGES.some((b) => b.key === band) ? band as BandKey : null,
  };
  const view = first(params.view);
  return {
    lens,
    mode: first(params.map) === "hq" ? "hq" : "ground",
    frame: view === "canada" || view === "world" ? view : "americas",
  };
}

/**
 * The view a query string names, read as the server reads it. The keys go in
 * an object with no prototype, so "?toString=" is a parameter the dashboard
 * does not know, like any other, and not a crash.
 */
export function viewOfQuery(query: string, atlas: Source): View {
  const params: Record<string, string[]> = Object.create(null);
  for (const [k, v] of new URLSearchParams(query)) (params[k] ??= []).push(v);
  return viewFromParams(params, atlas);
}

/** The dashboard's URL for a view, defaults omitted, in a stable order. */
export function paramsOfView(view: View, atlas: Source): URLSearchParams {
  const { lens } = view;
  const out = new URLSearchParams();
  if (lens.tier) out.set("tier", lens.tier);
  if (lens.hq) {
    const token = atlas.companies.find((c) => c.hq === lens.hq)?.hqToken;
    if (token) out.set("hq", token);
  }
  if (lens.firm !== "all") out.set("firm", lens.firm === "deloitte" ? "deloitte" : "another");
  if (lens.auditor) out.set("auditor", lens.auditor);
  if (lens.commodity) out.set("commodity", lens.commodity);
  if (lens.place) for (const t of atlas.placeTokens[lens.place] ?? []) out.append("prop", t);
  if (lens.band) out.set("band", lens.band);
  if (view.mode === "hq") out.set("map", "hq");
  if (view.frame !== "americas") out.set("view", view.frame);
  return out;
}

/** Companies files a company with no tier under the reason it has none; the dashboard calls them all unclassified. */
const UNCLASSIFIED_TOKENS = ["unclassified", "no_stage", "no_property", "conflicting"];

/**
 * The Companies page's URL for the same companies, as far as it can say it.
 * It filters by tier, head office, auditor, commodity and place, but not by
 * size. "Another firm" is written as the firms themselves: its own
 * whitespace filter keeps the companies whose auditor is not yet known. A
 * head office travels as every spelling the companies file it under, since
 * one place on the globe can be several in the roster.
 */
export function rosterParams(lens: Lens, atlas: Source): URLSearchParams {
  const out = new URLSearchParams();
  if (lens.tier) for (const t of lens.tier === "unclassified" ? UNCLASSIFIED_TOKENS : [lens.tier]) out.append("tier", t);
  if (lens.hq) {
    const tokens = new Set(atlas.companies.filter((c) => c.hq === lens.hq && c.hqToken).map((c) => c.hqToken!));
    for (const t of [...tokens].sort()) out.append("hq", t);
  }
  if (lens.auditor) out.append("auditor", lens.auditor);
  else if (lens.firm === "deloitte") out.append("auditor", DELOITTE);
  else if (lens.firm === "whitespace") {
    const firms = new Set(atlas.companies.map((c) => c.auditor).filter((a): a is string => a !== null && a !== DELOITTE));
    for (const f of [...firms].sort()) out.append("auditor", f);
  }
  if (lens.commodity) out.append("commodity", lens.commodity);
  if (lens.place) for (const t of atlas.placeTokens[lens.place] ?? []) out.append("prop", t);
  return out;
}

/* --------------------------------------------------------------- legend */

/**
 * The ramp's five steps, fixed and printed. A step means the same count in
 * every view and every period, so narrowing the page dims the map rather
 * than quietly re-scaling it, and a cross-fade only ever shows a count that
 * changed.
 */
export const STEPS = [1, 2, 5, 10, 25] as const;
export const STEP_LABELS = ["1", "2–4", "5–9", "10–24", "25 or more"] as const;

/** The step a count falls in, 1 to 5; 0 for none. */
export function stepOf(n: number): number {
  let k = 0;
  while (k < STEPS.length && n >= STEPS[k]) k++;
  return k;
}

/* ---------------------------------------------------------------- ranks */

/** "KPMG", "KPMG and PwC", "Deloitte, KPMG and PwC". */
export function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The rows tied with the first of a list ranked by n: the leaders, however many share the lead. */
export function leaders<T extends { n: number }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.n === rows[0].n);
}

/** A row's place in a list by a measure, shared when tied: "2nd", "joint 2nd". */
export function rankOf<T>(rows: readonly T[], row: T, by: (r: T) => number): string {
  const v = by(row);
  const tied = rows.some((r) => r !== row && by(r) === v);
  return `${tied ? "joint " : ""}${ordinal(1 + rows.filter((r) => by(r) > v).length)}`;
}

/** "KPMG audits the most: 12" or "KPMG and PwC audit the most: 12 each". */
export function mostWords<T extends { n: number }>(rows: readonly T[], label: (r: T) => string, one: string, many: string): string {
  const top = leaders(rows);
  return `${andList(top.map(label))} ${top.length === 1 ? one : many} the most: ${top[0].n}${top.length === 1 ? "" : " each"}`;
}

/* ---------------------------------------------------------------- brief */

/** "Ontario has the most: 3 companies", "Ontario and Quebec have the most: 2 companies each". */
function mostOf<T extends { n: number }>(rows: readonly T[], label: (r: T) => string, one: string, many: string): string {
  const top = leaders(rows);
  return `${andList(top.map(label))} ${top.length === 1 ? "has" : "have"} the most: ${top[0].n} ${top[0].n === 1 ? one : many}${top.length === 1 ? "" : " each"}`;
}

/** One row of a frame's table: its label, then a figure under each of the frame's column heads. */
export type BriefRow = { label: string; cells: string[]; ours?: boolean };

export type BriefFrame = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  /** The table's column heads: the label column's, then one per figure. */
  head: string[];
  /** The frame's numbers as a table: what the twin shows and the screen reader reads. */
  rows: BriefRow[];
  /** The globe beside the words, or null for a frame that is only its table. */
  map: { camera: Frame; steps: Record<string, number> } | null;
};

/** The heads of a table of ground by stage, after the place's own. */
export const STAGE_HEADS = ["Companies", "Producing", "Development", "Exploration", "Royalty or no tier"] as const;

function stageCells(r: StageCount): string[] {
  return [r.n, r.producing, r.development, r.exploration, r.royalty + r.unclassified].map(String);
}

/** The auditor rows of the brief: Deloitte, each other Big Four firm by name, every other firm (named in the research or not), and the unknown. */
export const BRIEF_FIRMS = [
  { key: DELOITTE, label: "Deloitte" },
  { key: "PwC", label: "PwC" },
  { key: "KPMG", label: "KPMG" },
  { key: "Ernst & Young", label: "EY" },
  { key: "firms", label: "Other firms" },
  { key: "unknown", label: "Auditor not yet known" },
] as const;

function briefFirm(c: AtlasCompany): (typeof BRIEF_FIRMS)[number]["key"] {
  if (c.auditor === null) return "unknown";
  return BRIEF_FIRMS.find((f) => f.key === c.auditor)?.key ?? "firms";
}

/** Every province and territory, or every state: one country's places, each lit the country's step. */
const COUNTRY_KEYS: Record<string, string[]> = {
  Canada: Object.keys(CANADA_SUBDIVISIONS).map((k) => `CA:${k}`),
  "United States": Object.keys(US_STATES).map((k) => `US:${k}`),
};

/**
 * The brief: the same published numbers as the page, in a fixed order a
 * partner can present from, every frame anchored on the period's as-of date.
 * Unfiltered on purpose: a brief that changed with whatever was last clicked
 * could not be presented twice the same way.
 *
 * Five frames: the market and where it operates; who audits it; where it
 * operates in the world, by country; where it operates in Canada, by
 * province; and each tier by the province of the head office.
 */
export function briefFrames(atlas: Atlas, periodTitle: string): BriefFrame[] {
  const cs = atlas.companies;
  const { threshold, currency, asOf } = atlas.period;
  const money = (n: number) => fmtCap(n, currency);
  const h = headline(cs);

  // Page 1: each company in exactly one row, by its published footprint.
  const footprint = (...keys: Array<string | null>) => cs.filter((c) => keys.includes(c.footprint)).length;
  const groundSteps = Object.fromEntries(propertyCounts(cs).map((p) => [p.key, stepOf(p.n)]));

  // Page 2: Deloitte, PwC, KPMG and EY by name; every other firm as one.
  const firms = BRIEF_FIRMS.map((f) => {
    const of = cs.filter((c) => briefFirm(c) === f.key);
    return { ...f, n: of.length, cap: of.reduce((s, c) => s + (c.cap ?? 0), 0) };
  });

  // Page 3: ground by country, a province folded into Canada and a state into the United States.
  const countries = groundByStage(cs, countriesOf);
  const worldSteps: Record<string, number> = {};
  for (const r of countries) for (const key of COUNTRY_KEYS[r.key] ?? [r.key]) worldSteps[key] = stepOf(r.n);
  const shown = countries.slice(0, 8);

  // Page 4: ground by Canadian province.
  const provinces = groundByStage(cs, (c) => c.places.filter((k) => k.startsWith("CA:")));
  const inCanada = cs.filter((c) => countriesOf(c).includes("Canada")).length;
  const noProvince = cs.filter((c) => countriesOf(c).includes("Canada") && !c.places.some((k) => k.startsWith("CA:"))).length;

  // Page 6: each tier by the province of the head office.
  const runFrom = new Map<string, { key: string; n: number; tiers: number[] }>();
  for (const c of cs) {
    if (!c.hq?.startsWith("CA:")) continue;
    const row = runFrom.get(c.hq) ?? { key: c.hq, n: 0, tiers: [0, 0, 0, 0, 0, 0, 0] };
    row.n++;
    row.tiers[c.tier === null ? 6 : c.tier - 1]++;
    runFrom.set(c.hq, row);
  }
  const offices = [...runFrom.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  const runFromCanada = offices.reduce((s, r) => s + r.n, 0);
  const unplacedOffices = headOfficeCounts(cs).unplaced;
  const elsewhere = cs.length - runFromCanada - unplacedOffices;

  const stageNote = "Stage is published per company, not per property, so a producer counts as producing wherever it holds ground.";

  return [
    {
      id: "market", kicker: periodTitle,
      title: `${plural(h.companies, "company", "companies")} worth ${money(h.cap)}`,
      body: `Listed mining companies worth ${money(threshold)} or more on ${dayLabel(asOf)}, by where they operate. ` +
        "Each company is counted in one row." +
        (h.capUnknown ? ` ${plural(h.capUnknown, "company has", "companies have")} no published market value.` : ""),
      head: ["", "Companies"],
      rows: [
        { label: "Companies", cells: [String(h.companies)] },
        { label: "Market value", cells: [money(h.cap)] },
        { label: "Operations in Canada only", cells: [String(footprint("canada_only"))] },
        { label: "Operations abroad only", cells: [String(footprint("abroad"))] },
        { label: "Operations in Canada and abroad", cells: [String(footprint("canada_and_abroad"))] },
        { label: "No operations on record", cells: [String(footprint("none", null))] },
      ],
      map: { camera: "americas", steps: groundSteps },
    },
    {
      id: "share", kicker: "Who audits them",
      title: `Deloitte audits ${h.deloitte} of ${h.companies}`,
      body: `${pct(h.deloitteCap, h.cap)} of the market value: ${money(h.deloitteCap)} of ${money(h.cap)}. ` +
        "PwC, KPMG and EY are shown by name; every other firm, named in the research or not, is counted together." +
        (h.auditorUnknown ? ` The auditor of ${h.auditorUnknown} is not yet known.` : ""),
      head: ["Auditor", "Companies", "Market value"],
      rows: firms.map((f) => ({ label: f.label, cells: [String(f.n), money(f.cap)], ours: f.key === DELOITTE })),
      map: null,
    },
    {
      id: "world", kicker: "Where they operate",
      title: countries.length ? `Operations in ${plural(countries.length, "country", "countries")}` : "No operations on record",
      body: countries.length
        ? `Companies with ground in each country, by tier: producing (Tiers 1 to 3), development (5) and exploration (6). ` +
          `Provinces count as Canada and states as the United States. ${stageNote}` +
          (countries.length > shown.length ? ` The ${shown.length} with the most are shown.` : "")
        : "No company in this period records a property.",
      head: ["Country", ...STAGE_HEADS],
      rows: shown.map((r) => ({ label: r.key, cells: stageCells(r) })),
      map: { camera: "world", steps: worldSteps },
    },
    {
      id: "canada", kicker: "Operations in Canada",
      title: provinces[0] ? mostOf(provinces, (p) => nameOf(p.key), "company", "companies") : "No Canadian operations on record",
      body: provinces.length
        ? `${plural(inCanada, "company holds", "companies hold")} ground in Canada, counted by tier in each province and territory where they hold it. ${stageNote}` +
          (noProvince ? ` ${plural(noProvince, "company holds", "companies hold")} Canadian ground no province can be read from, and ${noProvince === 1 ? "is" : "are"} in no row.` : "")
        : "No company in this period records a Canadian property.",
      head: ["Province or territory", ...STAGE_HEADS],
      rows: provinces.map((r) => ({ label: nameOf(r.key), cells: stageCells(r) })),
      map: { camera: "canada", steps: Object.fromEntries(provinces.map((p) => [p.key, stepOf(p.n)])) },
    },
    {
      id: "tiers", kicker: "Tiers by head office",
      title: offices[0] ? mostOf(offices, (r) => nameOf(r.key), "head office", "head offices") : "No head office is placed in Canada",
      body: `${plural(runFromCanada, "company is", "companies are")} run from a Canadian province or territory, each counted under its tier there. ` +
        `${plural(elsewhere, "is", "are")} run from outside Canada` +
        (unplacedOffices ? `, and ${plural(unplacedOffices, "head office")} cannot be placed on the map.` : "."),
      head: ["Head office", "Companies", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "No tier"],
      rows: offices.map((r) => ({ label: nameOf(r.key), cells: [r.n, ...r.tiers].map(String) })),
      map: { camera: "canada", steps: Object.fromEntries(offices.map((r) => [r.key, stepOf(r.n)])) },
    },
  ];
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export { dayLabel };

/** A proof from its addends: the parts a chart draws, which must sum to the companies in view. */
export function proofOf(parts: readonly number[], population: number): Proof {
  const shown = parts.filter((n) => n > 0);
  const total = shown.reduce((a, b) => a + b, 0);
  const ties = total === population;
  return { parts: shown, total, population, ties, text: `${shown.join(" + ")} = ${total} ${ties ? "✓" : `✗ expected ${population}`}` };
}

/** "Canada", "United States", or nothing for a country, which is its own name. */
export function groupOf(key: string): string {
  return key.startsWith("CA:") ? "Canada" : key.startsWith("US:") ? "United States" : "";
}
