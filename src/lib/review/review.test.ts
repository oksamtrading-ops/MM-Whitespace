import { test } from "node:test";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import {
  bulkConfirmation, effectiveDecision, evidenceBand, extractedFact, isConflict,
  partitionForBulkAccept, recordDecision, undoLast, type Candidate,
} from "./decide.ts";
import { cellLabel, companyRows, fieldRows, formatValue, IN_BUCKET } from "./queue.ts";

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    companyId: "c1", companyName: "Northco Mining Corp.", fieldKey: "auditor",
    findingId: "f1", findingAttempt: 1,
    proposedValue: "Deloitte", extractValue: null,
    evidenceStrength: 0.9, anchorMode: "exact_normalized", findingState: "proposed",
    sourceCount: 2, alreadyOverridden: false, bulkAcceptableField: true,
    ...over,
  };
}

const OPTS = { threshold: 0.8 };

// -------------------------------------------- what bulk accept must refuse

test("bulk accept takes a clean, well-anchored, above-threshold value", async () => {
  const { accept, refused } = await partitionForBulkAccept("auditor", [candidate()], OPTS);
  assert.equal(accept.length, 1);
  assert.equal(refused.length, 0);
});

test("REFUSED: fees, at any evidence level", async () => {
  // The guarantee is that a fee cites a filing. A threshold is not a citation
  // check. bulk_acceptable is a column on the catalogue, so this is data.
  const fee = candidate({
    fieldKey: "audit_fee", bulkAcceptableField: false, evidenceStrength: 1.0,
  });
  const { accept, refused } = await partitionForBulkAccept("audit_fee", [fee], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /not a citation check/);
});

test("REFUSED: an extract-versus-AI conflict, however confident", async () => {
  const conflict = candidate({
    extractValue: "KPMG", proposedValue: "Deloitte", evidenceStrength: 0.99,
  });
  const { accept, refused } = await partitionForBulkAccept("auditor", [conflict], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /a conflict is a decision, not a threshold/);
});

test("REFUSED: an already-overridden value", async () => {
  // Overrides are never overwritten, and this is where that would break.
  const { accept, refused } = await partitionForBulkAccept(
    "auditor", [candidate({ alreadyOverridden: true })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /never overwritten/);
});

test("REFUSED: stage flags without a typed per-session opt-in", async () => {
  const stage = candidate({ fieldKey: "stage_evidence_state" });
  const without = partitionForBulkAccept("stage_evidence_state", [stage], OPTS);
  assert.equal(without.accept.length, 0);
  assert.match(without.refused[0].reason, /typed opt-in/);

  const withOptIn = partitionForBulkAccept(
    "stage_evidence_state", [stage], { ...OPTS, stageOptIn: true });
  assert.equal(withOptIn.accept.length, 1, "the opt-in is a gate, not a prohibition");
});

test("REFUSED: anything with zero sources", async () => {
  // A confident answer with no source is a hallucination with good posture.
  const { accept, refused } = await partitionForBulkAccept(
    "auditor", [candidate({ sourceCount: 0, evidenceStrength: 1.0 })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /hallucination/);
});

test("REFUSED: anything the anchoring gate quarantined", async () => {
  for (const c of [
    candidate({ findingState: "anchor_mismatch", anchorMode: "label_only" }),
    candidate({ findingState: "unsupported", anchorMode: "none" }),
    candidate({ findingState: "proposed", anchorMode: "label_only" }),
  ]) {
    const { accept, refused } = await partitionForBulkAccept("auditor", [c], OPTS);
    assert.equal(accept.length, 0, `${c.findingState}/${c.anchorMode} must be refused`);
    assert.match(refused[0].reason, /did not verify/);
  }
});

test("REFUSED: anything below the threshold", async () => {
  const { accept, refused } = await partitionForBulkAccept(
    "auditor", [candidate({ evidenceStrength: 0.79 })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /below 0.8/);
});

test("REFUSED: bulk accept can never span fields", async () => {
  // There is no accept-everything control anywhere in the product.
  assert.throws(
    () => partitionForBulkAccept("auditor", [candidate({ fieldKey: "website" })], OPTS),
    /no accept-everything control/);
});

test("the confirmation names the count, the field, the threshold and that it undoes", async () => {
  const text = bulkConfirmation("Auditor", 187, 0.8, 12);
  assert.match(text, /187/);
  assert.match(text, /Auditor/);
  assert.match(text, /0\.8/);
  assert.match(text, /undoable/);
  assert.match(text, /12 values are excluded/);
});

test("a conflict needs both sides to assert something", async () => {
  assert.equal(isConflict(candidate({ extractValue: null, proposedValue: "X" })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: null })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: "X" })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: "Y" })), true);
});

