/**
 * What a run's "not yet done" counts as researched: a pass's field groups,
 * done in this period or carried from an earlier one.
 *
 * Without this a period rolled forward from TSX's list offers every company
 * again, the ~40 researched in Q3 among them: US$70-80 of pass 1 against a
 * US$100 a month limit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { commitPeriod, type ParsedCompany } from "../db/commit.ts";
import { commitTsxPeriod } from "../db/committsx.ts";
import type { TsxIssuer } from "../ingest/tsx.ts";
import { publishPeriod } from "../publish/snapshot.ts";
import { recordDecision, undoLast } from "../review/decide.ts";
import { EXTRACTED_FIELDS, LIVE_RULES_VERSION, promptVersionFor } from "./live.ts";
import { askedFor, compareRules, FIELD_GROUPS, liveRulesOf, scopeNote, type Pass } from "./scope.ts";
import {
  passScopes, periodHasResearch, scopeCompanies, scopeWithTickers, startRun, StartRefused,
} from "./start.ts";

const Q3 = "Q3-2026 (2026-05-31)";
const Q4 = "Q4-2026 (2026-08-31)";
const Q1 = "Q1-2027 (2026-11-30)";
/** The rules the 13 October runs were asked under: before commodities and the financials. */
const OCTOBER_13 = "2026-09-04.1+live.2026-10-09.1";
const TODAY = promptVersionFor("live");

function workbook(ticker: string, exchange: string, name: string, market_cap: number): ParsedCompany {
  return {
    ticker, exchange, name, ordinal: 1, market_cap,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"] }, region_provenance: { CANADA: "extract" },
    commodities: ["Gold"], venture_graduate: false, auditor: "KPMG LLP", auditor_class: "big4",
    entity_id: null, website: `https://${ticker.toLowerCase()}.example.com`,
    dtt_market: "Ontario", head_office_region: "Ontario, Canada",
    tier_workbook: null, footprint_workbook: null,
  } as ParsedCompany;
}

const issuer = (ticker: string, exchange: string, name: string, market_cap: number): TsxIssuer => ({
  ticker, exchange, name, market_cap, regions: { CANADA: ["ON"] }, commodities: ["Gold"],
  venture_graduate: false, head_office_region: "Ontario, Canada",
});

const list = (period: string, companies: TsxIssuer[]) => ({
  kind: "tsx_list" as const, period, companies,
  report: { blocking: [], warnings: [], info: [], proofs: {}, totals: {} },
});

/** Q3's four continuing companies, and two new ones with no website yet. */
const AUGUST = list("2026-08-31", [
  issuer("NRTH", "TSX", "Northco Mining Corp.", 5.4e9),
  issuer("STHC", "TSX", "Southco Resources Ltd.", 3.1e9),
  issuer("ROYL", "TSX", "Royalco Streaming Inc.", 8.1e9),
  issuer("CARY", "TSX", "Carryco Minerals Inc.", 5.2e8),
  issuer("NEWC", "TSX", "Newco Copper Corp.", 6.5e8),
  issuer("EDGE", "TSXV", "Edgeco Metals Inc.", 2.03e8),
]);

const periodId = async (db: Sql, label: string) =>
  String((await db.get("select id from periods where label = ?", label) as { id: string }).id);
const companyId = async (db: Sql, ticker: string) =>
  String((await db.get(`select company_id from company_identifiers
      where scheme = 'root_ticker' and value = ? and valid_to is null`, ticker) as { company_id: string }).company_id);

/**
 * A completed job of one pass, as the worker leaves it: one finding per
 * field, a quote and a filing for what it found, a reason for what it did
 * not. Review then accepts the fields named in `accept`; the rest wait.
 */
async function research(db: Sql, period: string, ticker: string, pass: Pass, promptVersion: string,
                        findings: Record<string, unknown>, accept: string[]) {
  const pid = await periodId(db, period);
  const cid = await companyId(db, ticker);
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test', ?, 'live') returning id`, pid, promptVersion) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, ?, 'completed') returning id`, run.id, cid, pass) as { id: string };
  for (const [field, value] of Object.entries(findings)) {
    const found = value !== null;
    const id = (await db.get(`insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
          anchor_mode, evidence_excerpt, abstained, abstention_reason, state, model, prompt_version)
       values (?, ?, 1, ?, ?, ?, 0.9, ?, ?, ?, ?, ?, 'test', ?) returning id`,
      run.id, job.id, cid, field, JSON.stringify(value), found ? "exact_normalized" : "none",
      found ? `the passage that says ${JSON.stringify(value)}` : null, found ? 0 : 1,
      found ? null : "None of the supplied documents say.", found ? "proposed" : "abstained",
      promptVersion) as { id: string }).id;
    if (found) {
      await db.run(`insert into finding_sources (finding_id, url, title, doc_type, source_tier)
          values (?, 'https://example.com/aif.pdf', 'Annual Information Form 2025', 'aif', 1)`, id);
    }
    if (accept.includes(field)) {
      await recordDecision(db, { periodId: pid, companyId: cid, fieldKey: field, decision: "accept", findingId: id });
    }
  }
}

