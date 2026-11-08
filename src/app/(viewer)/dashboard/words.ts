/**
 * The dashboard's words: the tier rules, the colour steps, and the frames of
 * Brief me. Pure, so the sentences a partner reads aloud are tested rather
 * than proof-read.
 *
 * Every sentence here states a count and what it is a count of. None of them
 * ranks a company, recommends one, or calls one an opportunity (doc 01: the
 * tool does not decide which companies are worth pursuing); the test holds
 * the brief to that word by word.
 */
import { CANADA_SUBDIVISIONS, US_STATES } from "../../../lib/publish/jurisdictions.ts";
import {
  countriesOf, dayLabel, DELOITTE, fmtCap, groundByStage, headline, headOfficeCounts, pct, plural, propertyCounts,
  type Atlas, type AtlasCompany, type StageCount,
} from "../../../lib/publish/lens.ts";

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

export { dayLabel };
