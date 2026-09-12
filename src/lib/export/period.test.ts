import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { exportFilename, exportPayload, exportWorkbook } from "./period.ts";

const hasPython = spawnSync("python3", ["-c", "import openpyxl"]).status === 0;

/** Two periods: a published one to compare against, and the one being exported. */
async function seeded(): Promise<{ db: Sql; periodId: string; northco: string }> {
  const db = memorySql();
  await db.run(`insert into periods (label, market_cap_as_of, rule_set_version, status, source_file_sha256)
     values ('Q2-2026 (2026-03-31)', '2026-03-31', '1.0.0', 'published', 'abc')`);
  await db.run(`insert into periods (label, market_cap_as_of, rule_set_version, source_file_sha256)
     values ('Q3-2026 (2026-06-30)', '2026-06-30', '1.0.0', 'deadbeef')`);
  const prior = await db.get("select id from periods where label like 'Q2%'") as { id: string };
  const period = await db.get("select id from periods where label like 'Q3%'") as { id: string };

  for (const [name, norm] of [["Northco Mining Corp.", "northco mining corp"],
                              ["Southco Resources Ltd.", "southco resources ltd"],
                              ["Oldco Merged Inc.", "oldco merged inc"]]) {
    await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id)
       values (?, ?, ?)`, name, norm, period.id);
  }
  const northco = (await db.get("select id from companies where name_normalized = 'northco mining corp'") as { id: string }).id;
  const southco = (await db.get("select id from companies where name_normalized = 'southco resources ltd'") as { id: string }).id;
  const merged = (await db.get("select id from companies where name_normalized = 'oldco merged inc'") as { id: string }).id;
  await db.run("update companies set status = 'merged' where id = ?", merged);

  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
     values (?, ?, 5, 'classified', 'canada_only', '1.0.0')`, period.id, northco);
  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
     values (?, ?, null, 'unclassified_no_stage_evidence', 'none', '1.0.0')`, period.id, southco);
  // Last period Northco was a tier 4; the export's PY Tier column reads this.
  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
     values (?, ?, 4, 'classified', 'canada_only', '1.0.0')`, prior.id, northco);

  const value = async (company: string, key: string, json: string) =>
    await db.run(`insert into company_period_field_values
       (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, ?, ?, 'extract', 'asserted')`, period.id, company, key, json);
  await value(northco, "root_ticker", '"NRTH"');
  await value(northco, "exchange", '"TSX"');
  await value(northco, "market_cap_cad", "888608691");
  await value(northco, "auditor", '"PwC"');
  await value(northco, "website", '"https://northco.invalid"');
  await value(northco, "property_regions", '{"CANADA": ["QC"], "USA": []}');
  await value(northco, "audit_fee", '{"amount": 353190, "currency": "CAD", "fiscal_year": 2025}');

  await db.run(`insert into company_period_stages (period_id, company_id, stage) values (?, ?, 'exploration')`,
               period.id, northco);
  await db.run(`insert into company_period_stages (period_id, company_id, stage) values (?, ?, 'development')`,
               period.id, northco);
  await db.run(`insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'SP-42', '2026-01-01', 'extract')`, northco);
  // Two rules, the second of which fired: the export comments the tier with it.
  await db.run(`insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
     values (?, ?, 0, 'guard_no_stage_evidence', '{"stageEvidence":"complete"}', false)`, period.id, northco);
  await db.run(`insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
     values (?, ?, 1, 'rule_5_development', '{"footprint":"canada_only"}', true)`, period.id, northco);
  return { db, periodId: period.id, northco };
}

test("the payload carries what the template needs, in one pass over the period", async () => {
  const { db } = await seeded();
  const payload = await exportPayload(db);

  assert.equal(payload.period.label, "Q3-2026 (2026-06-30)", "the latest period, not the prior one");
  assert.equal(payload.provenance.prior_period, "Q2-2026 (2026-03-31)");
  assert.equal(payload.provenance.source_file_sha256, "deadbeef");

  assert.deepEqual(payload.companies.map((c) => c.name),
                   ["Northco Mining Corp.", "Southco Resources Ltd."],
                   "a merged duplicate is not a company, and is not exported");

  const northco = payload.companies[0];
  assert.equal(northco.tier, 5);
  assert.equal(northco.prior_tier, 4, "the PY Tier column comes from the prior published period");
  assert.equal(northco.entity_id, "SP-42");
  assert.deepEqual([...northco.stages].sort(), ["development", "exploration"]);
  assert.equal(northco.trace?.rule_id, "rule_5_development", "the rule that fired, not the first rule");
  // Values arrive parsed, not as the JSON text the column holds.
  assert.equal(northco.values.market_cap_cad, 888608691);
  assert.equal(northco.values.auditor, "PwC");
  assert.deepEqual(northco.values.property_regions, { CANADA: ["QC"], USA: [] });
  assert.deepEqual(northco.values.audit_fee, { amount: 353190, currency: "CAD", fiscal_year: 2025 });

  const southco = payload.companies[1];
  assert.equal(southco.tier, null);
  assert.equal(southco.prior_tier, null, "a company with no prior tier says so rather than guessing");
  assert.equal(southco.trace, null);
});

test("the filename names the period, not the file it came from", async () => {
  assert.equal(exportFilename("Q3-2026 (2026-06-30)", "xlsx"), "MM Whitespace Q3-2026.xlsx");
  assert.equal(exportFilename("Q3-2026", "csv"), "MM Whitespace Q3-2026.csv");
  assert.equal(exportFilename('bad"name;', "xlsx"), "MM Whitespace bad-name-.xlsx",
               "nothing that could end the content-disposition header early");
});

test("the workbook is built, and it is a workbook", { skip: !hasPython }, async () => {
  const { db } = await seeded();
  const file = await exportWorkbook(db);
  assert.equal(file.filename, "MM Whitespace Q3-2026.xlsx");
  assert.match(file.contentType, /spreadsheetml/);
  assert.equal(file.bytes.subarray(0, 2).toString("latin1"), "PK", "an .xlsx is a zip");
  assert.ok(file.bytes.byteLength > 5_000, `only ${file.bytes.byteLength} bytes`);
  // What is IN the workbook is checked in Python, where openpyxl can open it
  // (tests/test_export_service.py); a zip's bytes say nothing from here.

  const csv = await exportWorkbook(db, { format: "csv" });
  assert.equal(csv.filename, "MM Whitespace Q3-2026.csv");
  const text = csv.bytes.toString("utf8");
  assert.match(text, /^# .*internal use/im, "the licence notices lead the file");
  assert.match(text, /Northco Mining Corp\./);
});
