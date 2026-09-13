import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { drain } from "./drain.ts";
import {
  CONFIRM_ABOVE, estimate, parseTickers, scopeCompanies, startRun, StartRefused,
} from "./start.ts";
import { BATCH_DISCOUNT } from "./scope.ts";
import { seedFixtureDatabase } from "../../../tests/cassettes/build_cassettes.mjs";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

function seeded() {
  return seedFixtureDatabase() as {
    db: Sql; periodId: string;
    companies: Array<{ id: string; name: string; ticker: string }>;
  };
}

async function actor(db: Sql, role: "admin" | "analyst") {
  await db.run("insert into app_users (email, role) values (?, ?)", `${role}@example.invalid`, role);
  const u = await db.get("select id from app_users where email = ?", `${role}@example.invalid`) as { id: string };
  return { id: u.id, role };
}

test("a run is created for the scope, audited, and attributed to who started it", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  const r = await startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "replay", actor: analyst });
  assert.equal(r.jobs, 2);
  assert.equal(r.estimate.count, 2);

  const run = await db.get("select created_by, mode, budget_usd, status from enrichment_runs where id = ?", r.runId) as
    Record<string, unknown>;
  assert.equal(run.created_by, analyst.id);
  assert.equal(run.mode, "replay");
  assert.equal(run.budget_usd, 5);
  assert.equal(run.status, "queued");

  const audit = await db.get("select detail from audit_log where event = 'run_started'") as { detail: string };
  const detail = JSON.parse(audit.detail);
  assert.equal(detail.runId, r.runId);
  assert.equal(detail.companies, 2);
});

test("one run at a time", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  await startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "replay", actor: analyst });
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "replay", actor: analyst }),
    (e: unknown) => e instanceof StartRefused && /already in progress/.test((e as Error).message));
});

test("the unresearched scope excludes companies with findings, and a full re-run is then Admin-only", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  const admin = await actor(db, "admin");
  await startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "replay", actor: analyst });
  const out = await drain(db, { deadlineSeconds: 60, mode: "replay", cassetteDir: CASSETTE_DIR });
  assert.equal(out.jobsCompleted, 2);

  assert.deepEqual(await scopeCompanies(db, periodId, "unresearched"), []);
  assert.equal((await scopeCompanies(db, periodId, "all")).length, 2);

  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "replay", actor: analyst }),
    /Nothing to research/);
  await assert.rejects(
    () => startRun(db, { periodId, scope: "all", budgetUsd: 5, mode: "replay", actor: analyst }),
    /Admin-only/);
  const again = await startRun(db, { periodId, scope: "all", budgetUsd: 5, mode: "replay", actor: admin });
  assert.equal(again.jobs, 2);
});

test("the estimate blocks: over budget is refused, and a large scope needs its count typed", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 0.10, mode: "replay", actor: analyst }),
    /estimate is US\$0\.50 against a budget of US\$0\.10/);

  const big = estimate(CONFIRM_ABOVE + 1, 1000);
  assert.equal(big.needsTypedCount, true);
  assert.equal(estimate(CONFIRM_ABOVE, 1000).needsTypedCount, false);
  assert.equal(big.exceedsBudget, false);
  assert.ok(big.estimatedMinutes >= 1);

  // Live estimates are per pass, from Run 1: the fields pass costs about half
  // the identity pass, so one flat figure over-refused pass 2 runs.
  assert.equal(estimate(10, 1000, "identity").estimatedUsd, 3);
  assert.equal(estimate(10, 1000, "general").estimatedUsd, 1.5);
  assert.equal(estimate(10, 1000).estimatedUsd, 2.5, "replay keeps the design's figure");
});

test("pass 1 covers every company; pass 2 only those with a website the application trusts", async () => {
  const { db, periodId, companies } = seeded();
  const analyst = await actor(db, "analyst");
  assert.equal((await scopeCompanies(db, periodId, "unresearched", "identity")).length, 2);
  assert.deepEqual(await scopeCompanies(db, periodId, "unresearched", "general"), []);
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst, pass: "general" }),
    /Accept websites from pass 1 first/);

  const r = await startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst, pass: "identity" });
  const groups = await db.all("select distinct field_group from enrichment_jobs where run_id = ?", r.runId) as Array<{ field_group: string }>;
  assert.deepEqual(groups.map((g) => g.field_group), ["identity"]);
  // Pass 1 in flight: not offered again.
  assert.deepEqual(await scopeCompanies(db, periodId, "unresearched", "identity"), []);

  // An accepted website makes that company eligible for pass 2, and only that one.
  await db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
      values (?, ?, 'website', '"https://northco.invalid"', 'ai_accepted', 'asserted')`, periodId, companies[0].id);
  assert.deepEqual(await scopeCompanies(db, periodId, "unresearched", "general"), [companies[0].id]);
});

test("a run can be narrowed to named tickers, and a ticker outside the scope is refused, not added", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  assert.deepEqual(parseTickers(" nrth, royl;nrth  "), ["NRTH", "ROYL"]);
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst,
                         pass: "identity", tickers: ["NRTH", "ZZZZ"] }),
    /ZZZZ is not in this scope/);
  const r = await startRun(db, { periodId, scope: "unresearched", budgetUsd: 5, mode: "live", actor: analyst,
                                 pass: "identity", tickers: ["nrth"] });
  assert.equal(r.jobs, 1);
  const audit = JSON.parse((await db.get("select detail from audit_log where event = 'run_started'") as { detail: string }).detail);
  assert.deepEqual(audit.tickers, ["NRTH"]);
});

test("a typed count must match the scope exactly", async () => {
  const { db, periodId } = seeded();
  const analyst = await actor(db, "analyst");
  // Make the scope large enough to need confirmation.
  for (let i = 0; i < CONFIRM_ABOVE; i++) {
    await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id) values (?, ?, ?)`,
                 `Bulk ${i} Inc.`, `bulk ${i}`, periodId);
    const c = await db.get("select id from companies where name_normalized = ?", `bulk ${i}`) as { id: string };
    await db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
                  values (?, ?, 'property_regions', '{}', 'extract', 'asserted')`, periodId, c.id);
  }
  const n = (await scopeCompanies(db, periodId, "unresearched")).length;
  assert.ok(n > CONFIRM_ABOVE);
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 100, mode: "replay", actor: analyst }),
    /Type that number/);
  await assert.rejects(
    () => startRun(db, { periodId, scope: "unresearched", budgetUsd: 100, mode: "replay", actor: analyst, confirmCount: n - 1 }),
    /Type that number/);
  const ok = await startRun(db, { periodId, scope: "unresearched", budgetUsd: 100, mode: "replay", actor: analyst, confirmCount: n });
  assert.equal(ok.jobs, n);
});


test("a batched run is estimated at half price, and the screen is told so", async () => {
  // The flag halves what a run costs. An estimate that did not know would quote
  // Run 3 at US$80 when it is US$40 -- and a number that is quietly half of what
  // it was is worse than no number, which is why /runs says "Batched" too.
  const live = estimate(229, 200, "identity");
  const batched = estimate(229, 200, "identity", true);
  assert.ok(live.estimatedUsd > 0);
  assert.equal(batched.estimatedUsd, Math.round(live.estimatedUsd * 0.5 * 100) / 100);
  assert.equal(batched.count, live.count, "the same companies, at a different price");
});

test("the estimate and the meter cannot disagree about a batched company", async () => {
  // Both read BATCH_DISCOUNT from scope.ts. Two copies of one number is how a
  // budget halts a run at half its cap, or fails to halt it at twice.
  assert.equal(BATCH_DISCOUNT, 0.5);
});
