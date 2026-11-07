import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLens, bandLabel, bandOf, dayLabel, DELOITTE, delta, earliestDay, fees, firmLabel, firmParts, fmtCap, headline,
  headOfficeCounts, latestDay, league, lensIsEmpty, linksOf, matrix, matrixFirm, monthsBefore, moves, NO_LENS, pct, plural,
  propertyCounts, signals, STAGE_GROUPS, stageGroup, countriesOf, countryOf, countryOfUnplaced, groundByStage,
  switchedSincePrior, tierKey, UNNAMED, yearEnds,
  type Atlas, type AtlasCompany, type Lens, type Signal,
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
const lens = (over: Partial<Lens>): Lens => ({ ...NO_LENS, ...over });
const AS_OF = "2026-08-31";
const PRIOR: NonNullable<Atlas["prior"]> = {
  id: "p0", label: "Q3 2025", asOf: "2025-08-31", threshold: 200e6, currency: "CAD", operator: "gte",
  revision: 1, companies: 8, capTotal: 1e10,
};

/* ------------------------------------------------------------------ lens */

test("the firm lens: Deloitte is Deloitte's clients, whitespace another named firm's, and the unknown neither", () => {
  const ours = company({ auditor: DELOITTE });
  const kpmg = company({ auditor: "KPMG" });
  const unknown = company(unknownAuditor);
  const unnamed = company({ auditor: UNNAMED, firmClass: "other" });
  const all = [ours, kpmg, unknown, unnamed];

  assert.deepEqual(applyLens(all, NO_LENS), all);
  assert.deepEqual(applyLens(all, lens({ firm: "deloitte" })), [ours]);
  assert.deepEqual(applyLens(all, lens({ firm: "whitespace" })), [kpmg, unnamed], "an unknown auditor is not whitespace");
  assert.equal(applyLens(all, lens({ firm: "deloitte" })).length + applyLens(all, lens({ firm: "whitespace" })).length +
    applyLens(all, lens({ auditor: "unknown" })).length, all.length,
    "Deloitte, another firm and not yet known split the population with nothing left over");
});

test("the auditor lens: a firm is that firm, and 'unknown' is exactly the companies research has not found one for", () => {
  const ours = company({ auditor: DELOITTE });
  const kpmg = company({ auditor: "KPMG" });
  const unknown = company(unknownAuditor);
  const unnamed = company({ auditor: UNNAMED, firmClass: "other" });
  const all = [ours, kpmg, unknown, unnamed];

  assert.deepEqual(applyLens(all, lens({ auditor: "unknown" })), [unknown]);
  assert.deepEqual(applyLens(all, lens({ auditor: "KPMG" })), [kpmg]);
  assert.deepEqual(applyLens(all, lens({ auditor: DELOITTE })), [ours]);
  assert.deepEqual(applyLens(all, lens({ auditor: UNNAMED })), [unnamed], "a firm not named is not the unknown");
  assert.deepEqual(applyLens(all, lens({ auditor: "PwC" })), []);
});

test("the tier lens matches a tier's number, and 'unclassified' every company with no tier", () => {
  const one = company({ tier: 1 });
  const six = company({ tier: 6 });
  const none = company({ tier: null, status: "unclassified_no_stage_evidence" });
  const conflicting = company({ tier: null, status: "unclassified_conflicting" });
  const all = [one, six, none, conflicting];

  assert.deepEqual(applyLens(all, lens({ tier: "1" })), [one]);
  assert.deepEqual(applyLens(all, lens({ tier: "6" })), [six]);
  assert.deepEqual(applyLens(all, lens({ tier: "unclassified" })), [none, conflicting]);
  assert.deepEqual(applyLens(all, lens({ tier: "3" })), []);
  assert.equal(tierKey(one), "1");
  assert.equal(tierKey(none), "unclassified");
});

test("the commodity lens matches any company listing the commodity", () => {
  const gold = company({ commodities: ["Gold"] });
  const both = company({ commodities: ["Copper", "Gold"] });
  const lithium = company({ commodities: ["Lithium"] });
  const nothing = company({ commodities: [] });
  const all = [gold, both, lithium, nothing];

  assert.deepEqual(applyLens(all, lens({ commodity: "Gold" })), [gold, both]);
  assert.deepEqual(applyLens(all, lens({ commodity: "Copper" })), [both]);
  assert.deepEqual(applyLens(all, lens({ commodity: "Uranium" })), []);
});

test("the place lens reads properties and the head-office lens reads head offices, never each other", () => {
  const bcOffice = company({ hq: "CA:BC", places: ["Mexico"] });
  const bcGround = company({ hq: "CA:ON", places: ["CA:BC", "CA:ON"] });
  const nowhere = company({ hq: null, places: [] });
  const all = [bcOffice, bcGround, nowhere];

  assert.deepEqual(applyLens(all, lens({ place: "CA:BC" })), [bcGround]);
  assert.deepEqual(applyLens(all, lens({ hq: "CA:BC" })), [bcOffice]);
  assert.deepEqual(applyLens(all, lens({ place: "Mexico" })), [bcOffice]);
  assert.deepEqual(applyLens(all, lens({ hq: "Mexico" })), []);
});

