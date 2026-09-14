/**
 * Decisions, and what bulk accept must refuse.
 *
 * Decisions are ROWS, never mutations. Undo is therefore an insert, not a
 * delete, and the trail records what the Analyst actually saw -- which is what
 * `finding_attempt` is for: without it an override silently re-binds to a later
 * proposal.
 *
 * See docs/design/08-review-workspace.md.
 */
import { decisionStamp } from "../db/stamp.ts";
import type { Sql } from "../db/sql.ts";
import { preserveExtract, resolveAfterDecision } from "./resolve.ts";

export type DecisionKind = "accept" | "override" | "flag" | "undo";

/** Four ordinal bands. Evidence is never encoded in colour alone. */
export type EvidenceBand = "low" | "medium" | "high" | "very high";

export function evidenceBand(strength: number | null): EvidenceBand {
  if (strength === null || strength < 0.4) return "low";
  if (strength < 0.6) return "medium";
  if (strength < 0.8) return "high";
  return "very high";
}

export type Candidate = {
  companyId: string;
  companyName: string;
  fieldKey: string;
  findingId: string | null;
  findingAttempt: number | null;
  proposedValue: unknown;
  extractValue: unknown;
  evidenceStrength: number | null;
  anchorMode: string;
  findingState: string;
  sourceCount: number;
  alreadyOverridden: boolean;
  /** The catalogue says whether the field may ever be bulk-accepted. */
  bulkAcceptableField: boolean;
};

export type Refusal = { companyId: string; reason: string };

export type BulkOptions = {
  threshold: number;
  /** Stage determines tier and tier is the deliverable, so it needs a typed opt-in. */
  stageOptIn?: boolean;
};

/**
 * The seven refusals, as a pure function over one field's candidates.
 *
 * Bulk accept is ALWAYS scoped to one field in one filtered view. There is no
 * accept-everything control anywhere in the product, which is why this takes a
 * single fieldKey and throws if the candidates disagree.
 */
export function partitionForBulkAccept(
  fieldKey: string, candidates: readonly Candidate[], opts: BulkOptions,
): { accept: Candidate[]; refused: Refusal[] } {
  for (const c of candidates) {
    if (c.fieldKey !== fieldKey) {
      throw new Error(
        `bulk accept is scoped to one field; got ${c.fieldKey} among ${fieldKey}. ` +
        "There is no accept-everything control in this product.",
      );
    }
  }

  const accept: Candidate[] = [];
  const refused: Refusal[] = [];
  const refuse = (c: Candidate, reason: string) => refused.push({ companyId: c.companyId, reason });

  for (const c of candidates) {
    // 1. Fees, at any evidence level. The guarantee is that a fee cites a
    //    filing, and a threshold is not a citation check. This reads the
    //    catalogue, so the exclusion is data rather than a special case here.
    if (!c.bulkAcceptableField) {
      refuse(c, "this field is not bulk-acceptable; a threshold is not a citation check");
      continue;
    }
    // 2. Any extract-versus-AI conflict. High confidence in a wrong answer is
    //    exactly the failure this would create.
    if (isConflict(c)) {
      refuse(c, "the extract and the proposal disagree; a conflict is a decision, not a threshold");
      continue;
    }
    // 3. Any already-overridden value. Overrides are never overwritten, and
    //    this is precisely where that invariant would break.
    if (c.alreadyOverridden) {
      refuse(c, "already overridden; an override is never overwritten");
      continue;
    }
    // 4. Stage flags, without a per-session typed opt-in.
    if (isStageField(fieldKey) && !opts.stageOptIn) {
      refuse(c, "stage determines tier; bulk accept needs a typed opt-in for this session");
      continue;
    }
    // 5. Anything with zero sources. A confident answer with no source is a
    //    hallucination with good posture.
    if (c.sourceCount === 0) {
      refuse(c, "no sources; a confident answer with no source is a hallucination");
      continue;
    }
    // 6. Anything quarantined by the anchoring gate.
    if (c.findingState !== "proposed" ||
        c.anchorMode === "none" || c.anchorMode === "label_only") {
      refuse(c, `not anchored (${c.findingState}/${c.anchorMode}); its excerpt did not verify`);
      continue;
    }
    // 7. Below the threshold for this run.
    if ((c.evidenceStrength ?? 0) < opts.threshold) {
      refuse(c, `evidence ${(c.evidenceStrength ?? 0).toFixed(3)} is below ${opts.threshold}`);
      continue;
    }
    accept.push(c);
  }
  return { accept, refused };
}

export function isStageField(fieldKey: string): boolean {
  return fieldKey === "stage_evidence_state" || fieldKey.startsWith("stage_");
}

/** The extract says one thing and the proposal another, and both assert a value. */
export function isConflict(c: Candidate): boolean {
  if (c.extractValue === null || c.extractValue === undefined) return false;
  if (c.proposedValue === null || c.proposedValue === undefined) return false;
  return JSON.stringify(c.extractValue) !== JSON.stringify(c.proposedValue);
}

/**
 * What the workbook asserted, read from the immutable fact table.
 *
 * NOT from company_period_field_values: that holds one row per field and the
 * first accept or override rewrites its source away from 'extract', so the
 * extract's value is gone from it the moment anyone decides anything. Keeping
 * the extract has to stay possible after an accept and an undo, and the facts
 * table is the only place the workbook's own assertion survives.
 */
