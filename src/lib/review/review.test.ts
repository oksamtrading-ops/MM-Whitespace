import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import {
  bulkConfirmation, effectiveDecision, evidenceBand, isConflict,
  partitionForBulkAccept, recordDecision, undoLast, type Candidate,
} from "./decide.ts";
import { cellLabel, formatValue } from "./queue.ts";

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

test("bulk accept takes a clean, well-anchored, above-threshold value", () => {
  const { accept, refused } = partitionForBulkAccept("auditor", [candidate()], OPTS);
  assert.equal(accept.length, 1);
  assert.equal(refused.length, 0);
});

test("REFUSED: fees, at any evidence level", () => {
  // The guarantee is that a fee cites a filing. A threshold is not a citation
  // check. bulk_acceptable is a column on the catalogue, so this is data.
  const fee = candidate({
    fieldKey: "audit_fee", bulkAcceptableField: false, evidenceStrength: 1.0,
  });
  const { accept, refused } = partitionForBulkAccept("audit_fee", [fee], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /not a citation check/);
});

test("REFUSED: an extract-versus-AI conflict, however confident", () => {
  const conflict = candidate({
    extractValue: "KPMG", proposedValue: "Deloitte", evidenceStrength: 0.99,
  });
  const { accept, refused } = partitionForBulkAccept("auditor", [conflict], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /a conflict is a decision, not a threshold/);
});

test("REFUSED: an already-overridden value", () => {
  // Overrides are never overwritten, and this is where that would break.
  const { accept, refused } = partitionForBulkAccept(
    "auditor", [candidate({ alreadyOverridden: true })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /never overwritten/);
});

test("REFUSED: stage flags without a typed per-session opt-in", () => {
  const stage = candidate({ fieldKey: "stage_evidence_state" });
  const without = partitionForBulkAccept("stage_evidence_state", [stage], OPTS);
  assert.equal(without.accept.length, 0);
  assert.match(without.refused[0].reason, /typed opt-in/);

  const withOptIn = partitionForBulkAccept(
    "stage_evidence_state", [stage], { ...OPTS, stageOptIn: true });
  assert.equal(withOptIn.accept.length, 1, "the opt-in is a gate, not a prohibition");
});

test("REFUSED: anything with zero sources", () => {
  // A confident answer with no source is a hallucination with good posture.
  const { accept, refused } = partitionForBulkAccept(
    "auditor", [candidate({ sourceCount: 0, evidenceStrength: 1.0 })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /hallucination/);
});

test("REFUSED: anything the anchoring gate quarantined", () => {
  for (const c of [
    candidate({ findingState: "anchor_mismatch", anchorMode: "label_only" }),
    candidate({ findingState: "unsupported", anchorMode: "none" }),
    candidate({ findingState: "proposed", anchorMode: "label_only" }),
  ]) {
    const { accept, refused } = partitionForBulkAccept("auditor", [c], OPTS);
    assert.equal(accept.length, 0, `${c.findingState}/${c.anchorMode} must be refused`);
    assert.match(refused[0].reason, /did not verify/);
  }
});

test("REFUSED: anything below the threshold", () => {
  const { accept, refused } = partitionForBulkAccept(
    "auditor", [candidate({ evidenceStrength: 0.79 })], OPTS);
  assert.equal(accept.length, 0);
  assert.match(refused[0].reason, /below 0.8/);
});

test("REFUSED: bulk accept can never span fields", () => {
  // There is no accept-everything control anywhere in the product.
  assert.throws(
    () => partitionForBulkAccept("auditor", [candidate({ fieldKey: "website" })], OPTS),
    /no accept-everything control/);
});

test("the confirmation names the count, the field, the threshold and that it undoes", () => {
  const text = bulkConfirmation("Auditor", 187, 0.8, 12);
  assert.match(text, /187/);
  assert.match(text, /Auditor/);
  assert.match(text, /0\.8/);
  assert.match(text, /undoable/);
  assert.match(text, /12 values are excluded/);
});

test("a conflict needs both sides to assert something", () => {
  assert.equal(isConflict(candidate({ extractValue: null, proposedValue: "X" })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: null })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: "X" })), false);
  assert.equal(isConflict(candidate({ extractValue: "X", proposedValue: "Y" })), true);
});

