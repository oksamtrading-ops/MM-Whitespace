import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countriesOf, countryOf, countryOfUnplaced, dayLabel, DELOITTE, fmtCap, groundByStage, headline, headOfficeCounts, pct, plural,
  propertyCounts, STAGE_GROUPS, stageGroup,
  type AtlasCompany,
} from "./lens.ts";

let made = 0;

/**
 * One company with every field filled: a classified C$1B Ontario producer
 * audited by KPMG, nothing researched, not in a prior period.
 */
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

const unknownAuditor = { auditor: null, firmClass: null } as const;

/* ---------------------------------------------------------- headline */

test("the headline sums market cap over the companies that have one, and counts the rest apart", () => {
  const cs = [
    company({ cap: 3e9, auditor: DELOITTE }),
    company({ cap: null, auditor: DELOITTE }),
    company({ cap: 1e9, auditor: "KPMG" }),
    company({ cap: null, ...unknownAuditor }),
    company({ cap: 5e8, ...unknownAuditor }),
  ];
  assert.deepEqual(headline(cs),
    { companies: 5, cap: 4.5e9, capUnknown: 2, deloitte: 2, deloitteCap: 3e9, auditorUnknown: 2 });
  assert.deepEqual(headline([]),
    { companies: 0, cap: 0, capUnknown: 0, deloitte: 0, deloitteCap: 0, auditorUnknown: 0 });
});

/* ------------------------------------------------------------ places */

test("a company counts once in every place it holds ground, so the places sum past the population", () => {
  const cs = [
    company({ places: ["CA:ON", "CA:QC", "Mexico"], auditor: DELOITTE, cap: 2e9 }),
    company({ places: ["CA:ON"], auditor: "KPMG", cap: null }),
    company({ places: ["CA:ON"], auditor: "PwC", cap: 5e8 }),
    company({ places: [] }),
  ];
  assert.deepEqual(propertyCounts(cs), [
    { key: "CA:ON", n: 3, deloitte: 1, cap: 2.5e9 },
    { key: "CA:QC", n: 1, deloitte: 1, cap: 2e9 },
    { key: "Mexico", n: 1, deloitte: 1, cap: 2e9 },
  ]);
  assert.equal(propertyCounts(cs).reduce((s, p) => s + p.n, 0), 5, "five company-places from four companies");
  assert.deepEqual(propertyCounts([]), []);
});

test("head offices sum to the companies placed, each with its cities, and the unplaced are counted apart", () => {
  const cs = [
    company({ hq: "CA:BC", hqCity: "Vancouver", auditor: DELOITTE, cap: 1e9 }),
    company({ hq: "CA:BC", hqCity: "Vancouver", cap: 2e9 }),
    company({ hq: "CA:BC", hqCity: "Kelowna", cap: null }),
    company({ hq: "CA:BC", hqCity: null, cap: 1e9 }),
    company({ hq: "CA:ON", hqCity: "Toronto", cap: 1e9 }),
    // "Canada" alone has no province to stand on.
    company({ hq: null, hqToken: "Canada", hqRegion: "Canada", hqCity: "Somewhere" }),
    company({ hq: null, hqToken: null, hqRegion: null, hqCity: null }),
  ];
  const { rows, unplaced } = headOfficeCounts(cs);
  assert.equal(unplaced, 2);
  assert.deepEqual(rows, [
    { key: "CA:BC", n: 4, deloitte: 1, cap: 4e9, cities: [{ city: "Vancouver", n: 2 }, { city: "Kelowna", n: 1 }] },
    { key: "CA:ON", n: 1, deloitte: 0, cap: 1e9, cities: [{ city: "Toronto", n: 1 }] },
  ]);
  assert.equal(rows.reduce((s, r) => s + r.n, 0) + unplaced, cs.length);
});

/* ------------------------------------------------------------ stages */

test("a company's stage is its tier's: producing 1 to 3, royalty 4, development 5, exploration 6, and no tier its own", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, null].map((tier) => stageGroup({ tier })),
    ["producing", "producing", "producing", "royalty", "development", "exploration", "unclassified"]);
});

test("ground by country folds provinces into Canada and states into the United States, once per company", () => {
  assert.deepEqual(countriesOf({ places: ["CA:BC", "CA:ON", "US:NV", "Peru"], unplaced: ["AFRICA: Atlantis", "CANADA: Nowhere"] }),
    ["Canada", "United States", "Peru", "Atlantis"]);
  assert.equal(countryOf("CA:YT"), "Canada");
  assert.equal(countryOf("US:AK"), "United States");
  assert.equal(countryOfUnplaced("USA: Somewhere"), "United States");
  assert.equal(countryOfUnplaced("OTHER: "), null);
  const rows = groundByStage([
    company({ tier: 1, places: ["CA:BC", "CA:ON"] }), company({ tier: 6, places: ["CA:BC"] }), company({ tier: null, places: ["Peru"] }),
  ], countriesOf);
  assert.deepEqual(rows.map((r) => [r.key, r.n, r.producing, r.exploration, r.unclassified]), [["Canada", 2, 1, 1, 0], ["Peru", 1, 0, 0, 1]]);
  for (const r of rows) assert.equal(STAGE_GROUPS.reduce((n, g) => n + r[g], 0), r.n, "the stages sum to the row");
});

