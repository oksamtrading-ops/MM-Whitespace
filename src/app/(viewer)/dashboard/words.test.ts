import { test } from "node:test";
import assert from "node:assert/strict";
import { DELOITTE, NO_LENS, UNNAMED, type Atlas, type AtlasCompany, type Lens } from "../../../lib/publish/lens.ts";
import {
  andList, briefFrames, chipsOf, DEFAULT_VIEW, leaders, legendWords, mostWords, ordinal, paramsOfView, proofOf, rankOf,
  rosterParams, scopeWords, stepOf, STEP_LABELS, STEPS, subjectWords, viewFromParams, viewOfQuery, type View,
} from "./words.ts";
import type { Office } from "./offices.ts";

let made = 0;

/** One company with every field filled: a classified C$1B Ontario producer audited by KPMG. */
function company(over: Partial<AtlasCompany> = {}): AtlasCompany {
  made++;
  const base: AtlasCompany = {
    id: `c${made}`, name: `Company ${made}`, ticker: `C${made}`, exchange: "TSX",
    cap: 1e9, tier: 2, status: "classified", footprint: "canada_only", priorTier: null,
    auditor: "KPMG", firmClass: "big4",
    hq: "CA:ON", hqToken: "CA:ON", hqRegion: "Ontario, Canada", hqCity: "Toronto",
    places: ["CA:ON"], unplaced: [], commodities: ["Gold"], stages: ["production"],
    since: null, change: null, changeKnown: false, sec: null, secForm: null, yearEnd: null, fee: null,
    prior: null,
  };
  return { ...base, ...over };
}

const PRIOR: NonNullable<Atlas["prior"]> = {
  id: "p0", label: "Q3-2026 (2026-05-31)", asOf: "2026-05-31", threshold: 200e6, currency: "CAD", operator: "gte",
  revision: 1, companies: 3, capTotal: 3e9,
};

function atlasOf(companies: AtlasCompany[], prior: Atlas["prior"] = null): Atlas {
  return {
    period: { id: "p1", label: "Q4-2026 (2026-08-31)", asOf: "2026-08-31", threshold: 200e6, currency: "CAD", operator: "gte" },
    publication: { id: "pub1", revision: 1, publishedAt: "2026-09-01", overrideReason: null, amendmentReason: null },
    prior, companies, leavers: [],
    placeTokens: { "CA:BC": ["CANADA:BC"], "CA:ON": ["CANADA:ON"], "US:NV": ["USA:NV", "US:NV"], Mexico: ["Mexico"] },
    firmClasses: {},
  };
}

/** A small market with a client, two other firms, an unknown auditor, ground at home and abroad, and history. */
function market(): Atlas {
  return atlasOf([
    company({ auditor: DELOITTE, firmClass: "big4", hq: "CA:BC", hqToken: "CA:BC", hqCity: "Vancouver", places: ["CA:BC", "Mexico"],
              prior: { cap: 8e8, auditor: "PwC" }, change: { date: "2025-11-04", from: "PwC" }, changeKnown: true }),
    company({ places: ["CA:ON", "US:NV"], commodities: ["Copper"], prior: { cap: 1e9, auditor: "KPMG" }, changeKnown: true }),
    company({ auditor: "Davidson & Company", firmClass: "national", tier: 6, places: ["US:NV"], prior: { cap: 9e8, auditor: "Davidson & Company" } }),
    company({ auditor: null, firmClass: null, tier: null, status: "unclassified_no_stage_evidence", places: ["CA:BC"] }),
  ], PRIOR);
}

const textOf = (atlas: Atlas) => briefFrames(atlas, "Q4 2026")
  .flatMap((f) => [f.kicker, f.title, f.body, ...f.rows.flatMap((r) => [r.label, r.value])]);

/* ---------------------------------------------------------------- brief */

test("the brief states counts: no frame calls a company an opportunity or a target, or says what to do about one", () => {
  const words = textOf(market()).join("\n");
  for (const banned of [/opportunit/i, /\btargets?\b/i, /\bshould\b/i, /\bpursu/i, /\brecommend/i, /\bprioriti/i, /\bOther\b/]) {
    assert.doesNotMatch(words, banned);
  }
});

