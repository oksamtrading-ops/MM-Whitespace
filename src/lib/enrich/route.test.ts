import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { claimJobs, ensureSlots, transition } from "./ledger.ts";
import { createRun, retryDelayMs, routeFailure } from "./worker.ts";
import { seedFixtureDatabase } from "../../../tests/cassettes/build_cassettes.mjs";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

/**
 * An error shaped the way @anthropic-ai/sdk 0.125.0 builds one: `status`,
 * the parsed body under `error`, and a Headers object. Built by hand so this
 * suite still runs with no node_modules; scripts/s3_probe.mjs checks the
 * same shape against the real SDK and the live API.
 */
function vendorError(status: number, type: string, message: string,
                     extra: { details?: Record<string, string>; retryAfter?: string } = {}) {
  const err = new Error(`${status} ${message}`) as Error & Record<string, unknown>;
  err.status = status;
  err.error = { type: "error", error: { type, message, ...(extra.details ? { details: extra.details } : {}) } };
  err.headers = new Headers(extra.retryAfter ? { "retry-after": extra.retryAfter } : {});
  return err;
}

/** A run of both fixture companies with one job claimed and in research, as processJob leaves it. */
async function inResearch() {
  const { db, periodId, companies } = seedFixtureDatabase() as {
    db: Sql; periodId: string; companies: Array<{ id: string }>;
  };
  const { runId } = await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, 1);
  const [job] = await claimJobs(db, runId, "w1", 1);
  await transition(db, job.id, "researching", { chargeAttempt: true });
  const read = async () => await db.get(
    "select state, attempts, available_at, last_error from enrichment_jobs where id = ?", job.id) as
    { state: string; attempts: number; available_at: string | null; last_error: string | null };
  return { db, runId, jobId: job.id, read };
}

test("a spend limit you set halts the whole run, with the vendor's words as the reason", async () => {
  const { db, runId, jobId, read } = await inResearch();
  const outcome = await routeFailure(db, runId, jobId, vendorError(400, "invalid_request_error",
    "You have reached your specified workspace API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."));
  assert.equal(outcome, "halt");

  const run = await db.get("select status, halt_reason from enrichment_runs where id = ?", runId) as
    { status: string; halt_reason: string };
  assert.equal(run.status, "halted");
  assert.match(run.halt_reason, /specified workspace API usage limits/);
  // The failing job and the one nobody had reached yet: halted, both of them.
  // Not dead-lettered -- that is the one-at-a-time failure this exists to stop.
  assert.equal((await read()).state, "halted");
  const states = await db.all("select state from enrichment_jobs where run_id = ?", runId) as Array<{ state: string }>;
  assert.deepEqual(states.map((s) => s.state), ["halted", "halted"]);
});

test("the tier's spend cap halts too, recognised by its error_code", async () => {
  const { db, runId, jobId } = await inResearch();
  assert.equal(await routeFailure(db, runId, jobId, vendorError(429, "rate_limit_error",
    "You have reached your API usage limits.", { details: { error_code: "enforced_spend_limit_reached" } })),
    "halt");
});

test("a rate limit goes back to the queue, not before the vendor's retry-after", async () => {
  const { db, runId, jobId, read } = await inResearch();
  const now = Date.parse("2026-09-11T12:00:00Z");
  const outcome = await routeFailure(db, runId, jobId,
    vendorError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit",
                { retryAfter: "120" }), now);
  assert.equal(outcome, "retry");
  const job = await read();
  assert.equal(job.state, "queued");
  assert.equal(job.attempts, 1, "a throttled attempt still counts");
  assert.ok(job.available_at! >= "2026-09-11 12:02:00", `available_at ${job.available_at}`);
  assert.match(job.last_error!, /rate limit/);
  const run = await db.get("select status from enrichment_runs where id = ?", runId) as { status: string };
  assert.notEqual(run.status, "halted");
});

test("an overloaded vendor charges no attempt", async () => {
  const { db, runId, jobId, read } = await inResearch();
  assert.equal(await routeFailure(db, runId, jobId, vendorError(529, "overloaded_error", "Overloaded")), "retry");
  assert.equal((await read()).attempts, 0);
});

test("a retryable failure on the last attempt is abandoned, with both reasons", async () => {
  const { db, runId, jobId, read } = await inResearch();
  await db.run("update enrichment_jobs set attempts = max_attempts where id = ?", jobId);
  assert.equal(await routeFailure(db, runId, jobId, vendorError(500, "api_error", "Internal server error")),
               "dead_letter");
  const job = await read();
  assert.equal(job.state, "dead_letter");
  assert.match(job.last_error!, /attempts exhausted; last: .*Internal server error/);
});

test("a malformed request is this job's problem alone", async () => {
  const { db, runId, jobId, read } = await inResearch();
  assert.equal(await routeFailure(db, runId, jobId,
    vendorError(400, "invalid_request_error", "max_tokens: Field required")), "dead_letter");
  assert.equal((await read()).state, "dead_letter");
  const run = await db.get("select status from enrichment_runs where id = ?", runId) as { status: string };
  assert.notEqual(run.status, "halted");
});

test("bad credentials halt the run: every job would fail the same way", async () => {
  const { db, runId, jobId } = await inResearch();
  // The body the live API returned to spike S3 for a mis-pasted key.
  assert.equal(await routeFailure(db, runId, jobId,
    vendorError(401, "authentication_error", "invalid x-api-key")), "halt");
});

test("backoff honours retry-after, grows with attempts, and is capped", () => {
  const none = () => 0;
  const withHeader = { headers: new Headers({ "retry-after": "300" }) };
  assert.equal(retryDelayMs(withHeader, 1, none), 300_000);
  assert.equal(retryDelayMs({}, 1, none), 30_000);
  assert.equal(retryDelayMs({}, 2, none), 60_000);
  assert.equal(retryDelayMs({}, 20, none), 15 * 60_000);
  assert.ok(retryDelayMs({}, 1, () => 0.999) < 35_000, "jitter stays under five seconds");
});
