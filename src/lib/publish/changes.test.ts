import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { publishPeriod } from "./snapshot.ts";
import { recordDecision, undoLast } from "../review/decide.ts";
import { diffRevision, revisionChanges, type Side } from "./changes.ts";

function company(over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: "NRTH", exchange: "TSX", name: "Northco Mining Corp.", ordinal: 1,
    market_cap: 5_000_000_000,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] },
    region_provenance: { CANADA: "extract", "LATIN AMERICA": "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: "Deloitte", auditor_class: "big4", entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada & Abroad",
    ...over,
  } as ParsedCompany;
}

/** A published period of n companies, the first of them never researched for stage. */
async function published(n = 2) {
  const db = memorySql();
  const companies = Array.from({ length: n }, (_, i) => company({
    ticker: `C${i}`, name: `Company ${i} Ltd.`,
    ...(i === 0 ? { stages: [], stage_evidence: "none" } : {}),
  }));
  await commitPeriod(db, { period: "2026-05-31", companies }, { label: "P1" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  const ids = (await db.all("select id from companies order by canonical_name") as Array<{ id: string }>)
    .map((c) => c.id);
  await publishPeriod(db, periodId, { overrideReason: "baseline for the test, stage not researched" });
  return { db, periodId, ids };
}

/** A research finding as the worker writes one: with the passage it was anchored to. */
async function finding(db: Sql, periodId: string, companyId: string, fieldKey: string, value: unknown) {
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };
  return (await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, evidence_excerpt, state, model, prompt_version)
     values (?, ?, 1, ?, ?, ?, 0.9, 'exact_normalized', 'the passage the value was read from',
             'proposed', 'test', 'test') returning id`,
    run.id, job.id, companyId, fieldKey, JSON.stringify(value)) as { id: string }).id;
}

test("nothing decided since the last revision is nothing changed", async () => {
  const { db, periodId } = await published();
  const c = (await revisionChanges(db, periodId))!;
  assert.equal(c.revision, 1);
  assert.equal(c.total, 0, JSON.stringify(c));
  assert.deepEqual([c.values, c.stages, c.tiers], [[], [], []]);
});

test("a period never published has nothing to differ from", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [company()] }, { label: "P1" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  assert.equal(await revisionChanges(db, periodId), null);
});

test("an override shows as the value it replaces and the value it puts there", async () => {
  const { db, periodId, ids } = await published();
  await recordDecision(db, { periodId, companyId: ids[1], fieldKey: "auditor",
                             decision: "override", overrideValue: "KPMG", reason: "the 2026 circular" });
  const c = (await revisionChanges(db, periodId))!;
  assert.equal(c.total, 1);
  assert.deepEqual(c.values.map((v) => [v.company, v.fieldKey, v.before, v.after, v.beforeSource, v.afterSource]),
                   [["Company 1 Ltd.", "auditor", "Deloitte", "KPMG", "extract", "manual_override"]]);
});

test("AN ACCEPT AND ITS UNDO ARE TWO DECISIONS AND NO CHANGE", async () => {
  // Counting decisions would report two here. The revision would freeze
  // exactly what revision 1 froze, and that is what the screen must say.
  const { db, periodId, ids } = await published();
  const f = await finding(db, periodId, ids[1], "auditor", "PwC");
  await recordDecision(db, { periodId, companyId: ids[1], fieldKey: "auditor", decision: "accept", findingId: f });
  assert.equal((await revisionChanges(db, periodId))!.total, 1);

  await undoLast(db, periodId, "auditor", null);
  const c = (await revisionChanges(db, periodId))!;
  assert.equal(c.total, 0, JSON.stringify(c));
});

test("an undo of something published is a change: it puts a different value back", async () => {
  const { db, periodId, ids } = await published();
  await recordDecision(db, { periodId, companyId: ids[1], fieldKey: "auditor",
                             decision: "override", overrideValue: "KPMG", reason: "the 2026 circular" });
  await publishPeriod(db, periodId, { overrideReason: "amendment for the test, stage not researched",
                                      amendmentReason: "KPMG" });
  await undoLast(db, periodId, "auditor", null);

  const c = (await revisionChanges(db, periodId))!;
  assert.equal(c.revision, 2);
  assert.deepEqual(c.values.map((v) => [v.before, v.after]), [["KPMG", "Deloitte"]]);
});

test("accepting stage research is one stage change and one tier change, not a list of fields", async () => {
  const { db, periodId, ids } = await published();
  const f = await finding(db, periodId, ids[0], "stage_evidence_state",
    { exploration: true, development: false, production: true, royalty_streaming: false });
  await recordDecision(db, { periodId, companyId: ids[0], fieldKey: "stage_evidence_state",
                             decision: "accept", findingId: f });

  const c = (await revisionChanges(db, periodId))!;
  assert.deepEqual(c.stages.map((s) => [s.company, s.before, s.after, s.evidenceBefore, s.evidenceAfter]),
                   [["Company 0 Ltd.", [], ["exploration", "production"], "none", "complete"]]);
  assert.equal(c.tiers.length, 1);
  assert.equal(c.tiers[0].before!.tier, null);
  assert.equal(c.tiers[0].before!.status, "unclassified_no_stage_evidence");
  assert.equal(c.tiers[0].after!.status, "classified");
  assert.notEqual(c.tiers[0].after!.tier, null);
  // The tier and the evidence state are carried by those two lists, never
  // repeated as field changes beside them.
  assert.ok(!c.values.some((v) => v.fieldKey === "tier" || v.fieldKey === "stage_evidence_state"),
            JSON.stringify(c.values));
});

test("a stage tick changed with the evidence state unchanged is still a stage change", async () => {
  const { db, periodId, ids } = await published();
  // Company 1 is "complete" with Production; the override adds Development.
  await recordDecision(db, { periodId, companyId: ids[1], fieldKey: "stage_evidence_state",
    decision: "override", reason: "the circular names a development project",
    overrideValue: { exploration: null, development: true, production: true, royalty_streaming: null } });
  const c = (await revisionChanges(db, periodId))!;
  assert.deepEqual(c.stages.map((s) => [s.before, s.after]), [[["production"], ["development", "production"]]]);
});

test("an accept that confirms the workbook changes the source, not the value", async () => {
  const { db, periodId, ids } = await published();
  const f = await finding(db, periodId, ids[1], "auditor", "Deloitte");
  await recordDecision(db, { periodId, companyId: ids[1], fieldKey: "auditor", decision: "accept", findingId: f });
  const c = (await revisionChanges(db, periodId))!;
  assert.deepEqual(c.values, []);
  assert.equal(c.sourceOnly, 1);
  assert.equal(c.total, 1, "a revision that only re-cites a value is still not identical");
});

test("the same value written by another engine is the same value", () => {
  // Postgres hands jsonb back reformatted and with its own key order; SQLite
  // hands back what was stored. Neither is a change.
  const side = (value: string): Side => ({
    values: [{ company_id: "c", field_key: "audit_fee", value, source: "ai_accepted" }], stages: [], tiers: [],
  });
  const c = diffRevision(side('{"amount":353190,"currency":"CAD","fiscal_year":2025}'),
                         side('{"fiscal_year": 2025, "amount": 353190, "currency": "CAD"}'),
                         new Map(), 1);
  assert.equal(c.total, 0);
});

test("the read is a fixed number of queries, whatever the size of the period", async () => {
  // Publish once made 3,918 round trips on Postgres and took minutes, and on
  // SQLite it took 17 ms either way. Round trips are what is counted.
  const count = async (n: number) => {
    const { db, periodId, ids } = await published(n);
    for (const id of ids.slice(1)) {
      await recordDecision(db, { periodId, companyId: id, fieldKey: "auditor",
                                 decision: "override", overrideValue: "KPMG", reason: "test" });
    }
    let queries = 0;
    const counting = new Proxy(db, {
      get: (target, prop, receiver) => !["all", "get", "run"].includes(String(prop))
        ? Reflect.get(target, prop, receiver)
        : (s: string, ...params: unknown[]) => { queries++; return (target as unknown as Record<string, (...a: unknown[]) => unknown>)[String(prop)](s, ...params); },
    });
    const c = (await revisionChanges(counting, periodId))!;
    assert.equal(c.values.length, n - 1);
    return queries;
  };
  assert.equal(await count(2), await count(12));
});
