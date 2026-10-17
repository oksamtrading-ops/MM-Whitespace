import { test } from "node:test";
import assert from "node:assert/strict";
import { normName } from "../db/commit.ts";
import {
  deloitteMarketFor, meetsThreshold, nearThreshold, planFrom,
  type Base, type Known, type Threshold, type TsxIssuer,
} from "./tsx.ts";

const LINE: Threshold = { amount: 200_000_000, operator: "gte", currency: "CAD", bandPct: 2 };
const BASE: Base = { periodId: "q3", label: "Q3-2026 (2026-05-31)", asOf: "2026-05-31", publicationId: "pub", revision: 10 };

const issuer = (ticker: string, exchange: string, name: string, market_cap: number | null,
                over: Partial<TsxIssuer> = {}): TsxIssuer => ({
  ticker, exchange, name, market_cap, regions: { CANADA: ["ON"] }, commodities: ["Gold"],
  venture_graduate: false, head_office_region: "Ontario, Canada", ...over,
});

function known(): Known {
  return {
    tickers: [
      { companyId: "c-nrth", ticker: "NRTH", exchange: "TSX" },
      { companyId: "c-sthc", ticker: "STHC", exchange: "TSX" },
      { companyId: "c-cary", ticker: "CARY", exchange: "TSXV" },
      { companyId: "c-devl", ticker: "DEVL", exchange: "TSXV" },
      { companyId: "c-blnk", ticker: "BLNK", exchange: "TSX" },
      { companyId: "c-old", ticker: "OLDC", exchange: "TSX" },
    ],
    names: new Map(([
      ["Northco Mining Corp.", "c-nrth"], ["Southco Resources Ltd.", "c-sthc"], ["Carryco Minerals Inc.", "c-cary"],
      ["Devco Development Ltd.", "c-devl"], ["Blankco Holdings Inc.", "c-blnk"], ["Oldco Gold Inc.", "c-old"],
      // A company merged into Northco still finds Northco.
      ["Northern Mining Inc.", "c-nrth"],
    ] as const).map(([name, id]) => [normName(name), id])),
    prior: [
      { companyId: "c-nrth", name: "Northco Mining Corp.", ticker: "NRTH", exchange: "TSX", marketCap: 5e9 },
      { companyId: "c-sthc", name: "Southco Resources Ltd.", ticker: "STHC", exchange: "TSX", marketCap: 3e9 },
      { companyId: "c-cary", name: "Carryco Minerals Inc.", ticker: "CARY", exchange: "TSXV", marketCap: 3e8 },
      { companyId: "c-devl", name: "Devco Development Ltd.", ticker: "DEVL", exchange: "TSXV", marketCap: 4.5e8 },
      { companyId: "c-blnk", name: "Blankco Holdings Inc.", ticker: "BLNK", exchange: "TSX", marketCap: 7.8e8 },
    ],
  };
}

const LIST = [
  issuer("NRTH", "TSX", "Northco Mining Corp.", 5.4e9),
  issuer("SOCO", "TSX", "Southco Resources Ltd.", 3.1e9),       // ticker changed, found by name
  issuer("CARY", "TSX", "Carryco Minerals Inc.", 5.2e8),         // graduated from TSXV
  issuer("DEVL", "TSXV", "Devco Development Ltd.", 1.5e8),       // under the line
  issuer("NEWC", "TSX", "Newco Copper Corp.", 6.5e8, { head_office_region: "British Columbia, Canada" }),
  issuer("EDGE", "TSXV", "Edgeco Metals Inc.", 2.03e8, { head_office_region: "Manitoba, Canada" }),
  issuer("OLDC", "TSX", "Oldco Gold Inc.", 9e8),                 // known from an older period
  issuer("TINY", "TSXV", "Tinyco Resources Ltd.", 1.2e7),
];

test("the threshold is the application's, and the band reaches both sides of it", () => {
  assert.equal(meetsThreshold(200_000_000, LINE), true, "at the line is in, decision 9");
  assert.equal(meetsThreshold(200_000_000, { ...LINE, operator: "gt" }), false);
  assert.equal(meetsThreshold(null, LINE), false, "no market cap places nobody");
  assert.equal(nearThreshold(203_000_000, LINE), true);
  assert.equal(nearThreshold(197_000_000, LINE), true, "just under is near too");
  assert.equal(nearThreshold(190_000_000, LINE), false, "5% off is not near at a 2% band");
});