test("every frame of the brief reads as a sentence, even for a period with nothing in it", () => {
  for (const atlas of [market(), atlasOf([])]) {
    const frames = briefFrames(atlas, "Q4 2026");
    for (const f of frames) assert.ok(f.kicker && f.title, `frame ${f.id} has a kicker and a title`);
    assert.doesNotMatch(textOf(atlas).join("\n"), /undefined|NaN|null|Infinity|\[object/);
  }
});

test("the brief names the prior period the way the page does", () => {
  const since = briefFrames(market(), "Q4 2026").find((f) => f.id === "since");
  assert.equal(since?.kicker, "Since Q3 2026");
  assert.match(since!.body, /than in Q3 2026\./);
  assert.equal(briefFrames(atlasOf([company()]), "Q4 2026").find((f) => f.id === "since"), undefined,
    "no prior period, no frame about one");
});

test("the brief's share frame adds up to the companies in it", () => {
  const atlas = market();
  const share = briefFrames(atlas, "Q4 2026").find((f) => f.id === "share")!;
  assert.equal(share.rows.reduce((n, r) => n + Number(r.value), 0), atlas.companies.length);
  assert.deepEqual(share.rows.filter((r) => r.ours).map((r) => r.label), ["Deloitte"]);
});

/* ------------------------------------------------------------------ URL */

/** A query string as Next hands it to a page: a repeated key becomes a list. */
function asParams(q: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of q) out[k] = k in out ? [...[out[k]].flat(), v] : v;
  return out;
}

test("a view survives its own URL: every filter, the map and the frame come back as they went", () => {
  const atlas = market();
  const views: View[] = [
    DEFAULT_VIEW,
    { lens: { ...NO_LENS, firm: "deloitte", tier: "1", commodity: "Gold", place: "US:NV", band: "2b" }, mode: "hq", frame: "world" },
    { lens: { ...NO_LENS, firm: "whitespace", hq: "CA:BC" }, mode: "ground", frame: "canada" },
    { lens: { ...NO_LENS, auditor: "unknown", tier: "unclassified", place: "Mexico" }, mode: "ground", frame: "americas" },
    { lens: { ...NO_LENS, auditor: "Davidson & Company", band: "floor" }, mode: "hq", frame: "americas" },
  ];
  for (const view of views) assert.deepEqual(viewFromParams(asParams(paramsOfView(view, atlas)), atlas), view);
  assert.equal(paramsOfView(DEFAULT_VIEW, atlas).toString(), "", "the default view is the bare URL");
});

test("a place travels under every token the Companies page files it under, and any one of them finds it", () => {
  const atlas = market();
  const view: View = { ...DEFAULT_VIEW, lens: { ...NO_LENS, place: "US:NV" } };
  assert.deepEqual(paramsOfView(view, atlas).getAll("prop"), ["USA:NV", "US:NV"]);
  assert.equal(viewFromParams({ prop: "US:NV" }, atlas).lens.place, "US:NV");
  assert.equal(viewFromParams({ prop: ["MARS:X", "USA:NV"] }, atlas).lens.place, "US:NV", "the first token recognised wins");
});

test("the address bar reads as the server reads it, and a key named like one of JavaScript's own is just unknown", () => {
  const atlas = market();
  const view: View = { lens: { ...NO_LENS, firm: "deloitte", tier: "1", place: "US:NV" }, mode: "hq", frame: "world" };
  assert.deepEqual(viewOfQuery(`?${paramsOfView(view, atlas)}`, atlas), view);
  assert.deepEqual(viewOfQuery("?constructor=1", atlas), DEFAULT_VIEW);
  for (const q of ["?tier=1&toString=x", "?__proto__=x&tier=1", "?tier=1&valueOf=1&hasOwnProperty=y"]) {
    assert.equal(viewOfQuery(q, atlas).lens.tier, "1", q);
  }
});

test("anything in the URL the period does not recognise is dropped, not guessed", () => {
  const view = viewFromParams({
    tier: "9", firm: "nobody", commodity: "Unobtainium", prop: "MARS:X", hq: "XX", auditor: "Nobody LLP", band: "huge",
    map: "sky", view: "moon",
  }, market());
  assert.deepEqual(view, DEFAULT_VIEW);
});

