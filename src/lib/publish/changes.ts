/**
 * What the next revision would change, against the revision standing.
 *
 * /publish used to say only that a revision carries "anything accepted in
 * review since" the last one, never what that was. Revision 11 of Q3-2026 went
 * out on 20 October 2026 as "China Gold/Alkane fixes" and carried neither: the
 * one decision since revision 10 was an undo of something else. An amendment's
 * reason is free text printed on the dashboard header, so the screen that asks
 * for it has to show what the revision really holds.
 *
 * Value against value, not decision against decision. An accept and its undo
 * are two decisions and no change; an override typing the value already
 * standing is a decision and no change; an undo is a change wherever it puts a
 * different value back. And the working rows read here are exactly what
 * publishPeriod freezes (snapshot.ts reads company_period_field_values,
 * company_period_stages and tiers as they stand), so this is a diff against
 * what the button would write, not against a second reading of the rules.
 */
import type { Sql } from "../db/sql.ts";
import type { Stage } from "../format/fields.ts";

/** One field of one company whose value differs. */
export type ValueChange = {
  companyId: string; company: string; fieldKey: string;
  before: unknown; after: unknown;
  /** Where each value came from: extract, ai_accepted, manual_override, derived... */
  beforeSource: string | null; afterSource: string | null;
};

/**
 * The stage, which is stored twice: an evidence state in the values and the
 * stages themselves as rows. Shown as one change, so "Partial -> Complete" and
 * the ticks behind it do not read as two unrelated edits.
 */
export type StageChange = {
  companyId: string; company: string;
  before: Stage[]; after: Stage[];
  evidenceBefore: string | null; evidenceAfter: string | null;
};

export type TierChange = {
  companyId: string; company: string;
  before: { tier: number | null; status: string } | null;
  after: { tier: number | null; status: string } | null;
};

export type RevisionChanges = {
  /** The revision the next one is compared with. */
  revision: number;
  values: ValueChange[];
  stages: StageChange[];
  tiers: TierChange[];
  /**
   * Values that keep their value and change where it came from: an accept
   * that confirms what the workbook said. Real work, and a real change to the
   * citation shown, but not a different answer.
   */
  sourceOnly: number;
  /** Every changed company-and-field, source-only included. 0 = an identical revision. */
  total: number;
};

/** The rows on either side, as read: values arrive as JSON text from both engines. */
export type Side = {
  values: Array<{ company_id: string; field_key: string; value: string | null; source: string | null }>;
  stages: Array<{ company_id: string; stage: string }>;
  tiers: Array<{ company_id: string; tier: number | null; status: string }>;
};

/**
 * Carried by the tier and stage changes instead: the tier has its own list
 * (with the reason a company has none), and the evidence state belongs with
 * the stage rows it summarises.
 */
const SHOWN_ELSEWHERE = new Set(["tier", "stage_evidence_state"]);

const STAGES: readonly Stage[] = ["exploration", "development", "production", "royalty_streaming"];

function parse(text: string | null | undefined): unknown {
  if (text === null || text === undefined) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * A value as comparable text, whatever key order or spacing its engine wrote:
 * Postgres hands jsonb back reformatted ('{"a": 1}'), SQLite as it was stored.
 */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(value) ?? null);
}

const key = (companyId: string, fieldKey: string) => `${companyId}\u0000${fieldKey}`;

function stagesBy(rows: Side["stages"]): Map<string, Stage[]> {
  const out = new Map<string, Stage[]>();
  for (const r of rows) {
    const id = String(r.company_id);
    out.set(id, [...(out.get(id) ?? []), r.stage as Stage]);
  }
  for (const [id, list] of out) out.set(id, STAGES.filter((s) => list.includes(s)));
  return out;
}