/* -------------------------------------------------------- formatting */

test("a date is written out by hand, so the server and the browser print the same day", () => {
  assert.equal(dayLabel("2026-08-31"), "31 Aug 2026");
  assert.equal(dayLabel("2026-08-01T12:00:00Z"), "1 Aug 2026");
  assert.equal(dayLabel("2025-05"), "May 2025");
  assert.equal(dayLabel("2025"), "2025");
  assert.equal(dayLabel("2025-13-01"), "2025", "a month that is not one leaves the year");
  assert.equal(dayLabel(null), "undated");
  assert.equal(dayLabel("sometime"), "sometime", "what is not a date is left as written");
});

test("fmtCap: trillions to two decimals, billions and millions to one, in the period's currency", () => {
  assert.equal(fmtCap(1.3462e12, "CAD"), "C$1.35T");
  assert.equal(fmtCap(2.003e11, "CAD"), "C$200.3B");
  assert.equal(fmtCap(5e8, "CAD"), "C$500M");
  assert.equal(fmtCap(5e8, "USD"), "US$500M");
  assert.equal(fmtCap(5e8, "usd"), "US$500M");
  assert.equal(fmtCap(2e9, "CAD"), "C$2B");
  assert.equal(fmtCap(2.25e8, "AUD"), "A$225M");
  assert.equal(fmtCap(5e8, "CHF"), "CHF 500M", "a currency with no symbol is named");
  assert.equal(fmtCap(-2.5e9, "CAD"), "-C$2.5B");
  assert.equal(fmtCap(12_345, "CAD"), "C$12.3K");
  assert.equal(fmtCap(0, "CAD"), "C$0");
});

test("fmtCap never prints a thousand of one unit: what rounds to a thousand millions is a billion", () => {
  assert.equal(fmtCap(999.97e6, "CAD"), "C$1B");
  assert.equal(fmtCap(999.94e6, "CAD"), "C$999.9M");
  assert.equal(fmtCap(999.96e9, "CAD"), "C$1T");
  assert.equal(fmtCap(999.94e9, "CAD"), "C$999.9B");
  assert.equal(fmtCap(999_960, "CAD"), "C$1M");
  assert.equal(fmtCap(999.6, "CAD"), "C$1K");
  assert.equal(fmtCap(-999.97e6, "USD"), "-US$1B");
});

test("pct rounds to one decimal, a half up, and a share of nothing is 0%", () => {
  assert.equal(pct(0.0718, 1), "7.2%");
  assert.equal(pct(17, 259), "6.6%");
  assert.equal(pct(1, 3), "33.3%");
  assert.equal(pct(2, 3), "66.7%");
  assert.equal(pct(1, 8), "12.5%");
  assert.equal(pct(259, 259), "100%");
  assert.equal(pct(0, 259), "0%");
  assert.equal(pct(5, 0), "0%");
  // 50.25% and 50.75%: the same halves views.ts rounds up for the same counts.
  assert.equal(pct(201, 400), "50.3%");
  assert.equal(pct(203, 400), "50.8%");
});

test("plural writes the count in Canadian English, with the noun to match", () => {
  assert.equal(plural(1, "company", "companies"), "1 company");
  assert.equal(plural(0, "company", "companies"), "0 companies");
  assert.equal(plural(1259, "company", "companies"), "1,259 companies");
  assert.equal(plural(2, "firm"), "2 firms");
});

/* ------------------------------------------------------------ purity */

test("no view reorders or changes the list it is given", () => {
  const frozen = (c: AtlasCompany) => Object.freeze({ ...c, places: Object.freeze([...c.places]) as string[] });
  const cs = Object.freeze([
    company({ cap: 3e9, auditor: DELOITTE, places: ["CA:BC", "Mexico"], hq: "CA:BC" }),
    company({ cap: 1e9, auditor: "Smythe", firmClass: "regional", places: ["CA:ON"] }),
    company({ cap: null, ...unknownAuditor, places: [], hq: null }),
  ].map(frozen));
  const order = cs.map((c) => c.id);

  headline(cs);
  propertyCounts(cs);
  headOfficeCounts(cs);
  groundByStage(cs, countriesOf);
  assert.deepEqual(cs.map((c) => c.id), order);
});
