import { test } from "node:test";
import assert from "node:assert/strict";
import { DELOITTE, UNNAMED, type Atlas, type AtlasCompany } from "../../../lib/publish/lens.ts";
import { andList, briefFrames, leaders, stepOf, STEP_LABELS, STEPS } from "./words.ts";

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
  .flatMap((f) => [f.kicker, f.title, f.body, ...f.head, ...f.rows.flatMap((r) => [r.label, ...r.cells])]);

/* ---------------------------------------------------------------- brief */

test("the brief states counts: no frame calls a company an opportunity or a target, or says what to do about one", () => {
  const words = textOf(market()).join("\n");
  for (const banned of [/opportunit/i, /\btargets?\b/i, /\bshould\b/i, /\bpursu/i, /\brecommend/i, /\bprioriti/i]) {
    assert.doesNotMatch(words, banned);
  }
  // "Other firms" is the one Other: the auditors research named beyond the four, as the brief's reader asked for them.
  assert.doesNotMatch(words.replaceAll("Other firms", ""), /\bOther\b/);
});

test("every frame of the brief reads as a sentence, even for a period with nothing in it", () => {
  for (const atlas of [market(), atlasOf([])]) {
    const frames = briefFrames(atlas, "Q4 2026");
    for (const f of frames) {
      assert.ok(f.kicker && f.title, `frame ${f.id} has a kicker and a title`);
      for (const r of f.rows) assert.equal(r.cells.length, Math.max(1, f.head.length - 1), `${f.id}: a figure under every head`);
    }
    assert.doesNotMatch(textOf(atlas).join("\n"), /undefined|NaN|null|Infinity|\[object/);
  }
});

test("the brief is five frames, in order, and only the auditors' frame has no map", () => {
  const frames = briefFrames(market(), "Q4 2026");
  assert.deepEqual(frames.map((f) => f.id), ["market", "share", "world", "canada", "tiers"]);
  assert.deepEqual(frames.filter((f) => f.map === null).map((f) => f.id), ["share"]);
  assert.deepEqual(frames.map((f) => f.map?.camera ?? null), ["americas", null, "world", "canada", "canada"]);
});

test("no frame but the auditors' names Deloitte, and only that one marks a row as Deloitte's", () => {
  for (const f of briefFrames(market(), "Q4 2026")) {
    if (f.id === "share") continue;
    assert.doesNotMatch([f.title, f.body, ...f.head, ...f.rows.flatMap((r) => [r.label, ...r.cells])].join(" "), /Deloitte/, f.id);
    assert.ok(f.rows.every((r) => !r.ours), f.id);
  }
});

test("the market frame counts each company in one row of where it operates", () => {
  const atlas = atlasOf([
    company({ footprint: "canada_only" }), company({ footprint: "canada_only" }),
    company({ footprint: "abroad", places: ["Mexico"] }),
    company({ footprint: "canada_and_abroad", places: ["CA:BC", "US:NV"] }),
    company({ footprint: "none", tier: 4, places: [] }), company({ footprint: null, tier: null, places: [] }),
  ]);
  const rows = Object.fromEntries(briefFrames(atlas, "Q4 2026")[0].rows.map((r) => [r.label, r.cells[0]]));
  assert.equal(rows["Operations in Canada only"], "2");
  assert.equal(rows["Operations abroad only"], "1");
  assert.equal(rows["Operations in Canada and abroad"], "1");
  assert.equal(rows["No operations on record"], "2");
  assert.equal(["Operations in Canada only", "Operations abroad only", "Operations in Canada and abroad", "No operations on record"]
    .reduce((n, k) => n + Number(rows[k]), 0), atlas.companies.length, "the four rows are the companies");
  assert.ok(!("Hold ground in Canada" in rows) && !("Hold ground abroad" in rows));
});

test("the auditors' frame names Deloitte, PwC, KPMG and EY, counts every other firm together, and adds up", () => {
  const atlas = atlasOf([
    company({ auditor: DELOITTE }), company({ auditor: "PwC" }), company({ auditor: "PwC" }), company({ auditor: "KPMG" }),
    company({ auditor: "Ernst & Young" }), company({ auditor: "Davidson & Company", firmClass: "national" }),
    company({ auditor: "BDO", firmClass: "national" }), company({ auditor: UNNAMED, firmClass: "other" }),
    company({ auditor: null, firmClass: null }),
  ]);
  const share = briefFrames(atlas, "Q4 2026").find((f) => f.id === "share")!;
  assert.deepEqual(share.rows.map((r) => [r.label, r.cells[0]]), [
    ["Deloitte", "1"], ["PwC", "2"], ["KPMG", "1"], ["EY", "1"], ["Other firms", "3"], ["Auditor not yet known", "1"],
  ]);
  assert.equal(share.rows.reduce((n, r) => n + Number(r.cells[0]), 0), atlas.companies.length);
  assert.deepEqual(share.rows.filter((r) => r.ours).map((r) => r.label), ["Deloitte"]);
  assert.equal(share.map, null, "no map");
});

test("the world frame sums ground by country: provinces are Canada, states the United States, and ground the globe cannot draw still counts", () => {
  const atlas = atlasOf([
    company({ tier: 1, places: ["CA:BC", "CA:ON", "US:NV", "Mexico"] }),
    company({ tier: 5, places: ["CA:QC"] }),
    company({ tier: 6, places: ["US:AK", "US:NV"], unplaced: ["AFRICA: Atlantis"] }),
    company({ tier: 4, places: ["Mexico"] }),
  ]);
  const world = briefFrames(atlas, "Q4 2026").find((f) => f.id === "world")!;
  assert.deepEqual(world.head, ["Country", "Companies", "Producing", "Development", "Exploration", "Royalty or no tier"]);
  assert.deepEqual(world.rows.map((r) => [r.label, ...r.cells]), [
    ["Canada", "2", "1", "1", "0", "0"],
    ["Mexico", "2", "1", "0", "0", "1"],
    ["United States", "2", "1", "0", "1", "0"],
    ["Atlantis", "1", "0", "0", "1", "0"],
  ]);
  assert.equal(world.title, "Operations in 4 countries");
  assert.match(world.body, /Stage is published per company, not per property/);
  // The whole of a country is lit at its own step, not a province at the province's.
  assert.equal(world.map!.steps["CA:NU"], stepOf(2));
  assert.equal(world.map!.steps["US:TX"], stepOf(2));
  assert.equal(world.map!.steps.Mexico, stepOf(2));
});

test("the Canada frame splits each province's companies by stage, and only Canada's", () => {
  const atlas = atlasOf([
    company({ tier: 2, places: ["CA:BC", "CA:ON"] }), company({ tier: 6, places: ["CA:BC"] }),
    company({ tier: null, status: "unclassified_no_stage_evidence", places: ["CA:BC", "US:NV"] }),
    company({ tier: 3, places: ["Mexico"] }),
  ]);
  const canada = briefFrames(atlas, "Q4 2026").find((f) => f.id === "canada")!;
  assert.deepEqual(canada.rows.map((r) => [r.label, ...r.cells]), [
    ["British Columbia", "3", "1", "0", "1", "1"],
    ["Ontario", "1", "1", "0", "0", "0"],
  ]);
  assert.equal(canada.title, "British Columbia has the most: 3 companies");
  assert.deepEqual(Object.keys(canada.map!.steps).sort(), ["CA:BC", "CA:ON"]);
});

test("the tiers frame counts each tier by the province of the head office, and says where the rest are run from", () => {
  const atlas = atlasOf([
    company({ tier: 1, hq: "CA:BC" }), company({ tier: 6, hq: "CA:BC" }), company({ tier: 6, hq: "CA:BC" }),
    company({ tier: null, status: "unclassified_conflicting", hq: "CA:ON" }),
    company({ tier: 3, hq: "US:NV" }), company({ tier: 5, hq: null }),
  ]);
  const tiers = briefFrames(atlas, "Q4 2026").find((f) => f.id === "tiers")!;
  assert.deepEqual(tiers.head, ["Head office", "Companies", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "No tier"]);
  assert.deepEqual(tiers.rows.map((r) => [r.label, ...r.cells]), [
    ["British Columbia", "3", "1", "0", "0", "0", "0", "2", "0"],
    ["Ontario", "1", "0", "0", "0", "0", "0", "0", "1"],
  ]);
  for (const r of tiers.rows) assert.equal(r.cells.slice(1).reduce((n, v) => n + Number(v), 0), Number(r.cells[0]), "the tiers sum to the row");
  assert.equal(tiers.title, "British Columbia has the most: 3 head offices");
  assert.match(tiers.body, /^4 companies are run from a Canadian province or territory.* 1 is run from outside Canada, and 1 head office cannot be placed on the map\.$/);
});

/* ------------------------------------------------------------------ URL */

/** A query string as Next hands it to a page: a repeated key becomes a list. */
function asParams(q: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of q) out[k] = k in out ? [...[out[k]].flat(), v] : v;
  return out;
}

