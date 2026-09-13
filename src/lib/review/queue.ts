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
import { formatFieldValue } from "../format/fields.ts";
import type { Sql } from "../db/sql.ts";
import { evidenceBand, isConflict, isStageField, type Candidate } from "./decide.ts";
import { EDGAR_PROFILE_FIELDS } from "../enrich/sources.ts";

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
  return (await db.all(`select f.key as "fieldKey", f.label,
            count(distinct e.company_id) as proposals,
            f.bulk_acceptable as "bulkAcceptable",
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
  fieldKey: string; newerThanDecision?: boolean;
};

/** The one bucket that holds DECIDED rows, and so is counted apart. */
export const SUPERSEDED = "superseded";

/**
 * Does this proposal say something other than what the field holds?
 *
 * The stage is the one field whose stored form is not the proposal's form: a
 * proposal is flags, and what is stored is an evidence state ("complete")
 * beside rows in company_period_stages. Comparing those two directly answers
 * "different" for every stage on every re-run.
 */
function differs(fieldKey: string, proposed: unknown, resolved: unknown, stages: string[]): boolean {
  if (isStageField(fieldKey)) {
    const flags = proposed && typeof proposed === "object" ? proposed as Record<string, unknown> : null;
    if (!flags) return false;
    const proposedStages = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k);
    return canonical([...proposedStages].sort()) !== canonical([...stages].sort());
  }
  return canonical(proposed) !== canonical(resolved);
}

/** A value as comparable text, key order and all, for "is this the same value". */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(value) ?? null);
}

/**
 * Which stamp is later, whatever shape the engine returns them in: SQLite
 * writes "2026-09-13 00:57:19", Postgres "2026-09-13 00:57:19.54+00". Both
 * sides of a comparison come from the same engine, so one reading of both is
 * enough; an unparseable pair falls back to text order rather than claiming
 * "not newer", which would hide the row this exists to surface.
 */
function isAfter(later: unknown, earlier: unknown): boolean {
  if (later === null || later === undefined || earlier === null || earlier === undefined) return false;
  const at = (v: unknown) => Date.parse(String(v).replace(" ", "T"));
  const a = at(later); const b = at(earlier);
  return Number.isNaN(a) || Number.isNaN(b) ? String(later) > String(earlier) : a > b;
}

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
  // Decided, and overtaken since. Every other bucket is about undecided rows.
  [SUPERSEDED]: (c) => Boolean(c.newerThanDecision),
};

export async function queueBuckets(
  db: Sql, periodId: string, threshold = 0.8,
): Promise<QueueBucket[]> {
  const candidates = (await allCandidates(db, periodId))
    .map((c) => ({ ...c, conflict: isConflict(c) }));
  const undecided = candidates.filter((c) => !c.decided);
  // A count is across fields and the grid shows one field, so each bucket also
  // carries the field to open. Otherwise "need review 7" can land on a field
  // holding none of them.
  const bucket = (key: string, label: string, startHere?: boolean): QueueBucket => {
    const from = key === SUPERSEDED ? candidates : undecided;
    const inIt = from.filter((c) => IN_BUCKET[key](c, threshold));
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
    bucket(SUPERSEDED, "accepted, then researched again"),
  ];
}

export type Row = Candidate & {
  decided: boolean;
  decision: string | null;
  /**
   * An accepted value that later research DISAGREES with: a run after the
   * decision proposed something different from what is stored. Run 1 hit it
   * twice -- fees accepted without a currency, then re-researched with one,
   * and the row stayed out of every queue because it counted as decided.
   *
   * Two narrowings, or this is noise rather than a signal. A re-run that
   * proposes the same value again says nothing, so the comparison is against
   * the RESOLVED value, not against the finding's identity: on Run 1's data
   * the unfiltered version flagged 29 rows, of which most were "PwC" again.
   * And an override is never flagged: a person chose that value deliberately,
   * and a model proposing against it is not a reason to ask them twice.
   */
  newerThanDecision: boolean;
  abstained: boolean;
  band: ReturnType<typeof evidenceBand>;
  excerpt: string | null;
  sourceUrl: string | null;
  documentHash: string | null;
  conflict: boolean;
};

async function allCandidates(db: Sql, periodId: string): Promise<Row[]> {
  const rows = await db.all(`select c.id as "companyId", c.canonical_name as "companyName",
            e.id as "findingId", e.attempt as "findingAttempt", e.field_key as "fieldKey",
            e.proposed_value as "proposedValue", e.evidence_strength as "evidenceStrength",
            e.anchor_mode as "anchorMode", e.state as "findingState",
            e.evidence_excerpt as excerpt, e.abstained as abstained,
            f.bulk_acceptable as "bulkAcceptableField",
            (select count(*) from finding_sources s where s.finding_id = e.id) as "sourceCount",
            (select s.url from finding_sources s where s.finding_id = e.id limit 1) as "sourceUrl",
            (select s.source_tier from finding_sources s where s.finding_id = e.id limit 1) as "sourceTier",
            e.anchor_document_hash as "documentHash",
            -- From the facts table, not the resolved values: a decision
            -- rewrites the resolved row's source away from 'extract', and the
            -- diff would then show the AI's proposal against nothing.
            (select f.typed_value from company_period_facts f
              where f.period_id = ? and f.company_id = c.id and f.field_key = e.field_key
                and f.assertion = 'asserted') as "extractValue",
            e.created_at as "findingCreatedAt",
            -- What the field actually holds now, to compare the proposal with.
            (select v.value from company_period_field_values v
              where v.period_id = ? and v.company_id = c.id and v.field_key = e.field_key) as "resolvedValue",
            (select d.decision from review_decisions d
              where d.period_id = ? and d.company_id = c.id and d.field_key = e.field_key
                and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
              order by d.decided_at desc, d.id desc limit 1) as decision,
            -- Which finding the standing decision judged, and when: a newer
            -- proposal than that is research the decision never saw.
            (select d.finding_id from review_decisions d
              where d.period_id = ? and d.company_id = c.id and d.field_key = e.field_key
                and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
              order by d.decided_at desc, d.id desc limit 1) as "decidedFindingId",
            (select d.decided_at from review_decisions d
              where d.period_id = ? and d.company_id = c.id and d.field_key = e.field_key
                and d.decision != 'undo'
                and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
              order by d.decided_at desc, d.id desc limit 1) as "decidedAt"
       from enrichment_findings e
       join enrichment_runs r on r.id = e.run_id and r.period_id = ?
       join companies c on c.id = e.company_id
       join field_catalog f on f.key = e.field_key
      where e.state != 'superseded'`,
    periodId, periodId, periodId, periodId, periodId, periodId) as Array<Record<string, unknown>>;

  // The stage is stored as an evidence state plus its own rows, and proposed
  // as flags, so comparing the two shapes directly says "different" every
  // time. The stages themselves are what to compare.
  const stagesOf = new Map<string, string[]>();
  for (const row of await db.all(`select company_id, stage from company_period_stages
      where period_id = ?`, periodId) as Array<{ company_id: string; stage: string }>) {
    stagesOf.set(row.company_id, [...(stagesOf.get(row.company_id) ?? []), row.stage]);
  }

  const candidates = rows.map((r) => {
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
      newerThanDecision: decision === "accept" &&
        String(r.findingId ?? "") !== String(r.decidedFindingId ?? "") &&
        (String(r.findingState) === "proposed" || String(r.findingState) === "anchor_mismatch") &&
        isAfter(r.findingCreatedAt, r.decidedAt) &&
        differs(String(r.fieldKey), proposedValue,
                r.resolvedValue ? safeParse(String(r.resolvedValue)) : null,
                stagesOf.get(String(r.companyId)) ?? []),
      abstained: Number(r.abstained) === 1,
      band: evidenceBand(r.evidenceStrength === null ? null : Number(r.evidenceStrength)),
      excerpt: r.excerpt ? String(r.excerpt) : null,
      sourceUrl: r.sourceUrl ? String(r.sourceUrl) : null,
      documentHash: r.documentHash ? String(r.documentHash) : null,
      conflict: false,
    };
    candidate.conflict = isConflict(candidate);
    return {
      ...candidate,
      createdAt: r.findingCreatedAt ?? null,
      sourceTier: r.sourceTier === null || r.sourceTier === undefined ? null : Number(r.sourceTier),
    };
  });

  // One row per company and field, picked here rather than in the statement:
  // which proposal to show depends on the standing decision, and a correlated
  // subquery cannot see it.
  const groups = new Map<string, Proposal[]>();
  for (const c of candidates) {
    const key = `${c.companyId}\u0000${c.fieldKey}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].map(pickFinding)
    .sort((a, b) => byStrengthAsc(a.evidenceStrength, b.evidenceStrength) ||
                    a.companyName.localeCompare(b.companyName));
}