test("the band lens matches a company's size band, and a company with no market cap is in none of them", () => {
  const big = company({ cap: 12e9 });
  const mid = company({ cap: 3e9 });
  const edge = company({ cap: 500e6 });
  const small = company({ cap: 250e6 });
  const unsized = company({ cap: null });
  const all = [big, mid, edge, small, unsized];

  assert.deepEqual(applyLens(all, lens({ band: "10b" })), [big]);
  assert.deepEqual(applyLens(all, lens({ band: "2b" })), [mid]);
  assert.deepEqual(applyLens(all, lens({ band: "500m" })), [edge]);
  assert.deepEqual(applyLens(all, lens({ band: "floor" })), [small]);
  const banded = (["10b", "2b", "500m", "floor"] as const).flatMap((band) => applyLens(all, lens({ band })));
  assert.ok(!banded.includes(unsized), "an unknown cap is not the smallest band");
});

test("lenses on several fields narrow together, and an empty lens is recognised as one", () => {
  const target = company({ auditor: "PwC", tier: 1, commodities: ["Gold"], places: ["CA:QC"], hq: "CA:QC", cap: 3e9 });
  const all = [
    target,
    company({ auditor: "PwC", tier: 1, commodities: ["Gold"], places: ["CA:QC"], hq: "CA:QC", cap: 12e9 }),
    company({ auditor: DELOITTE, tier: 1, commodities: ["Gold"], places: ["CA:QC"], hq: "CA:QC", cap: 3e9 }),
    company({ auditor: "PwC", tier: 2, commodities: ["Gold"], places: ["CA:QC"], hq: "CA:QC", cap: 3e9 }),
    company({ auditor: "PwC", tier: 1, commodities: ["Silver"], places: ["CA:QC"], hq: "CA:QC", cap: 3e9 }),
  ];
  const narrow = lens({ firm: "whitespace", tier: "1", commodity: "Gold", place: "CA:QC", hq: "CA:QC", auditor: "PwC", band: "2b" });
  assert.deepEqual(applyLens(all, narrow), [target]);
  assert.equal(lensIsEmpty(NO_LENS), true);
  assert.equal(lensIsEmpty(lens({ firm: "deloitte" })), false);
  assert.equal(lensIsEmpty(lens({ band: "floor" })), false);
  assert.equal(lensIsEmpty(lens({ auditor: "unknown" })), false);
});

/* ------------------------------------------------------------- headline */

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

/* --------------------------------------------------------------- league */

test("the league ranks firms by clients, then by cap, then by name, with the unnamed and the unknown last", () => {
  const cs = [
    // The unknown is the biggest group, and still last.
    ...Array.from({ length: 5 }, () => company({ cap: 1e9, ...unknownAuditor })),
    ...Array.from({ length: 3 }, () => company({ cap: 1e9, auditor: UNNAMED, firmClass: "other" })),
    company({ auditor: DELOITTE, cap: 2e9 }),
    company({ auditor: DELOITTE, cap: null }),
    // Ties Deloitte on clients with more cap behind it, so ranks above it.
    company({ auditor: "KPMG", cap: 5e9 }),
    company({ auditor: "KPMG", cap: 1e9 }),
    // Tie on clients and cap: by name.
    company({ auditor: "MNP", firmClass: "national", cap: 1e9 }),
    company({ auditor: "BDO", firmClass: "national", cap: 1e9 }),
  ];
  const rows = league(cs);
  assert.deepEqual(rows.map((r) => [r.firm, r.n]),
    [["KPMG", 2], [DELOITTE, 2], ["BDO", 1], ["MNP", 1], [UNNAMED, 3], ["unknown", 5]]);
  assert.equal(rows.reduce((s, r) => s + r.n, 0), cs.length, "every company sits in exactly one row");

  const row = (firm: string) => rows.find((r) => r.firm === firm)!;
  assert.equal(row(DELOITTE).cap, 2e9, "a company with no market cap adds nothing to its firm's cap");
  assert.equal(row(DELOITTE).ours, true);
  assert.deepEqual(rows.filter((r) => r.ours).map((r) => r.firm), [DELOITTE]);
  assert.equal(row("MNP").cls, "national");
  assert.equal(row("unknown").cls, "unknown");
  assert.equal(row("unknown").label, "Not yet known");
  assert.equal(row(UNNAMED).label, "Another firm, not named");
  assert.equal(row("KPMG").label, "KPMG");
  assert.equal(firmLabel(null), "Not yet known");
  assert.deepEqual(league([]), []);
});

/* ------------------------------------------------------------ firmParts */

