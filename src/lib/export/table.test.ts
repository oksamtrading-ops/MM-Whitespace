import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { memorySql } from "../db/open.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod } from "../publish/snapshot.ts";
import { listCompanies } from "../profile/company.ts";
import { exportTable, reportFilename, safeUrl, tableFilename, tablePayload } from "./table.ts";

const hasPython = spawnSync("python3", ["-c", "import openpyxl"]).status === 0;

function company(name: string, over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: name.slice(0, 4).toUpperCase(), exchange: "TSX", name, ordinal: 1,
    market_cap: 5_000_000_000,
    stages: ["royalty_streaming"], stage_evidence: "complete", property_evidence: "none",
    regions: {}, region_provenance: {},
    commodities: ["Gold"], venture_graduate: false,
    auditor: "PwC", auditor_class: null, entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada only", dtt_market: "Ontario",
    ...over,
  } as ParsedCompany;
}

async function published() {
  const db = memorySql();
  await commitPeriod(db, {
    period: "2026-05-31",
    companies: [company("Northco Royalties Inc."), company("Southco Streams Ltd.", { auditor: "Deloitte", ordinal: 2 })],
  }, { label: "Q3-2026 (2026-05-31)" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  await publishPeriod(db, periodId, { overrideReason: "test" });
  return { db, periodId };
}

test("the Deloitte market never reaches a row, so it can never reach the file", async () => {
  const { db } = await published();
  const rows = await listCompanies(db, { allowDraft: false });
  for (const r of rows) {
    assert.ok(!("dtt_market" in r.sources), "an internal field's provenance is dropped too");
    assert.ok(!r.meta.some((m) => m.field === "dtt_market"));
  }
  const payload = tablePayload({ rows, total: rows.length, filterWords: "Every company in the period",
                                 basis: { label: "Q3-2026 (2026-05-31)", revision: 1 } });
  assert.doesNotMatch(JSON.stringify(payload), /Ontario|Deloitte market|dtt_market/);
});

test("commodities reach the table and the export as a column of their own", async () => {
  const { db } = await published();
  const rows = await listCompanies(db, { allowDraft: false });
  assert.deepEqual(rows[0].commodities, ["Gold"], "read from the published revision");
  assert.ok(!rows[0].meta.some((m) => m.field === "commodities"), "a column, so not a hidden detail");
  const payload = tablePayload({ rows, total: rows.length, filterWords: "Every company in the period",
                                 basis: { label: "Q3-2026 (2026-05-31)", revision: 1 } });
  const keys = payload.columns.map((c) => c.key);
  assert.ok(keys.indexOf("commodities") === keys.indexOf("footprint") + 1, "beside footprint, as on screen");
  assert.equal(payload.columns.filter((c) => c.label === "Commodities").length, 1, "once, not again as a detail");
  assert.equal((payload.rows[0] as Record<string, unknown>).commodities, "Gold");
});

test("a link is written only for a cited value, and only if it is http(s)", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl(" https://ok.example/a "), "https://ok.example/a");
  const row = {
    companyId: "c1", name: "Northco", ticker: "N", exchange: "TSX", tier: 4, status: "classified", footprint: "none",
    auditor: "PwC", marketCap: 1, hqRegion: "Ontario, Canada", hqCity: null,
    commodities: ["Gold"],
    auditFee: { amount: 10, currency: "CAD", fiscal_year: 2025 }, taxFee: null,
    stages: [], stageEvidence: "complete" as const,
    regions: {}, meta: [], sources: { audit_fee: "ai_accepted", auditor: "extract", head_office_region: "manual_override" },
  };
  const payload = tablePayload({
    rows: [row], total: 1, filterWords: "x", basis: { label: "P", revision: 9 },
    cite: (_c, field) => ({
      kind: "k", title: "t", retrieved: null, quote: "q",
      url: field === "audit_fee" ? "https://doc.example/circ.pdf" : "javascript:alert(1)",
    }),
  });
  assert.deepEqual(payload.rows[0].links, { audit_fee: "https://doc.example/circ.pdf" },
                   "the workbook auditor is not cited as research; the javascript: address is not a link");
  assert.deepEqual(payload.sources.map((s) => s.field).sort(), ["Audit fees", "Company HQ"]);
  assert.equal(payload.period.basis, "Published revision 9 of P");
});

