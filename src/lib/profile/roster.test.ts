import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeFilter, dropUnknown, EMPTY_FILTER, facetOptions, filterRows, hqWord, parseRosterParams,
  sortRows, stageMark, tierToken, toRosterParams, type RosterRow,
} from "./roster.ts";

function row(over: Partial<RosterRow> & { name: string }): RosterRow {
  return {
    companyId: over.name.toLowerCase().replace(/\W+/g, "-"),
    ticker: null, exchange: "TSX", tier: null, status: "unclassified_no_stage_evidence", footprint: "abroad",
    auditor: null, marketCap: null, hqRegion: null, hqCity: null, auditFee: null, erp: null, commodities: [],
    stages: [], stageEvidence: "none", regions: {}, sources: {}, meta: [],
    ...over,
  };
}

const ROWS: RosterRow[] = [
  row({ name: "Agnico Eagle", ticker: "AEM", tier: 3, status: "classified", footprint: "canada_and_abroad",
        auditor: "EY", marketCap: 126e9, hqRegion: "Ontario, Canada", hqCity: "Toronto",
        stages: ["exploration", "production"], stageEvidence: "complete",
        regions: { CANADA: ["ON", "QC"], "LATIN AMERICA": ["Mexico"] },
        auditFee: { amount: 8_052_000, currency: "CAD", fiscal_year: 2025 },
        sources: { audit_fee: "ai_accepted" }, commodities: ["Gold", "Silver"] }),
  row({ name: "Wheaton Precious", ticker: "WPM", tier: 4, status: "classified", footprint: "abroad",
        auditor: "Deloitte", marketCap: 60e9, hqRegion: "British Columbia, Canada",
        stages: ["royalty_streaming"], stageEvidence: "complete", regions: { USA: ["NV"] },
        auditFee: { amount: 517_116, currency: "USD", fiscal_year: 2025 } }),
  row({ name: "Altius Minerals", ticker: "ALS", tier: null, status: "unclassified_no_property_evidence",
        footprint: "none", auditor: "__other_unnamed__", marketCap: 3e9, hqRegion: "Newfoundland and Labrador, Canada",
        stages: ["royalty_streaming"], stageEvidence: "partial", commodities: ["Lithium", "Potash"],
        meta: [{ field: "fiscal_year_end", label: "Fiscal year end", text: "31 December" }] }),
  row({ name: "Arizona Sonoran", ticker: "ASCU", marketCap: 2e9, hqRegion: "Arizona, United States",
        regions: { CANADA: ["NWT"] }, commodities: ["Copper", "Gold"] }),
  row({ name: "Aclara Resources", ticker: "ARA", marketCap: 1e9, hqRegion: "Chile",
        auditFee: { amount: 2_000_000, currency: "CAD", fiscal_year: 2025 },
        sources: { incumbent_erp: "ai_accepted" } }),
];

const names = (shown: Array<{ row: RosterRow }>) => shown.map((s) => s.row.name);

test("a filter survives the trip through its URL", () => {
  const f = { ...EMPTY_FILTER, q: "gold", tier: ["2", "no_stage"], hq: ["CA:ON"], stage: ["production", "none"],
              auditor: ["Deloitte", "unknown"], footprint: ["abroad"], prop: ["CANADA:ON"], ws: true,
              sort: "auditFee" as const, dir: 1 as const };
  assert.deepEqual(parseRosterParams(toRosterParams(f)), f);
  assert.equal(toRosterParams(EMPTY_FILTER).toString(), "", "the default view is the bare URL");
});

test("tokens outside a fixed vocabulary are dropped, and a firm with a comma is one firm", () => {
  const f = parseRosterParams(new URLSearchParams("tier=7&tier=2&stage=mining&footprint=moon&auditor=Smith%2C+Jones+LLP"));
  assert.deepEqual(f.tier, ["2"]);
  assert.deepEqual(f.stage, []);
  assert.deepEqual(f.footprint, []);
  assert.deepEqual(f.auditor, ["Smith, Jones LLP"]);
});