test("the five firm parts always sum to the population, and their caps to its cap", () => {
  const cs = [
    company({ auditor: DELOITTE, firmClass: "big4", cap: 1e9 }),
    company({ auditor: "PwC", firmClass: "big4", cap: 2e9 }),
    company({ auditor: "Ernst & Young", firmClass: "big4", cap: null }),
    company({ auditor: "MNP", firmClass: "national", cap: 6e8 }),
    company({ auditor: "Davidson & Company", firmClass: "regional", cap: 3e8 }),
    company({ auditor: "Stern & Lovrics", firmClass: "other", cap: 2.5e8 }),
    company({ auditor: UNNAMED, firmClass: "other", cap: 4e8 }),
    company({ cap: 7e8, ...unknownAuditor }),
  ];
  assert.deepEqual(firmParts(cs).map((p) => [p.key, p.n, p.cap]), [
    ["deloitte", 1, 1e9], ["big4", 2, 2e9], ["national", 1, 6e8], ["other", 3, 9.5e8], ["unknown", 1, 7e8],
  ]);
  // Whatever the lens leaves, the parts still add up.
  for (let i = 0; i <= cs.length; i++) {
    for (const some of [cs.slice(0, i), cs.slice(i)]) {
      const parts = firmParts(some);
      assert.equal(parts.reduce((s, p) => s + p.n, 0), some.length);
      assert.equal(parts.reduce((s, p) => s + p.cap, 0), headline(some).cap);
    }
  }
  assert.deepEqual(firmParts([]).map((p) => p.key), ["deloitte", "big4", "national", "other", "unknown"],
    "an empty lens still has all five parts, at zero");
});

/* --------------------------------------------------------------- matrix */

test("a size band includes its lower edge: exactly C$500M is the 500m band, a dollar less is the floor", () => {
  assert.equal(bandOf(500e6), "500m");
  assert.equal(bandOf(500e6 - 1), "floor");
  assert.equal(bandOf(2e9), "2b");
  assert.equal(bandOf(2e9 - 1), "500m");
  assert.equal(bandOf(10e9), "10b");
  assert.equal(bandOf(10e9 - 1), "2b");
  assert.equal(bandOf(0), "floor");
  assert.equal(bandOf(null), null);
});

test("a band's label names its edges in the period's currency, the floor starting at the threshold", () => {
  assert.equal(bandLabel("10b", 200e6, "CAD"), "C$10B and above");
  assert.equal(bandLabel("2b", 200e6, "CAD"), "C$2B to C$10B");
  assert.equal(bandLabel("500m", 200e6, "CAD"), "C$500M to C$2B");
  assert.equal(bandLabel("floor", 200e6, "CAD"), "C$200M to C$500M");
  assert.equal(bandLabel("floor", 150e6, "USD"), "US$150M to US$500M");
});

test("the matrix puts a company with no market cap in `unsized`, never in a band", () => {
  const cs = [
    company({ cap: null, auditor: DELOITTE }),
    company({ cap: null, ...unknownAuditor }),
    company({ cap: 500e6, auditor: DELOITTE }),
    company({ cap: 499_999_999, auditor: "KPMG" }),
    company({ cap: 12e9, auditor: "PwC" }),
    company({ cap: 3e9, auditor: "Ernst & Young" }),
    company({ cap: 3e9, auditor: "MNP", firmClass: "national" }),
    company({ cap: 3e9, auditor: "Davidson & Company", firmClass: "regional" }),
    company({ cap: 3e9, auditor: UNNAMED, firmClass: "other" }),
    company({ cap: 3e9, ...unknownAuditor }),
  ];
  const { rows, unsized } = matrix(cs, 200e6, "CAD");
  assert.equal(unsized, 2);
  assert.deepEqual(rows.map((r) => [r.band, r.n]), [["10b", 1], ["2b", 5], ["500m", 1], ["floor", 1]]);
  const row = (band: string) => rows.find((r) => r.band === band)!;
  assert.equal(row("500m").cells.Deloitte, 1, "exactly C$500M is in the 500m band");
  assert.equal(row("floor").cells.KPMG, 1);
  assert.equal(row("10b").cells.PwC, 1);
  assert.deepEqual(row("2b").cells,
    { Deloitte: 0, PwC: 0, KPMG: 0, "Ernst & Young": 1, national: 1, other: 2, unknown: 1 });
  for (const r of rows) assert.equal(Object.values(r.cells).reduce((a, b) => a + b, 0), r.n, `${r.band} cells sum to its count`);
  assert.equal(rows.reduce((s, r) => s + r.n, 0) + unsized, cs.length, "the bands and the unsized are the population");
  assert.equal(row("floor").label, "C$200M to C$500M");
  assert.equal(row("10b").label, "C$10B and above");
});

test("a matrix column is a Big 4 firm by name, then the national firms, then every other firm, then the unknown", () => {
  assert.equal(matrixFirm(company({ auditor: DELOITTE })), "Deloitte");
  assert.equal(matrixFirm(company({ auditor: "Ernst & Young" })), "Ernst & Young");
  assert.equal(matrixFirm(company({ auditor: "BDO", firmClass: "national" })), "national");
  assert.equal(matrixFirm(company({ auditor: "Smythe", firmClass: "regional" })), "other");
  assert.equal(matrixFirm(company({ auditor: "Stern & Lovrics", firmClass: "other" })), "other");
  assert.equal(matrixFirm(company({ auditor: UNNAMED, firmClass: "other" })), "other");
  assert.equal(matrixFirm(company(unknownAuditor)), "unknown");
});