test("the Companies link says 'another firm' as the firms themselves, and carries no size it cannot filter by", () => {
  const atlas = market();
  assert.deepEqual(rosterParams({ ...NO_LENS, firm: "whitespace" }, atlas).getAll("auditor"), ["Davidson & Company", "KPMG"]);
  assert.deepEqual(rosterParams({ ...NO_LENS, firm: "deloitte" }, atlas).getAll("auditor"), [DELOITTE]);
  assert.equal(rosterParams({ ...NO_LENS, band: "10b" }, atlas).toString(), "");
});

/* --------------------------------------------------------------- words */

test("the headline's scope reads as a phrase, and every filter in use has a chip that removes it", () => {
  const lens: Lens = { ...NO_LENS, tier: "1", commodity: "Gold", place: "US:NV", hq: "CA:BC" };
  assert.equal(scopeWords(lens, 200e6, "CAD"), "Tier 1 gold companies with ground in Nevada and run from British Columbia");
  assert.equal(scopeWords({ ...NO_LENS, commodity: "PGM" }, 200e6, "CAD"), "PGM companies", "an acronym keeps its capitals");
  assert.equal(scopeWords(NO_LENS, 200e6, "CAD"), "companies");
  assert.deepEqual(chipsOf({ ...lens, firm: "deloitte" }, 200e6, "CAD").map((c) => c.key), ["firm", "tier", "commodity", "place", "hq"]);
  assert.deepEqual(chipsOf(NO_LENS, 200e6, "CAD"), []);
});