test("an issuer is found by ticker first, then by name, and what moved is said", () => {
  const plan = planFrom({ period: "2026-08-31", companies: LIST }, known(), LINE, BASE);
  assert.deepEqual(plan.blocking, []);
  assert.equal(plan.issuers, 8);
  assert.deepEqual(plan.population.map((p) => p.issuer.ticker), ["NRTH", "SOCO", "CARY", "NEWC", "EDGE", "OLDC"]);

  const by = new Map(plan.population.map((p) => [p.issuer.ticker, p]));
  assert.equal(by.get("NRTH")?.matchedBy, "ticker");
  assert.deepEqual(by.get("NRTH")?.moves, []);
  assert.equal(by.get("SOCO")?.companyId, "c-sthc", "GGA became GORO: the name still finds the company");
  assert.equal(by.get("SOCO")?.matchedBy, "name");
  assert.deepEqual(by.get("SOCO")?.moves, ["ticker"]);
  assert.equal(by.get("CARY")?.matchedBy, "ticker", "a graduate's open TSXV ticker still finds it on TSX");
  assert.deepEqual(by.get("CARY")?.moves, ["exchange"]);
  assert.equal(by.get("NEWC")?.companyId, null, "never seen: created at commit");
  assert.equal(by.get("OLDC")?.companyId, "c-old", "known, but not in the last period's population");
  assert.equal(by.get("OLDC")?.prior, null);

  assert.deepEqual(plan.entrants.map((p) => p.issuer.ticker), ["NEWC", "EDGE", "OLDC"]);
  assert.deepEqual(plan.continuing.map((p) => p.issuer.ticker), ["NRTH", "SOCO", "CARY"]);
  assert.deepEqual(plan.dropOuts.map((d) => [d.name, d.reason, d.now?.marketCap ?? null]), [
    ["Blankco Holdings Inc.", "not_listed", null],
    ["Devco Development Ltd.", "below_threshold", 1.5e8],
  ]);
  assert.deepEqual(plan.near.map((n) => [n.ticker, n.inPeriod]), [["EDGE", true]]);
});

test("a name never takes a company a ticker has already claimed", () => {
  const list = [
    issuer("NRTH", "TSX", "Northco Mining Corp.", 5e9),
    // A new issuer that happens to carry Northco's old name.
    issuer("NRTX", "TSXV", "Northern Mining Inc.", 4e8),
  ];
  const plan = planFrom({ period: "2026-08-31", companies: list }, known(), LINE, BASE);
  assert.equal(plan.population[0].companyId, "c-nrth");
  assert.equal(plan.population[1].companyId, null);
  assert.equal(plan.blocking.length, 1, "and a new company cannot take a name in use");
  assert.match(plan.blocking[0], /Northern Mining Inc\. \(NRTX\) has the same name/);
});

test("a ticker renamed under the same company is a new name, not a new company", () => {
  const plan = planFrom({ period: "2026-08-31", companies: [issuer("NRTH", "TSX", "Northco Metals Corp.", 5e9)] },
                        known(), LINE, BASE);
  assert.equal(plan.population[0].companyId, "c-nrth");
  assert.deepEqual(plan.population[0].moves, ["name"]);
});

test("nothing published, or a threshold in another currency, is refused", () => {
  const none = planFrom({ period: "2026-08-31", companies: LIST }, known(), LINE, null);
  assert.match(none.blocking[0], /No period has been published yet/);
  const usd = planFrom({ period: "2026-08-31", companies: LIST }, known(), { ...LINE, currency: "USD" }, BASE);
  assert.match(usd.blocking[0], /threshold is set in USD/);
});

test("the Deloitte market follows the head office, and an unseen province is not guessed", () => {
  assert.deepEqual(deloitteMarketFor("British Columbia, Canada"), { market: "British Columbia", unmapped: false });
  assert.deepEqual(deloitteMarketFor("Quebec, Canada"), { market: "Quebec & NCR", unmapped: false });
  assert.deepEqual(deloitteMarketFor("Saskatchewan, Canada"), { market: "Prairies Region", unmapped: false });
  assert.deepEqual(deloitteMarketFor("Newfoundland and Labrador, Canada"), { market: "Atlantic", unmapped: false });
  assert.deepEqual(deloitteMarketFor("Manitoba, Canada"), { market: null, unmapped: true });
  assert.deepEqual(deloitteMarketFor("Yukon, Canada"), { market: null, unmapped: true });
  assert.deepEqual(deloitteMarketFor("Nevada, United States"), { market: null, unmapped: false }, "abroad has none");
  assert.deepEqual(deloitteMarketFor(null), { market: null, unmapped: false });
});