/* --------------------------------------------------------------- places */

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

test("a link runs between a head office and every other place its companies hold ground, never to itself", () => {
  const vancouverMiner = company({ hq: "CA:BC", places: ["CA:BC", "Mexico", "US:NV"], auditor: DELOITTE });
  const vancouverExplorer = company({ hq: "CA:BC", places: ["Mexico"] });
  const torontoMiner = company({ hq: "CA:ON", places: ["Mexico", "CA:ON", "CA:BC"] });
  const placeless = company({ hq: null, places: ["Mexico", "CA:BC"] });
  const cs = [vancouverMiner, vancouverExplorer, torontoMiner, placeless];

  assert.deepEqual(linksOf(cs, "CA:BC", "hq"), [
    { from: "CA:BC", to: "Mexico", n: 2, deloitte: 1 },
    { from: "CA:BC", to: "US:NV", n: 1, deloitte: 1 },
  ], "BC's own ground is not a link from BC");
  assert.deepEqual(linksOf(cs, "Mexico", "place"), [
    { from: "CA:BC", to: "Mexico", n: 2, deloitte: 1 },
    { from: "CA:ON", to: "Mexico", n: 1, deloitte: 0 },
  ]);
  assert.deepEqual(linksOf(cs, "CA:BC", "place"), [{ from: "CA:ON", to: "CA:BC", n: 1, deloitte: 0 }],
    "the Vancouver miner's BC ground is at home, and the company with no head office draws nothing");
  assert.deepEqual(linksOf(cs, "CA:ON", "place"), []);
  assert.deepEqual(linksOf(cs, "US:NV", "hq"), []);

  // Both sides tell the same story: a pair carries the same companies from either end.
  for (const l of linksOf(cs, "CA:BC", "hq")) {
    assert.deepEqual(linksOf(cs, l.to, "place").find((m) => m.from === l.from), l);
  }
});

/* ---------------------------------------------------------------- moves */

test("a partial date counts from the first day it could mean", () => {
  assert.equal(earliestDay("2025-09-03"), "2025-09-03");
  assert.equal(earliestDay("2025-05"), "2025-05-01");
  assert.equal(earliestDay("2025"), "2025-01-01");
  assert.equal(earliestDay("2025-09-03T10:00:00Z"), "2025-09-03");
  assert.equal(earliestDay("May 2025"), null);
  assert.equal(earliestDay(""), null);
  assert.equal(earliestDay(null), null);
});

test("monthsBefore counts back across a year boundary", () => {
  assert.equal(monthsBefore("2026-08-31", 24), "2024-08-31");
  assert.equal(monthsBefore("2026-02-15", 3), "2025-11-15");
  assert.equal(monthsBefore("2026-01-31", 1), "2025-12-31");
  assert.equal(monthsBefore("2026-12-01", 12), "2025-12-01");
  assert.equal(monthsBefore("2026-01-10", 13), "2024-12-10");
  assert.equal(monthsBefore("2026-03-10", 0), "2026-03-10");
  assert.equal(monthsBefore("2026-08-31 00:00:00", 24), "2024-08-31", "a timestamp reads as its date");
  assert.equal(monthsBefore("2028-02-29", 24), "2026-02-28", "a day the month does not have becomes its last");
  assert.equal(monthsBefore("2026-05-31", 3), "2026-02-28");
});

/** A change of auditor research found, to the company's current auditor. */
const moved = (date: string | null, from: string | null = "KPMG", over: Partial<AtlasCompany> = {}) =>
  company({ change: { date, from }, changeKnown: true, auditor: DELOITTE, ...over });

test("the moves window is anchored on the as-of date, and a year-only date is never claimed for it", () => {
  const yearOnly = moved("2024");        // 2024-01-01: before the window opens on 2024-08-31
  const monthOnly = moved("2025-05");    // 2025-05-01: inside
  const opening = moved("2024-08-31");   // the window's first day: inside
  const dayBefore = moved("2024-08-30");
  const later = moved("2026-09-01");     // after the as-of date
  const onAsOf = moved("2026-08-31");
  const undated = moved(null);
  const unreadable = moved("sometime in 2025");
  const lookedNoChange = company({ change: null, changeKnown: true });
  const notLooked = company();
  const cs = [yearOnly, monthOnly, opening, dayBefore, later, onAsOf, undated, unreadable, lookedNoChange, notLooked];

  const r = moves(cs, AS_OF);
  assert.equal(r.since, "2024-08-31");
  assert.deepEqual(r.moves.map((m) => m.company), [onAsOf, monthOnly, opening], "newest first");
  assert.deepEqual(r.moves[1], { company: monthOnly, from: "KPMG", to: DELOITTE, date: "2025-05" },
    "a move keeps the date as the filing gave it");
  assert.equal(r.undated, 2, "an undated or unreadable change is counted apart, never placed in the window");
  assert.equal(r.looked, 9, "every company research looked at, with a change or without one");

  // Anchored on the as-of date: the same changes, a period earlier, fall differently.
  const earlier = moves(cs, "2026-01-01");
  assert.equal(earlier.since, "2024-01-01");
  assert.ok(earlier.moves.some((m) => m.company === yearOnly), "\"2024\" counts from 1 January, so a window opening then holds it");
  assert.ok(!earlier.moves.some((m) => m.company === onAsOf), "a change after the as-of date is not in its window");

  assert.deepEqual(moves(cs, AS_OF, 12).moves.map((m) => m.company), [onAsOf], "a twelve-month window opens 2025-08-31");
});