/**
 * Q3 from the workbook, researched as production's was, and published:
 *
 *   NRTH  pass 1, its SEC registration accepted; pass 2 on 13 October, its
 *         auditor accepted -- before pass 2 asked for commodities and the
 *         financials
 *   STHC  pass 1, which found no SEC registration, and review accepted that
 *   ROYL  pass 1, its head office overridden; pass 2 under today's rules,
 *         auditor and commodities accepted
 *   CARY  pass 1, and nothing decided (Capstone Copper's case)
 *   DEVL, BLNK  never researched, and gone from TSX's August list
 */
async function researchedQ3(): Promise<Sql> {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [
    workbook("NRTH", "TSX", "Northco Mining Corp.", 5e9),
    workbook("STHC", "TSX", "Southco Resources Ltd.", 3.2e9),
    workbook("ROYL", "TSX", "Royalco Streaming Inc.", 8.4e9),
    workbook("CARY", "TSX", "Carryco Minerals Inc.", 3.1e8),
    workbook("DEVL", "TSXV", "Devco Development Ltd.", 4.5e8),
    workbook("BLNK", "TSX", "Blankco Holdings Inc.", 7.8e8),
  ] }, { label: Q3 });
  await research(db, Q3, "NRTH", "identity", OCTOBER_13,
                 { sec_registrant: { registrant: true, form: "40-F", cik: "1" } }, ["sec_registrant"]);
  await research(db, Q3, "NRTH", "general", OCTOBER_13,
                 { auditor: "KPMG LLP", audit_fee: { amount: 1, currency: "CAD", fiscal_year: 2025 } }, ["auditor"]);
  await research(db, Q3, "STHC", "identity", OCTOBER_13, { sec_registrant: null }, ["sec_registrant"]);
  await research(db, Q3, "ROYL", "identity", OCTOBER_13, { head_office_location: "Vancouver" }, []);
  await recordDecision(db, { periodId: await periodId(db, Q3), companyId: await companyId(db, "ROYL"),
                             fieldKey: "head_office_location", decision: "override", overrideValue: "Toronto",
                             reason: "The 2026 AIF moved it." });
  await research(db, Q3, "ROYL", "general", TODAY,
                 { auditor: "PwC LLP", commodities: ["Gold", "Silver"], total_revenue: null },
                 ["auditor", "commodities"]);
  await research(db, Q3, "CARY", "identity", OCTOBER_13, { sec_registrant: null }, []);
  return db;
}

async function tickers(db: Sql, period: string, scope: "unresearched" | "all", pass: Pass) {
  return (await scopeWithTickers(db, await periodId(db, period), scope, pass)).map((c) => c.ticker).sort();
}

async function actor(db: Sql, role: "admin" | "analyst") {
  await db.run("insert into app_users (email, role) values (?, ?)", `${role}@example.invalid`, role);
  const u = await db.get("select id from app_users where email = ?", `${role}@example.invalid`) as { id: string };
  return { id: u.id, role };
}

test("in a rolled-forward period, research carried from the last one is not offered again", async () => {
  const db = await researchedQ3();
  await publishPeriod(db, await periodId(db, Q3), { overrideReason: "test" });
  await commitTsxPeriod(db, AUGUST, { label: Q4 });

  // Pass 1: carried research counts -- an accepted registration (NRTH), an
  // accepted "found nothing" (STHC), an override (ROYL). What nobody decided
  // is not carried (CARY), and the newcomers were never researched.
  assert.deepEqual(await tickers(db, Q4, "unresearched", "identity"), ["CARY", "EDGE", "NEWC"]);
  assert.deepEqual(await tickers(db, Q4, "all", "identity"), ["CARY", "EDGE", "NEWC", "NRTH", "ROYL", "STHC"],
                   "the full re-run still reaches everyone, on purpose");

  // Pass 2: a carried website makes a company eligible. Northco's filing
  // fields were researched, but on 13 October, before pass 2 asked for
  // commodities and the financials, so it is offered again; Royalco has both.
  assert.deepEqual(await tickers(db, Q4, "unresearched", "general"), ["CARY", "NRTH", "STHC"]);
  assert.deepEqual(await tickers(db, Q4, "all", "general"), ["CARY", "NRTH", "ROYL", "STHC"]);

  // What /runs says beside the counts.
  const p1 = await passScopes(db, await periodId(db, Q4), "identity");
  assert.deepEqual({ eligible: p1.eligible, here: p1.doneHere, carried: p1.doneCarried, from: p1.carriedFrom },
                   { eligible: 6, here: 0, carried: 3, from: [Q3] });
  assert.match(scopeNote("identity", "unresearched", p1), /Leaves out 3 whose research was carried from Q3-2026/);
  assert.match(scopeNote("identity", "all", p1), /^Includes 3 whose research was carried .*pays for again/);
  const p2 = await passScopes(db, await periodId(db, Q4), "general");
  assert.deepEqual(p2.partly, [{ lacking: FIELD_GROUPS.general[1].label, n: 1 }]);
  assert.match(scopeNote("general", "unresearched", p2),
               /^Leaves out 1 whose research .* Includes 1 researched only in part, still without commodities and the financials\. Not yet done/);
});

