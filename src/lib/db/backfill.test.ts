import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "./open.ts";
import type { Sql } from "./sql.ts";
import { commitPeriod, type ParsedCompany } from "./commit.ts";
import { backfillHeadOffice, BackfillRefused } from "./backfill.ts";
import { publishPeriod } from "../publish/snapshot.ts";
import { recordDecision } from "../review/decide.ts";

function company(name: string, cap: number, over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: name.slice(0, 4).toUpperCase(), exchange: "TSX", name, ordinal: 1, market_cap: cap,
    stages: [], stage_evidence: "none", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: null, auditor_class: null, entity_id: null, website: null,
    tier_workbook: 4, footprint_workbook: "Canada only",
    ...over,
  } as ParsedCompany;
}

const OLD = [company("Northco Mining Corp.", 5e9), company("Southco Gold Ltd.", 2e9, { ordinal: 2 }),
             company("Westco Copper Inc.", 1e9, { ordinal: 3 })];

/** The same workbook, parsed by the parser that now reads head office. */
const NEW = [
  { ...OLD[0], head_office_region: "Ontario, Canada" },
  { ...OLD[1], head_office_region: "British Columbia, Canada" },
  { ...OLD[2], head_office_region: null },   // the file's value could not be read safely
];

/** Committed by the old parser and published; research had already found Southco's head office. */
async function published(): Promise<{ db: Sql; periodId: string }> {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: OLD }, { label: "Q3-2026 (2026-05-31)" });
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  await db.run("update periods set source_file_sha256 = 'abc123'");
  const southco = (await db.get("select id from companies where canonical_name like 'Southco%'") as { id: string }).id;
  // Research found it, with its quote, and a reviewer accepted it -- as it
  // happens in production, so publish has a citation to freeze.
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'identity', 'completed') returning id`, run.id, southco) as { id: string };
  const finding = await db.get(`insert into enrichment_findings
       (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
        anchor_mode, evidence_excerpt, state, model, prompt_version)
     values (?, ?, 1, ?, 'head_office_region', '"Yukon, Canada"', 0.8, 'exact_normalized',
             'Head office: Whitehorse, Yukon', 'proposed', 'test', 'test') returning id`, run.id, job.id, southco) as { id: string };
  await recordDecision(db, { periodId, companyId: southco, fieldKey: "head_office_region", decision: "accept", findingId: finding.id });
  await publishPeriod(db, periodId, { overrideReason: "test" });
  return { db, periodId };
}

const count = async (db: Sql, table: string) =>
  Number((await db.get(`select count(*) n from ${table} where field_key = 'head_office_region'`) as { n: number }).n);

test("a dry run says what it would write and writes nothing", async () => {
  const { db } = await published();
  const before = { facts: await count(db, "company_period_facts"), values: await count(db, "company_period_field_values") };
  const r = await backfillHeadOffice(db, { period: "2026-05-31", companies: NEW }, { apply: false, expectRevision: 1 });
  assert.equal(r.applied, false);
  assert.equal(r.facts, 3);
  assert.equal(r.values, 1, "Northco only: Southco's research stands, Westco's file value is unreadable");
  assert.equal(r.standing, 1);
  assert.deepEqual({ facts: await count(db, "company_period_facts"), values: await count(db, "company_period_field_values") }, before);
});

test("applied, it fills the gap and never stands over research; a second run writes nothing", async () => {
  const { db, periodId } = await published();
  const r = await backfillHeadOffice(db, { period: "2026-05-31", companies: NEW },
                                     { apply: true, expectRevision: 1, sha256: "abc123" });
  assert.equal(r.applied, true);
  const value = async (name: string) => (await db.get(`select v.value, v.source from company_period_field_values v
      join companies c on c.id = v.company_id where c.canonical_name like ? and v.field_key = 'head_office_region'
        and v.period_id = ?`, `${name}%`, periodId) as { value: string; source: string } | undefined);
  assert.deepEqual(await value("Northco"), { value: '"Ontario, Canada"', source: "extract" });
  assert.deepEqual(await value("Southco"), { value: '"Yukon, Canada"', source: "ai_accepted" },
                   "research outranks the workbook, and the backfill never touches it");
  assert.equal(await value("Westco"), undefined, "an unreadable head office is no value, not a guess");
  const fact = await db.get(`select typed_value, assertion from company_period_facts f join companies c on c.id = f.company_id
      where c.canonical_name like 'Southco%' and f.field_key = 'head_office_region'`) as { typed_value: string; assertion: string };
  assert.deepEqual(fact, { typed_value: '"British Columbia, Canada"', assertion: "asserted" },
                   "the fact records what the FILE said, beside the research that outranks it");
  const audit = await db.get("select detail from audit_log where event = 'head_office_backfilled'") as { detail: string };
  assert.equal(JSON.parse(audit.detail).workbook_sha256, "abc123", "the workbook is recorded, by hash");

  const again = await backfillHeadOffice(db, { period: "2026-05-31", companies: NEW }, { apply: true, expectRevision: 1 });
  assert.equal(again.facts + again.values, 0);
  assert.equal(Number((await db.get("select count(*) n from audit_log where event = 'head_office_backfilled'") as { n: number }).n), 1,
               "and records nothing, because nothing happened");
});

test("it refuses a revision it was not planned against", async () => {
  const { db } = await published();
  await assert.rejects(backfillHeadOffice(db, { period: "2026-05-31", companies: NEW }, { apply: true, expectRevision: 8 }),
                       (e: unknown) => e instanceof BackfillRefused && /Expected revision 8/.test(e.message));
});

test("it refuses a workbook that is not the one committed, by its figures", async () => {
  const { db } = await published();
  const edited = NEW.map((c, i) => (i === 0 ? { ...c, market_cap: 6e9 } : c));
  await assert.rejects(backfillHeadOffice(db, { period: "2026-05-31", companies: edited }, { apply: true, expectRevision: 1 }),
                       (e: unknown) => e instanceof BackfillRefused && /Northco Mining Corp.: the workbook says 6000000000/.test(e.message));
  assert.equal(await count(db, "company_period_facts"), 0, "a refusal writes nothing");
});

test("a payload from the old parser is refused rather than read as 'no head office'", async () => {
  const { db } = await published();
  await assert.rejects(backfillHeadOffice(db, { period: "2026-05-31", companies: OLD }, { apply: true, expectRevision: 1 }),
                       (e: unknown) => e instanceof BackfillRefused && /current parser/.test(e.message));
});

test("a future period gets head office from the commit itself, and an absent column leaves a value standing", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-08-31", companies: NEW }, { label: "Q4-2026 (2026-08-31)" });
  assert.equal(await count(db, "company_period_field_values"), 3);
  const fact = await db.get(`select assertion from company_period_facts f join companies c on c.id = f.company_id
      where c.canonical_name like 'Westco%' and f.field_key = 'head_office_region'`) as { assertion: string };
  assert.equal(fact.assertion, "absent_blank");

  const old = memorySql();
  await commitPeriod(old, { period: "2026-08-31", companies: OLD }, { label: "Q4-2026 (2026-08-31)" });
  assert.equal(await count(old, "company_period_facts"), 0, "no column, no claim");
});