test("a date given only as a year or a month is claimed only when all of it falls in the window", () => {
  const thisYear = moved("2026");          // to 31 Dec 2026: may fall after the as-of date
  const thisMonth = moved("2026-08");      // to 31 Aug 2026, the as-of date itself: inside
  const openingMonth = moved("2024-08");   // from 1 Aug 2024: may fall before the window opens on 31 Aug
  const nextYear = moved("2027");          // wholly after: neither claimed nor counted as loose
  const r = moves([thisYear, thisMonth, openingMonth, nextYear], AS_OF);
  assert.deepEqual(r.moves.map((m) => m.company), [thisMonth]);
  assert.equal(r.straddling, 2, "a loose date across either edge is counted apart, never placed in the window");
  assert.equal(r.undated, 0);
  assert.deepEqual(signals([thisYear, thisMonth, openingMonth, nextYear], AS_OF, "CAD").find((s) => s.id === "moved")!.companies, [thisMonth],
    "the fact counts the same changes as the ledger");
  assert.equal(latestDay("2024-02"), "2024-02-29", "a month's last day, leap years included");
  assert.equal(latestDay("2025-11-04"), "2025-11-04");
  assert.equal(latestDay("sometime"), null);
});

test("moves on one day are listed largest first", () => {
  const small = moved("2025-06", "KPMG", { cap: 1e9 });
  const large = moved("2025-06", "KPMG", { cap: 5e9 });
  const unsized = moved("2025-06", "KPMG", { cap: null });
  assert.deepEqual(moves([small, unsized, large], AS_OF).moves.map((m) => m.company), [large, small, unsized]);
});

test("a move is won by the incoming firm and lost by the outgoing one, and a move within one firm is neither", () => {
  const m = (from: string | null, to: string | null) => moved("2025-06-01", from, { auditor: to, firmClass: to ? "big4" : null });
  const cs = [
    m("KPMG", DELOITTE), m("KPMG", DELOITTE), m("PwC", "KPMG"),
    m(DELOITTE, DELOITTE),        // reappointed: the same firm, so neither won nor lost
    m(UNNAMED, "PwC"),            // won by PwC; no named firm lost it
    m("Ernst & Young", UNNAMED),  // lost by EY; no named firm won it
    m(null, "MNP"),               // won by MNP; the filing did not say from whom
    m("BDO", null),               // lost by BDO; the incumbent is not yet known
  ];
  const r = moves(cs, AS_OF);
  assert.equal(r.moves.length, cs.length - 1, "every change research found but the reappointment, which is no move at all");
  assert.deepEqual(r.byFirm, [
    { firm: "KPMG", won: 1, lost: 2 },
    { firm: DELOITTE, won: 2, lost: 0 },
    { firm: "PwC", won: 1, lost: 1 },
    { firm: "MNP", won: 1, lost: 0 },
    { firm: "BDO", won: 0, lost: 1 },
    { firm: "Ernst & Young", won: 0, lost: 1 },
  ]);
  assert.ok(!r.byFirm.some((f) => f.firm === UNNAMED), "a firm not named is never on the scoreboard");
});

test("a switch since the prior period needs both auditors known, and different", () => {
  const toDeloitte = company({ auditor: DELOITTE, cap: 1e9, prior: { cap: 1e9, auditor: "KPMG" } });
  const fromDeloitte = company({ auditor: "PwC", cap: 5e9, prior: { cap: 4e9, auditor: DELOITTE } });
  const same = company({ auditor: "KPMG", prior: { cap: 1e9, auditor: "KPMG" } });
  const nowUnknown = company({ ...unknownAuditor, prior: { cap: 1e9, auditor: "KPMG" } });
  const thenUnknown = company({ auditor: "KPMG", prior: { cap: 1e9, auditor: null } });
  const entrant = company({ auditor: "KPMG", prior: null });
  assert.deepEqual(switchedSincePrior([toDeloitte, fromDeloitte, same, nowUnknown, thenUnknown, entrant]), [
    { company: fromDeloitte, from: DELOITTE, to: "PwC", date: null },
    { company: toDeloitte, from: "KPMG", to: DELOITTE, date: null },
  ]);
});

