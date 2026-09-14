/**
 * After a decision: the resolved value, and everything derived from it.
 *
 * Three defects this closes, each of which made accepted research go nowhere:
 *
 *   1. Tiers were computed once, at commit, and never again. Accepting a stage
 *      finding changed a value that nothing re-read, so a period could have
 *      242 researched stages and still show 242 unclassified.
 *   2. Undo recorded itself and left the accepted value standing, so the
 *      value a partner saw after publish was the one the Analyst had taken
 *      back.
 *   3. A decision could not touch a published period at all: publish freezes
 *      the working values so a RE-IMPORT cannot move them, and the decision
 *      path honoured the same freeze. An amendment then republished the old
 *      values. Decisions are how a published period is corrected, so they
 *      amend; a re-import still cannot (commit.ts keeps its guard).
 *
 * The published snapshot is never touched here. It changes only when someone
 * publishes a new revision.
 */
import { ABROAD } from "../db/commit.ts";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import { classify, deriveFootprint, type Evidence, type Stage } from "../tiering/index.ts";

export const STAGES: readonly Stage[] = ["exploration", "development", "production", "royalty_streaming"];

/** Fields whose value feeds the tier. */
const TIER_INPUTS = new Set(["stage_evidence_state", "property_regions"]);

const parse = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
};

/**
 * Keep what the workbook said before a decision first displaces it.
 *
 * company_period_facts is the file's own assertion and is what undo restores.
 * Commit writes facts for the fields it parses, but not for every field it
 * resolves -- website, stage evidence and the stage rows among them -- so the
 * first decision on such a field would otherwise destroy the only copy. This
 * records it at that moment. `on conflict do nothing`: a fact already there is
 * the file's word and is never rewritten.
 */
export async function preserveExtract(
  db: Sql, periodId: string, companyId: string, fieldKey: string,
): Promise<void> {
  const current = await db.get(`select value, source, evidence_state from company_period_field_values
      where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, fieldKey) as
    { value: string | null; source: string; evidence_state: string } | undefined;
  if (!current || (current.source !== "extract" && current.source !== "derived")) return;

  const assertion = current.evidence_state === "unknown" || current.value === null || current.value === "null"
    ? "absent_blank" : "asserted";
  const ins = `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, ?, ?, ?, ?) on conflict (period_id, company_id, field_key) do nothing`;
  await db.run(ins, periodId, companyId, fieldKey, current.value, current.value, assertion);

  if (fieldKey === "stage_evidence_state") {
    const rows = await db.all(`select stage from company_period_stages
        where period_id = ? and company_id = ? order by stage`, periodId, companyId) as Array<{ stage: string }>;
    const stages = JSON.stringify(rows.map((r) => r.stage));
    await db.run(ins, periodId, companyId, "stages", stages, stages, "asserted");
  }
}

/** The accept or override standing for a company and field, ignoring flags and undone rows. */
async function standingValueDecision(db: Sql, periodId: string, companyId: string, fieldKey: string) {
  return await db.get(`select d.decision, d.override_value, d.finding_id from review_decisions d
      where d.period_id = ? and d.company_id = ? and d.field_key = ?
        and d.decision in ('accept', 'override')
        and not exists (select 1 from review_decisions u where u.undoes_id = d.id)
      order by d.seq desc limit 1`, periodId, companyId, fieldKey) as
    { decision: "accept" | "override"; override_value: string | null; finding_id: string | null } | undefined;
}

async function fact(db: Sql, periodId: string, companyId: string, fieldKey: string) {
  const row = await db.get(`select typed_value, assertion from company_period_facts
      where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, fieldKey) as
    { typed_value: string | null; assertion: string } | undefined;
  if (!row) return undefined;
  return { value: row.assertion === "asserted" ? parse(row.typed_value) : null, assertion: row.assertion };
}

/** Is this a proposed set of stage flags, as research and the override form produce? */
export function asStageFlags(v: unknown): Partial<Record<Stage, boolean | null>> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return STAGES.some((s) => s in o) ? (o as Partial<Record<Stage, boolean | null>>) : null;
}

/**
 * Recompute one field's resolved value from the decisions standing on it,
 * then anything derived from it. Called after every decision.
 */