test("a count's step is fixed, so the same number is the same shade in every view and every period", () => {
  assert.deepEqual([0, 1, 2, 4, 5, 9, 10, 24, 25, 400].map(stepOf), [0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(STEP_LABELS.length, STEPS.length);
  STEPS.forEach((s, i) => assert.ok(STEP_LABELS[i].startsWith(String(s)), `step ${i + 1}'s label starts at ${s}`));
});

test("ordinals: 1st, 2nd, 3rd, and the teens are all 'th'", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th"]);
});

test("a proof drops the empty parts and says whether the rest sum to the companies in view", () => {
  assert.deepEqual(proofOf([3, 0, 4], 7), { parts: [3, 4], total: 7, population: 7, ties: true, text: "3 + 4 = 7 ✓" });
  assert.equal(proofOf([3, 4], 8).text, "3 + 4 = 7 ✗ expected 8");
});

/* ------------------------------------------------------- review fixes */

test("one company in view is a company, not companies", () => {
  assert.equal(scopeWords({ ...NO_LENS, tier: "1" }, 200e6, "CAD", 1), "Tier 1 company");
  assert.equal(scopeWords({ ...NO_LENS, tier: "1" }, 200e6, "CAD", 2), "Tier 1 companies");
  assert.equal(scopeWords(NO_LENS, 200e6, "CAD", 0), "companies");
});

test("another firm is many firms, and the answer does not say twice what it has said", () => {
  assert.deepEqual(subjectWords({ firm: "whitespace", auditor: null }, 289), ["Firms other than Deloitte audit", "of them."]);
  assert.deepEqual(subjectWords({ firm: "whitespace", auditor: null }, 1), ["A firm other than Deloitte audits", "of them."]);
  assert.deepEqual(subjectWords({ firm: "all", auditor: "PwC" }, 70), ["PwC audits", "of them."]);
  assert.deepEqual(subjectWords({ firm: "all", auditor: UNNAMED }, 5), ["“Another firm, not named” audits", "of them."]);
  assert.equal(subjectWords({ firm: "all", auditor: "unknown" }, 31), null, "the line before counts the auditors not yet known");
  assert.equal(subjectWords({ firm: "all", auditor: DELOITTE }, 24), null, "the headline is Deloitte's count");
  assert.equal(subjectWords({ firm: "deloitte", auditor: null }, 24), null);
  assert.equal(subjectWords(NO_LENS, 344), null);
});

test("the legend and the chips name a firm as the middle of a sentence does", () => {
  assert.equal(legendWords(NO_LENS), "any auditor");
  assert.equal(legendWords({ firm: "deloitte", auditor: null }), "audited by Deloitte");
  assert.equal(legendWords({ firm: "all", auditor: DELOITTE }), "audited by Deloitte");
  assert.equal(legendWords({ firm: "whitespace", auditor: null }), "audited by another firm");
  assert.equal(legendWords({ firm: "all", auditor: "unknown" }), "whose auditor is not yet known");
  assert.equal(legendWords({ firm: "all", auditor: "PwC" }), "audited by PwC");
  assert.equal(legendWords({ firm: "all", auditor: UNNAMED }), "audited by another firm, not named");
  assert.equal(chipsOf({ ...NO_LENS, auditor: UNNAMED }, 200e6, "CAD")[0].label, "Audited by another firm, not named");
  assert.equal(chipsOf({ ...NO_LENS, auditor: "PwC" }, 200e6, "CAD")[0].label, "Audited by PwC");
});

test("unclassified travels to Companies as every reason a company has no tier", () => {
  assert.deepEqual(rosterParams({ ...NO_LENS, tier: "unclassified" }, market()).getAll("tier"),
    ["unclassified", "no_stage", "no_property", "conflicting"]);
  assert.deepEqual(rosterParams({ ...NO_LENS, tier: "2" }, market()).getAll("tier"), ["2"]);
});

test("a head office travels to Companies as every spelling its companies file it under", () => {
  const atlas = atlasOf([
    company({ hq: "Australia", hqToken: "Australia" }),
    company({ hq: "Australia", hqToken: "AUS" }),
    company({ hq: "CA:ON", hqToken: "CA:ON" }),
  ]);
  assert.deepEqual(rosterParams({ ...NO_LENS, hq: "Australia" }, atlas).getAll("hq"), ["AUS", "Australia"]);
});

test("a tier the period does not know is dropped, even one named like an object's own property", () => {
  for (const tier of ["constructor", "toString", "__proto__", "7"]) {
    assert.equal(viewFromParams({ tier }, market()).lens.tier, null, tier);
  }
  assert.equal(viewFromParams({ tier: "unclassified" }, market()).lens.tier, "unclassified");
});

test("the most is shared when tied, and a tied place says so", () => {
  const rows = [{ label: "KPMG", n: 5, cap: 9 }, { label: "PwC", n: 5, cap: 7 }, { label: "Deloitte", n: 3, cap: 7 }, { label: "MNP", n: 3, cap: 1 }];
  assert.deepEqual(leaders(rows).map((r) => r.label), ["KPMG", "PwC"]);
  assert.equal(mostWords(rows, (r) => r.label, "audits", "audit"), "KPMG and PwC audit the most: 5 each");
  assert.equal(mostWords(rows.slice(1), (r) => r.label, "audits", "audit"), "PwC audits the most: 5");
  assert.equal(rankOf(rows, rows[2], (r) => r.n), "joint 3rd");
  assert.equal(rankOf(rows, rows[2], (r) => r.cap), "joint 2nd");
  assert.equal(rankOf(rows, rows[0], (r) => r.cap), "1st");
  assert.equal(andList(["A", "B", "C"]), "A, B and C");
  assert.equal(andList(["A"]), "A");
});

test("the brief names the cities the globe draws, and counts ground as the memo does", () => {
  const offices: Office[] = [
    { key: "rest:CA:QC", place: "CA:QC", label: "Quebec", at: [-72, 52], n: 4, ours: 1, dashed: true },
    { key: "city:CA:BC:Vancouver", place: "CA:BC", label: "Vancouver", at: [-123.1, 49.3], n: 3, ours: 2, dashed: false },
    { key: "city:CA:ON:Toronto", place: "CA:ON", label: "Toronto", at: [-79.4, 43.7], n: 2, ours: 0, dashed: false },
  ];
  const atlas = market();
  const frame = briefFrames(atlas, "Q4 2026", offices).find((f) => f.id === "offices")!;
  assert.equal(frame.title, "Vancouver: 3 head offices", "a region's centre is not a city");
  assert.deepEqual(frame.rows.map((r) => r.label), ["Vancouver", "Toronto"]);
  const first = briefFrames(atlas, "Q4 2026", offices).find((f) => f.id === "market")!;
  const inCanada = atlas.companies.filter((c) => c.footprint === "canada_only" || c.footprint === "canada_and_abroad").length;
  assert.equal(first.rows.find((r) => r.label === "Hold ground in Canada")!.value, String(inCanada));
});
