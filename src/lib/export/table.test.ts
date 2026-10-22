import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { memorySql } from "../db/open.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod } from "../publish/snapshot.ts";
import { listCompanies } from "../profile/company.ts";
import { exportTable, safeUrl, tableFilename, tablePayload } from "./table.ts";

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
    auditor: "PwC", marketCap: 1, hqRegion: "Ontario, Canada", hqCity: null, erp: null, erpChange: null,
    commodities: ["Gold"],
    auditFee: { amount: 10, currency: "CAD", fiscal_year: 2025 }, stages: [], stageEvidence: "complete" as const,
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
  assert.equal(tableFilename("Q3-2026 (2026-05-31)", "csv"), "Market Assessment Tool Q3-2026 companies.csv");
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
