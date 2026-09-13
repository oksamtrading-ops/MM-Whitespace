/**
 * The publish gate.
 *
 * Publish is blocked while any default-dashboard chart sits below its coverage
 * floor, while unresolved conflicts remain, or while the run's fabrication rate
 * exceeds its ceiling.
 *
 * An Admin may override, with a recorded reason that is then PRINTED ON THE
 * DASHBOARD HEADER. That printing is the point: it is what stops a stale-data
 * warning becoming a banner nobody reads, which is exactly what happened to the
 * source workbook's own "TAB NOT UPDATED" notice.
 *
 * See docs/design/08-review-workspace.md.
 */
import type { Sql } from "../db/sql.ts";

export type Coverage = {
  chart: string;
  label: string;
  drivingField: string;
  floorPct: number | null;
  blocksPublish: boolean;
  resolved: number;
  population: number;
  actualPct: number;
  meetsFloor: boolean;
};

export type Blocker =
  | { kind: "coverage"; chart: string; detail: string }
  | { kind: "unresolved_conflicts"; count: number; detail: string }
  | { kind: "hallucination_rate"; rate: number; ceiling: number; detail: string };

export type GateResult = {
  periodId: string;
  population: number;
  coverage: Coverage[];
  blockers: Blocker[];
  unresolvedCount: number;
  publishable: boolean;
};

/** A value counts as resolved only when the source actually asserts something. */
const RESOLVED = `
  value is not null
  and value != 'null'
  and evidence_state = 'asserted'
`;

export async function computeCoverage(db: Sql, periodId: string): Promise<Coverage[]> {
  const population = (await db.get("select count(*) n from tiers where period_id = ?", periodId) as { n: number }).n;

  const floors = await db.all("select chart, label, driving_field, floor_pct, blocks_publish from coverage_floors order by chart") as Array<{
    chart: string; label: string; driving_field: string;
    floor_pct: number | null; blocks_publish: number;
  }>;

  // One query per floor, and there are a handful of floors. Promise.all rather
  // than a loop so the round trips overlap, which is what turns a Postgres
  // connection's latency from a sum into a maximum.
  return Promise.all(floors.map(async (f) => {
    let resolved: number;
    if (f.driving_field === "stage_evidence_state") {
      // "Resolved stage" means stage evidence exists -- not that the field has
      // a value. Every company has the value 'none'; 242 of them mean "nobody
      // has looked", which is the opposite of resolved.
      resolved = (await db.get(`select count(*) n from company_period_field_values
          where period_id = ? and field_key = 'stage_evidence_state'
            and value not in ('null', '"none"')`, periodId) as { n: number }).n;
    } else if (f.driving_field === "footprint") {
      // A footprint of 'none' IS resolved -- it is the honest answer for a
      // royalty company with no properties, and the whole point of adding the
      // fourth value. What is unresolved is a company with no property evidence.
      resolved = (await db.get(`select count(*) n from tiers t
           join company_period_field_values v
             on v.period_id = t.period_id and v.company_id = t.company_id
            and v.field_key = 'property_evidence_state'
          where t.period_id = ? and v.value != '"none"'`, periodId) as { n: number }).n;
    } else {
      resolved = (await db.get(`select count(*) n from company_period_field_values
          where period_id = ? and field_key = ? and ${RESOLVED}`, periodId, f.driving_field) as { n: number }).n;
    }

    const actualPct = population === 0 ? 0 : (100 * resolved) / population;
    return {
      chart: f.chart,
      label: f.label,
      drivingField: f.driving_field,
      floorPct: f.floor_pct,
      blocksPublish: f.blocks_publish === 1,
      resolved,
      population,
      actualPct: Math.round(actualPct * 10) / 10,
      meetsFloor: f.floor_pct === null ? true : actualPct >= f.floor_pct,
    };
  }));
}

/**
 * A conflict is a field where two sources disagree and nobody has adjudicated:
 * more than one non-superseded proposal for the same company and field.
 */
