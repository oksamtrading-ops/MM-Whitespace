import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRosterParams } from "../profile/roster.ts";
import type { TierProvinces } from "./crosstabs.ts";
import { companiesHref, companiesOf, groupRows, MAP_TIER_GROUPS, provinceMix } from "./maptiers.ts";

const TIERS: TierProvinces[] = [
  { token: "1", companies: 2, rows: [{ code: "ON", n: 2 }, { code: "QC", n: 1 }] },
  { token: "2", companies: 3, rows: [{ code: "ON", n: 3 }] },
  { token: "3", companies: 0, rows: [] },
  { token: "no_stage", companies: 1, rows: [{ code: "BC", n: 1 }] },
  { token: "conflicting", companies: 1, rows: [{ code: "BC", n: 1 }, { code: "ON", n: 1 }] },
];
const group = (key: string) => MAP_TIER_GROUPS.find((g) => g.key === key)!;

test("the map offers six tiers and one Unclassified, which gathers the four reasons for none", () => {
  assert.deepEqual(MAP_TIER_GROUPS.map((g) => g.label),
    ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6", "Unclassified"]);
  const u = groupRows(TIERS, group("unclassified"));
  assert.equal(u.companies, 2, "no stage research and conflicting, together");
  assert.deepEqual(u.rows, [{ code: "BC", n: 2 }, { code: "ON", n: 1 }], "most first");
  assert.deepEqual(groupRows(TIERS, group("3")), { companies: 0, rows: [] }, "an empty tier is empty, not missing");
});

test("a province's mix names every tier present there, and only those", () => {
  assert.deepEqual(provinceMix(TIERS, "ON"),
    [{ label: "Tier 1", n: 2 }, { label: "Tier 2", n: 3 }, { label: "Unclassified", n: 1 }]);
  assert.deepEqual(provinceMix(TIERS, "YT"), []);
});

test("the count reads as a phrase", () => {
  assert.equal(companiesOf(group("2"), 1), "1 Tier 2 company");
  assert.equal(companiesOf(group("2"), 3), "3 Tier 2 companies");
  assert.equal(companiesOf(group("unclassified"), 2), "2 unclassified companies");
});

test("See them opens the companies table on exactly what the map counted", () => {
  // The links are only worth having if the table reads them back as the same filter.
  const read = (href: string) => parseRosterParams(new URL(href, "https://x.invalid").searchParams);
  const all = read(companiesHref("ON", null));
  assert.deepEqual(all.prop, ["CANADA:ON"]);
  assert.deepEqual(all.tier, []);
  const tier2 = read(companiesHref("ON", group("2")));
  assert.deepEqual(tier2.prop, ["CANADA:ON"]);
  assert.deepEqual(tier2.tier, ["2"]);
  const none = read(companiesHref("NT", group("unclassified")));
  assert.deepEqual(none.prop, ["CANADA:NT"]);
  assert.deepEqual([...none.tier].sort(), ["conflicting", "no_property", "no_stage", "unclassified"]);
});
