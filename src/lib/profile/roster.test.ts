import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountText, cellWord, COLUMN_FIELDS, DEFAULT_COLS, describeFilter, dropUnknown, EMPTY_FILTER,
  facetOptions, filterRows, hqWord, isNarrowed, LEGACY_COLS, MORE_COLS, parseAmount, parseRosterParams,
  ROSTER_COLUMNS, sortRows, stageMark, tierToken, toRosterParams, type RosterRow,
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
    cols: ["tier" as const, "footprint" as const, "totalAssets" as const],
  };
  assert.deepEqual(parseRosterParams(toRosterParams(f)), f);
  assert.equal(isNarrowed({ ...EMPTY_FILTER, cols: ["tier"] }), false, "which columns show narrows nothing");
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
  assert.ok(!f.cols.includes("taxFee") && f.cols.includes("ticker"), "an unknown column hides nothing");
  assert.equal(f.cols.length, LEGACY_COLS.length - 1, "Company was never a column that could hide");
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
  const hidden = filterRows(FEES, { ...EMPTY_FILTER, q: "80,000", cols: DEFAULT_COLS.filter((k) => k !== "taxFee") });
  assert.deepEqual(names(hidden), ["Delta Royalty"]);
  assert.equal(hidden[0].matched?.label, "Tax fees paid to audit firm");
  const ticker = filterRows(FEES, { ...EMPTY_FILTER, q: "agx", cols: DEFAULT_COLS.filter((k) => k !== "ticker") });
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

/* ------------------------------------------- the columns picked from "More columns" */

const money = (amount: number, currency: string, fy: number) => ({ amount, currency, fiscal_year: fy });

const MORE: RosterRow[] = [
  row({ name: "Alpha Gold", ticker: "AGX", exchange: "TSX", marketCap: 900e6,
        regions: { CANADA: ["ON", "QC"], USA: [] },
        sources: { total_assets: "ai_accepted", sec_registrant: "ai_accepted" },
        more: { website: "https://www.alphagold.example/about", venture_graduate: true, fiscal_year_end: "12-31",
                reporting_currency: "CAD", sec_registrant: { registrant: true, form: "40-F", cik: "1" },
                auditor_change: { changed: true, date: "2025-06", previous_auditor: "Grant Thornton" },
                auditor_since: 2025, total_revenue: money(250e6, "CAD", 2025), net_income: money(-4e6, "CAD", 2025),
                total_assets: money(1.2e9, "CAD", 2025), audit_related_fee: money(40_000, "CAD", 2025),
                other_fee: money(5_000, "CAD", 2025) } }),
  row({ name: "Beta Copper", ticker: "BCU", exchange: "TSXV", marketCap: 150e6,
        sources: { total_assets: "ai_accepted", sec_registrant: "ai_accepted", auditor_change: "ai_accepted" },
        more: { website: "http://betacopper.example", venture_graduate: false, fiscal_year_end: "06-30",
                reporting_currency: "USD", sec_registrant: { registrant: false, form: null, cik: null },
                auditor_since: 2009, total_revenue: money(30e6, "USD", 2024), total_assets: null } }),
  row({ name: "Gamma Silver", ticker: null, exchange: null,
        more: { website: "javascript:alert(1)", auditor_change: { changed: false, date: null, previous_auditor: null },
                net_income: money(2e6, "AUD", 2025) } }),
];