// ------------------------------------------------------ decisions are rows

async function seeded() {
  const db = await memorySql();
  await db.run("insert into periods (label, market_cap_as_of) values ('P1','2026-05-31')");
  const period = await db.get("select id from periods") as { id: string };
  await db.run("insert into companies (canonical_name, name_normalized) values ('Northco','northco')");
  const company = await db.get("select id from companies") as { id: string };
  return { db, periodId: period.id, companyId:(await company).id };
}

test("a flag without a reason is refused, and an override without a value", async () => {
  const { db, periodId, companyId } = await seeded();
  await assert.rejects(
() => recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "flag" }), /requires a one-line reason/);
  await assert.rejects(() => recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override" }), /requires a value/);
});

test("UNDO IS AN INSERT, not a delete", async () => {
  const { db, periodId, companyId } = await seeded();
  await recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override",
    overrideValue: "KPMG", actorId: null });

  const before = await db.get("select count(*) n from review_decisions") as { n: number };
  const undone = await undoLast(db, periodId, "auditor", null);
  const after = await db.get("select count(*) n from review_decisions") as { n: number };

  assert.ok(undone);
  assert.equal(after.n, before.n + 1, "undo adds a row rather than removing one");
  // The original decision is still on the record; the trail is append-only.
  const original = await db.get("select decision from review_decisions where id = ?",undone!.undone) as
    { decision: string };
  assert.equal(original.decision, "override");
  assert.equal(await effectiveDecision(db, periodId, companyId, "auditor"), undefined,
    "an undone decision no longer stands");
});

test("undo walks back one decision at a time", async () => {
  const { db, periodId, companyId } = await seeded();
  await recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "accept" });
  await recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue: "PwC" });

  assert.equal((await effectiveDecision(db, periodId, companyId, "auditor"))?.decision, "override");
  await undoLast(db, periodId, "auditor", null);
  assert.equal((await effectiveDecision(db, periodId, companyId, "auditor"))?.decision, "accept",
    "undoing the override leaves the earlier accept standing");
  await undoLast(db, periodId, "auditor", null);
  assert.equal(await effectiveDecision(db, periodId, companyId, "auditor"), undefined);
  assert.equal(await undoLast(db, periodId, "auditor", null), null, "nothing left to undo");
});

test("a decision binds to the finding attempt it judged", async () => {
  // Without this an override silently re-binds to a later proposal and the
  // trail no longer records what the Analyst actually saw.
  const { db, periodId, companyId } = await seeded();
  await recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override",
    overrideValue: "KPMG", findingAttempt: 2 });
  assert.equal((await effectiveDecision(db, periodId, companyId, "auditor"))?.finding_attempt, 2);
});

test("an override lands as manual_override, which a re-import cannot overwrite", async () => {
  const { db, periodId, companyId } = await seeded();
  await recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue: "KPMG" });
  const row = await db.get(`select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'auditor'`, periodId, companyId) as { value: string; source: string };
  assert.equal(row.source, "manual_override");
  assert.equal(JSON.parse(row.value), "KPMG");
});

// ------------------------------------------------------------ presentation

test("evidence has four ordinal bands, so it is never colour alone", async () => {
  assert.equal(evidenceBand(0.1), "low");
  assert.equal(evidenceBand(0.45), "medium");
  assert.equal(evidenceBand(0.7), "high");
  assert.equal(evidenceBand(0.95), "very high");
  assert.equal(evidenceBand(null), "low");
});

