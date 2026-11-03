/**
 * The dashboard's words and the state it keeps in the URL: pure, so the
 * sentences a partner reads aloud are tested rather than proof-read.
 *
 * Every sentence here states a count and what it is a count of. None of them
 * ranks a company, recommends one, or calls one an opportunity (doc 01: the
 * tool does not decide which companies are worth pursuing); the test holds
 * the brief to that word by word.
 */
import { periodName } from "../../_ui/format.ts";
import { CANADA_SUBDIVISIONS, US_STATES } from "../../../lib/publish/jurisdictions.ts";
import type { Proof } from "../../../lib/publish/views.ts";
import {
  BAND_EDGES, bandLabel, dayLabel, DELOITTE, firmLabel, firmParts, fmtCap, headline, league, moves, NO_LENS, pct,
  plural, propertyCounts, signals, delta, headOfficeCounts, UNNAMED,
  type Atlas, type BandKey, type FirmLens, type Lens,
} from "../../../lib/publish/lens.ts";
import type { Office } from "./offices.ts";

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

export type BriefFrame = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  /** The frame's numbers as a table: what the twin shows and the screen reader reads. */
  rows: Array<{ label: string; value: string; ours?: boolean }>;
  camera: Frame;
  mode: MapMode;
  /** Light only these companies' ground on the globe. */
  firm: FirmLens;
};

/**
 * The brief: the same published numbers as the page, in a fixed order a
 * partner can present from, every frame anchored on the period's as-of date.
 * Unfiltered on purpose: a brief that changed with whatever was last clicked
 * could not be presented twice the same way. `offices` are the head-office
 * discs the globe draws for every company, so the cities it names are the
 * ones it shows.
 */