test("a count's step is fixed, so the same number is the same shade in every view and every period", () => {
  assert.deepEqual([0, 1, 2, 4, 5, 9, 10, 24, 25, 400].map(stepOf), [0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(STEP_LABELS.length, STEPS.length);
  STEPS.forEach((s, i) => assert.ok(STEP_LABELS[i].startsWith(String(s)), `step ${i + 1}'s label starts at ${s}`));
});

test("the most is shared when tied", () => {
  const rows = [{ label: "KPMG", n: 5, cap: 9 }, { label: "PwC", n: 5, cap: 7 }, { label: "Deloitte", n: 3, cap: 7 }, { label: "MNP", n: 3, cap: 1 }];
  assert.deepEqual(leaders(rows).map((r) => r.label), ["KPMG", "PwC"]);
  assert.deepEqual(leaders(rows.slice(1)).map((r) => r.label), ["PwC"]);
  assert.equal(andList(["A", "B", "C"]), "A, B and C");
  assert.equal(andList(["A"]), "A");
});

test("a province tied for the most names them all, with the noun before each", () => {
  const atlas = atlasOf([
    company({ places: ["CA:ON"], hq: "CA:ON" }), company({ places: ["CA:ON"], hq: "CA:ON" }),
    company({ places: ["CA:QC"], hq: "CA:QC" }), company({ places: ["CA:QC"], hq: "CA:QC" }),
  ]);
  const frames = briefFrames(atlas, "Q4 2026");
  assert.equal(frames.find((f) => f.id === "canada")!.title, "Ontario and Quebec have the most: 2 companies each");
  assert.equal(frames.find((f) => f.id === "tiers")!.title, "Ontario and Quebec have the most: 2 head offices each");
  const one = briefFrames(atlasOf([company({ places: ["CA:ON"], hq: "CA:ON" })]), "Q4 2026");
  assert.equal(one.find((f) => f.id === "canada")!.title, "Ontario has the most: 1 company");
});

test("Canadian ground no province can be read from counts in Canada on both maps, and is said on the Canada frame", () => {
  const atlas = atlasOf([company({ places: ["CA:ON"] }), company({ places: [], unplaced: ["CANADA: Nunavik"] })]);
  const frames = briefFrames(atlas, "Q4 2026");
  assert.equal(frames.find((f) => f.id === "world")!.rows.find((r) => r.label === "Canada")!.cells[0], "2");
  const canada = frames.find((f) => f.id === "canada")!;
  assert.match(canada.body, /^2 companies hold ground in Canada/);
  assert.match(canada.body, /1 company holds Canadian ground no province can be read from, and is in no row\.$/);
});