// ------------------------------------------------------ decisions are rows

function seeded() {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  db.prepare("insert into periods (label, market_cap_as_of) values ('P1','2026-05-31')").run();
  const period = db.prepare("select id from periods").get() as { id: string };
  db.prepare("insert into companies (canonical_name, name_normalized) values ('Northco','northco')")
    .run();
  const company = db.prepare("select id from companies").get() as { id: string };
  return { db, periodId: period.id, companyId: company.id };
}

test("a flag without a reason is refused, and an override without a value", () => {
  const { db, periodId, companyId } = seeded();
  assert.throws(() => recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "flag" }), /requires a one-line reason/);
  assert.throws(() => recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override" }), /requires a value/);
});

test("UNDO IS AN INSERT, not a delete", () => {
  const { db, periodId, companyId } = seeded();
  recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override",
    overrideValue: "KPMG", actorId: null });

  const before = db.prepare("select count(*) n from review_decisions").get() as { n: number };
  const undone = undoLast(db, periodId, "auditor", null);
  const after = db.prepare("select count(*) n from review_decisions").get() as { n: number };

  assert.ok(undone);
  assert.equal(after.n, before.n + 1, "undo adds a row rather than removing one");
  // The original decision is still on the record; the trail is append-only.
  const original = db.prepare(
    "select decision from review_decisions where id = ?").get(undone!.undone) as
    { decision: string };
  assert.equal(original.decision, "override");
  assert.equal(effectiveDecision(db, periodId, companyId, "auditor"), undefined,
    "an undone decision no longer stands");
});

test("undo walks back one decision at a time", () => {
  const { db, periodId, companyId } = seeded();
  recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "accept" });
  recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue: "PwC" });

  assert.equal(effectiveDecision(db, periodId, companyId, "auditor")?.decision, "override");
  undoLast(db, periodId, "auditor", null);
  assert.equal(effectiveDecision(db, periodId, companyId, "auditor")?.decision, "accept",
    "undoing the override leaves the earlier accept standing");
  undoLast(db, periodId, "auditor", null);
  assert.equal(effectiveDecision(db, periodId, companyId, "auditor"), undefined);
  assert.equal(undoLast(db, periodId, "auditor", null), null, "nothing left to undo");
});

test("a decision binds to the finding attempt it judged", () => {
  // Without this an override silently re-binds to a later proposal and the
  // trail no longer records what the Analyst actually saw.
  const { db, periodId, companyId } = seeded();
  recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override",
    overrideValue: "KPMG", findingAttempt: 2 });
  assert.equal(effectiveDecision(db, periodId, companyId, "auditor")?.finding_attempt, 2);
});

test("an override lands as manual_override, which a re-import cannot overwrite", () => {
  const { db, periodId, companyId } = seeded();
  recordDecision(db, {
    periodId, companyId, fieldKey: "auditor", decision: "override", overrideValue: "KPMG" });
  const row = db.prepare(
    `select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'auditor'`,
  ).get(periodId, companyId) as { value: string; source: string };
  assert.equal(row.source, "manual_override");
  assert.equal(JSON.parse(row.value), "KPMG");
});

// ------------------------------------------------------------ presentation

test("evidence has four ordinal bands, so it is never colour alone", () => {
  assert.equal(evidenceBand(0.1), "low");
  assert.equal(evidenceBand(0.45), "medium");
  assert.equal(evidenceBand(0.7), "high");
  assert.equal(evidenceBand(0.95), "very high");
  assert.equal(evidenceBand(null), "low");
});

test("a cell's accessible name carries value, evidence band and review state", () => {
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

test("a multi-valued stage renders as its set, not as JSON", () => {
  assert.equal(
    formatValue({ exploration: true, development: false, production: true }),
    "exploration + production");
  assert.equal(formatValue(null), "no value");
  assert.equal(formatValue("PwC"), "PwC");
});