/**
 * Fields where the research disagrees with ITSELF and nobody has chosen.
 *
 * Two passes and any re-run each propose a value; where they differ, somebody
 * has to say which is right. That is an adjudication, and it is exactly what a
 * review decision is -- so a field that has one is resolved, whatever the
 * findings still say. UNRESOLVED is the whole of this blocker's meaning.
 *
 * It did not check. The count was every company-field with two distinct
 * proposals, decided or not, under a message that read "and no adjudication".
 * On Q3-2026 that was all 13 of the EDGAR-versus-filing disagreements from
 * Run 2 -- every one of them adjudicated by hand on 13 September, 10 accepted
 * and 3 overridden -- and the gate went on reporting them for ever. No amount
 * of review could have cleared it. The test that should have caught this is
 * named "with no adjudication" and never recorded one, so it only ever
 * exercised the blocking half.
 */
export async function unresolvedConflicts(db: Sql, periodId: string): Promise<number> {
  const row = await db.get(`select count(*) n from (
       select f.company_id, f.field_key
         from enrichment_findings f
         join enrichment_runs r on r.id = f.run_id
        where r.period_id = ? and f.state = 'proposed' and f.abstained = false
          and not exists (
            select 1 from review_decisions d
             where d.period_id = r.period_id
               and d.company_id = f.company_id
               and d.field_key = f.field_key
               and d.decision != 'undo'
               and not exists (select 1 from review_decisions u where u.undoes_id = d.id))
        group by f.company_id, f.field_key
       having count(distinct f.proposed_value) > 1
     )`, periodId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Companies still carrying an unresolved value. Recorded, not prevented. */
export async function unresolvedCount(db: Sql, periodId: string): Promise<number> {
  return (await db.get(`select count(distinct company_id) n from company_period_field_values
      where period_id = ? and evidence_state = 'unknown'`, periodId) as { n: number }).n;
}

async function hallucinationRateForPeriod(db: Sql, periodId: string) {
  const row = await db.get(`select
       sum(case when f.state = 'unsupported' then 1 else 0 end) as unsupported,
       sum(case when f.state != 'abstained' then 1 else 0 end)  as assessed
       from enrichment_findings f
       join enrichment_runs r on r.id = f.run_id
      where r.period_id = ?`, periodId) as
    { unsupported: number | null; assessed: number | null };
  const unsupported = row.unsupported ?? 0;
  const assessed = row.assessed ?? 0;
  return { unsupported, assessed, rate: assessed === 0 ? 0 : unsupported / assessed };
}

export async function evaluateGate(db: Sql, periodId: string): Promise<GateResult> {
  const coverage = await computeCoverage(db, periodId);
  const population = coverage[0]?.population ?? 0;
  const blockers: Blocker[] = [];

  for (const c of coverage) {
    if (c.blocksPublish && !c.meetsFloor) {
      blockers.push({
        kind: "coverage",
        chart: c.chart,
        detail: `${c.label}: ${c.actualPct}% resolved (${c.resolved} of ${c.population}), ` +
                `floor is ${c.floorPct}%`,
      });
    }
  }

  const conflicts = await unresolvedConflicts(db, periodId);
  if (conflicts > 0) {
    blockers.push({
      kind: "unresolved_conflicts", count: conflicts,
      detail: `${conflicts} field(s) have two proposals and no adjudication`,
    });
  }

  const ceilingRow = await db.get("select value from publish_thresholds where key = 'max_hallucination_rate'") as
    { value: number } | undefined;
  const ceiling = ceilingRow?.value ?? 0.02;
  const h = await hallucinationRateForPeriod(db, periodId);
  if (h.rate > ceiling) {
    blockers.push({
      kind: "hallucination_rate", rate:h.rate, ceiling,
      detail: `fabrication rate ${(h.rate * 100).toFixed(1)}% of ${h.assessed} assessed ` +
              `findings exceeds the ${(ceiling * 100).toFixed(1)}% ceiling`,
    });
  }

  return {
    periodId, population, coverage, blockers,
    unresolvedCount: await unresolvedCount(db, periodId),
    publishable: blockers.length === 0,
  };
}

/** Rendered onto the dashboard header when a publish went through blocked. */
export function overrideBanner(
  reason: string, blockers: Blocker[], publishedAt: string,
): string {
  const what = blockers.map((b) => b.detail).join("; ");
  return `Published ${publishedAt} through a blocked gate. Reason given: ` +
         `"${reason}". Outstanding at publish: ${what}.`;
}