test("the dashboard map's ?province link still narrows, as a property filter", () => {
  const f = parseRosterParams({ province: "nwt" });
  assert.deepEqual(f.prop, ["CANADA:NT"]);
  assert.deepEqual(names(filterRows(ROWS, f)), ["Arizona Sonoran"], "NWT and NT are one territory");
});

test("OR within a filter, AND across filters", () => {
  const or = filterRows(ROWS, { ...EMPTY_FILTER, tier: ["3", "4"] });
  assert.deepEqual(names(or).sort(), ["Agnico Eagle", "Wheaton Precious"]);
  const and = filterRows(ROWS, { ...EMPTY_FILTER, tier: ["3", "4"], hq: ["CA:BC"] });
  assert.deepEqual(names(and), ["Wheaton Precious"]);
});

test("each kind of unclassified is its own tier option", () => {
  assert.equal(tierToken(ROWS[2]), "no_property");
  assert.equal(tierToken(ROWS[3]), "no_stage");
  assert.deepEqual(names(filterRows(ROWS, { ...EMPTY_FILTER, tier: ["no_property"] })), ["Altius Minerals"]);
});

test("stage is tri-state: not researched never matches a stage, and has its own option", () => {
  const production = filterRows(ROWS, { ...EMPTY_FILTER, stage: ["production"] });
  assert.deepEqual(names(production), ["Agnico Eagle"]);
  const none = filterRows(ROWS, { ...EMPTY_FILTER, stage: ["none"] });
  assert.deepEqual(names(none).sort(), ["Aclara Resources", "Arizona Sonoran"]);
  assert.equal(stageMark(ROWS[0], "development"), "blank", "complete evidence: an absent stage is no");
  assert.equal(stageMark(ROWS[2], "production"), "unknown", "partial evidence: an absent stage is not known");
  assert.equal(stageMark(ROWS[3], "production"), "not_researched");
  assert.equal(stageMark({ ...ROWS[0], stages: null }, "production"), "not_recorded",
               "a revision with no stage rows says so rather than guessing");
});

test("before stage rows were published, the stage filter falls back to the deciding stage", () => {
  const old = ROWS.map((r) => ({ ...r, stages: null }));
  assert.deepEqual(names(filterRows(old, { ...EMPTY_FILTER, stage: ["royalty_streaming"] })), ["Wheaton Precious"],
                   "tier 4 decides royalty; unclassified Altius has no deciding stage");
});

test("search finds what is on screen with no hint, and a hidden value with one", () => {
  const onScreen = filterRows(ROWS, { ...EMPTY_FILTER, q: "toronto" });
  assert.deepEqual(names(onScreen), ["Agnico Eagle"]);
  assert.equal(onScreen[0].matched, null);
  const hidden = filterRows(ROWS, { ...EMPTY_FILTER, q: "december" });
  assert.deepEqual(names(hidden), ["Altius Minerals"]);
  assert.equal(hidden[0].matched?.label, "Fiscal year end");
  // Commodities have a column now, so a search for one is a search for what is on screen.
  const metal = filterRows(ROWS, { ...EMPTY_FILTER, q: "lithium" });
  assert.deepEqual(names(metal), ["Altius Minerals"]);
  assert.equal(metal[0].matched, null);
});