test("a run in the period counts only for the fields it asked for", async () => {
  const db = await researchedQ3();
  const q3 = await periodId(db, Q3);
  // Northco's 13 October pass 2 is done for the filing fields, not for the
  // fields added on 16 and 17 October; Royalco's ran under today's rules.
  assert.deepEqual(await tickers(db, Q3, "unresearched", "general"), ["BLNK", "CARY", "DEVL", "NRTH", "STHC"]);
  // A pass 1 job counts whatever review made of it: it is waiting there.
  assert.deepEqual(await tickers(db, Q3, "unresearched", "identity"), ["BLNK", "DEVL"]);
  const p2 = await passScopes(db, q3, "general");
  assert.equal(p2.doneHere, 1);
  assert.deepEqual(p2.carriedFrom, []);
});

test("an override here keeps carried research counted, and so does a second quarter", async () => {
  const db = await researchedQ3();
  await publishPeriod(db, await periodId(db, Q3), { overrideReason: "test" });
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  const q4 = await periodId(db, Q4);
  const royl = await companyId(db, "ROYL");

  // Royalco's filing fields rest on its auditor alone. Overriding it in Q4
  // makes the value this period's, not a carried one: still researched.
  await recordDecision(db, { periodId: q4, companyId: royl, fieldKey: "auditor", decision: "override",
                             overrideValue: "Deloitte LLP", reason: "The 2026 circular names the change." });
  assert.ok(!(await tickers(db, Q4, "unresearched", "general")).includes("ROYL"));
  assert.equal((await passScopes(db, q4, "general")).doneHere, 1, "now partly this period's work");
  await undoLast(db, q4, "auditor", null);
  assert.ok(!(await tickers(db, Q4, "unresearched", "general")).includes("ROYL"), "undo goes back to the carried value");

  // A quarter later the research is six months old and still counts:
  // source_period_id names Q3, whose review settled it.
  await recordDecision(db, { periodId: q4, companyId: royl, fieldKey: "auditor", decision: "override",
                             overrideValue: "Deloitte LLP", reason: "The 2026 circular names the change." });
  await publishPeriod(db, q4, { overrideReason: "test" });
  await commitTsxPeriod(db, list("2026-11-30", AUGUST.companies), { label: Q1 });
  assert.deepEqual(await tickers(db, Q1, "unresearched", "identity"), ["CARY", "EDGE", "NEWC"]);
  assert.deepEqual(await tickers(db, Q1, "unresearched", "general"), ["CARY", "NRTH", "STHC"]);
  const p1 = await passScopes(db, await periodId(db, Q1), "general");
  assert.deepEqual(p1.carriedFrom, [Q3, Q4], "Royalco's auditor from Q4, its commodities from Q3");
});

test("starting a run takes the narrower scope, and a full re-run of carried research is Admin-only", async () => {
  const db = await researchedQ3();
  await publishPeriod(db, await periodId(db, Q3), { overrideReason: "test" });
  await commitTsxPeriod(db, AUGUST, { label: Q4 });
  const q4 = await periodId(db, Q4);
  const analyst = await actor(db, "analyst");
  const admin = await actor(db, "admin");

  // No finding yet in Q4, but a quarter's research carried into it.
  assert.ok(await periodHasResearch(db, q4));
  await assert.rejects(
    () => startRun(db, { periodId: q4, scope: "all", budgetUsd: 5, mode: "live", actor: analyst, pass: "identity" }),
    (e: unknown) => e instanceof StartRefused && /carries research from an earlier one, is Admin-only/.test((e as Error).message));
  await assert.rejects(
    () => startRun(db, { periodId: q4, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst,
                         pass: "identity", tickers: ["NRTH"] }),
    /NRTH is not in this scope .*carried here/);

  const r = await startRun(db, { periodId: q4, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst,
                                 pass: "identity" });
  assert.equal(r.jobs, 3);
  assert.equal(r.estimate.estimatedUsd, 0.9, "three companies at US$0.30, not six");
  assert.deepEqual(await scopeCompanies(db, q4, "unresearched", "identity"), [], "in flight, not offered twice");

  await db.run("update enrichment_jobs set state = 'completed'");
  await db.run("update enrichment_runs set status = 'completed'");
  const all = await startRun(db, { periodId: q4, scope: "all", budgetUsd: 5, mode: "live", actor: admin,
                                   pass: "identity" });
  assert.equal(all.jobs, 6, "an Admin can still research everyone again");
});

