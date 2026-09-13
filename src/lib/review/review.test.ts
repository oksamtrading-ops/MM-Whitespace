import { test } from "node:test";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import {
  bulkConfirmation, effectiveDecision, evidenceBand, extractedFact, isConflict,
  partitionForBulkAccept, recordDecision, undoLast, type Candidate,
} from "./decide.ts";
import { cellLabel, companyRows, fieldRows, formatValue, IN_BUCKET, queueBuckets } from "./queue.ts";
import { chosenThreshold, DEFAULT_THRESHOLD, THRESHOLDS } from "./threshold.ts";

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
    newerThanDecision: false,
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
  // A value accepted before better research arrived says so out loud, for a
  // reader who has no colour and no badge.
  assert.equal(
    cellLabel({ ...row, decided: true, decision: "accept", newerThanDecision: true }, "Audit fees"),
    "Audit fees, Deloitte, evidence high, accept, newer research since");
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

/*
 * Run 1, twice: a fee was accepted, a later run researched it again and
 * proposed a better value -- with its currency and fiscal year -- and the row
 * appeared in no queue, because "decided" is what every bucket filters out.
 * Both times the new research sat unseen until someone went looking in "All".
 */
type FindingOpts = { state?: string; fieldKey?: string; strength?: number; tier?: number; url?: string };

