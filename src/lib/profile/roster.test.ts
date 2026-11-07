import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountText, COLUMN_FIELDS, describeFilter, dropUnknown, EMPTY_FILTER, facetOptions, filterRows, hqWord, isNarrowed,
  parseAmount, parseRosterParams, ROSTER_COLUMNS, sortRows, stageMark, tierToken, toRosterParams, type RosterRow,
} from "./roster.ts";

function row(over: Partial<RosterRow> & { name: string }): RosterRow {
  return {
    companyId: over.name.toLowerCase().replace(/\W+/g, "-"),
    ticker: null, exchange: "TSX", tier: null, status: "unclassified_no_stage_evidence", footprint: "abroad",
    auditor: null, marketCap: null, hqRegion: null, hqCity: null, auditFee: null, taxFee: null,
    commodities: [],
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
    [["Copper", 1], ["Gold", 2], ["Lithium", 1], ["Potash", 1], ["Silver", 1], ["None recorded", 2]],
    "alphabetical, each with how many companies hold it, none that nobody holds, and the empty last");

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

/* ---------------------------------------------- a filter on every column */

const FEES: RosterRow[] = [
  row({ name: "Alpha Gold", ticker: "AGX", exchange: "TSX", tier: 2, status: "classified", marketCap: 900e6,
        stages: ["exploration", "production"], stageEvidence: "complete",
        auditFee: { amount: 400_000, currency: "CAD", fiscal_year: 2025 },
        taxFee: { amount: 25_000, currency: "CAD", fiscal_year: 2025 }, sources: { tax_fee: "ai_accepted" } }),
  row({ name: "Beta Copper", ticker: "BCU", exchange: "TSXV", tier: 5, status: "classified", marketCap: 150e6,
        stages: ["development"], stageEvidence: "partial",
        auditFee: { amount: 120_000, currency: "USD", fiscal_year: 2024 },
        taxFee: null, sources: { tax_fee: "ai_accepted" } }),
  row({ name: "Gamma Silver", ticker: null, exchange: null, tier: 6, status: "classified", marketCap: null,
        stages: ["exploration"], stageEvidence: "complete", taxFee: 9_000 }),
  row({ name: "Delta Royalty", ticker: "DRY", exchange: "TSX", tier: 4, status: "classified", marketCap: 3e9,
        stages: ["royalty_streaming"], stageEvidence: "complete",
        taxFee: { amount: 80_000, currency: "USD", fiscal_year: 2025 } }),
];

test("every new column filter survives the trip through its URL", () => {
  const f = {
    ...EMPTY_FILTER, exchange: ["TSXV", "unknown"], decides: ["production", "none"],
    exploration: ["yes", "unknown"], development: ["no"], production: [], royalty_streaming: ["not_researched"],
    name: "gold", ticker: "ag", tickerHas: "value" as const,
    auditFee: { min: 100_000, max: 500_000, cur: ["CAD", "~"], fy: ["2025"], has: "" as const },
    taxFee: { min: null, max: 50_000, cur: [], fy: [], has: "not_found" as const },
    marketCap: { min: 1e8, max: null, cur: [], fy: [], has: "value" as const },
    hide: ["ticker" as const, "stages" as const, "marketCap" as const],
  };
  assert.deepEqual(parseRosterParams(toRosterParams(f)), f);
  assert.equal(isNarrowed({ ...EMPTY_FILTER, hide: ["ticker"] }), false, "hiding a column narrows nothing");
});

test("junk in the new keys is dropped, not guessed at", () => {
  const f = parseRosterParams(new URLSearchParams(
    "exploration=maybe&decides=mining&audit_min=lots&audit_max=1e99&tax_has=sometimes&cap_cur=USD&cap_has=not_found" +
    "&audit_cur=dollars&audit_fy=25&hide=name&hide=bogus&hide=taxFee&ticker_has=perhaps"));
  assert.deepEqual(f.exploration, []);
  assert.deepEqual(f.decides, []);
  assert.deepEqual(f.auditFee, { min: null, max: null, cur: [], fy: [], has: "" });
  assert.equal(f.taxFee.has, "");
  assert.deepEqual(f.marketCap, { min: null, max: null, cur: [], fy: [], has: "" },
                   "market cap has no currency choice and no not-found");
  assert.deepEqual(f.hide, ["taxFee"], "Company can never be hidden");
  assert.equal(f.tickerHas, "");
});

test("company and ticker narrow by what they contain, and a ticker can be asked for or not", () => {
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, name: " GOLD" })), ["Alpha Gold"]);
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, ticker: "c" })), ["Beta Copper"]);
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, tickerHas: "empty" })), ["Gamma Silver"]);
  assert.equal(filterRows(FEES, { ...EMPTY_FILTER, tickerHas: "value" }).length, 3);
});