test("new columns are hidden until picked, and old URLs and saved reports open as they were saved", () => {
  const none = parseRosterParams(new URLSearchParams(""));
  assert.deepEqual(none.cols, [...LEGACY_COLS], "no cols, no hide: the table as it always was");
  for (const k of MORE_COLS) assert.ok(!(none.cols as string[]).includes(k), `${k} shows by default`);
  assert.equal(toRosterParams(none).toString(), "", "the default is left out of the URL");

  // ?hide= listed what was taken off the table as it was then.
  const old = parseRosterParams(new URLSearchParams("tier=2&hide=ticker&hide=stages&hide=marketCap"));
  assert.deepEqual(old.cols, LEGACY_COLS.filter((k) => !["ticker", "stages", "marketCap"].includes(k)));
  assert.ok(MORE_COLS.every((k) => !old.cols.includes(k)), "an old link never grows the new columns");
  const rewritten = toRosterParams(old).toString();
  assert.match(rewritten, /^tier=2&cols=tier&cols=stage&cols=footprint/);
  assert.deepEqual(parseRosterParams(new URLSearchParams(rewritten)).cols, old.cols, "and it round-trips");

  const picked = parseRosterParams(new URLSearchParams("cols=totalAssets&cols=ticker&cols=bogus"));
  assert.deepEqual(picked.cols, ["ticker", "totalAssets"], "in the table's order, unknown keys dropped");
  assert.deepEqual(parseRosterParams(new URLSearchParams("cols=~")).cols, [], "Company alone");
  assert.equal(toRosterParams({ ...EMPTY_FILTER, cols: [] }).toString(), "cols=%7E");
  assert.deepEqual(parseRosterParams(new URLSearchParams("cols=bogus")).cols, [...DEFAULT_COLS],
                   "nothing a column: the default, not an empty table");
  assert.deepEqual(parseRosterParams(new URLSearchParams("cols=tier&hide=tier")).cols, ["tier"], "cols wins");
});

test("each new column says what it holds, and the picker knows how many hold it", () => {
  const [a, b, c] = MORE;
  assert.equal(cellWord(a, "website"), "alphagold.example");
  assert.equal(cellWord(c, "website"), null, "only http(s) is a link");
  assert.equal(cellWord(a, "props"), "Canada: ON, QC");
  assert.equal(cellWord(a, "venture"), "Yes");
  assert.equal(cellWord(b, "venture"), "No");
  assert.equal(cellWord(a, "fye"), "31 December");
  assert.equal(cellWord(a, "sec"), "Yes · 40-F");
  assert.equal(cellWord(b, "sec"), "No");
  assert.equal(cellWord(a, "auditorChange"), "Changed 2025-06 from Grant Thornton");
  assert.equal(cellWord(c, "auditorChange"), "No change");
  assert.equal(cellWord(a, "auditorSince"), "2025", "a year, not 2,025");
  assert.match(cellWord(a, "netIncome") ?? "", /^-?C?\$?.*4,000,000.*FY2025/);
  assert.equal(cellWord(b, "totalAssets"), null);
});

test("every new filter narrows by its column", () => {
  const n = (f: Partial<typeof EMPTY_FILTER>) => names(filterRows(MORE, { ...EMPTY_FILTER, ...f }));
  assert.deepEqual(n({ website: "betacopper" }), ["Beta Copper"]);
  assert.deepEqual(n({ websiteHas: "empty" }), ["Gamma Silver"], "an address that is not a link is no website");
  assert.deepEqual(n({ venture: ["yes"] }), ["Alpha Gold"]);
  assert.deepEqual(n({ venture: ["unknown"] }), ["Gamma Silver"]);
  assert.deepEqual(n({ sec: ["no"] }), ["Beta Copper"]);
  assert.deepEqual(n({ sec: ["unknown"] }), ["Gamma Silver"]);
  assert.deepEqual(n({ audchg: ["changed"] }), ["Alpha Gold"]);
  assert.deepEqual(n({ audchg: ["not_found"] }), ["Beta Copper"], "researched, and the filing does not say");
  assert.deepEqual(n({ fye: ["06-30"] }), ["Beta Copper"]);
  assert.deepEqual(n({ repcur: ["CAD", "unknown"] }), ["Alpha Gold", "Gamma Silver"]);
  const range = (over: object) => ({ ...EMPTY_FILTER.revenue, ...over });
  assert.deepEqual(n({ revenue: range({ min: 100e6 }) }), ["Alpha Gold"]);
  assert.deepEqual(n({ revenue: range({ cur: ["USD"] }) }), ["Beta Copper"]);
  assert.deepEqual(n({ revenue: range({ fy: ["2024"] }) }), ["Beta Copper"]);
  assert.deepEqual(n({ netIncome: range({ max: 0 }) }), ["Alpha Gold"], "a loss is a negative amount");
  assert.deepEqual(n({ totalAssets: range({ has: "not_found" }) }), ["Beta Copper"]);
  assert.deepEqual(n({ totalAssets: range({ has: "empty" }) }), ["Beta Copper", "Gamma Silver"]);
  assert.deepEqual(n({ auditRelatedFee: range({ min: 10_000 }) }), ["Alpha Gold"]);
  assert.deepEqual(n({ otherFee: range({ has: "value" }) }), ["Alpha Gold"]);
  assert.deepEqual(n({ auditorSince: range({ max: 2010 }) }), ["Beta Copper"]);
  assert.deepEqual(n({ exchange: ["TSXV"] }), ["Beta Copper"]);

  // Each survives its URL.
  const f = {
    ...EMPTY_FILTER, website: "copper", websiteHas: "value" as const, venture: ["yes", "not_found"], sec: ["no"],
    audchg: ["no_change"], fye: ["12-31"], repcur: ["USD"],
    revenue: range({ min: 1e6, cur: ["USD"], fy: ["2025"] }), netIncome: range({ max: -1 }),
    totalAssets: range({ has: "not_found" as const }), auditRelatedFee: range({ min: 1 }), otherFee: range({ max: 9 }),
    auditorSince: range({ min: 2000, max: 2020 }),
  };
  assert.deepEqual(parseRosterParams(toRosterParams(f)), f);
  const junk = parseRosterParams(new URLSearchParams("venture=maybe&audchg=yes&since_cur=CAD&since_fy=2025"));
  assert.deepEqual([junk.venture, junk.audchg, junk.auditorSince.cur, junk.auditorSince.fy], [[], [], [], []],
                   "a year has no currency and no fiscal year");
});