test("another firm, not named, differs from a Big 4 firm, but beside any other firm it may be the same one", () => {
  const classes = { KPMG: "big4", PwC: "big4", MNP: "national", "Smythe LLP": "regional" } as const;
  const toBig4 = company({ auditor: "KPMG", firmClass: "big4", cap: 3e9, prior: { cap: 3e9, auditor: UNNAMED } });
  const fromBig4 = company({ auditor: UNNAMED, firmClass: "other", cap: 2e9, prior: { cap: 2e9, auditor: "PwC" } });
  const toRegional = company({ auditor: "Smythe LLP", firmClass: "regional", prior: { cap: 1e9, auditor: UNNAMED } });
  const fromNational = company({ auditor: UNNAMED, firmClass: "other", prior: { cap: 1e9, auditor: "MNP" } });
  const cs = [toBig4, fromBig4, toRegional, fromNational];
  assert.deepEqual(switchedSincePrior(cs, classes).map((m) => m.company), [toBig4, fromBig4]);
  const d = delta({ companies: cs, prior: PRIOR, firmClasses: classes })!;
  assert.equal(d.switched.length, 2);
  assert.equal(d.unclear, 2, "the pairs that may be no change at all are counted apart");
  assert.equal(switchedSincePrior(cs).length, 0, "with no firm list, no pair with the unnamed pool is claimed");
});

/* -------------------------------------------------------------- signals */

const signal = (cs: AtlasCompany[], id: Signal["id"], currency = "CAD") =>
  signals(cs, AS_OF, currency).find((s) => s.id === id)!;

test("large: worth C$500M or more and audited outside the Big 4 and the national firms, of those that size with a classed auditor", () => {
  const bigRegional = company({ name: "Big Regional", cap: 3e9, auditor: "Davidson & Company", firmClass: "regional" });
  const atTheEdge = company({ name: "At The Edge", cap: 500e6, auditor: "Stern & Lovrics", firmClass: "other" });
  const smallRegional = company({ name: "Small Regional", cap: 499e6, auditor: "Smythe", firmClass: "regional" });
  const bigNational = company({ name: "Big National", cap: 3e9, auditor: "MNP", firmClass: "national" });
  const bigUnknown = company({ name: "Big Unknown", cap: 3e9, ...unknownAuditor });
  const unsized = company({ name: "Unsized", cap: null, auditor: "Smythe", firmClass: "regional" });
  const bigDeloitte = company({ name: "Big Deloitte", cap: 2e9, auditor: DELOITTE });
  const bigUnnamed = company({ name: "Big Unnamed", cap: 4e9, auditor: UNNAMED, firmClass: "other" });
  const s = signal([smallRegional, atTheEdge, bigNational, bigUnknown, unsized, bigDeloitte, bigRegional, bigUnnamed], "large");

  assert.deepEqual(s.companies, [bigRegional, atTheEdge], "largest first");
  assert.equal(s.of, 4, "Big Regional, At The Edge, Big National, Big Deloitte: an unnamed firm has no class to be outside");
  assert.match(s.rule, /C\$500M or more/);
  assert.match(signal([], "large", "USD").rule, /US\$500M or more/);
});

test("producers: tier 1 to 3 with an auditor outside the Big 4 and the national firms, of the producers with a known auditor", () => {
  const p1 = company({ name: "P1", tier: 1, cap: 1e9, auditor: "Smythe", firmClass: "regional" });
  const p3 = company({ name: "P3", tier: 3, cap: 2e9, auditor: "Stern & Lovrics", firmClass: "other" });
  const developer = company({ name: "Developer", tier: 5, auditor: "Smythe", firmClass: "regional" });
  const bigFour = company({ name: "Big Four", tier: 2, auditor: "KPMG" });
  const national = company({ name: "National", tier: 2, auditor: "BDO", firmClass: "national" });
  const unclassified = company({ name: "Unclassified", tier: null, auditor: "Smythe", firmClass: "regional" });
  const unknown = company({ name: "Unknown", tier: 1, ...unknownAuditor });
  const s = signal([p1, p3, developer, bigFour, national, unclassified, unknown], "producers");

  assert.deepEqual(s.companies, [p3, p1]);
  assert.equal(s.of, 4, "P1, P3, Big Four and National");
});

test("tenure: an incumbent of ten years or more that is not Deloitte, of the companies whose incumbent and its year are known", () => {
  const tenYears = company({ name: "Ten Years", since: 2016, auditor: "KPMG", cap: 3e9 });
  const nineYears = company({ name: "Nine Years", since: 2017, auditor: "KPMG" });
  const longDeloitte = company({ name: "Long Deloitte", since: 1998, auditor: DELOITTE, cap: 9e9 });
  const unknownFirm = company({ name: "Unknown Firm", since: 2001, ...unknownAuditor });
  const unknownYear = company({ name: "Unknown Year", since: null, auditor: "KPMG" });
  const unnamed = company({ name: "Unnamed", since: 2005, auditor: UNNAMED, firmClass: "other", cap: 2e9 });
  const s = signal([tenYears, nineYears, longDeloitte, unknownFirm, unknownYear, unnamed], "tenure");

  assert.deepEqual(s.companies, [tenYears, unnamed]);
  assert.equal(s.of, 3, "Ten Years, Nine Years and Unnamed: the denominator is the numerator's population, another firm's");
  assert.equal(s.rule, "Appointed in 2016 or earlier, of the companies audited by another firm whose appointment year is known.");
});

