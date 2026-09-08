/**
 * The triage board and the field-major grid.
 *
 * 259 companies by roughly ten enriched fields is about 2,590 decisions per
 * period. A company-by-field grid charges the Analyst a context switch on every
 * cell; judging one field DOWN A COLUMN reuses a single mental model, which is
 * the difference between a two-hour review and a two-day one -- and a two-day
 * review means the period never gets published, which is the bottleneck this
 * product exists to remove.
 *
 * So the Analyst lands on a triage board and picks a batch. They never face
 * 2,590 undifferentiated cells.
 */
import { DatabaseSync } from "node:sqlite";
import { evidenceBand, isConflict, isStageField, type Candidate } from "./decide.ts";

export type QueueBucket = {
  key: string;
  label: string;
  count: number;
  /** Where the design says to start. */
  startHere?: boolean;
};

export type FieldSummary = {
  fieldKey: string;
  label: string;
  proposals: number;
  decided: number;
  bulkAcceptable: boolean;
};

export function reviewableFields(db: DatabaseSync, periodId: string): FieldSummary[] {
  return db.prepare(
    `select f.key as fieldKey, f.label,
            count(distinct e.company_id) as proposals,
            f.bulk_acceptable as bulkAcceptable,
            (select count(distinct d.company_id) from review_decisions d
              where d.period_id = ? and d.field_key = f.key and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
            ) as decided
       from field_catalog f
       join enrichment_findings e on e.field_key = f.key
       join enrichment_runs r on r.id = e.run_id and r.period_id = ?
      group by f.key
      order by proposals desc`,
  ).all(periodId, periodId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      fieldKey: String(row.fieldKey),
      label: String(row.label),
      proposals: Number(row.proposals),
      decided: Number(row.decided),
      bulkAcceptable: Number(row.bulkAcceptable) === 1,
    };
  });
}

/** Every number on the board is a link that opens the grid pre-filtered. */
export function queueBuckets(
  db: DatabaseSync, periodId: string, threshold = 0.8,
): QueueBucket[] {
  const rows = allCandidates(db, periodId);
  const undecided = rows.filter((c) => !c.decided);

  const quarantined = undecided.filter(
    (c) => c.findingState !== "proposed" ||
           c.anchorMode === "none" || c.anchorMode === "label_only");
  const noEvidence = undecided.filter((c) => c.sourceCount === 0 || c.abstained);
  const conflicts = undecided.filter((c) => isConflict(c));
  const rest = undecided.filter(
    (c) => !quarantined.includes(c) && !noEvidence.includes(c) && !conflicts.includes(c));
  const bulkable = rest.filter(
    (c) => c.bulkAcceptableField && (c.evidenceStrength ?? 0) >= threshold &&
           !(isStageField(c.fieldKey)));
  const needReview = rest.filter((c) => !bulkable.includes(c));

  return [
    { key: "bulkable", label: `above threshold — bulk-acceptable`, count: bulkable.length },
    { key: "need_review", label: "need review", count: needReview.length },
    { key: "conflict", label: "extract disagrees with AI", count: conflicts.length, startHere: true },
    { key: "no_evidence", label: "no evidence found", count: noEvidence.length },
    { key: "quarantined", label: "quarantined: excerpt did not anchor", count: quarantined.length },
  ];
}

export type Row = Candidate & {
  decided: boolean;
  decision: string | null;
  abstained: boolean;
  band: ReturnType<typeof evidenceBand>;
  excerpt: string | null;
  sourceUrl: string | null;
  documentHash: string | null;
  conflict: boolean;
};

