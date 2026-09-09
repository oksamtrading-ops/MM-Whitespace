import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import { derivePhase, listRuns, readRunStatus, STALL_SECONDS } from "./runstatus.ts";

/* docs/design/03 names seven states and the database stores five. These are
   the two it does not, and they are the two that matter most. */

test("a completed run that abandoned jobs did not simply complete", () => {
  assert.equal(derivePhase("completed", { unfinished: 0, deadLetters: 0, secondsSinceProgress: 10 }),
               "completed");
  assert.equal(derivePhase("completed", { unfinished: 0, deadLetters: 3, secondsSinceProgress: 10 }),
               "completed_with_errors",
               "three companies were abandoned; reporting that as success is the lie");
});

test("a running run with nothing moving for three minutes is stalled", () => {
  const running = (secondsSinceProgress: number, unfinished = 5) =>
    derivePhase("running", { unfinished, deadLetters: 0, secondsSinceProgress });
  assert.equal(running(STALL_SECONDS - 1), "running");
  assert.equal(running(STALL_SECONDS), "stalled");
  assert.equal(running(9999, 0), "running",
    "with no work left there is nothing to be stalled on");
});

test("a run awaiting a batch is not stalled, however long it waits", () => {
  // Calling a deliberate wait a stall teaches an Analyst to ignore the word on
  // the one occasion it means something.
  assert.equal(derivePhase("awaiting_batch",
    { unfinished: 40, deadLetters: 0, secondsSinceProgress: 6 * 3600 }), "awaiting_batch");
});

test("halted and failed are reported as themselves, never as progress", () => {
  assert.equal(derivePhase("halted", { unfinished: 90, deadLetters: 0, secondsSinceProgress: 1 }),
               "halted");
  assert.equal(derivePhase("failed", { unfinished: 90, deadLetters: 2, secondsSinceProgress: 1 }),
               "failed");
});

/* ------------------------------------------------------------ end to end */

function seeded() {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  db.prepare("insert into periods (label, market_cap_as_of) values ('P1','2026-05-31')").run();
  const period = db.prepare("select id from periods").get() as { id: string };
  db.prepare("insert into companies (canonical_name, name_normalized) values ('Northco','northco')")
    .run();
  const company = db.prepare("select id from companies").get() as { id: string };
  db.prepare(
    `insert into enrichment_runs (period_id, status, budget_usd, spend_usd, model, prompt_version, mode)
     values (?, 'running', 25, 20, 'test-model', 'v1', 'replay')`).run(period.id);
  const run = db.prepare("select id from enrichment_runs").get() as { id: string };
  return { db, periodId: period.id, companyId: company.id, runId: run.id };
}

function job(db: DatabaseSync, runId: string, companyId: string,
             state: string, updatedAt: string, lease: string | null = null) {
  db.prepare(
    `insert into enrichment_jobs (run_id, company_id, field_group, state, updated_at,
                                  lease_expires_at, attempts, last_error)
     values (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(runId, companyId, `g${Math.random()}`, state, updatedAt, lease,
        state === "dead_letter" ? "rate limit, three times" : null);
}

const stamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

test("a worker that died holding its jobs shows as stalled, with the leases counted", () => {
  const { db, periodId, companyId, runId } = seeded();
  const now = Date.parse("2026-09-09T12:00:00Z");
  const longAgo = stamp(now - 10 * 60 * 1000);
  job(db, runId, companyId, "completed", longAgo);
  job(db, runId, companyId, "researching", longAgo, stamp(now - 5 * 60 * 1000));
  job(db, runId, companyId, "queued", longAgo);

  const status = readRunStatus(db, runId, now)!;
  assert.equal(status.phase, "stalled");
  assert.equal(status.storedStatus, "running", "the database still believes it is running");
  assert.equal(status.expiredLeases, 1);
  assert.equal(status.total, 3);
  assert.equal(status.finished, 1);
  assert.equal(status.pct, 33.3);
  assert.ok(status.secondsSinceProgress! >= STALL_SECONDS);
  assert.equal(status.budget.warn, true, "80% of the budget is spent");
  assert.equal(status.budget.halt, false);
});

test("the same run, moving, is running and not stalled", () => {
  const { db, companyId, runId } = seeded();
  const now = Date.parse("2026-09-09T12:00:00Z");
  job(db, runId, companyId, "completed", stamp(now - 5 * 1000));
  job(db, runId, companyId, "queued", stamp(now - 5 * 1000));
  assert.equal(readRunStatus(db, runId, now)!.phase, "running");
});

test("abandoned jobs are named with the error that abandoned them", () => {
  const { db, periodId, companyId, runId } = seeded();
  const now = Date.parse("2026-09-09T12:00:00Z");
  db.prepare("update enrichment_runs set status = 'completed' where id = ?").run(runId);
  job(db, runId, companyId, "completed", stamp(now));
  job(db, runId, companyId, "dead_letter", stamp(now));

  const status = readRunStatus(db, runId, now)!;
  assert.equal(status.phase, "completed_with_errors");
  assert.equal(status.deadLetters.length, 1);
  assert.equal(status.deadLetters[0].companyName, "Northco");
  assert.match(status.deadLetters[0].lastError!, /rate limit/);
  assert.equal(listRuns(db, periodId, now).length, 1);
});

test("a run with no jobs yet is queued, not stalled and not complete", () => {
  const { db, runId } = seeded();
  db.prepare("update enrichment_runs set status = 'queued' where id = ?").run(runId);
  const status = readRunStatus(db, runId, Date.now())!;
  assert.equal(status.phase, "queued");
  assert.equal(status.total, 0);
  assert.equal(status.pct, 0, "no jobs is not a hundred per cent done");
});