test("exchange, the deciding stage and each stage column narrow on their own", () => {
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, exchange: ["TSXV", "unknown"] })),
                   ["Beta Copper", "Gamma Silver"]);
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, decides: ["royalty_streaming"] })), ["Delta Royalty"]);
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, exploration: ["yes"] })), ["Alpha Gold", "Gamma Silver"]);
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, exploration: ["unknown"] })), ["Beta Copper"],
                   "partial evidence: an absent stage is not known, not a no");
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, exploration: ["no"] })), ["Delta Royalty"]);
  assert.deepEqual(names(filterRows(ROWS, { ...EMPTY_FILTER, production: ["not_researched"] })),
                   ["Arizona Sonoran", "Aclara Resources"]);
  const facets = facetOptions(FEES);
  assert.deepEqual(facets.exploration[0].options.map((o) => [o.value, o.count]), [["yes", 2], ["no", 1], ["unknown", 1]]);
  assert.deepEqual(facets.exchange[0].options.map((o) => o.label), ["TSX", "TSXV", "Not known"]);
});

test("a fee range compares amounts as printed, and currency, year and presence narrow it further", () => {
  const between = filterRows(FEES, { ...EMPTY_FILTER, auditFee: { ...EMPTY_FILTER.auditFee, min: 100_000, max: 450_000 } });
  assert.deepEqual(names(between), ["Alpha Gold", "Beta Copper"], "a range drops rows with no fee");
  const cad = filterRows(FEES, { ...EMPTY_FILTER, auditFee: { ...EMPTY_FILTER.auditFee, min: 100_000, cur: ["CAD"] } });
  assert.deepEqual(names(cad), ["Alpha Gold"]);
  const fy = filterRows(FEES, { ...EMPTY_FILTER, taxFee: { ...EMPTY_FILTER.taxFee, fy: ["2025"] } });
  assert.deepEqual(names(fy), ["Alpha Gold", "Delta Royalty"]);
  const bare = filterRows(FEES, { ...EMPTY_FILTER, taxFee: { ...EMPTY_FILTER.taxFee, cur: ["~"] } });
  assert.deepEqual(names(bare), ["Gamma Silver"], "a fee stored before currencies were kept is its own choice");

  const has = (h: "value" | "empty" | "not_found") =>
    names(filterRows(FEES, { ...EMPTY_FILTER, taxFee: { ...EMPTY_FILTER.taxFee, has: h } }));
  assert.deepEqual(has("value"), ["Alpha Gold", "Gamma Silver", "Delta Royalty"]);
  assert.deepEqual(has("empty"), ["Beta Copper"]);
  assert.deepEqual(has("not_found"), ["Beta Copper"], "researched, and the filing does not say");

  const facets = facetOptions(FEES);
  assert.deepEqual(facets.taxFeeCur[0].options.map((o) => [o.value, o.count]), [["CAD", 1], ["USD", 1], ["~", 1]]);
  assert.deepEqual(facets.taxFeeFy[0].options.map((o) => o.label), ["FY2025", "Not recorded"], "newest year first");
});

test("market cap filters in Canadian dollars, and an empty cap is its own choice", () => {
  const big = filterRows(FEES, { ...EMPTY_FILTER, marketCap: { ...EMPTY_FILTER.marketCap, min: 500e6 } });
  assert.deepEqual(names(big), ["Alpha Gold", "Delta Royalty"]);
  const none = filterRows(FEES, { ...EMPTY_FILTER, marketCap: { ...EMPTY_FILTER.marketCap, has: "empty" } });
  assert.deepEqual(names(none), ["Gamma Silver"]);
});