/** A period with runs and findings a test can lay out proposal by proposal. */
async function researchFixture() {
  const { db, periodId, companyId } = await seeded();
  const run = async (at: string) => {
    await db.run(`insert into enrichment_runs
       (period_id, scope, status, budget_usd, mode, model, prompt_version, created_at)
       values (?, 'all', 'completed', 5, 'live', 'claude-sonnet-5', '1', ?)`, periodId, at);
    const r = await db.get("select id from enrichment_runs order by created_at desc, id desc limit 1") as { id: string };
    await db.run(`insert into enrichment_jobs (run_id, company_id, field_group, state)
       values (?, ?, 'general', 'completed')`, r.id, companyId);
    return r.id;
  };
  const finding = async (runId: string, value: string, at: string, opts: FindingOpts = {}) => {
    const job = await db.get("select id from enrichment_jobs where run_id = ?", runId) as { id: string };
    // returning id, not "the newest row": a test lays proposals out in whatever
    // order it needs, and the newest is not always the one just written.
    const row = await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength, anchor_mode,
        state, evidence_excerpt, model, prompt_version, created_at)
       values (?, ?, 1, ?, ?, ?, ?, 'proximity', ?, 'Audit fees 8,052',
               'claude-sonnet-5', '1', ?) returning id`,
      runId, job.id, companyId, opts.fieldKey ?? "audit_fee", value, opts.strength ?? 0.73,
      opts.state ?? "proposed", at) as { id: string };
    await db.run(`insert into finding_sources (finding_id, url, source_tier) values (?, ?, ?)`,
                 row.id, opts.url ?? "https://x.invalid", opts.tier ?? 1);
    return row.id;
  };
  return { db, periodId, companyId, run, finding };
}

async function acceptedThenResearchedAgain() {
  const { db, periodId, companyId, run, finding } = await researchFixture();
  const first = await finding(await run("2026-09-11 11:00:00"), "8052000", "2026-09-11 11:30:00");
  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "accept",
                             findingId: first, actorId: null });
  // The accept happened when that finding was the only one; the clock matters,
  // so it is set to then rather than to the moment this test runs.
  await db.run("update review_decisions set decided_at = '2026-09-11 12:00:00' where finding_id = ?", first);
  const second = await finding(await run("2026-09-13 00:57:00"),
                               '{"amount": 8052000, "currency": "CAD", "fiscal_year": 2025}',
                               "2026-09-13 00:58:00");
  return { db, periodId, companyId, first, second };
}

test("a value accepted before better research arrived is surfaced, not hidden", async () => {
  const { db, periodId, second } = await acceptedThenResearchedAgain();

  const [row] = await fieldRows(db, periodId, "audit_fee", "all");
  assert.equal(row.findingId, second, "the row offers the newest proposal, not the one accepted");
  assert.equal(row.decided, true);
  assert.equal(row.newerThanDecision, true);

  const superseded = await fieldRows(db, periodId, "audit_fee", "superseded");
  assert.deepEqual(superseded.map((r) => r.findingId), [second]);
  // And it is counted where an Analyst will see it.
  const buckets = await queueBuckets(db, periodId);
  assert.equal(buckets.find((b) => b.key === "superseded")?.count, 1);
  // Accepting again binds the newer finding, which is the whole point.
  await recordDecision(db, { periodId, companyId: row.companyId, fieldKey: "audit_fee",
                             decision: "accept", findingId: second, actorId: null });
  const after = await db.get(`select value from company_period_field_values
      where period_id = ? and field_key = 'audit_fee'`, periodId) as { value: string };
  assert.deepEqual(JSON.parse(after.value), { amount: 8052000, currency: "CAD", fiscal_year: 2025 });
  assert.deepEqual(await fieldRows(db, periodId, "audit_fee", "superseded"), [],
                   "once re-accepted it stops asking");
});

test("where a decision stands, the row offers the NEWEST proposal, not the strongest", async () => {
  // 13 September: two of four corrections never reached the superseded bucket.
  // An older EDGAR proposal outscored the newer one read off the filing, so
  // the older one was picked as "best" -- and it was the finding already
  // decided, which made the row look settled. They had to be overridden by hand.
  const { db, periodId, companyId, run, finding } = await researchFixture();
  const strong = await finding(await run("2026-09-11 11:00:00"), '"Vancouver"',
    "2026-09-11 11:30:00", { fieldKey: "head_office_location", strength: 0.88 });
  await recordDecision(db, { periodId, companyId, fieldKey: "head_office_location",
                             decision: "accept", findingId: strong, actorId: null });
  await db.run("update review_decisions set decided_at = '2026-09-11 12:00:00' where finding_id = ?", strong);
  const newerAndWeaker = await finding(await run("2026-09-13 00:57:00"), '"Toronto"',
    "2026-09-13 00:58:00", { fieldKey: "head_office_location", strength: 0.71 });

  const [row] = await fieldRows(db, periodId, "head_office_location", "all");
  assert.equal(row.findingId, newerAndWeaker, "the weaker, newer correction is the one shown");
  assert.equal(row.newerThanDecision, true);
  assert.deepEqual(
    (await fieldRows(db, periodId, "head_office_location", "superseded")).map((r) => r.findingId),
    [newerAndWeaker], "and it is in the bucket that exists to surface it");
});

test("for a field EDGAR answers from its profile, the issuer's filing wins on source, not on score", async () => {
  // EDGAR's stored address and fiscal year-end go stale while the filings stay
  // current, and EDGAR is fetched fresh every time, so it can outscore the
  // document that is actually right. For these fields the better source wins
  // outright. Elsewhere the arithmetic still decides.
  // One finding per company, field and run, so the two passes are two runs --
  // which is how they are started.
  const { db, periodId, run, finding } = await researchFixture();
  const pass1 = await run("2026-09-13 00:57:00");
  const pass2 = await run("2026-09-13 00:59:00");
  const profile = async (fieldKey: string, strength: number) => finding(pass1, '"Vancouver"',
    "2026-09-13 00:58:00", { fieldKey, strength, tier: 3, url: "https://data.sec.gov/submissions/CIK1.json" });
  const filing = async (fieldKey: string, strength: number) => finding(pass2, '"Toronto"',
    "2026-09-13 01:00:00", { fieldKey, strength, tier: 2, url: "https://firstquantum.invalid/aif.pdf" });

  await profile("head_office_location", 0.88);
  const aif = await filing("head_office_location", 0.71);
  const [office] = await fieldRows(db, periodId, "head_office_location", "all");
  assert.equal(office.findingId, aif, "the AIF outranks the registrant profile");

  await profile("auditor", 0.88);
  const weaker = await filing("auditor", 0.71);
  const [auditor] = await fieldRows(db, periodId, "auditor", "all");
  assert.notEqual(auditor.findingId, weaker, "every other field is still decided by evidence");
});

test("nothing else is called superseded: not an override, not the decided finding itself", async () => {
  const { db, periodId, companyId, second } = await acceptedThenResearchedAgain();
  // An override is a person's own value. A model proposing again is not a
  // reason to ask them twice.
  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "override",
                             overrideValue: { amount: 610628, currency: "CAD", fiscal_year: 2025 },
                             findingId: second, actorId: null });
  assert.deepEqual(await fieldRows(db, periodId, "audit_fee", "superseded"), []);

  // A field decided on its newest finding is settled, and says nothing.
  const { db: db2, periodId: p2, companyId: c2, second: newest } = await acceptedThenResearchedAgain();
  await recordDecision(db2, { periodId: p2, companyId: c2, fieldKey: "audit_fee",
                              decision: "accept", findingId: newest, actorId: null });
  assert.deepEqual(await fieldRows(db2, p2, "audit_fee", "superseded"), []);
});

test("a stage re-proposed unchanged says nothing, and a changed one speaks up", async () => {
  // The stage is stored as "complete" plus its own rows while a proposal is
  // flags, so a naive comparison calls every stage re-run a disagreement.
  const { db, periodId, companyId } = await seeded();
  await db.run(`insert into enrichment_runs
     (period_id, scope, status, budget_usd, mode, model, prompt_version, created_at)
     values (?, 'all', 'completed', 5, 'live', 'm', '1', '2026-09-11 11:00:00')`, periodId);
  const run = await db.get("select id from enrichment_runs limit 1") as { id: string };
  await db.run(`insert into enrichment_jobs (run_id, company_id, field_group, state)
     values (?, ?, 'general', 'completed')`, run.id, companyId);
  const job = await db.get("select id from enrichment_jobs limit 1") as { id: string };
  const stage = async (value: string, at: string, attempt: number) => {
    await db.run(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, state, evidence_excerpt, model, prompt_version, created_at)
       values (?, ?, ?, ?, 'stage_evidence_state', ?, 0.9, 'exact_normalized', 'proposed',
               'an exploration and development company', 'm', '1', ?)`,
      run.id, job.id, attempt, companyId, value, at);
    return (await db.get("select id from enrichment_findings order by created_at desc, id desc limit 1") as { id: string }).id;
  };
  const flags = '{"exploration": true, "development": true, "production": false, "royalty_streaming": false}';
  const first = await stage(flags, "2026-09-11 11:30:00", 1);
  await recordDecision(db, { periodId, companyId, fieldKey: "stage_evidence_state",
                             decision: "accept", findingId: first, actorId: null });
  await db.run("update review_decisions set decided_at = '2026-09-11 12:00:00' where finding_id = ?", first);

  await stage(flags, "2026-09-13 00:58:00", 2);
  assert.deepEqual(await fieldRows(db, periodId, "stage_evidence_state", "superseded"), [],
                   "the same stages again is not a disagreement");

  await stage('{"exploration": true, "development": true, "production": true, "royalty_streaming": false}',
              "2026-09-13 01:00:00", 3);
  const changed = await fieldRows(db, periodId, "stage_evidence_state", "superseded");
  assert.equal(changed.length, 1, "a stage the research now reads differently is worth a second look");
});

