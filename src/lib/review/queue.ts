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
import type { Sql } from "../db/sql.ts";
import { evidenceBand, isConflict, isStageField, type Candidate } from "./decide.ts";

export type QueueBucket = {
  key: string;
  label: string;
  count: number;
  /** Where the design says to start. */
  startHere?: boolean;
  /** The field to open: counts are across fields, the grid shows one field. */
  firstField: string | null;
};

export type FieldSummary = {
  fieldKey: string;
  label: string;
  proposals: number;
  decided: number;
  bulkAcceptable: boolean;
};

export async function reviewableFields(db: Sql, periodId: string): Promise<FieldSummary[]> {
  return (await db.all(`select f.key as fieldKey, f.label,
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
      order by proposals desc`, periodId, periodId)).map((r) => {
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

/**
 * The five buckets, defined once.
 *
 * The board's counts and the rows behind its links came from two separate
 * expressions, and they had drifted: "need review" counted the remainder but
 * opened every undecided row, conflicts included. Every number on the board is
 * a link that opens the grid pre-filtered, so the count and the filter have to
 * be the same statement.
 */
type Bucketable = {
  conflict?: boolean; findingState: string; anchorMode: string; sourceCount: number;
  abstained?: boolean; bulkAcceptableField: boolean; evidenceStrength: number | null;
  fieldKey: string;
};

export const IN_BUCKET: Record<string, (c: Bucketable, threshold: number) => boolean> = {
  quarantined: (c) => c.findingState !== "proposed" ||
                      c.anchorMode === "none" || c.anchorMode === "label_only",
  no_evidence: (c) => c.sourceCount === 0 || Boolean(c.abstained),
  conflict: (c) => Boolean(c.conflict),
  bulkable: (c, t) => !IN_BUCKET.quarantined(c, t) && !IN_BUCKET.no_evidence(c, t) &&
                      !IN_BUCKET.conflict(c, t) &&
                      c.bulkAcceptableField && (c.evidenceStrength ?? 0) >= t &&
                      !isStageField(c.fieldKey),
  need_review: (c, t) => !IN_BUCKET.quarantined(c, t) && !IN_BUCKET.no_evidence(c, t) &&
                         !IN_BUCKET.conflict(c, t) && !IN_BUCKET.bulkable(c, t),
};

export async function queueBuckets(
  db: Sql, periodId: string, threshold = 0.8,
): Promise<QueueBucket[]> {
  const undecided = (await allCandidates(db, periodId))
    .filter((c) => !c.decided)
    .map((c) => ({ ...c, conflict: isConflict(c) }));
  // A count is across fields and the grid shows one field, so each bucket also
  // carries the field to open. Otherwise "need review 7" can land on a field
  // holding none of them.
  const bucket = (key: string, label: string, startHere?: boolean): QueueBucket => {
    const inIt = undecided.filter((c) => IN_BUCKET[key](c, threshold));
    return {
      key, label, count: inIt.length, firstField: inIt[0]?.fieldKey ?? null,
      ...(startHere ? { startHere } : {}),
    };
  };

  return [
    bucket("bulkable", "above threshold — bulk-acceptable"),
    bucket("need_review", "need review"),
    bucket("conflict", "extract disagrees with AI", true),
    bucket("no_evidence", "no evidence found"),
    bucket("quarantined", "quarantined: excerpt did not anchor"),
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

async function allCandidates(db: Sql, periodId: string): Promise<Row[]> {
  const rows = await db.all(`select c.id as companyId, c.canonical_name as companyName,
            e.id as findingId, e.attempt as findingAttempt, e.field_key as fieldKey,
            e.proposed_value as proposedValue, e.evidence_strength as evidenceStrength,
            e.anchor_mode as anchorMode, e.state as findingState,
            e.evidence_excerpt as excerpt, e.abstained as abstained,
            f.bulk_acceptable as bulkAcceptableField,
            (select count(*) from finding_sources s where s.finding_id = e.id) as sourceCount,
            (select s.url from finding_sources s where s.finding_id = e.id limit 1) as sourceUrl,
            e.anchor_document_hash as documentHash,
            -- From the facts table, not the resolved values: a decision
            -- rewrites the resolved row's source away from 'extract', and the
            -- diff would then show the AI's proposal against nothing.
            (select f.typed_value from company_period_facts f
              where f.period_id = ? and f.company_id = c.id and f.field_key = e.field_key
                and f.assertion = 'asserted') as extractValue,
            (select d.decision from review_decisions d
              where d.period_id = ? and d.company_id = c.id and d.field_key = e.field_key
                and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
              order by d.decided_at desc, d.id desc limit 1) as decision
       from enrichment_findings e
       join enrichment_runs r on r.id = e.run_id and r.period_id = ?
       join companies c on c.id = e.company_id
       join field_catalog f on f.key = e.field_key
      where e.state != 'superseded'
      order by e.evidence_strength asc nulls first, c.canonical_name asc`, periodId, periodId, periodId) as Array<Record<string, unknown>>;

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
export async function fieldRows(
  db: Sql, periodId: string, fieldKey: string, bucket?: string, threshold = 0.8,
): Promise<Row[]> {
  const all = (await allCandidates(db, periodId)).filter((r) => r.fieldKey === fieldKey);
  if (!bucket || bucket === "all") return all;

  const undecided = all.filter((r) => !r.decided);
  const predicate = IN_BUCKET[bucket];
  // An unknown bucket shows everything undecided rather than nothing: a bad
  // link in a shared URL should not read as an empty queue.
  return predicate ? undecided.filter((r) => predicate(r, threshold)) : undecided;
}

export type CompanyRow = {
  companyId: string;
  companyName: string;
  /** One per field, in the order the fields are given. null = nothing proposed. */
  cells: Array<Row | null>;
};

/**
 * The same proposals, pivoted.
 *
 * docs/design/08: "Both read the same resolved values; only the axis differs."
 * So this is built from fieldRows rather than from its own query — a second
 * query would be a second definition of what is reviewable, and the two would
 * disagree the first time either changed.
 */
export async function companyRows(
  db: Sql, periodId: string, threshold = 0.8,
): Promise<{ fields: FieldSummary[]; rows: CompanyRow[] }> {
  const fields = await reviewableFields(db, periodId);
  const byCompany = new Map<string, CompanyRow>();

  // Sequential rather than mapped: the column index is the field's position,
  // so the loop carries it, and one connection does the work either way.
  for (const [column, field] of fields.entries()) {
    for (const row of await fieldRows(db, periodId, field.fieldKey, "all", threshold)) {
      let entry = byCompany.get(row.companyId);
      if (!entry) {
        entry = {
          companyId: row.companyId, companyName: row.companyName,
          cells: new Array(fields.length).fill(null),
        };
        byCompany.set(row.companyId, entry);
      }
      entry.cells[column] = row;
    }
  }

  const rows = [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
  return { fields, rows };
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
  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    // The two structured researched fields read as sentences, not as the
    // keys that happen to be true -- "registrant" alone drops the form.
    if ("registrant" in o) {
      return o.registrant
        ? `SEC registrant${o.form ? `, files ${o.form}` : ""}${o.cik ? ` (CIK ${o.cik})` : ""}`
        : "not an SEC registrant";
    }
    if ("changed" in o) {
      return o.changed
        ? `changed${o.date ? ` ${o.date}` : ""}${o.previous_auditor ? ` from ${o.previous_auditor}` : ""}`
        : "no change in 24 months";
    }
  }
  if (typeof value === "object") {
    const on = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, " "));
    if (on.length) return on.join(" + ");
    return JSON.stringify(value);
  }
  return String(value);
}

/** Stage is the only field that moves tier, so the consequence is shown live. */
export async function tierConsequence(
  db: Sql, periodId: string, row: Row,
): Promise<string | null> {
  if (!isStageField(row.fieldKey)) return null;
  const current = await db.get("select tier, status from tiers where period_id = ? and company_id = ?", periodId, row.companyId) as { tier: number | null; status: string } | undefined;
  if (!current) return null;
  const from = current.tier === null ? "Unclassified" : `Tier ${current.tier}`;
  return `Accepting re-runs the classifier for ${row.companyName}, currently ${from}.`;
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}
