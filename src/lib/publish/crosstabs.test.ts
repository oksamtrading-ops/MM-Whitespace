import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod } from "./snapshot.ts";
import { foldProvinces } from "./jurisdictions.ts";
import { provincesByTier } from "./crosstabs.ts";

function company(ordinal: number, name: string, over: Partial<ParsedCompany>): ParsedCompany {
  return {
    ticker: `T${ordinal}`, exchange: "TSX", name, ordinal, market_cap: 5_000_000_000,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: 2, footprint_workbook: "Canada only",
    ...over,
  } as ParsedCompany;
}

test("the map's tier view splits each province exactly as the all-companies map counts it", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [
    company(1, "Ontario Producer Ltd.", { regions: { CANADA: ["ON", "QC"] } }),
    company(2, "Abroad And Home Corp.", {
      regions: { CANADA: ["ON"], "LATIN AMERICA": ["Chile"] },
      region_provenance: { CANADA: "extract", "LATIN AMERICA": "extract" },
      footprint_workbook: "Canada and abroad", tier_workbook: 1 }),
    company(3, "Northern Explorer Inc.", {
      stages: ["exploration"], regions: { CANADA: ["NWT"] }, tier_workbook: 6 }),
    // No Canadian ground: on no province, in no tier's count.
    company(4, "Chile Only SA", {
      regions: { "LATIN AMERICA": ["Chile"] }, region_provenance: { "LATIN AMERICA": "extract" },
      footprint_workbook: "Abroad only", tier_workbook: 3 }),
  ] }, { label: "P1 (2026-05-31)" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  const { publicationId } = await publishPeriod(db, periodId, { overrideReason: "test" });

  const tiers = await provincesByTier(db, publicationId);
  assert.deepEqual(tiers.map((t) => t.token),
    ["1", "2", "3", "4", "5", "6", "no_stage", "no_property", "conflicting", "unclassified"],
    "every tier and every reason for none, in the companies table's order, zeros included");
  assert.equal(tiers.reduce((a, t) => a + t.companies, 0), 3, "the abroad-only company holds no Canadian ground");

  // The all-companies map reads the snapshot's own aggregate. The tiers must add up to it.
  const agg = foldProvinces(await db.all(
    "select bucket, n from publication_aggregates where publication_id = ? and kind = 'province_footprint'",
    publicationId) as Array<{ bucket: string; n: number }>);
  const summed = new Map<string, number>();
  for (const t of tiers) for (const r of t.rows) summed.set(r.code, (summed.get(r.code) ?? 0) + r.n);
  assert.deepEqual(Object.fromEntries([...summed].sort()), Object.fromEntries([...agg].sort()),
                   "a province's tiers add up to its all-companies count");
  assert.equal(summed.get("NT"), 1, "NWT is the Northwest Territories, one place");

  // Each company lands in its own tier, as published.
  const published = await db.all(`select c.canonical_name name, t.tier, t.status from published_period_tiers t
      join companies c on c.id = t.company_id where t.publication_id = ?`, publicationId) as
    Array<{ name: string; tier: number | null; status: string }>;
  const tierOf = (name: string) => published.find((p) => p.name === name)!;
  const ontarioTier = tierOf("Ontario Producer Ltd.");
  const token = ontarioTier.tier === null ? null : String(ontarioTier.tier);
  assert.ok(token, `the fixture's Ontario producer should be classified (${ontarioTier.status})`);
  const its = tiers.find((t) => t.token === token)!;
  assert.ok(its.rows.some((r) => r.code === "QC"), "its Quebec property is counted in its tier");
});