/** A Row plus what only the pick needs: when it was written, and from where. */
type Proposal = Row & { createdAt: unknown; sourceTier: number | null };

/** An anchored proposal, then one held for a human, then the rest, abstention last. */
const STATE_RANK: Record<string, number> = { proposed: 0, anchor_mismatch: 1, abstained: 3 };
const stateRank = (state: string): number => STATE_RANK[state] ?? 2;

/** Ascending, with an unscored proposal first: the worst work comes first. */
function byStrengthAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

/** Newest first, by creation and then by id, which ties-break in insert order. */
function byNewest(a: Proposal, b: Proposal): number {
  if (isAfter(a.createdAt, b.createdAt)) return -1;
  if (isAfter(b.createdAt, a.createdAt)) return 1;
  return String(b.findingId ?? "").localeCompare(String(a.findingId ?? ""));
}

/**
 * Which of a company's proposals for one field the Analyst sees.
 *
 * Two passes (EDGAR in pass 1, the filings in pass 2) and every re-run propose
 * a value. The others stay on record, append-only.
 *
 * Where a decision already stands, the one to show is the NEWEST proposal the
 * decision never saw -- not the strongest. Those are the same row most of the
 * time, and when they differ the strongest is the one already decided, so the
 * row drops out of the superseded bucket and the correction is lost: two of
 * the four corrections on 13 September never surfaced and had to be overridden
 * by hand, because an older EDGAR proposal outscored the newer filing.
 *
 * Otherwise it is the best proposal: state, then -- for the fields EDGAR
 * answers from a registrant profile -- the better source outright, so the
 * issuer's own filing wins whatever the arithmetic says, then evidence.
 */