test("the tax fee is a column: searched, sorted by currency then amount, and not repeated in search's hidden values", () => {
  assert.deepEqual(names(filterRows(FEES, { ...EMPTY_FILTER, q: "80,000" })), ["Delta Royalty"]);
  const sorted = sortRows(filterRows(FEES, EMPTY_FILTER), "taxFee", 1);
  assert.deepEqual(names(sorted), ["Gamma Silver", "Alpha Gold", "Delta Royalty", "Beta Copper"],
                   "no currency, then CAD, then USD; no fee last");
  assert.ok(COLUMN_FIELDS.has("tax_fee"));
  assert.equal(ROSTER_COLUMNS.find((c) => c.key === "taxFee")?.label, "Tax fees paid to audit firm");
});

test("the filter in words names every column filter", () => {
  const f = {
    ...EMPTY_FILTER, name: "gold", decides: ["production"], exploration: ["unknown"],
    taxFee: { min: 10_000, max: 50_000, cur: ["CAD"], fy: ["2025"], has: "" as const },
    marketCap: { ...EMPTY_FILTER.marketCap, min: 1e9 },
  };
  const words = describeFilter(f, facetOptions(FEES));
  assert.match(words, /Stage \(deciding the tier\): Production/);
  assert.match(words, /Exploration: Not known/);
  assert.match(words, /Company contains “gold”/);
  assert.match(words, /Tax fees paid to audit firm: C\$10,000 to C\$50,000, in CAD, FY2025/);
  assert.match(words, /Market cap: at least C\$1(\.0)?B/);
});

test("amounts are typed as people say them", () => {
  assert.equal(parseAmount("250k"), 250_000);
  assert.equal(parseAmount("1.5M"), 1_500_000);
  assert.equal(parseAmount("C$2,000,000"), 2_000_000);
  assert.equal(parseAmount("3 bn"), 3e9);
  assert.equal(parseAmount(" "), null);
  assert.equal(parseAmount("lots"), undefined);
  assert.equal(parseAmount("1.2.3"), undefined);
  assert.equal(amountText(250_000), "250k");
  assert.equal(amountText(1_500_000), "1.5M");
  assert.equal(amountText(2e9), "2B");
  assert.equal(amountText(1234), "1234");
  for (const n of [250_000, 1_500_000, 2e9, 1234, 90_500]) assert.equal(parseAmount(amountText(n)), n);
});

test("a search that hits a hidden column keeps the row and says which column matched", () => {
  const shown = filterRows(FEES, { ...EMPTY_FILTER, q: "80,000" });
  assert.equal(shown[0]?.matched, null, "on screen, no hint");
  const hidden = filterRows(FEES, { ...EMPTY_FILTER, q: "80,000", hide: ["taxFee"] });
  assert.deepEqual(names(hidden), ["Delta Royalty"]);
  assert.equal(hidden[0].matched?.label, "Tax fees paid to audit firm");
  const ticker = filterRows(FEES, { ...EMPTY_FILTER, q: "agx", hide: ["ticker"] });
  assert.equal(ticker[0].matched?.label, "Ticker");
});

test("a currency or year no fee holds any more is dropped, so a saved report never narrows to nothing", () => {
  const facets = facetOptions(FEES);
  const f = dropUnknown({
    ...EMPTY_FILTER,
    auditFee: { ...EMPTY_FILTER.auditFee, cur: ["CAD", "EUR"], fy: ["2025", "1999"] },
    taxFee: { ...EMPTY_FILTER.taxFee, cur: ["~", "GBP"], fy: ["2031"] },
  }, facets);
  assert.deepEqual([f.auditFee.cur, f.auditFee.fy], [["CAD"], ["2025"]]);
  assert.deepEqual([f.taxFee.cur, f.taxFee.fy], [["~"], []]);
});

test("the URL's own spelling is stable, and an amount the URL would drop is not an amount", () => {
  const once = toRosterParams(parseRosterParams(new URLSearchParams("name=gold%20&tax_min=10000&tier=2"))).toString();
  assert.equal(toRosterParams(parseRosterParams(new URLSearchParams(once))).toString(), once);
  assert.equal(parseAmount("2,000,000 bn"), undefined);
  assert.equal(parseAmount("900,000 bn"), 900e12);
});
