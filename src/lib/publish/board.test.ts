import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRosterParams } from "../profile/roster.ts";
import { attestFirms, companiesHref, headOffices, TIER_KEYS, tierCounts, type BoardCompany } from "./board.ts";
import { UNNAMED } from "./lens.ts";

const co = (tier: number | null, hqToken: string | null, auditor: string | null): BoardCompany => ({ tier, hqToken, auditor });

// Twenty companies: BC has 12 head offices, ON 5, AB 1, Canada with no
// province 1, Australia 1; and one with no head office on record would be a
// twenty-first, added where a test needs it.
const MARKET: BoardCompany[] = [
  ...Array.from({ length: 10 }, (_, i) => co(i < 4 ? 6 : 5, "CA:BC", i < 6 ? "Davidson & Company" : "PwC")),
  co(1, "CA:BC", "Deloitte"), co(null, "CA:BC", null),
  co(3, "CA:ON", "KPMG"), co(3, "CA:ON", "KPMG"), co(2, "CA:ON", "Deloitte"), co(4, "CA:ON", "Smythe"), co(6, "CA:ON", UNNAMED),
  co(6, "CA:AB", "Davidson & Company"), co(5, "Canada", "PwC"), co(3, "Australia", "BDO"),
];

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);

test("every company is in one tier or in none, and the tiers sum to the period", () => {
  const t = tierCounts(MARKET);
  assert.deepEqual(t, { 1: 1, 2: 1, 3: 3, 4: 1, 5: 7, 6: 6, none: 1 });
  assert.equal(sum(t), MARKET.length);
  assert.deepEqual(Object.keys(t), [...TIER_KEYS], "in tier order, no tier last");
});

test("head offices: provinces most first, then Canada with no province, outside Canada, and not on record", () => {
  const h = headOffices([...MARKET, co(6, null, "PwC")]);
  assert.deepEqual(h.rows.map((r) => [r.label, r.n]), [
    ["British Columbia", 12], ["Ontario", 5], ["Alberta", 1], ["Canada, no province", 1], ["Outside Canada", 1], ["Not on record", 1],
  ]);
  assert.deepEqual([h.canada, h.outside, h.unknown], [19, 1, 1]);
  for (const r of h.rows) assert.equal(sum(r.tiers), r.n, `${r.label}: its tiers sum to its head offices`);
  assert.equal(h.rows.reduce((s, r) => s + r.n, 0), 21, "the rows sum to the period");
  assert.deepEqual(h.rows.find((r) => r.key === "CA:BC")!.tiers, { 1: 1, 2: 0, 3: 0, 4: 0, 5: 6, 6: 4, none: 1 });
  assert.deepEqual(h.rows.find((r) => r.kind === "unknown")!.tokens, ["unknown"], "the token Companies files it under");
});

test("outside Canada is every country and state, gathered", () => {
  const h = headOffices([co(1, "US:NV", null), co(1, "Australia", null), co(2, "US:NV", null)]);
  assert.deepEqual(h.rows.map((r) => [r.key, r.n, r.tokens]), [["outside", 3, ["Australia", "US:NV"]]]);
});

test("attest firms: the four always, Deloitte first, then firms with ten or more, other firms, and not yet known", () => {
  const g = attestFirms(MARKET, { firmMin: 3, provinceMin: 5 });
  assert.deepEqual(g.rows.map((r) => [r.label, r.n]), [
    ["Deloitte", 2], ["PwC", 5], ["KPMG", 2], ["EY", 0], ["Davidson & Company", 7], ["Other firms", 3], ["Not yet known", 1],
  ]);
  const other = g.rows.find((r) => r.kind === "other")!;
  assert.deepEqual(other.tokens, ["BDO", "Smythe", UNNAMED], "every firm it gathers, the unnamed too");
  assert.equal(other.firms, 2, "two firms research named");
  assert.deepEqual([g.known, g.unknown], [19, 1]);
  assert.equal(g.rows.reduce((s, r) => s + r.n, 0), MARKET.length, "the rows sum to the period");
  for (const r of g.rows) {
    assert.equal(sum(r.places), r.n, `${r.label}: its head offices sum to the row`);
    assert.equal(sum(r.tiers), r.n, `${r.label}: its tiers sum to the row`);
  }
});

test("a province gets a column of its own at the line; the rest of Canada is one column", () => {
  const g = attestFirms(MARKET, { firmMin: 3, provinceMin: 5 });
  assert.deepEqual(g.places.map((p) => [p.short, p.tokens]), [
    ["BC", ["CA:BC"]], ["ON", ["CA:ON"]], ["Rest", ["CA:AB", "Canada"]], ["Outside", ["Australia"]],
  ]);
  assert.equal(g.rows.find((r) => r.key === "Davidson & Company")!.places.rest, 1, "Alberta is in the rest");
  assert.equal(g.rows.find((r) => r.key === "PwC")!.places.rest, 1, "so is Canada with no province");
  const none = attestFirms(MARKET, { provinceMin: 50 });
  assert.deepEqual(none.places.map((p) => p.label), ["Canada", "Outside Canada"], "with no province of its own, the rest is Canada");
});

test("a firm under the line, or an unnamed one, is never a row of its own", () => {
  const g = attestFirms(MARKET);
  assert.deepEqual(g.rows.map((r) => r.label), ["Deloitte", "PwC", "KPMG", "EY", "Other firms", "Not yet known"]);
  assert.equal(g.rows.find((r) => r.kind === "other")!.n, 10);
});

test("every figure opens exactly its companies in Companies", () => {
  const parse = (href: string) => {
    const params: Record<string, string[]> = {};
    for (const [k, v] of new URLSearchParams(href.split("?")[1] ?? "")) (params[k] ??= []).push(v);
    return parseRosterParams(params);
  };
  assert.equal(companiesHref({}), "/companies");
  const f = parse(companiesHref({ tier: "3", hq: ["CA:BC"], auditor: ["PwC"] }));
  assert.deepEqual([f.tier, f.hq, f.auditor], [["3"], ["CA:BC"], ["PwC"]]);
  assert.deepEqual(parse(companiesHref({ tier: "none" })).tier.sort(), ["conflicting", "no_property", "no_stage", "unclassified"],
    "no tier is every reason Companies files a company with none under");
  assert.deepEqual(parse(companiesHref({ hq: ["Australia", "US:NV"], auditor: ["unknown"] })).hq, ["Australia", "US:NV"]);
  assert.deepEqual(parse(companiesHref({ auditor: ["unknown"] })).auditor, ["unknown"]);
});
