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
import { DatabaseSync } from "node:sqlite";

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

export function recordDecision(db: DatabaseSync, opts: RecordOptions): string {
  if (opts.decision === "flag" && !opts.reason?.trim()) {
    throw new Error("a flag requires a one-line reason");
  }
  if (opts.decision === "override" && opts.overrideValue === undefined) {
    throw new Error("an override requires a value");
  }
  db.prepare(
    `insert into review_decisions
       (period_id, company_id, field_key, decision, override_value, reason,
        finding_id, finding_attempt, actor_id, bulk, undoes_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(opts.periodId, opts.companyId, opts.fieldKey, opts.decision,
        opts.overrideValue === undefined ? null : JSON.stringify(opts.overrideValue),
        opts.reason ?? null, opts.findingId ?? null, opts.findingAttempt ?? null,
        opts.actorId ?? null, opts.bulk ? 1 : 0, opts.undoesId ?? null);

  const row = db.prepare(
    "select id from review_decisions order by rowid desc limit 1").get() as { id: string };

  // An accepted or overridden value is promoted into the resolved-value table,
  // where the conditional upsert protects it from any later extract import.
  if (opts.decision === "accept" || opts.decision === "override") {
    const value = opts.decision === "override"
      ? JSON.stringify(opts.overrideValue)
      : (db.prepare("select proposed_value v from enrichment_findings where id = ?")
          .get(opts.findingId ?? "") as { v: string } | undefined)?.v ?? null;
    db.prepare(
      `insert into company_period_field_values as v
         (period_id, company_id, field_key, value, source, evidence_state, actor_id)
       values (?, ?, ?, ?, ?, 'asserted', ?)
       on conflict (period_id, company_id, field_key) do update
         set value = excluded.value, source = excluded.source,
             evidence_state = excluded.evidence_state, actor_id = excluded.actor_id,
             decided_at = (datetime('now'))
         where v.frozen_at is null`,
    ).run(opts.periodId, opts.companyId, opts.fieldKey, value,
          opts.decision === "override" ? "manual_override" : "ai_accepted",
          opts.actorId ?? null);
  }
  return row.id;
}

/** Undo is an INSERT, because decisions are rows. */
export function undoLast(
  db: DatabaseSync, periodId: string, fieldKey: string, actorId: string | null,
): { undone: string; companyId: string } | null {
  const last = db.prepare(
    `select d.id, d.company_id, d.decision from review_decisions d
      where d.period_id = ? and d.field_key = ? and d.decision != 'undo'
        and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
      order by d.decided_at desc, d.rowid desc limit 1`,
  ).get(periodId, fieldKey) as { id: string; company_id: string } | undefined;
  if (!last) return null;

  recordDecision(db, {
    periodId, companyId: last.company_id, fieldKey,
    decision: "undo", undoesId: last.id, actorId,
    reason: "undo",
  });
  return { undone: last.id, companyId: last.company_id };
}

/** The decision standing for a company and field, ignoring undone ones. */
export function effectiveDecision(
  db: DatabaseSync, periodId: string, companyId: string, fieldKey: string,
) {
  return db.prepare(
    `select d.id, d.decision, d.override_value, d.reason, d.finding_attempt, d.bulk
       from review_decisions d
      where d.period_id = ? and d.company_id = ? and d.field_key = ?
        and d.decision != 'undo'
        and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
      order by d.decided_at desc, d.rowid desc limit 1`,
  ).get(periodId, companyId, fieldKey) as
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