test("sec: registered with the SEC, of the companies audited by another firm whose SEC status is known", () => {
  const filer = company({ name: "Filer", sec: true, secForm: "40-F", auditor: "KPMG", cap: 3e9 });
  const deloitteFiler = company({ name: "Deloitte Filer", sec: true, secForm: "40-F", auditor: DELOITTE, cap: 9e9 });
  const notFiler = company({ name: "Not Filer", sec: false, auditor: "KPMG" });
  const unchecked = company({ name: "Unchecked", sec: null, auditor: "KPMG" });
  // Not whitespace: nobody knows whose it is.
  const unknownFirm = company({ name: "Unknown Firm", sec: true, secForm: "20-F", cap: 1e9, ...unknownAuditor });
  const s = signal([filer, deloitteFiler, notFiler, unchecked, unknownFirm], "sec");

  assert.deepEqual(s.companies, [filer]);
  assert.equal(s.of, 2, "Filer and Not Filer: another firm's, with the SEC status found either way");
});

test("moved: a change of auditor in the two years to the as-of date, of the companies research looked at", () => {
  const recent = moved("2025-05", "KPMG", { name: "Recent" });
  const old = moved("2024", "KPMG", { name: "Old" });
  const undated = moved(null, "KPMG", { name: "Undated" });
  const none = company({ name: "None", change: null, changeKnown: true });
  const notLooked = company({ name: "Not Looked" });
  const s = signal([recent, old, undated, none, notLooked], "moved");

  assert.deepEqual(s.companies, [recent]);
  assert.equal(s.of, 4);
  assert.equal(s.rule, "A change of auditor dated between 31 Aug 2024 and 31 Aug 2026, of the companies research checked for one.");
});

test("no fact about another firm's companies holds a Deloitte client or an unknown one, and none holds more than it was checked for", () => {
  // Every Deloitte client here meets every other condition of every signal.
  const deloitte = Array.from({ length: 3 }, (_, i) => company({
    name: `Deloitte ${i}`, auditor: DELOITTE, firmClass: "big4", cap: (i + 1) * 1e9, tier: 1,
    since: 1990, sec: true, secForm: "40-F", change: { date: "2025-06", from: "KPMG" }, changeKnown: true,
  }));
  const others = [
    company({ name: "Regional", auditor: "Smythe", firmClass: "regional", cap: 2e9, tier: 1, since: 1995, sec: true }),
    company({ name: "Unknown", ...unknownAuditor, cap: 2e9, tier: 1, sec: true }),
  ];
  const all = signals([...deloitte, ...others], AS_OF, "CAD");
  assert.deepEqual(all.map((s) => s.id), ["large", "producers", "tenure", "sec", "moved"]);
  for (const s of all) {
    assert.ok(s.companies.length <= s.of, `${s.id}: ${s.companies.length} of ${s.of}`);
    if (s.id !== "moved") {
      assert.ok(!s.companies.some((c) => c.auditor === DELOITTE || c.auditor === null), `${s.id} holds a Deloitte client or an unknown: ${s.rule}`);
    }
  }
  assert.deepEqual(all.find((s) => s.id === "tenure")!.companies.map((c) => c.name), ["Regional"]);
  assert.deepEqual(all.find((s) => s.id === "sec")!.companies.map((c) => c.name), ["Regional"]);
  // A change TO Deloitte is still a change: the rule makes no claim about the firm.
  assert.equal(all.find((s) => s.id === "moved")!.companies.length, 3);
});

/* ------------------------------------------------------------ year-ends */

test("year-ends fall in their month, and the ones research has not found are counted apart", () => {
  const cs = ["12-31", "12-31", "06-30", "01-31", null, "13-01", "00-15"].map((yearEnd) => company({ yearEnd }));
  const { months, unknown } = yearEnds(cs);
  assert.deepEqual(months, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2]);
  assert.equal(unknown, 3, "no year-end, and two that name no month");
  assert.equal(months.reduce((a, b) => a + b, 0) + unknown, cs.length);
});

/* ----------------------------------------------------------------- fees */

test("fees are summed per firm and per currency, never across currencies, and a fee with no currency is counted apart", () => {
  const fee = (amount: number, currency: string | null, auditor: string | null = "KPMG") =>
    company({ auditor, firmClass: auditor ? "big4" : null, fee: { amount, currency, year: 2025 } });
  const cs = [
    fee(100_000, "CAD"), fee(250_000, "CAD"), fee(80_000, "USD"),
    fee(500_000, "CAD", DELOITTE),
    fee(40_000, null),
    fee(60_000, "USD", null),
    company({ fee: null }),
  ];
  const r = fees(cs);
  assert.equal(r.known, 6, "every fee on record, with a currency or without");
  assert.equal(r.noCurrency, 1);
  assert.deepEqual(r.rows, [
    { firm: "KPMG", n: 3, byCurrency: [{ currency: "CAD", sum: 350_000, n: 2 }, { currency: "USD", sum: 80_000, n: 1 }] },
    { firm: DELOITTE, n: 1, byCurrency: [{ currency: "CAD", sum: 500_000, n: 1 }] },
    { firm: "unknown", n: 1, byCurrency: [{ currency: "USD", sum: 60_000, n: 1 }] },
  ]);
  assert.equal(r.rows.reduce((s, row) => s + row.n, 0) + r.noCurrency, r.known);
});