/** The comparison itself, with no database: what the tests pin. */
export function diffRevision(
  published: Side, working: Side, names: Map<string, string>, revision: number,
): RevisionChanges {
  const name = (id: string) => names.get(id) ?? id;

  // --- values ---------------------------------------------------------------
  const before = new Map(published.values.map((v) => [key(String(v.company_id), v.field_key), v]));
  const after = new Map(working.values.map((v) => [key(String(v.company_id), v.field_key), v]));
  const values: ValueChange[] = [];
  let sourceOnly = 0;
  const evidence = new Map<string, { before: string | null; after: string | null }>();

  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k);
    const a = after.get(k);
    const [companyId, fieldKey] = k.split("\u0000");
    const bv = parse(b?.value);
    const av = parse(a?.value);
    const differs = canonical(bv) !== canonical(av);

    if (fieldKey === "stage_evidence_state") {
      if (differs) {
        evidence.set(companyId, {
          before: typeof bv === "string" ? bv : null, after: typeof av === "string" ? av : null,
        });
      }
      continue;
    }
    if (SHOWN_ELSEWHERE.has(fieldKey)) continue;
    if (differs) {
      values.push({
        companyId, company: name(companyId), fieldKey, before: bv, after: av,
        beforeSource: b?.source ?? null, afterSource: a?.source ?? null,
      });
    } else if ((b?.source ?? null) !== (a?.source ?? null)) {
      sourceOnly++;
    }
  }

  // --- stages, with their evidence state ------------------------------------
  const stagesBefore = stagesBy(published.stages);
  const stagesAfter = stagesBy(working.stages);
  const stages: StageChange[] = [];
  for (const companyId of new Set([...stagesBefore.keys(), ...stagesAfter.keys(), ...evidence.keys()])) {
    const b = stagesBefore.get(companyId) ?? [];
    const a = stagesAfter.get(companyId) ?? [];
    const ev = evidence.get(companyId);
    if (b.join() === a.join() && !ev) continue;
    const standing = String(parse(working.values.find((v) =>
      String(v.company_id) === companyId && v.field_key === "stage_evidence_state")?.value) ?? "") || null;
    stages.push({
      companyId, company: name(companyId), before: b, after: a,
      evidenceBefore: ev ? ev.before : standing, evidenceAfter: ev ? ev.after : standing,
    });
  }

  // --- tiers -----------------------------------------------------------------
  const tiersBefore = new Map(published.tiers.map((t) => [String(t.company_id), t]));
  const tiersAfter = new Map(working.tiers.map((t) => [String(t.company_id), t]));
  const tiers: TierChange[] = [];
  for (const companyId of new Set([...tiersBefore.keys(), ...tiersAfter.keys()])) {
    const b = tiersBefore.get(companyId);
    const a = tiersAfter.get(companyId);
    const shape = (t: typeof b) => t ? { tier: t.tier === null ? null : Number(t.tier), status: t.status } : null;
    if (canonical(shape(b)) === canonical(shape(a))) continue;
    tiers.push({ companyId, company: name(companyId), before: shape(b), after: shape(a) });
  }

  const byCompany = <T extends { company: string }>(x: T, y: T) => x.company.localeCompare(y.company);
  values.sort((x, y) => x.fieldKey.localeCompare(y.fieldKey) || byCompany(x, y));
  stages.sort(byCompany);
  tiers.sort(byCompany);

  return {
    revision, values, stages, tiers, sourceOnly,
    total: values.length + stages.length + tiers.length + sourceOnly,
  };
}

/**
 * The next revision against the newest one, or null when nothing is published
 * yet (a first publication has nothing to differ from).
 *
 * Eight reads whatever the size of the period. Publish was 3,918 round trips on
 * Postgres until it read in bulk, and nothing local would have shown it.
 */
export async function revisionChanges(db: Sql, periodId: string): Promise<RevisionChanges | null> {
  const pub = await db.get(`select id, revision from period_publications where period_id = ?
      order by revision desc limit 1`, periodId) as { id: string; revision: number } | undefined;
  if (!pub) return null;

  // Text on both sides, so both engines hand back the same shape to compare.
  const [pv, wv, ps, ws, pt, wt, companies] = await Promise.all([
    db.all(`select company_id, field_key, cast(value as text) as value, source
        from published_period_values where publication_id = ?`, pub.id),
    db.all(`select company_id, field_key, cast(value as text) as value, source
        from company_period_field_values where period_id = ?`, periodId),
    db.all("select company_id, stage from published_period_stages where publication_id = ?", pub.id),
    db.all("select company_id, stage from company_period_stages where period_id = ?", periodId),
    db.all("select company_id, tier, status from published_period_tiers where publication_id = ?", pub.id),
    db.all("select company_id, tier, status from tiers where period_id = ?", periodId),
    db.all("select id, canonical_name from companies"),
  ]);

  const names = new Map((companies as Array<{ id: string; canonical_name: string }>)
    .map((c) => [String(c.id), c.canonical_name]));
  return diffRevision(
    { values: pv as Side["values"], stages: ps as Side["stages"], tiers: pt as Side["tiers"] },
    { values: wv as Side["values"], stages: ws as Side["stages"], tiers: wt as Side["tiers"] },
    names, Number(pub.revision),
  );
}