export function briefFrames(atlas: Atlas, periodTitle: string, offices: readonly Office[] = []): BriefFrame[] {
  const cs = atlas.companies;
  const { threshold, currency, asOf } = atlas.period;
  const money = (n: number) => fmtCap(n, currency);
  const h = headline(cs);
  const parts = firmParts(cs);
  const ground = propertyCounts(cs);
  const canada = ground.filter((p) => p.key.startsWith("CA:"));
  // As the memo counts them: the published footprint, not only the ground the globe can draw.
  const footprint = (...keys: string[]) => cs.filter((c) => c.footprint !== null && keys.includes(c.footprint)).length;
  const inCanada = footprint("canada_only", "canada_and_abroad");
  const abroad = footprint("canada_and_abroad", "abroad");
  // Firms the research names; the unnamed pool is not a firm, and the unknown are no firm yet.
  const firms = league(cs).filter((r) => r.firm !== "unknown" && r.firm !== UNNAMED);
  const ours = firms.find((r) => r.ours);
  const unplaced = headOfficeCounts(cs).unplaced;
  const cities = offices.filter((o) => !o.dashed);
  const m = moves(cs, asOf);
  const dMoves = m.byFirm.find((f) => f.firm === DELOITTE) ?? { won: 0, lost: 0 };
  const sig = signals(cs, asOf, currency);
  const d = delta(atlas);

  const frames: BriefFrame[] = [
    {
      id: "market", kicker: periodTitle, camera: "americas", mode: "ground", firm: "all",
      title: `${plural(h.companies, "company", "companies")} worth ${money(h.cap)}`,
      body: `Listed mining companies worth ${money(threshold)} or more on ${dayLabel(asOf)}, by where they hold ground.` +
        (h.capUnknown ? ` ${plural(h.capUnknown, "company has", "companies have")} no published market value.` : ""),
      rows: [
        { label: "Companies", value: String(h.companies) },
        { label: "Market value", value: money(h.cap) },
        { label: "Hold ground in Canada", value: String(inCanada) },
        { label: "Hold ground abroad", value: String(abroad) },
      ],
    },
    {
      id: "share", kicker: "Deloitte's share", camera: "americas", mode: "ground", firm: "deloitte",
      title: `Deloitte audits ${h.deloitte} of ${h.companies}`,
      body: `${pct(h.deloitteCap, h.cap)} of the market value: ${money(h.deloitteCap)} of ${money(h.cap)}.` +
        (h.auditorUnknown ? ` The auditor of ${h.auditorUnknown} is not yet known.` : ""),
      rows: parts.map((p) => ({ label: p.label, value: String(p.n), ours: p.key === "deloitte" })),
    },
    {
      id: "world", kicker: "Where they dig", camera: "world", mode: "ground", firm: "all",
      title: `Ground in ${plural(ground.length, "place")}`,
      body: `${inCanada} hold ground in Canada and ${abroad} abroad; a company with ground in both is counted in both.`,
      rows: ground.slice(0, 6).map((p) => ({ label: nameOf(p.key), value: `${p.n} · Deloitte ${p.deloitte}` })),
    },
    {
      id: "canada", kicker: "Canada", camera: "canada", mode: "ground", firm: "all",
      title: canada[0] ? mostWords(canada, (p) => nameOf(p.key), "holds", "hold") : "No Canadian ground on record",
      body: canada.length
        ? `Companies with a property in each province and territory. Deloitte audits ${canada[0].deloitte} of the ${canada[0].n} in ${nameOf(canada[0].key)}.`
        : "No company in this period records a Canadian property.",
      rows: canada.slice(0, 6).map((p) => ({ label: nameOf(p.key), value: `${p.n} · Deloitte ${p.deloitte}` })),
    },
    {
      id: "firms", kicker: "Who audits them", camera: "americas", mode: "ground", firm: "whitespace",
      title: firms[0] ? mostWords(firms, (r) => r.label, "audits", "audit") : "No auditor is named yet",
      body: ours
        ? `Deloitte audits ${ours.n}, ${rankOf(firms, ours, (r) => r.n)} by number of companies. The globe shows the ground of the ${h.companies - h.deloitte - h.auditorUnknown} audited by another firm.`
        : "Deloitte audits none of these companies.",
      rows: firms.slice(0, 7).map((r) => ({ label: r.label, value: String(r.n), ours: r.ours })),
    },
    {
      id: "offices", kicker: "Where they are run from", camera: "canada", mode: "hq", firm: "all",
      title: cities[0] ? `${cities[0].label}: ${plural(cities[0].n, "head office")}` : "No head office is placed in a city",
      body: (cities[0] ? `Deloitte audits ${cities[0].ours} of them.` : "") +
        (unplaced ? ` ${plural(unplaced, "head office")} cannot be placed on the globe.` : ""),
      rows: cities.slice(0, 5).map((o) => ({ label: o.label, value: `${o.n} · Deloitte ${o.ours}` })),
    },
    {
      id: "moves", kicker: "What moved", camera: "americas", mode: "ground", firm: "all",
      title: `${plural(m.moves.length, "change")} of auditor in two years`,
      body: `Dated between ${dayLabel(m.since)} and ${dayLabel(asOf)}, among the ${m.looked} companies research checked. ` +
        `Deloitte was appointed at ${dMoves.won} of them and replaced at ${dMoves.lost}.`,
      rows: m.byFirm.slice(0, 6).map((f) => ({ label: firmLabel(f.firm), value: `+${f.won} −${f.lost}`, ours: f.firm === DELOITTE })),
    },
  ];
  if (d && atlas.prior) {
    const capChange = d.capThen ? (d.capNow - d.capThen) / d.capThen : 0;
    const then = periodName(atlas.prior.label).name;
    frames.push({
      id: "since", kicker: `Since ${then}`, camera: "americas", mode: "ground", firm: "all",
      title: `${d.entrants.length} in, ${atlas.leavers.length} out`,
      body: (d.paired
        ? `${d.paired === d.continuing ? `The ${d.continuing} in both periods are` : `Of the ${d.continuing} in both periods, the ${d.paired} with a market value both times are`} ` +
          `worth ${pct(Math.abs(capChange), 1)} ${capChange >= 0 ? "more" : "less"} than in ${then}. `
        : "") +
        `${d.tierUp} moved up a tier and ${d.tierDown} down; ${plural(d.switched.length, "company", "companies")} changed auditor between the two.`,
      rows: [
        { label: "Entered", value: String(d.entrants.length) },
        { label: "Left", value: String(atlas.leavers.length) },
        { label: "Up a tier", value: String(d.tierUp) },
        { label: "Down a tier", value: String(d.tierDown) },
        { label: "Changed auditor", value: String(d.switched.length) },
      ],
    });
  }
  frames.push({
    id: "facts", kicker: "Facts worth knowing", camera: "americas", mode: "ground", firm: "whitespace",
    title: "Five published facts, each with its count",
    body: "Each counts the companies it holds for, out of those research could check. None is a score, and none is combined with another.",
    rows: sig.map((s) => ({ label: s.title, value: `${s.companies.length} of ${s.of}` })),
  });
  return frames;
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