test("a draft says it is a draft", () => {
  const p = tablePayload({ rows: [], total: 0, filterWords: "x", basis: { label: "P", revision: null } });
  assert.match(p.period.basis, /^Draft of P — not published/);
  assert.equal(tableFilename("Q3-2026 (2026-05-31)", "csv"), "Mining & Metals Marketplace Assessment Tool Q3-2026 companies.csv");
});

test("the file holds exactly the rows the same URL shows on screen", { skip: !hasPython }, async () => {
  const { db } = await published();
  const file = await exportTable(db, { allowDraft: false, format: "csv", params: new URLSearchParams("auditor=Deloitte") });
  const text = file.bytes.toString("utf8");
  assert.equal(file.rows, 1);
  assert.match(text, /# Filter: Auditor: Deloitte/);
  assert.match(text, /# Rows: 1 of 2/);
  assert.match(text, /artificial intelligence/);
  assert.match(text, /Southco Streams/);
  assert.doesNotMatch(text, /Northco Royalties/);
  assert.match(text, /Royalty \/ streaming,.*X/, "the frozen stage rows reach the file");
  assert.doesNotMatch(text, /Ontario/, "and the Deloitte market does not");
});

test("the tax fee is a column of the file, and a column hidden on screen is left out of it", () => {
  const row = {
    companyId: "c1", name: "Northco", ticker: "N", exchange: "TSX", tier: 4, status: "classified", footprint: "none",
    auditor: "PwC", marketCap: 1, hqRegion: "Ontario, Canada", hqCity: null, commodities: ["Gold"],
    auditFee: { amount: 10, currency: "CAD", fiscal_year: 2025 }, taxFee: { amount: 3, currency: "CAD", fiscal_year: 2025 },
    stages: [], stageEvidence: "complete" as const, regions: {}, meta: [], sources: {},
  };
  const all = tablePayload({ rows: [row], total: 1, filterWords: "x", basis: { label: "P", revision: 9 } });
  const keys = all.columns.map((c) => c.key);
  assert.ok(keys.includes("tax_fee"));
  assert.equal(all.columns.find((c) => c.key === "tax_fee")?.label, "Tax fees paid to audit firm");
  assert.deepEqual((all.rows[0] as Record<string, unknown>).tax_fee, { amount: 3, currency: "CAD", fiscal_year: 2025 });

  const some = tablePayload({ rows: [row], total: 1, filterWords: "x", basis: { label: "P", revision: 9 },
                              cols: ["marketCap", "tier", "stage", "footprint", "commodities", "hq", "auditor", "auditFee"] });
  const left = some.columns.map((c) => c.key);
  for (const gone of ["ticker", "exchange", "exploration", "development", "production", "royalty_streaming", "tax_fee"]) {
    assert.ok(!left.includes(gone), `${gone} is still in the file`);
  }
  assert.ok(left.includes("name") && left.includes("audit_fee") && left.includes("market_cap"));
});

test("a report's file is named for the report, safely", () => {
  assert.equal(reportFilename("Gold producers", "Q4-2026 (2026-08-29)", "xlsx"), "Gold producers (Q4-2026).xlsx");
  assert.equal(reportFilename("Ont/Qué \"tier 2\"", "Q4-2026", "csv"), "Ont-Que -tier 2- (Q4-2026).csv");
  assert.equal(reportFilename("Québec gold — Côte d’Ivoire", "Q4-2026", "csv"), "Quebec gold - Cote d-Ivoire (Q4-2026).csv");
  assert.equal(reportFilename("金矿", "Q4-2026", "xlsx"), "Report (Q4-2026).xlsx");
  assert.equal(reportFilename("   ", "Q4-2026", "xlsx"), "Report (Q4-2026).xlsx");
});

test("a saved report downloads as a file named for it, with its filter and hidden columns", { skip: !hasPython }, async () => {
  const { db } = await published();
  const file = await exportTable(db, {
    allowDraft: false, format: "xlsx", report: { name: "Deloitte audits" },
    params: new URLSearchParams("auditor=Deloitte&hide=ticker&report=00000000-0000-4000-8000-000000000000"),
  });
  assert.match(file.filename, /^Deloitte audits \(.+\)\.xlsx$/);
  assert.equal(file.rows, 1);
  assert.match(file.filterWords, /^Report “Deloitte audits” · Auditor: Deloitte$/);
  assert.equal(file.bytes.subarray(0, 2).toString("latin1"), "PK", "a workbook");
  const csv = await exportTable(db, { allowDraft: false, format: "csv", params: new URLSearchParams("hide=ticker&hide=taxFee") });
  const header = csv.bytes.toString("utf8").split("\n").find((l) => l.startsWith("Company"));
  assert.ok(header && !/Ticker|Exchange|Tax fees/.test(header), header ?? "no header");
  assert.match(header ?? "", /Audit fees/);
});

test("a picked column is a column of the file, written as the screen writes it, and only once", () => {
  const row = {
    companyId: "c1", name: "Northco", ticker: "N", exchange: "TSX", tier: 4, status: "classified", footprint: "none",
    auditor: "PwC", marketCap: 1, hqRegion: "Ontario, Canada", hqCity: null, commodities: ["Gold"],
    auditFee: null, taxFee: null, stages: [], stageEvidence: "complete" as const, regions: { CANADA: ["ON"] },
    sources: {},
    meta: [{ field: "total_assets", label: "Total assets", text: "C$5 (FY2025)" },
           { field: "website", label: "Website", text: "https://northco.example" },
           { field: "incumbent_erp", label: "Incumbent ERP", text: "SAP" }],
    more: { total_assets: { amount: 5, currency: "CAD", fiscal_year: 2025 }, website: "https://northco.example",
            venture_graduate: true, auditor_since: 2011 },
  };
  const plain = tablePayload({ rows: [row], total: 1, filterWords: "x", basis: { label: "P", revision: 9 } });
  const plainKeys = plain.columns.map((c) => c.key);
  assert.ok(!plainKeys.includes("total_assets"), "not picked: not a column of its own");
  assert.ok(plainKeys.includes("meta:total_assets"), "but the value still rides along at the end, as it always has");

  const picked = tablePayload({ rows: [row], total: 1, filterWords: "x", basis: { label: "P", revision: 9 },
                                cols: ["ticker", "website", "props", "venture", "totalAssets", "auditorSince"] });
  const cols = picked.columns;
  const keys = cols.map((c) => c.key);
  for (const k of ["website", "property_regions", "venture_graduate", "total_assets", "auditor_since"]) {
    assert.ok(keys.includes(k), `${k} is not in the file`);
  }
  assert.equal(cols.find((c) => c.key === "total_assets")?.kind, "fee", "an amount with its currency and year");
  assert.ok(!keys.includes("meta:total_assets") && !keys.includes("meta:website"), "a picked value is written once");
  assert.ok(keys.includes("meta:incumbent_erp"), "values with no column still ride along");
  const cells = picked.rows[0] as Record<string, unknown>;
  assert.deepEqual(cells.total_assets, { amount: 5, currency: "CAD", fiscal_year: 2025 });
  assert.equal(cells.website, "https://northco.example", "the address, not its host");
  assert.equal(cells.venture_graduate, "Yes");
  assert.equal(cells.auditor_since, "2011");
  assert.equal(cells.property_regions, "Canada: ON");
  assert.ok(!keys.includes("market_cap"), "a column not picked is left out");
});

test("an old download link with hide= exports the columns it always did", { skip: !hasPython }, async () => {
  const { db } = await published();
  const csv = await exportTable(db, { allowDraft: false, format: "csv", params: new URLSearchParams("hide=ticker") });
  const header = csv.bytes.toString("utf8").split("\n").find((l) => l.startsWith("Company")) ?? "";
  assert.match(header, /^Company,Market cap \(CAD\),Tier,/, header);
  assert.match(header, /Auditor,Audit fees — currency,.*Tax fees paid to audit firm — fiscal year,/,
               "the columns it always had, in their order");
  assert.doesNotMatch(header, /Ticker|Exchange|Revenue|Total assets|Website,/, "and no new column appeared");
  const picked = await exportTable(db, { allowDraft: false, format: "csv",
                                         params: new URLSearchParams("cols=totalAssets&cols=revenue") });
  const head2 = picked.bytes.toString("utf8").split("\n").find((l) => l.startsWith("Company")) ?? "";
  assert.match(head2, /^Company,Revenue — currency,Revenue — amount,Revenue — fiscal year,Total assets — currency,/, head2);
});
