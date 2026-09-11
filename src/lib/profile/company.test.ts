import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import { formatProfileValue, listCompanies, readCompanyProfile, unpublishedChanges } from "./company.ts";

test("a market cap reads as money and a region map as the regions actually held", async () => {
  assert.equal(formatProfileValue("market_cap_cad", 1060201462), "C$1,060,201,462", "never a bare $");
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

/*
 * Run 1: an Analyst accepted Nouveau Monde's stage in review, opened the
 * company, and read "no stage research yet" -- the published revision, which
 * predates the research. The page now says what review changed since.
 */
test("what review changed since the published revision is known, and nothing else is", async () => {
  const db = memorySql();
  await db.run(`insert into periods (label, market_cap_as_of, rule_set_version)
     values ('Q3-2026 (2026-06-30)', '2026-06-30', '1.0.0')`);
  const period = await db.get("select id from periods") as { id: string };
  await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id)
     values ('Northwind Graphite Inc.', 'northwind graphite inc', ?)`, period.id);
  const company = await db.get("select id from companies") as { id: string };
  const setLive = async (key: string, value: string, source: string) => {
    await db.run(`delete from company_period_field_values where period_id = ? and company_id = ? and field_key = ?`,
                 period.id, company.id, key);
    await db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, ?, ?, ?, 'asserted')`, period.id, company.id, key, value, source);
  };
  await setLive("auditor", '"PwC"', "extract");
  await setLive("sec_registrant", '{"registrant": true, "cik": "1649752"}', "extract");
  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
     values (?, ?, null, 'unclassified_no_stage_evidence', 'canada_only', '1.0.0')`, period.id, company.id);

  assert.equal(await unpublishedChanges(db, company.id), null, "an unpublished period has nothing to compare with");

  // Publish revision 1 the way publishPeriod does: a copy of the working rows.
  await db.run(`insert into period_publications (period_id, revision) values (?, 1)`, period.id);
  const pub = await db.get("select id from period_publications") as { id: string };
  await db.run(`insert into published_period_values (publication_id, company_id, field_key, value, source, evidence_state)
     select ?, company_id, field_key, value, source, evidence_state from company_period_field_values`, pub.id);
  await db.run(`insert into published_period_tiers (publication_id, company_id, tier, status, footprint, rule_set_version)
     select ?, company_id, tier, status, footprint, rule_set_version from tiers`, pub.id);

  assert.deepEqual(await unpublishedChanges(db, company.id), { revision: 1, fields: [], tier: null },
                   "straight after publishing, nothing differs");

  // The same object with its keys in another order -- how jsonb prints -- is not a change.
  await setLive("sec_registrant", '{"cik": "1649752", "registrant": true}', "extract");
  assert.deepEqual((await unpublishedChanges(db, company.id))!.fields, []);

  // Review accepts a stage and a website, and confirms the auditor the workbook had.
  await setLive("stage_evidence_state", '"complete"', "ai_accepted");
  await setLive("website", '"https://northwind.example"', "ai_accepted");
  await setLive("auditor", '"PwC"', "ai_accepted");
  await db.run(`update tiers set tier = 5, status = 'classified' where company_id = ?`, company.id);

  const changes = await unpublishedChanges(db, company.id);
  assert.deepEqual(changes?.fields, ["Auditor", "Stage evidence", "Website"],
                   "a confirmed value changes its provenance, which the page shows");
  assert.deepEqual(changes?.tier, {
    from: { tier: null, status: "unclassified_no_stage_evidence" },
    to: { tier: 5, status: "classified" },
  });
});