test("a re-run that proposes the same value again says nothing", async () => {
  // Run 1's data: re-running pass 2 re-proposed "PwC", "12-31" and "Toronto"
  // for fields already accepted with exactly those values. Flagging identity
  // would have put 29 rows in front of an Analyst, of which a handful
  // actually disagreed with what was stored.
  const { db, periodId, companyId } = await seeded();
  await db.run(`insert into enrichment_runs
     (period_id, scope, status, budget_usd, mode, model, prompt_version, created_at)
     values (?, 'all', 'completed', 5, 'live', 'm', '1', '2026-09-11 11:00:00')`, periodId);
  const run = await db.get("select id from enrichment_runs limit 1") as { id: string };
  await db.run(`insert into enrichment_jobs (run_id, company_id, field_group, state)
     values (?, ?, 'general', 'completed')`, run.id, companyId);
  const job = await db.get("select id from enrichment_jobs limit 1") as { id: string };
  const propose = async (at: string, attempt: number) => {
    await db.run(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, state, evidence_excerpt, model, prompt_version, created_at)
       values (?, ?, ?, ?, 'auditor', '"PwC"', 0.9, 'exact_normalized', 'proposed',
               'the auditors are PwC', 'm', '1', ?)`, run.id, job.id, attempt, companyId, at);
    return (await db.get("select id from enrichment_findings order by created_at desc, id desc limit 1") as { id: string }).id;
  };
  const first = await propose("2026-09-11 11:30:00", 1);
  await recordDecision(db, { periodId, companyId, fieldKey: "auditor", decision: "accept",
                             findingId: first, actorId: null });
  await db.run("update review_decisions set decided_at = '2026-09-11 12:00:00' where finding_id = ?", first);
  await propose("2026-09-13 00:58:00", 2);

  assert.deepEqual(await fieldRows(db, periodId, "auditor", "superseded"), [],
                   "the stored value already says PwC");
});

// --- the bulk accept floor ---------------------------------------------------

test("the floor is the reviewer's to set, within limits", async () => {
  assert.equal(chosenThreshold("0.7"), 0.7);
  assert.equal(chosenThreshold(0.6), 0.6);
  assert.equal(chosenThreshold("0.9"), 0.9);
  // Anything not offered falls back to the default rather than being honoured:
  // a URL is not a place to invent a floor of 0.01.
  for (const bad of ["0", "0.01", "0.55", "-1", "2", "abc", "", undefined, null]) {
    assert.equal(chosenThreshold(bad), DEFAULT_THRESHOLD, String(bad));
  }
  assert.equal(Math.min(...THRESHOLDS), 0.6, "never below 0.60");
  assert.ok(THRESHOLDS.includes(DEFAULT_THRESHOLD), "the default is one of the offered floors");
});

test("a lower floor widens bulk accept and nothing else", async () => {
  // The floor is one condition of seven. Lowering it must not let a fee, a
  // conflict, an unanchored value or a stage flag through.
  const at = (threshold: number, over: Partial<Candidate> = {}) =>
    partitionForBulkAccept(over.fieldKey ?? "auditor", [candidate(over)], { threshold });

  assert.equal((await at(0.8, { evidenceStrength: 0.71 })).accept.length, 0);
  assert.equal((await at(0.7, { evidenceStrength: 0.71 })).accept.length, 1,
               "an anchored value a reviewer would take by hand");

  const refusedAtAnyFloor: Array<[string, Partial<Candidate>]> = [
    ["a fee", { fieldKey: "audit_fee", bulkAcceptableField: false, evidenceStrength: 0.99 }],
    ["a conflict", { extractValue: "KPMG", proposedValue: "Deloitte", evidenceStrength: 0.99 }],
    ["an override", { alreadyOverridden: true, evidenceStrength: 0.99 }],
    ["an unanchored value", { anchorMode: "label_only", findingState: "anchor_mismatch", evidenceStrength: 0.99 }],
    ["a sourceless value", { sourceCount: 0, evidenceStrength: 0.99 }],
    ["a stage", { fieldKey: "stage_evidence_state", evidenceStrength: 0.99 }],
  ];
  for (const [what, over] of refusedAtAnyFloor) {
    const { accept } = await at(0.6, over);
    assert.equal(accept.length, 0, `${what} was accepted at the lowest floor`);
  }
});