test("a cell's accessible name carries value, evidence band and review state", async () => {
  const row = {
    ...candidate(), decided: false, decision: null, abstained: false,
    band: "high" as const, excerpt: null, sourceUrl: null, documentHash: null,
    conflict: false,
  };
  assert.equal(cellLabel(row, "Auditor"), "Auditor, Deloitte, evidence high, unreviewed");
  assert.equal(
    cellLabel({ ...row, decided: true, decision: "accept" }, "Auditor"),
    "Auditor, Deloitte, evidence high, accept");
  assert.equal(
    cellLabel({ ...row, abstained: true }, "Audit fees"),
    "Audit fees, abstained, evidence high, unreviewed");
});

test("a multi-valued stage renders as its set, not as JSON", async () => {
  assert.equal(
    formatValue({ exploration: true, development: false, production: true }),
    "exploration + production");
  assert.equal(formatValue(null), "no value");
  assert.equal(formatValue("PwC"), "PwC");
});

/* --------------------------------------------------- keeping the extract */

/** A conflict as it actually arrives: the workbook says KPMG, the model says Deloitte. */
async function conflicted() {
  const seed = await seeded();
  const { db, periodId, companyId } = await seed;
  await db.run(`insert into company_period_facts
       (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, 'auditor', 'KPMG', '"KPMG"', 'asserted')`, periodId, companyId);db.run(`insert into company_period_field_values
       (period_id, company_id, field_key, value, source, evidence_state)
     values (?, ?, 'auditor', '"KPMG"', 'extract', 'asserted')`, periodId, companyId);
  return seed;
}

test("the workbook's assertion survives a decision, so it can still be kept", async () => {
  const { db, periodId, companyId } = await conflicted();

  // Accepting the model rewrites the resolved row's source away from 'extract'.
  await recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "accept" });
  const resolved = await db.get(`select source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'auditor'`, periodId, companyId) as { source: string };
  assert.equal(resolved.source, "ai_accepted",
    "which is why the extract cannot be read back from this table");

  // The facts table still holds it, which is what keeps "keep extract"
  // available after an accept and an undo.
  assert.deepEqual(await extractedFact(db, periodId, companyId, "auditor"),
                   { present: true, value: "KPMG" });
});

test("keeping the extract records an override carrying the workbook's value", async () => {
  const { db, periodId, companyId } = await conflicted();
  const fact = await extractedFact(db, periodId, companyId, "auditor");
  await recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue:fact.value });

  const decision = await effectiveDecision(db, periodId, companyId, "auditor");
  assert.equal(decision?.decision, "override",
    "choosing the workbook over the model is an override of the proposal");
  assert.equal(JSON.parse(decision!.override_value!), "KPMG");

  const resolved = await db.get(`select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'auditor'`, periodId, companyId) as { value: string; source: string };
  assert.equal(JSON.parse(resolved.value), "KPMG");
  assert.equal((await resolved).source, "manual_override");
});

test("a value is kept whole, not as the string it was displayed as", async () => {
  const { db, periodId, companyId } = await seeded();
  const regions = { CANADA: ["BC", "ON"], AFRICA: [] };
  await db.run(`insert into company_period_facts
       (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, 'property_regions', 'BC, ON', ?, 'asserted')`, periodId, companyId, JSON.stringify(regions));

  // The client only ever had this formatted for display. The server reads the
  // fact, so what is stored is the structure and not "Canada: BC, ON".
  assert.deepEqual((await extractedFact(db, periodId, companyId, "property_regions")).value, regions);
});

test("there is nothing to keep where the workbook asserts nothing", async () => {
  const { db, periodId, companyId } = await seeded();
  assert.deepEqual(await extractedFact(db, periodId, companyId, "website"),
                   { present: false, value: null });
  // absent_blank asserts that there is no value; it is not a value to keep.
  await db.run(`insert into company_period_facts
       (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, 'website', '', null, 'absent_blank')`, periodId, companyId);
  assert.deepEqual(await extractedFact(db, periodId, companyId, "website"),
                   { present: false, value: null });
});

/* --------------------------- the board's counts and the grid's rows agree */

