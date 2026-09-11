import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { drain } from "./drain.ts";
import { claimSlot, ensureSlots, nextClaimableRun, settleRun, WORKER_SLOTS } from "./ledger.ts";
import { createRun } from "./worker.ts";
import { seedFixtureDatabase } from "../../../tests/cassettes/build_cassettes.mjs";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

function seeded() {
  return seedFixtureDatabase() as {
    db: Sql; periodId: string;
    companies: Array<{ id: string; name: string; ticker: string }>;
  };
}

const opts = { deadlineSeconds: 60, mode: "replay" as const, cassetteDir: CASSETTE_DIR, host: "test" };

test("a worker drains every queued job across a run and settles the run", async () => {
  const { db, periodId, companies } = seeded();
  const { runId } = await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });

  const out = await drain(db, opts);
  assert.equal(out.reason, "drained");
  assert.equal(out.jobsCompleted, 2);
  assert.equal(out.jobsFailed, 0);
  assert.equal(out.workRemains, false);

  const run = await db.get("select status, completed_at from enrichment_runs where id = ?", runId) as
    { status: string; completed_at: string | null };
  assert.equal(run.status, "completed", "the run's stored status follows its jobs");
  assert.ok(run.completed_at);

  // The slot was given back, and the invocation was recorded end to end.
  const slots = await db.get("select count(*) n from worker_slots where leased_by is not null") as { n: number };
  assert.equal(slots.n, 0);
  const rec = await db.get("select end_reason, jobs_completed, ended_at from worker_runs where id = ?", out.workerRunId) as
    Record<string, unknown>;
  assert.equal(rec.end_reason, "drained");
  assert.equal(rec.jobs_completed, 2);
  assert.ok(rec.ended_at);
});

test("a company with no recording is abandoned with the reason, and the worker carries on", async () => {
  const { db, periodId, companies } = seeded();
  await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id)
                values ('Ghostco Ltd.', 'ghostco', ?)`, periodId);
  const ghost = await db.get("select id from companies where name_normalized = 'ghostco'") as { id: string };
  const { runId } = await createRun(db, periodId, [ghost.id, ...companies.map((c) => c.id)],
                                    { cassetteDir: CASSETTE_DIR });

  const out = await drain(db, opts);
  assert.equal(out.jobsCompleted, 2);
  assert.equal(out.jobsFailed, 1);
  assert.match(out.lastError ?? "", /cassette miss/);

  const dead = await db.get(`select state, last_error from enrichment_jobs where run_id = ? and company_id = ?`,
                            runId, ghost.id) as { state: string; last_error: string };
  assert.equal(dead.state, "dead_letter");
  assert.match(dead.last_error, /cassette miss/);

  // "Completed with errors" is derived from exactly this shape.
  const run = await db.get("select status from enrichment_runs where id = ?", runId) as { status: string };
  assert.equal(run.status, "completed");
});

test("a worker stops at its deadline and reports that work remains", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });

  // A clock that is already past the deadline: nothing may be claimed.
  let t = 1_000_000;
  const out = await drain(db, { ...opts, deadlineSeconds: 0, now: () => (t += 1) });
  assert.equal(out.reason, "deadline");
  assert.equal(out.jobsCompleted, 0);
  assert.equal(out.workRemains, true, "the caller uses this to ask for a successor");
});

test("a worker with no free slot exits at the door and holds nothing", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, WORKER_SLOTS);
  for (let i = 1; i <= WORKER_SLOTS; i++) assert.ok(await claimSlot(db, `other-${i}`));

  const out = await drain(db, opts);
  assert.equal(out.reason, "no_slot");
  const queued = await db.get("select count(*) n from enrichment_jobs where state = 'queued'") as { n: number };
  assert.equal(queued.n, 2, "nothing was claimed");
});

test("an empty ledger is 'no work', not an error", async () => {
  const { db } = seeded();
  const out = await drain(db, opts);
  assert.equal(out.reason, "no_work");
  assert.equal(out.workRemains, false);
});

test("a probe holds the invocation open and heartbeats until the deadline, doing no work", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });

  let t = 1_000_000;
  const slept: number[] = [];
  const out = await drain(db, {
    ...opts, probe: true, deadlineSeconds: 90,
    now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; },
  });
  assert.equal(out.reason, "probe");
  assert.deepEqual(slept, [30_000, 30_000, 30_000], "heartbeat-sized steps");
  const queued = await db.get("select count(*) n from enrichment_jobs where state = 'queued'") as { n: number };
  assert.equal(queued.n, 2, "a probe never claims a job");
  const rec = await db.get("select probe, deadline_seconds from worker_runs where id = ?", out.workerRunId) as
    { probe: number; deadline_seconds: number };
  assert.equal(rec.probe, 1);
  assert.equal(rec.deadline_seconds, 90);
});

test("the next claimable run skips a run whose jobs are all backing off", async () => {
  const { db, periodId, companies } = seeded();
  const a = await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  const b = await createRun(db, periodId, [companies[1].id], { cassetteDir: CASSETTE_DIR });
  await db.run("update enrichment_jobs set available_at = '2999-01-01 00:00:00' where run_id = ?", a.runId);
  assert.equal(await nextClaimableRun(db), b.runId);
  await db.run("update enrichment_jobs set available_at = null where run_id = ?", a.runId);
  assert.equal(await nextClaimableRun(db), a.runId, "the older run comes first once it is claimable");
});

test("settleRun reports but never overrides a halted run", async () => {
  const { db, periodId, companies } = seeded();
  const { runId } = await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  await db.run("update enrichment_runs set status = 'halted' where id = ?", runId);
  await db.run("update enrichment_jobs set state = 'halted' where run_id = ?", runId);
  assert.equal(await settleRun(db, runId), "halted");
  const run = await db.get("select status from enrichment_runs where id = ?", runId) as { status: string };
  assert.equal(run.status, "halted");
});