test("the commodity filter keeps any company holding any chosen commodity, and its options are what rows hold", () => {
  const either = filterRows(ROWS, { ...EMPTY_FILTER, commodity: ["Silver", "Copper"] });
  assert.deepEqual(names(either).sort(), ["Agnico Eagle", "Arizona Sonoran"], "OR within the filter");
  const andTier = filterRows(ROWS, { ...EMPTY_FILTER, commodity: ["Gold"], tier: ["3"] });
  assert.deepEqual(names(andTier), ["Agnico Eagle"], "AND across filters");

  const facets = facetOptions(ROWS);
  assert.deepEqual(facets.commodity[0].options.map((o) => [o.label, o.count]),
    [["Copper", 1], ["Gold", 2], ["Lithium", 1], ["Potash", 1], ["Silver", 1]],
    "alphabetical, each with how many companies hold it, and none that nobody holds");

  const f = parseRosterParams(new URLSearchParams("commodity=Gold&commodity=Lithium&commodity=Unobtainium"));
  assert.deepEqual(f.commodity, ["Gold", "Lithium", "Unobtainium"], "kept as typed until checked against the rows");
  assert.deepEqual(dropUnknown(f, facets).commodity, ["Gold", "Lithium"], "a commodity nobody holds is dropped");
  assert.equal(toRosterParams(dropUnknown(f, facets)).toString(), "commodity=Gold&commodity=Lithium", "and it round-trips");
  assert.match(describeFilter({ ...EMPTY_FILTER, commodity: ["Gold", "Lithium"] }, facets),
               /Commodity: Gold or Lithium/);
});

test("whitespace only keeps every company Deloitte does not audit, unknown auditors included", () => {
  const ws = filterRows(ROWS, { ...EMPTY_FILTER, ws: true });
  assert.ok(!names(ws).includes("Wheaton Precious"));
  assert.ok(names(ws).includes("Arizona Sonoran"), "an unknown auditor is whitespace until shown otherwise");
});

test("fees sort by currency, then amount, and a missing fee is last either way", () => {
  const all = filterRows(ROWS, EMPTY_FILTER);
  const up = names(sortRows(all, "auditFee", 1));
  assert.deepEqual(up.slice(0, 3), ["Aclara Resources", "Agnico Eagle", "Wheaton Precious"],
                   "C$2.0M before C$8.1M, both before any US$");
  const down = names(sortRows(all, "auditFee", -1));
  assert.deepEqual(down.slice(0, 3), ["Wheaton Precious", "Agnico Eagle", "Aclara Resources"]);
  assert.deepEqual(down.slice(3).sort(), ["Altius Minerals", "Arizona Sonoran"]);
});

test("head office reads the way the workbook writes it", () => {
  assert.equal(hqWord(ROWS[0]), "Toronto, ON");
  assert.equal(hqWord(ROWS[1]), "BC");
  assert.equal(hqWord(ROWS[3]), "AZ");
  assert.equal(hqWord(ROWS[4]), "Chile");
  assert.equal(hqWord(row({ name: "x" })), null);
});

test("options come from the rows, with counts, and a stale link drops what nobody holds", () => {
  const facets = facetOptions(ROWS);
  const hq = facets.hq.map((g) => g.label);
  assert.deepEqual(hq, ["Canada", "United States", "Other countries"]);
  const auditors = facets.auditor[0].options.map((o) => o.label);
  assert.equal(auditors[0], "Deloitte", "Deloitte leads the firm list");
  assert.ok(auditors.includes("Other (not named)"));
  assert.equal(auditors.at(-1), "Not known");
  const stage = Object.fromEntries(facets.stage[0].options.map((o) => [o.value, o.count]));
  assert.equal(stage.none, 2);
  assert.equal(stage.royalty_streaming, 2);

  const stale = dropUnknown({ ...EMPTY_FILTER, hq: ["CA:ON", "CA:PE"], auditor: ["Nobody LLP"] }, facets);
  assert.deepEqual(stale.hq, ["CA:ON"]);
  assert.deepEqual(stale.auditor, []);
});

test("the filter in words names every part of it", () => {
  const facets = facetOptions(ROWS);
  assert.equal(describeFilter(EMPTY_FILTER, facets), "Every company in the period");
  const words = describeFilter({ ...EMPTY_FILTER, tier: ["3", "4"], hq: ["CA:ON"], ws: true, q: "gold" }, facets);
  assert.equal(words, "Tier: Tier 3 or Tier 4 · Company HQ: Ontario (ON) · Not audited by Deloitte · Matching “gold”");
});