export async function resolveAfterDecision(
  db: Sql, periodId: string, companyId: string, fieldKey: string, actorId: string | null = null,
): Promise<void> {
  const standing = await standingValueDecision(db, periodId, companyId, fieldKey);

  let value: unknown;
  let source: string;
  let evidenceState: string;
  if (standing) {
    value = standing.decision === "override"
      ? parse(standing.override_value)
      : parse((await db.get("select proposed_value v from enrichment_findings where id = ?",
                            standing.finding_id ?? "") as { v: string } | undefined)?.v ?? null);
    source = standing.decision === "override" ? "manual_override" : "ai_accepted";
    evidenceState = value === null ? "unknown" : "asserted";
  } else {
    // Nothing stands: back to what the file said.
    const f = await fact(db, periodId, companyId, fieldKey);
    if (f !== undefined) {
      value = f.value;
      evidenceState = f.assertion === "asserted" ? "asserted" : "unknown";
    } else {
      // The file said nothing about this field -- a researched field such as
      // fiscal year-end, which no workbook column carries. An undone accept
      // leaves it empty, not holding the value that was taken back.
      const current = await db.get(`select source from company_period_field_values
          where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, fieldKey) as
        { source: string } | undefined;
      if (!current || current.source === "extract" || current.source === "derived") return;
      value = null;
      evidenceState = "unknown";
    }
    source = "extract";
  }

  if (fieldKey === "stage_evidence_state") {
    await resolveStage(db, periodId, companyId, value, source, actorId);
  } else {
    await writeValue(db, periodId, companyId, fieldKey, value, source, evidenceState, actorId);
  }
  if (TIER_INPUTS.has(fieldKey)) await retier(db, periodId, companyId);
}

async function writeValue(
  db: Sql, periodId: string, companyId: string, fieldKey: string,
  value: unknown, source: string, evidenceState: string, actorId: string | null,
): Promise<void> {
  // No frozen_at guard, deliberately: see defect 3 above.
  await db.run(`insert into company_period_field_values as v
       (period_id, company_id, field_key, value, source, evidence_state, actor_id, decided_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (period_id, company_id, field_key) do update
       set value = excluded.value, source = excluded.source,
           evidence_state = excluded.evidence_state, actor_id = excluded.actor_id,
           decided_at = excluded.decided_at`,
    periodId, companyId, fieldKey, JSON.stringify(value ?? null), source, evidenceState,
    actorId, formatStamp());
}

/**
 * Stage lives in two places: the evidence state (a field value) and the
 * presence rows (company_period_stages). A decision carries flags; the tier
 * engine reads the rows and the state. Absence of a row means "false" only
 * when the state is complete, so a flag left null makes the state partial.
 */
async function resolveStage(
  db: Sql, periodId: string, companyId: string, value: unknown, source: string, actorId: string | null,
): Promise<void> {
  let evidence: Evidence;
  let present: Stage[];
  const flags = asStageFlags(value);
  if (flags) {
    present = STAGES.filter((s) => flags[s] === true);
    evidence = STAGES.every((s) => typeof flags[s] === "boolean") ? "complete" : "partial";
  } else {
    // Restoring the file: its state, and the rows it had.
    evidence = (typeof value === "string" && ["none", "partial", "complete"].includes(value)
      ? value : "none") as Evidence;
    const rows = (await fact(db, periodId, companyId, "stages"))?.value;
    present = Array.isArray(rows) ? rows.filter((s): s is Stage => STAGES.includes(s as Stage)) : [];
  }

  await db.run("delete from company_period_stages where period_id = ? and company_id = ?", periodId, companyId);
  for (const s of present) {
    await db.run(`insert into company_period_stages (period_id, company_id, stage) values (?, ?, ?)
        on conflict do nothing`, periodId, companyId, s);
  }
  await writeValue(db, periodId, companyId, "stage_evidence_state", evidence, source,
                   evidence === "none" ? "unknown" : "asserted", actorId);
}

/** Classify one company from its resolved inputs, exactly as commit does. */
export async function retier(db: Sql, periodId: string, companyId: string): Promise<void> {
  const read = async (key: string) => parse((await db.get(`select value from company_period_field_values
      where period_id = ? and company_id = ? and field_key = ?`, periodId, companyId, key) as
      { value: string } | undefined)?.value ?? null);

  const stageEvidence = ((await read("stage_evidence_state")) ?? "none") as Evidence;
  const stages = (await db.all(`select stage from company_period_stages
      where period_id = ? and company_id = ?`, periodId, companyId) as Array<{ stage: Stage }>).map((r) => r.stage);
  const regions = ((await read("property_regions")) ?? {}) as Record<string, string[]>;
  const anyRegion = Object.values(regions).some((v) => Array.isArray(v) && v.length > 0);
  const storedPropertyEvidence = (await read("property_evidence_state")) as Evidence | null;
  const propertyEvidence: Evidence = anyRegion ? "complete" : (storedPropertyEvidence ?? "none");

  const propsCanada = (regions.CANADA ?? []).length > 0;
  const propsAbroad = ABROAD.some((k) => (regions[k] ?? []).length > 0);
  const footprint = deriveFootprint(propsCanada, propsAbroad, propertyEvidence);
  const cls = classify({ stages, stageEvidence, footprint, propertyEvidence });

  await db.run(`insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id) do update
         set tier = excluded.tier, status = excluded.status,
             footprint = excluded.footprint, rule_set_version = excluded.rule_set_version`,
    periodId, companyId, cls.tier, cls.status, cls.footprint, cls.ruleSetVersion);
  await db.run("delete from tier_traces where period_id = ? and company_id = ?", periodId, companyId);
  for (const t of cls.trace) {
    await db.run(`insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
        values (?, ?, ?, ?, ?, ?)`, periodId, companyId, t.ord, t.ruleId, JSON.stringify(t.inputs), t.matched);
  }
  await writeValue(db, periodId, companyId, "property_evidence_state", propertyEvidence, "derived", "asserted", null);
  await writeValue(db, periodId, companyId, "footprint", cls.footprint, "derived", "asserted", null);
  await writeValue(db, periodId, companyId, "tier", cls.tier, "derived",
                   cls.tier === null ? "unknown" : "asserted", null);
}