test("every bucket's count is the number of rows its link opens", async () => {
  // These were two separate expressions and had drifted: "need review"
  // counted the remainder but opened every undecided row, conflicts included.
  const rows: Array<Parameters<typeof IN_BUCKET.conflict>[0]> = [
    // a clean, strong, non-conflicting value: bulk-acceptable
    { conflict: false, findingState: "proposed", anchorMode: "exact_normalized",
      sourceCount: 2, abstained: false, bulkAcceptableField: true,
      evidenceStrength: 0.9, fieldKey: "auditor" },
    // the same, but weak: needs review
    { conflict: false, findingState: "proposed", anchorMode: "exact_normalized",
      sourceCount: 2, abstained: false, bulkAcceptableField: true,
      evidenceStrength: 0.4, fieldKey: "auditor" },
    // disagrees with the workbook: a conflict and nothing else
    { conflict: true, findingState: "proposed", anchorMode: "exact_normalized",
      sourceCount: 2, abstained: false, bulkAcceptableField: true,
      evidenceStrength: 0.9, fieldKey: "auditor" },
    // never anchored: quarantined and nothing else
    { conflict: false, findingState: "proposed", anchorMode: "label_only",
      sourceCount: 2, abstained: false, bulkAcceptableField: true,
      evidenceStrength: 0.9, fieldKey: "auditor" },
    // nothing found at all: no evidence and nothing else
    { conflict: false, findingState: "proposed", anchorMode: "exact_normalized",
      sourceCount: 0, abstained: false, bulkAcceptableField: true,
      evidenceStrength: null, fieldKey: "auditor" },
  ];
  const keys = ["bulkable", "need_review", "conflict", "no_evidence", "quarantined"];
  const counts: Record<string, number> = Object.fromEntries(
    keys.map((k) => [k, rows.filter((r) => IN_BUCKET[k](r, 0.8)).length]));

  // Before the deepEqual: node's assert narrows `counts` to the literal it is
  // compared against, and a string index into that type no longer type-checks.
  const total = keys.reduce((n, k) => n + counts[k], 0);
  assert.equal(total, rows.length, "the buckets partition the undecided rows exactly once");
  assert.deepEqual(counts,
    { bulkable: 1, need_review: 1, conflict: 1, no_evidence: 1, quarantined: 1 });
});

test("a conflict is only ever in the conflict bucket", async () => {
  const conflicted = {
    conflict: true, findingState: "proposed", anchorMode: "exact_normalized",
    sourceCount: 2, abstained: false, bulkAcceptableField: true,
    evidenceStrength: 0.95, fieldKey: "auditor",
  };
  assert.ok(IN_BUCKET.conflict(conflicted, 0.8));
  assert.ok(!IN_BUCKET.need_review(conflicted, 0.8),
    "a conflict opened from 'need review' would be resolved without its diff");
  assert.ok(!IN_BUCKET.bulkable(conflicted, 0.8),
    "and bulk accept must never sweep one up");
});

/* ------------------------------------- the same values, a different axis */

test("company-major and field-major show the same proposals", async () => {
  const { db, periodId, companyId } = await seeded();
  await db.run(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version)
     values (?, 5, 'm', 'v1')`, periodId);
  const run = await db.get("select id from enrichment_runs") as { id: string };
  for (const field of ["auditor", "website"]) {
    await db.run(`insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, ?)`, run.id, companyId, field);
    const job = await db.get("select id from enrichment_jobs order by rowid desc limit 1") as { id: string };
    await db.run(`insert into enrichment_findings
         (run_id, job_id, company_id, field_key, attempt, proposed_value, evidence_strength,
          anchor_mode, state, model, prompt_version)
       values (?, ?, ?, ?, 1, ?, 0.9, 'exact_normalized', 'proposed', 'm', 'v1')`, run.id, job.id, companyId, field,
          JSON.stringify(field === "auditor" ? "KPMG" : "x.example"));
  }

  const { fields, rows } = await companyRows(db, periodId);
  assert.equal(rows.length, 1, "one company, one row");
  assert.equal(rows[0].cells.length, fields.length, "one cell per field, present or not");

  // Every cell is the row the field view would have shown for that pairing.
  for (const [column, field] of fields.entries()) {
    const down = (await fieldRows(db, periodId, field.fieldKey, "all"))
      .find((r) => r.companyId === companyId) ?? null;
    const across = rows[0].cells[column];
    assert.equal(across?.findingId ?? null, down?.findingId ?? null,
      `${field.fieldKey} differs between the two axes`);
    assert.equal(across?.band ?? null, down?.band ?? null);
  }
});