export async function extractedFact(
  db: Sql, periodId: string, companyId: string, fieldKey: string,
): Promise<{ present: boolean; value: unknown }> {
  const row = await db.get(`select typed_value, assertion from company_period_facts
      where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, fieldKey) as
    { typed_value: string | null; assertion: string } | undefined;
  if (!row || row.assertion !== "asserted" || row.typed_value === null) {
    return { present: false, value: null };
  }
  try { return { present: true, value: JSON.parse(row.typed_value) }; }
  catch { return { present: true, value: row.typed_value }; }
}

export type RecordOptions = {
  periodId: string;
  companyId: string;
  fieldKey: string;
  decision: DecisionKind;
  overrideValue?: unknown;
  reason?: string | null;
  findingId?: string | null;
  findingAttempt?: number | null;
  actorId?: string | null;
  bulk?: boolean;
  undoesId?: string | null;
};

export async function recordDecision(db: Sql, opts: RecordOptions): Promise<string> {
  if (opts.decision === "flag" && !opts.reason?.trim()) {
    throw new Error("a flag requires a one-line reason");
  }
  if (opts.decision === "override" && opts.overrideValue === undefined) {
    throw new Error("an override requires a value");
  }
  // Before anything displaces the file's value, keep it: it is what undo restores.
  if (opts.decision === "accept" || opts.decision === "override") {
    await preserveExtract(db, opts.periodId, opts.companyId, opts.fieldKey);
  }
  // seq is the order, and it is read from the table rather than from this
  // process: decisionStamp()'s high-water mark is a module-level variable, so
  // two serverless instances can issue the same microsecond. Inside a
  // transaction this sees the rows already written by it, so a bulk accept
  // numbers itself; between two concurrent transactions the unique index
  // refuses the second rather than letting both claim the same place.
  const row = await db.get(`insert into review_decisions
       (period_id, company_id, field_key, decision, override_value, reason,
        finding_id, finding_attempt, actor_id, bulk, undoes_id, decided_at, seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             (select coalesce(max(seq), 0) + 1 from review_decisions))
     returning id`, opts.periodId, opts.companyId, opts.fieldKey, opts.decision,
        opts.overrideValue === undefined ? null : JSON.stringify(opts.overrideValue),
        opts.reason ?? null, opts.findingId ?? null, opts.findingAttempt ?? null,
        opts.actorId ?? null, Boolean(opts.bulk), opts.undoesId ?? null,
        decisionStamp()) as { id: string };

  // The resolved value follows the decisions standing on the field -- an
  // accept, an override, or, once those are undone, the file's own value --
  // and the tier follows the value. The conditional upsert in commit.ts still
  // protects every non-extract value from a later import.
  if (opts.decision !== "flag") {
    const target = opts.decision === "undo"
      ? await db.get("select company_id, field_key from review_decisions where id = ?", opts.undoesId ?? "") as
          { company_id: string; field_key: string } | undefined
      : { company_id: opts.companyId, field_key: opts.fieldKey };
    if (target) {
      await resolveAfterDecision(db, opts.periodId, target.company_id, target.field_key, opts.actorId ?? null);
    }
  }
  return row.id;
}

/** Undo is an INSERT, because decisions are rows. */
export async function undoLast(
  db: Sql, periodId: string, fieldKey: string, actorId: string | null,
): Promise<{ undone: string; companyId: string } | null> {
  // Ordered by seq, which is the order the rows were written in (0025). This
  // used to be (decided_at, id), where the tiebreak was a random uuid -- so
  // two decisions sharing a microsecond across instances resolved
  // consistently but arbitrarily, and undo could walk back the wrong one.
  const last = await db.get(`select d.id, d.company_id, d.decision from review_decisions d
      where d.period_id = ? and d.field_key = ? and d.decision != 'undo'
        and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
      order by d.seq desc limit 1`, periodId, fieldKey) as { id: string; company_id: string } | undefined;
  if (!last) return null;

  await recordDecision(db, {
    periodId, companyId: last.company_id, fieldKey,
    decision: "undo", undoesId: last.id, actorId,
    reason: "undo",
  });
  return { undone: last.id, companyId: last.company_id };
}

/** The decision standing for a company and field, ignoring undone ones. */
export async function effectiveDecision(
  db: Sql, periodId: string, companyId: string, fieldKey: string,
) {
  return await db.get(`select d.id, d.decision, d.override_value, d.reason, d.finding_attempt, d.bulk
       from review_decisions d
      where d.period_id = ? and d.company_id = ? and d.field_key = ?
        and d.decision != 'undo'
        and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
      order by d.seq desc limit 1`, periodId, companyId, fieldKey) as
    { id: string; decision: DecisionKind; override_value: string | null;
      reason: string | null; finding_attempt: number | null; bulk: number } | undefined;
}

/**
 * What the confirmation dialog must say. It names the count, the field and the
 * threshold, states that it is undoable, and is the only path -- there is no
 * suppress-this-dialog option.
 */
export function bulkConfirmation(
  fieldLabel: string, count: number, threshold: number, refusedCount: number,
): string {
  return (
    `Accept ${count} ${fieldLabel} value${count === 1 ? "" : "s"} at evidence ` +
    `${threshold} or above? ` +
    (refusedCount > 0
      ? `${refusedCount} value${refusedCount === 1 ? " is" : "s are"} excluded and stay ` +
        `for individual review. `
      : "") +
    "This is undoable."
  );
}