/* ---------------------------------------------------------------- delta */

test("delta: an entrant has no prior; a continuing company compares cap where both are known, and a lower tier number is up", () => {
  const entrant = company({ prior: null, cap: 1e9 });
  const unsizedEntrant = company({ prior: null, cap: null });
  const up = company({ prior: { cap: 1e9, auditor: "KPMG" }, cap: 2e9, tier: 2, priorTier: 3 });
  const down = company({ prior: { cap: 4e9, auditor: "KPMG" }, cap: 3e9, tier: 5, priorTier: 2 });
  const noCapThen = company({ prior: { cap: null, auditor: "KPMG" }, cap: 7e9, tier: 2, priorTier: 2 });
  const noCapNow = company({ prior: { cap: 5e8, auditor: "KPMG" }, cap: null, tier: null, priorTier: 4 });
  const noTierThen = company({ prior: { cap: 6e8, auditor: "KPMG" }, cap: 6e8, tier: 4, priorTier: null });
  const switched = company({ prior: { cap: 1e9, auditor: DELOITTE }, cap: 1e9, auditor: "PwC" });
  const cs = [entrant, unsizedEntrant, up, down, noCapThen, noCapNow, noTierThen, switched];

  const d = delta({ companies: cs, prior: PRIOR })!;
  assert.deepEqual(d.entrants, [entrant, unsizedEntrant]);
  assert.equal(d.continuing, 6);
  assert.equal(d.capNow, 2e9 + 3e9 + 6e8 + 1e9, "only where both caps are known");
  assert.equal(d.capThen, 1e9 + 4e9 + 6e8 + 1e9);
  assert.equal(d.paired, 4, "the continuing companies the two sums are over");
  assert.equal(d.tierUp, 1);
  assert.equal(d.tierDown, 1);
  assert.deepEqual(d.switched.map((m) => [m.company, m.from, m.to]), [[switched, DELOITTE, "PwC"]]);
  assert.equal(delta({ companies: cs, prior: null }), null, "no prior period, no delta");
});

/* ----------------------------------------------------------- formatting */

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

/* ---------------------------------------------------------------- purity */

test("no view reorders or changes the list it is given", () => {
  const frozen = (c: AtlasCompany) => Object.freeze({ ...c, places: Object.freeze([...c.places]) as string[] });
  const cs = Object.freeze([
    company({ cap: 3e9, auditor: DELOITTE, places: ["CA:BC", "Mexico"], hq: "CA:BC", since: 2001, sec: true,
              change: { date: "2025-05", from: "KPMG" }, changeKnown: true, prior: { cap: 2e9, auditor: "KPMG" },
              fee: { amount: 1e5, currency: "CAD", year: 2025 }, yearEnd: "12-31" }),
    company({ cap: 1e9, auditor: "Smythe", firmClass: "regional", places: ["CA:ON"], since: 1999, sec: true,
              change: { date: "2025-07", from: "MNP" }, changeKnown: true, priorTier: 3, prior: { cap: 1e9, auditor: "MNP" },
              fee: { amount: 9e4, currency: "USD", year: 2025 }, yearEnd: "06-30" }),
    company({ cap: null, ...unknownAuditor, places: [], hq: null }),
  ].map(frozen));
  const order = cs.map((c) => c.id);

  applyLens(cs, lens({ firm: "whitespace" }));
  headline(cs);
  league(cs);
  firmParts(cs);
  matrix(cs, 200e6, "CAD");
  propertyCounts(cs);
  headOfficeCounts(cs);
  linksOf(cs, "CA:BC", "hq");
  linksOf(cs, "Mexico", "place");
  moves(cs, AS_OF);
  switchedSincePrior(cs);
  signals(cs, AS_OF, "CAD");
  yearEnds(cs);
  fees(cs);
  delta({ companies: cs as AtlasCompany[], prior: PRIOR });
  assert.deepEqual(cs.map((c) => c.id), order);
});

test("a date is written out by hand, so the server and the browser print the same day", () => {
  assert.equal(dayLabel("2026-08-31"), "31 Aug 2026");
  assert.equal(dayLabel("2026-08-01T12:00:00Z"), "1 Aug 2026");
  assert.equal(dayLabel("2025-05"), "May 2025");
  assert.equal(dayLabel("2025"), "2025");
  assert.equal(dayLabel("2025-13-01"), "2025", "a month that is not one leaves the year");
  assert.equal(dayLabel(null), "undated");
  assert.equal(dayLabel("sometime"), "sometime", "what is not a date is left as written");
});

/* ---------------------------------------------------------------- stages */

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