export function pickFinding(group: Proposal[]): Proposal {
  const newer = group.filter((c) => c.newerThanDecision);
  if (newer.length > 0) return [...newer].sort(byNewest)[0];

  const preferSource = EDGAR_PROFILE_FIELDS.has(group[0].fieldKey);
  return [...group].sort((a, b) =>
    stateRank(a.findingState) - stateRank(b.findingState) ||
    (preferSource ? (a.sourceTier ?? 9) - (b.sourceTier ?? 9) : 0) ||
    byStrengthAsc(b.evidenceStrength, a.evidenceStrength) ||
    byNewest(a, b))[0];
}

/** Field-major, sorted by evidence ASCENDING so the worst work comes first. */
export async function fieldRows(
  db: Sql, periodId: string, fieldKey: string, bucket?: string, threshold = 0.8,
): Promise<Row[]> {
  const all = (await allCandidates(db, periodId)).filter((r) => r.fieldKey === fieldKey);
  if (!bucket || bucket === "all") return all;
  // The one bucket whose rows are decided: everything else asks what is left
  // to do, and this asks what was done before the research improved.
  if (bucket === SUPERSEDED) return all.filter((r) => r.newerThanDecision);

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
    : formatValue(row.proposedValue, row.fieldKey);
  const state = row.decided ? row.decision! : "unreviewed";
  const newer = row.newerThanDecision ? ", newer research since" : "";
  return `${fieldLabel}, ${value}, evidence ${row.band}, ${state}${newer}`;
}

/** A proposed or extracted value as the grid shows it -- and as its override box starts. */
export function formatValue(value: unknown, fieldKey = ""): string {
  if (value === null || value === undefined) return "no value";
  return formatFieldValue(fieldKey, value);
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
