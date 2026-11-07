import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { commitTsxPeriod } from "../db/committsx.ts";
import type { TsxIssuer } from "../ingest/tsx.ts";
import { publishPeriod } from "./snapshot.ts";
import { aboutTheTool, monthYear, thresholdWords } from "./landing.ts";

const company = (ticker: string, market_cap: number): ParsedCompany => ({
  ticker, exchange: "TSX", name: `${ticker} Mining Corp.`, ordinal: 1, market_cap,
  stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
  regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
  commodities: ["Gold"], venture_graduate: false, auditor: "KPMG LLP", auditor_class: "big4",
  entity_id: null, website: `https://${ticker.toLowerCase()}.example.com`,
  dtt_market: "Ontario", head_office_region: "Ontario, Canada",
  tier_workbook: null, footprint_workbook: null,
} as ParsedCompany);

const issuer = (ticker: string, market_cap: number): TsxIssuer => ({
  ticker, exchange: "TSX", name: `${ticker} Mining Corp.`, market_cap, regions: { CANADA: ["ON"] },
  commodities: ["Gold"], venture_graduate: false, head_office_region: "Ontario, Canada",
});

const idOf = async (db: ReturnType<typeof memorySql>, label: string) =>
  String((await db.get("select id from periods where label = ?", label) as { id: string }).id);

test("nothing is stated before anything is published", async () => {
  const db = memorySql();
  assert.equal(await aboutTheTool(db), null);
  await commitPeriod(db, { period: "2026-05-31", companies: [company("AAA", 5e8)] }, { label: "Q3" });
  assert.equal(await aboutTheTool(db), null, "a draft speaks for nobody");
});

test("the figures are the newest published period's, and a draft after it changes none of them", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [company("AAA", 5e8), company("BBB", 9e8)] },
    { label: "Q3" });
  await publishPeriod(db, await idOf(db, "Q3"), { overrideReason: "test" });

  const q3 = (await aboutTheTool(db))!;
  assert.equal(q3.asOf, "2026-05-31");
  assert.equal(q3.companies, 2);
  assert.equal(q3.listedIssuers, null, "a workbook never held TSX's whole list");
  assert.deepEqual(q3.threshold, { amount: 200_000_000, operator: "gte", currency: "CAD" });

  // TSX's list for August: four issuers, three over the line.
  await commitTsxPeriod(db, { kind: "tsx_list", period: "2026-08-31",
    companies: [issuer("AAA", 6e8), issuer("BBB", 9e8), issuer("CCC", 3e8), issuer("DDD", 1e8)] },
    { label: "Q4" });
  assert.equal((await aboutTheTool(db))!.asOf, "2026-05-31", "Q4 is a draft");

  await publishPeriod(db, await idOf(db, "Q4"), { overrideReason: "test" });
  const q4 = (await aboutTheTool(db))!;
  assert.equal(q4.asOf, "2026-08-31");
  assert.equal(q4.listedIssuers, 4, "every issuer TSX listed, not only those over the line");
  assert.equal(q4.companies, 3);
});

test("the line is the one the revision was published at", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [company("AAA", 5e8)] }, { label: "Q3" });
  const q3 = await idOf(db, "Q3");
  await publishPeriod(db, q3, { overrideReason: "test" });
  await db.run("update periods set threshold_amount = 100000000 where id = ?", q3);
  assert.equal((await aboutTheTool(db))!.threshold.amount, 200_000_000);
});

test("MM.YYYY, in Toronto", () => {
  assert.equal(monthYear("2026-08-31"), "08.2026", "a calendar date is taken as written");
  assert.equal(monthYear("2026-11-06T06:51:23.079749+00:00"), "11.2026");
  assert.equal(monthYear("2026-11-01 02:30:00"), "10.2026", "half past nine on Hallowe'en in Toronto");
  assert.equal(monthYear("2026-11-01T02:30:00Z"), "10.2026");
});

test("the line in words says whether a company on it is in", () => {
  assert.equal(thresholdWords({ amount: 100_000_000, operator: "gte", currency: "CAD" }), "of C$100M or more");
  assert.equal(thresholdWords({ amount: 100_000_000, operator: "gt", currency: "CAD" }), "in excess of C$100M");
});