function allCandidates(db: DatabaseSync, periodId: string): Row[] {
  const rows = db.prepare(
    `select c.id as companyId, c.canonical_name as companyName,
            e.id as findingId, e.attempt as findingAttempt, e.field_key as fieldKey,
            e.proposed_value as proposedValue, e.evidence_strength as evidenceStrength,
            e.anchor_mode as anchorMode, e.state as findingState,
            e.evidence_excerpt as excerpt, e.abstained as abstained,
            f.bulk_acceptable as bulkAcceptableField,
            (select count(*) from finding_sources s where s.finding_id = e.id) as sourceCount,
            (select s.url from finding_sources s where s.finding_id = e.id limit 1) as sourceUrl,
            e.anchor_document_hash as documentHash,
            (select v.value from company_period_field_values v
              where v.period_id = ? and v.company_id = c.id and v.field_key = e.field_key
                and v.source = 'extract') as extractValue,
            (select d.decision from review_decisions d
              where d.period_id = ? and d.company_id = c.id and d.field_key = e.field_key
                and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
              order by d.decided_at desc, d.rowid desc limit 1) as decision
       from enrichment_findings e
       join enrichment_runs r on r.id = e.run_id and r.period_id = ?
       join companies c on c.id = e.company_id
       join field_catalog f on f.key = e.field_key
      where e.state != 'superseded'
      order by e.evidence_strength asc nulls first, c.canonical_name asc`,
  ).all(periodId, periodId, periodId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const proposedValue = r.proposedValue ? safeParse(String(r.proposedValue)) : null;
    const extractValue = r.extractValue ? safeParse(String(r.extractValue)) : null;
    const decision = r.decision ? String(r.decision) : null;
    const candidate: Row = {
      companyId: String(r.companyId),
      companyName: String(r.companyName),
      fieldKey: String(r.fieldKey),
      findingId: r.findingId ? String(r.findingId) : null,
      findingAttempt: r.findingAttempt === null ? null : Number(r.findingAttempt),
      proposedValue,
      extractValue,
      evidenceStrength: r.evidenceStrength === null ? null : Number(r.evidenceStrength),
      anchorMode: String(r.anchorMode),
      findingState: String(r.findingState),
      sourceCount: Number(r.sourceCount),
      alreadyOverridden: decision === "override",
      bulkAcceptableField: Number(r.bulkAcceptableField) === 1,
      decided: decision !== null,
      decision,
      abstained: Number(r.abstained) === 1,
      band: evidenceBand(r.evidenceStrength === null ? null : Number(r.evidenceStrength)),
      excerpt: r.excerpt ? String(r.excerpt) : null,
      sourceUrl: r.sourceUrl ? String(r.sourceUrl) : null,
      documentHash: r.documentHash ? String(r.documentHash) : null,
      conflict: false,
    };
    candidate.conflict = isConflict(candidate);
    return candidate;
  });
}

/** Field-major, sorted by evidence ASCENDING so the worst work comes first. */
export function fieldRows(
  db: DatabaseSync, periodId: string, fieldKey: string, bucket?: string, threshold = 0.8,
): Row[] {
  const all = allCandidates(db, periodId).filter((r) => r.fieldKey === fieldKey);
  if (!bucket || bucket === "all") return all;

  const undecided = all.filter((r) => !r.decided);
  switch (bucket) {
    case "conflict":
      return undecided.filter((r) => r.conflict);
    case "quarantined":
      return undecided.filter(
        (r) => r.findingState !== "proposed" ||
               r.anchorMode === "none" || r.anchorMode === "label_only");
    case "no_evidence":
      return undecided.filter((r) => r.sourceCount === 0 || r.abstained);
    case "bulkable":
      return undecided.filter(
        (r) => r.bulkAcceptableField && (r.evidenceStrength ?? 0) >= threshold &&
               !r.conflict && r.findingState === "proposed" && r.sourceCount > 0 &&
               !isStageField(r.fieldKey));
    default:
      return undecided;
  }
}

/**
 * The accessible name for one cell: value, evidence band and review state.
 * "Auditor, PwC, evidence high, unreviewed" -- rather than leaving state to a
 * colour wash.
 */
export function cellLabel(row: Row, fieldLabel: string): string {
  const value = row.abstained
    ? "abstained"
    : formatValue(row.proposedValue);
  const state = row.decided ? row.decision! : "unreviewed";
  return `${fieldLabel}, ${value}, evidence ${row.band}, ${state}`;
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "no value";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const on = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, " "));
    if (on.length) return on.join(" + ");
    return JSON.stringify(value);
  }
  return String(value);
}

/** Stage is the only field that moves tier, so the consequence is shown live. */
export function tierConsequence(
  db: DatabaseSync, periodId: string, row: Row,
): string | null {
  if (!isStageField(row.fieldKey)) return null;
  const current = db.prepare(
    "select tier, status from tiers where period_id = ? and company_id = ?",
  ).get(periodId, row.companyId) as { tier: number | null; status: string } | undefined;
  if (!current) return null;
  const from = current.tier === null ? "Unclassified" : `Tier ${current.tier}`;
  return `Accepting re-runs the classifier for ${row.companyName}, currently ${from}.`;
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}
