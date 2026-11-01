import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { memorySql } from "../db/open.ts";
import { storeDocument } from "./worker.ts";
import { recheckUnsupported } from "./recheck.ts";
import { evaluateGate } from "../publish/gate.ts";

const CIRCULAR = "Appointment of Auditor. Brightwater & Company LLP, Chartered Professional Accountants, " +
  "is the current auditor of the Company. KPMG LLP, the Company’s former auditor, resigned effective " +
  "August 8, 2018.";
const POSITION = `CONSOLIDATED STATEMENTS OF FINANCIAL POSITION
(Expressed in Canadian dollars)
                              2023            2022
Cash                     1,204,551       2,330,118
Mineral properties      13,772,809      11,473,911
                        14,977,360      13,804,029`;

/** Findings stored before 1 November 2026, as the gate then judged them. */
async function stored() {
  const db = memorySql();
  await db.run("insert into periods (label, market_cap_as_of) values ('Q4-2026', '2026-08-31')");
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  await db.run("insert into companies (canonical_name, name_normalized) values ('Northco Mining Corp.', 'northco')");
  const companyId = (await db.get("select id from companies") as { id: string }).id;
  const run = await db.get(`insert into enrichment_runs (period_id, scope, status, budget_usd, mode, model, prompt_version)
      values (?, 'all', 'completed', 5, 'live', 'm', '1') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };

  const doc = (text: string) => storeDocument(db, {
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    url: "https://northco.invalid/filing.pdf", finalUrl: "https://northco.invalid/filing.pdf",
    retrievedAt: "2026-10-20 10:00:00", extractor: "pdf", extractorVersion: "1", normalizationVersion: "1",
    text, charCount: text.length, pageCount: 1, charsPerPage: text.length,
    sourceTier: 2, docType: "pdf", hasTextLayer: true,
  } as Parameters<typeof storeDocument>[1]);
  const circular = await doc(CIRCULAR);
  const position = await doc(POSITION);

  let attempt = 0;
  const finding = async (fieldKey: string, value: unknown, excerpt: string, documentHash: string,
                         state = "unsupported", scale: string | null = null) =>
    (await db.get(`insert into enrichment_findings
        (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength, anchor_mode,
         anchor_document_hash, state, evidence_excerpt, scale_token, model, prompt_version)
        values (?, ?, ?, ?, ?, ?, 0.3, 'none', ?, ?, ?, ?, 'm', '1') returning id`,
      run.id, job.id, ++attempt, companyId, fieldKey, JSON.stringify(value), documentHash, state, excerpt, scale,
    ) as { id: string }).id;

  return {
    db, periodId,
    apostrophe: await finding("auditor", "KPMG LLP", "KPMG LLP, the Company\\\"s former auditor, resigned", circular),
    invented: await finding("auditor_since", 2011, "first appointed as auditor of the Company on June 1, 2011", circular),
    total: await finding("total_assets", { amount: 14_977_360, currency: "CAD", fiscal_year: 2023 },
                         "14,977,360", position, "unsupported", "units"),
    proposed: await finding("head_office_region", "British Columbia",
                            "Brightwater & Company LLP, Chartered Professional Accountants", circular, "proposed"),
  };
}

const states = async (db: ReturnType<typeof memorySql>) => Object.fromEntries(
  (await db.all("select id, state from enrichment_findings") as Array<{ id: string; state: string }>)
    .map((r) => [r.id, r.state]));

test("Q4 2026: the stored unsupported findings are checked again, and only the found ones move", async () => {
  const { db, apostrophe, invented, total, proposed } = await stored();

  const dry = await recheckUnsupported(db, { dryRun: true });
  assert.equal(dry.checked, 3, "only what is unsupported is read");
  assert.deepEqual(dry.held.map((h) => [h.findingId, h.inexact]).sort(),
                   [[apostrophe, "punctuation"], [total, "unlabelled"]].sort());
  assert.equal((await states(db))[apostrophe], "unsupported", "a dry run writes nothing");

  const wet = await recheckUnsupported(db);
  assert.equal(wet.held.length, 2);
  assert.deepEqual(await states(db), {
    [apostrophe]: "anchor_mismatch", [total]: "anchor_mismatch",
    [invented]: "unsupported", [proposed]: "proposed",
  }, "held for a person, never proposed; the invented one stays counted");

  const row = await db.get("select anchor_mode, anchor_start, anchor_end from enrichment_findings where id = ?",
                           apostrophe) as { anchor_mode: string; anchor_start: number; anchor_end: number };
  assert.equal(row.anchor_mode, "none", "nothing anchors, and the grid still says so");
  assert.ok(row.anchor_end > row.anchor_start);

  const audit = await db.all("select detail from audit_log where event = 'finding_rechecked'") as Array<{ detail: string }>;
  assert.deepEqual(audit.map((a) => JSON.parse(a.detail).finding_id).sort(), [apostrophe, total].sort());
  assert.match(JSON.parse(audit[0].detail).reason, /\w/, "each move says why");

  const again = await recheckUnsupported(db);
  assert.deepEqual([again.checked, again.held.length], [1, 0], "running it again moves nothing new");
});

test("Q4 2026: what moves no longer counts against the publish ceiling", async () => {
  const { db, periodId } = await stored();
  const rate = async () => {
    const b = (await evaluateGate(db, periodId)).blockers.find((b) => b.kind === "hallucination_rate");
    return b && "rate" in b ? b.rate : 0;
  };
  assert.equal(await rate(), 3 / 4);
  await recheckUnsupported(db);
  assert.equal(await rate(), 1 / 4, "the invented one is still counted");
});