test("the new filters' options, words, sort and search", () => {
  const facets = facetOptions(MORE);
  const opts = (k: "venture" | "fye" | "repcur" | "audchg") => facets[k][0].options.map((o) => `${o.label} ${o.count}`);
  assert.deepEqual(opts("venture"), ["Yes 1", "No 1", "Not known 1"]);
  assert.deepEqual(opts("fye"), ["30 June 1", "31 December 1", "Not known 1"]);
  assert.deepEqual(opts("audchg"), ["Changed 1", "No change 1", "Researched, not found 1"]);
  assert.deepEqual(facets.revenueCur[0].options.map((o) => o.value), ["CAD", "USD"]);
  assert.deepEqual(facets.netIncomeFy[0].options.map((o) => o.value), ["2025"]);
  assert.deepEqual(dropUnknown({ ...EMPTY_FILTER, fye: ["12-31", "01-31"], repcur: ["GBP"] }, facets).fye, ["12-31"]);

  const words = describeFilter({
    ...EMPTY_FILTER, venture: ["yes"], website: "alpha",
    auditorSince: { ...EMPTY_FILTER.auditorSince, min: 2010 },
    totalAssets: { ...EMPTY_FILTER.totalAssets, min: 1e9, cur: ["CAD"], fy: ["2025"] },
  }, facets);
  assert.match(words, /Venture graduate: Yes/);
  assert.match(words, /Website contains “alpha”/);
  assert.match(words, /Auditor since: at least 2010/);
  assert.match(words, /Total assets: at least C\$1,000,000,000, in CAD, FY2025/);

  assert.deepEqual(names(sortRows(filterRows(MORE, EMPTY_FILTER), "auditorSince", 1)),
                   ["Beta Copper", "Alpha Gold", "Gamma Silver"], "earliest first, none last");
  assert.deepEqual(names(sortRows(filterRows(MORE, EMPTY_FILTER), "website", 1)),
                   ["Alpha Gold", "Beta Copper", "Gamma Silver"]);

  const hidden = filterRows(MORE, { ...EMPTY_FILTER, q: "grant thornton" });
  assert.equal(hidden[0].matched?.label, "Auditor change", "a hidden column's match says where it is");
  const shown = filterRows(MORE, { ...EMPTY_FILTER, q: "grant thornton", cols: [...DEFAULT_COLS, "auditorChange"] });
  assert.equal(shown[0].matched, null, "and on screen needs no hint");
});

test("every new column is in the table's order, and none of them is the Deloitte market", () => {
  const keys = ROSTER_COLUMNS.map((c) => c.key);
  for (const k of MORE_COLS) assert.ok(keys.includes(k), `${k} has no column`);
  assert.ok(!JSON.stringify(ROSTER_COLUMNS).includes("dtt"), "dtt_market is never a column");
});
