import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import { formatProfileValue, listCompanies, readCompanyProfile } from "./company.ts";

test("a market cap reads as money and a region map as the regions actually held", async () => {
  assert.equal(formatProfileValue("market_cap_cad", 1060201462), "$1,060,201,462");
  assert.equal(
    formatProfileValue("property_regions", {
      AFRICA: [], "LATIN AMERICA": ["Guyana", "Suriname"], CANADA: [], "AUS/NZ/PNG": ["Fiji"],
    }),
    "Latin America: Guyana, Suriname · AUS/NZ/PNG: Fiji",
    "eight empty buckets are noise; the shout is not a region name");
  assert.equal(formatProfileValue("property_regions", { AFRICA: [], CANADA: [] }),
               "No properties recorded");
  assert.equal(formatProfileValue("commodities", ["Gold", "Copper"]), "Gold, Copper");
  assert.equal(formatProfileValue("venture_graduate", false), "No");
  assert.equal(formatProfileValue("auditor", null), "—");
});

/* The boundary in docs/design/01: a Viewer must never see a draft period. */
test("a Viewer reads nothing until a period is published", async () => {
  const db = memorySql();
  await db.run(`insert into periods (label, market_cap_as_of, rule_set_version)
     values ('Q1-2027 (2026-12-31)', '2026-12-31', '1.0.0')`);
  const period = await db.get("select id from periods") as { id: string };
  await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id)
     values ('Northwind Gold Inc.', 'northwind gold inc', ?)`, period.id);
  const company = await db.get("select id from companies") as { id: string };
  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
     values (?, ?, 4, 'classified', 'none', '1.0.0')`, period.id, company.id);

  assert.equal(await readCompanyProfile(db, company.id, { allowDraft: false }), null,
               "an unpublished period is not readable by a Viewer");
  assert.deepEqual(await listCompanies(db, { allowDraft: false }), [],
                   "and neither is the population it contains");

  const draft = await readCompanyProfile(db, company.id, { allowDraft: true });
  assert.equal(draft?.publication, null, "an Analyst is told this is the draft");
  assert.equal(draft?.tier?.tier, 4);
  assert.equal((await listCompanies(db, { allowDraft: true })).length, 1);
});

test("a company that does not exist is absent, not an error", async () => {
  const db = memorySql();
  assert.equal(await readCompanyProfile(db, "0".repeat(32), { allowDraft: true }), null);
});