test("values carried from the workbook are not research, so their full run is not Admin-only", async () => {
  const db = memorySql();
  await commitPeriod(db, { period: "2026-05-31", companies: [workbook("NRTH", "TSX", "Northco Mining Corp.", 5e9)] },
                     { label: Q3 });
  await publishPeriod(db, await periodId(db, Q3), { overrideReason: "test" });
  await commitTsxPeriod(db, list("2026-08-31", [issuer("NRTH", "TSX", "Northco Mining Corp.", 5.4e9)]), { label: Q4 });
  const q4 = await periodId(db, Q4);
  assert.equal((await db.get(`select source from company_period_field_values
      where period_id = ? and field_key = 'website'`, q4) as { source: string }).source, "inherited");
  assert.equal(await periodHasResearch(db, q4), false);
  assert.deepEqual(await tickers(db, Q4, "unresearched", "identity"), ["NRTH"]);
  assert.deepEqual(await tickers(db, Q4, "unresearched", "general"), ["NRTH"]);
});

test("every field pass 2 reads belongs to a group, and today's rules ask for every group", () => {
  const grouped = new Set(Object.values(FIELD_GROUPS).flat().flatMap((g) => g.fields));
  for (const f of EXTRACTED_FIELDS) assert.ok(grouped.has(f), `${f} is in no group, so no run would count it`);
  for (const f of ["website", "sec_registrant"]) assert.ok(grouped.has(f));
  for (const g of Object.values(FIELD_GROUPS).flat()) {
    assert.ok(askedFor(g, TODAY), `${g.key}: a run started today must count for it`);
  }
  // Pass 2's groups leave out what pass 1 also finds, so pass 1 alone never marks pass 2 done.
  const pass1 = new Set(FIELD_GROUPS.identity.flatMap((g) => g.fields));
  for (const g of FIELD_GROUPS.general) for (const f of g.fields) assert.ok(!pass1.has(f), f);
});

test("a run's rules are read from its prompt version and compared as numbers", () => {
  assert.equal(liveRulesOf("2026-09-04.1+live.2026-10-17.1"), "2026-10-17.1");
  assert.equal(liveRulesOf("2026-09-04.1"), null, "replay names no live rules");
  assert.equal(liveRulesOf(TODAY), LIVE_RULES_VERSION);
  assert.equal(compareRules("2026-10-09.1", "2026-10-17.1"), -1);
  assert.equal(compareRules("2026-10-17.10", "2026-10-17.9"), 1, "not as text");
  assert.equal(compareRules("2026-10-17.1", "2026-10-17.1"), 0);
  const october = FIELD_GROUPS.general[1];
  assert.equal(askedFor(october, OCTOBER_13), false);
  assert.equal(askedFor(october, "2026-09-04.1+live.2026-10-16.1"), false, "commodities but not the financials");
  assert.equal(askedFor(october, "2026-09-04.1"), true, "replay counts as it always has");
  assert.equal(askedFor(FIELD_GROUPS.general[0], OCTOBER_13), true);
});

test("the ERP change signal is its own group, so research from before 22 October does not claim it", () => {
  const signal = FIELD_GROUPS.general.find((g) => g.fields.includes("erp_change"))!;
  assert.equal(signal.since, "2026-10-22.1");
  assert.deepEqual([...signal.fields], ["erp_change"], "nothing older is folded into it");
  assert.equal(askedFor(signal, "2026-09-04.1+live.2026-10-21.1"), false, "the fee runs of 21 October did not ask");
  assert.equal(askedFor(signal, "2026-09-04.1+live.2026-10-22.1"), true);
  assert.ok(compareRules(LIVE_RULES_VERSION, signal.since!) >= 0, "today's rules ask for it");
  assert.equal(signal.required, false,
               "a signal most filings are silent on would leave every carried company not yet done");
  assert.ok(FIELD_GROUPS.general.filter((g) => g.required !== false).every((g) => g.fields.length > 1),
            "the groups that decide what is done are the two halves, as before");
});
