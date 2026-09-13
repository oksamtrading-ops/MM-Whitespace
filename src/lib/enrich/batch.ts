/**
 * The Batch API: submit, poll, settle.
 *
 * docs/design/03 called for this and the ledger has held a place for it since
 * migration 0004 -- `awaiting_batch`, and a `batch_id` on the job -- but
 * nothing ever submitted one, so all 30 companies of Runs 1 and 2 were
 * researched at full price. Batched requests cost half, and the quarterly run
 * is the textbook batch workload: 259 companies, no human waiting.
 *
 * IT IS WORTH IT BECAUSE EACH PASS IS ONE REQUEST. Discovery looks like an
 * agentic loop -- up to six turns -- but its web searches happen inside a
 * single call, because the search tool is server-side. Run 2 settles it: all
 * 30 identity jobs and 40 of 41 field jobs made exactly one vendor call. So
 * both passes batch, and the rare company that needs a second turn is
 * finished synchronously when its answer is read (live.continueDiscovery),
 * rather than being thrown away.
 *
 * WHAT IT DOES NOT CHANGE. The fetching stays synchronous and stays in the
 * worker: pass 2 must read the filings before it can ask about them. Only the
 * model call moves.
 *
 * OFF UNLESS ASKED. `MM_ENRICH_BATCH=1`. Nothing here has been exercised
 * against the real Batch API -- the tests drive a fake one -- so switching it
 * on is a deliberate act, and the synchronous path remains the default.
 */
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import type { VendorMessage } from "./live.ts";

/** Off unless a deployment says otherwise. */
export const BATCH_ENABLED = process.env.MM_ENRICH_BATCH === "1";

/**
 * How many requests go in one batch.
 *
 * The API takes up to 100,000, but a batch is also the unit of waiting: every
 * company in it is held until the last one is answered. A run of 259 in four
 * batches keeps a stall from holding the whole period, and keeps a worker's
 * submit step inside one invocation.
 */
export const BATCH_SIZE = 64;

export type BatchRequest = { custom_id: string; params: Record<string, unknown> };

export type BatchResult = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: VendorMessage }
    | { type: "errored"; error: unknown }
    | { type: "expired" }
    | { type: "canceled" };
};

export type BatchHandle = {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts?: { processing?: number; succeeded?: number; errored?: number;
                     canceled?: number; expired?: number };
  expires_at?: string | null;
};

/** The three calls this needs, so a test can supply all three. */
export type BatchVendor = {
  create(requests: BatchRequest[]): Promise<BatchHandle>;
  retrieve(vendorBatchId: string): Promise<BatchHandle>;
  results(vendorBatchId: string): Promise<AsyncIterable<BatchResult>>;
};

export async function sdkBatchVendor(): Promise<BatchVendor> {
  // Dynamic, exactly as live.sdkVendor is: the SDK is an optional runtime
  // dependency and the test suite must not need it installed.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout: 5 * 60_000, maxRetries: 2 });
  return {
    create: (requests) =>
      client.messages.batches.create({ requests: requests as never }) as unknown as Promise<BatchHandle>,
    retrieve: (id) => client.messages.batches.retrieve(id) as unknown as Promise<BatchHandle>,
    results: async (id) =>
      await client.messages.batches.results(id) as unknown as AsyncIterable<BatchResult>,
  };
}

export type BatchRow = {
  id: string; run_id: string; vendor_batch_id: string | null; state: string;
  request_count: number; expires_at: string | null;
};

export type BatchRequestRow = {
  id: string; batch_id: string; job_id: string; custom_id: string;
  attempt: number; context: string; state: string;
};

/** One prepared job, waiting to be asked. */
export type Submission = {
  jobId: string;
  attempt: number;
  request: Record<string, unknown>;
  /** What resume will need; stored, because the submitting worker will be gone. */
  context: Record<string, unknown>;
};

/**
 * Send one batch and hand its jobs over to it.
 *
 * The vendor's id is written BEFORE the jobs move to awaiting_batch. A crash
 * between the two leaves a batch nothing points at -- visible, pollable, and
 * paid for -- whereas the other order leaves jobs waiting on a batch whose id
 * was never recorded, which nothing can ever settle.
 */
export async function submitBatch(
  db: Sql, runId: string, submissions: readonly Submission[], vendor: BatchVendor,
  now: () => number = Date.now,
): Promise<{ batchId: string; vendorBatchId: string; count: number }> {
  if (submissions.length === 0) throw new Error("a batch needs at least one request");

  const batch = await db.get(
    `insert into enrichment_batches (run_id, state, request_count, created_at)
     values (?, 'submitting', ?, ?) returning id`,
    runId, submissions.length, formatStamp(now())) as { id: string };

  // custom_id is the only thing the vendor echoes back, so it names the
  // request row and nothing else has to be inferred from position.
  const requests = submissions.map((s, i) => ({
    custom_id: `job-${s.jobId}-${s.attempt}-${i}`,
    params: s.request,
  }));

  let handle: BatchHandle;
  try {
    handle = await vendor.create(requests);
  } catch (err) {
    await db.run(`update enrichment_batches set state = 'failed', last_error = ? where id = ?`,
                 String((err as Error).message).slice(0, 500), batch.id);
    throw err;
  }

  await db.run(
    `update enrichment_batches set vendor_batch_id = ?, state = 'in_progress', expires_at = ?
      where id = ?`, handle.id, handle.expires_at ?? null, batch.id);

  for (const [i, s] of submissions.entries()) {
    await db.run(
      `insert into enrichment_batch_requests (batch_id, job_id, custom_id, attempt, context, created_at)
       values (?, ?, ?, ?, ?, ?)`,
      batch.id, s.jobId, requests[i].custom_id, s.attempt,
      JSON.stringify(s.context ?? {}), formatStamp(now()));
    await db.run("update enrichment_jobs set batch_id = ? where id = ?", handle.id, s.jobId);
  }

  return { batchId: batch.id, vendorBatchId: handle.id, count: submissions.length };
}

/** Batches that still owe an answer, or owe their results being read. */
export async function openBatches(db: Sql): Promise<BatchRow[]> {
  return await db.all(
    `select id, run_id, vendor_batch_id, state, request_count, expires_at
       from enrichment_batches
      where state in ('in_progress', 'ended') and vendor_batch_id is not null
      order by created_at`) as BatchRow[];
}

/** How many batches are waiting. The tick asks this and nothing more. */
export async function openBatchCount(db: Sql): Promise<number> {
  return Number((await db.get(
    `select count(*) n from enrichment_batches
      where state in ('in_progress', 'ended') and vendor_batch_id is not null`) as { n: number }).n);
}

/** Ask the vendor whether a batch has finished; record the answer either way. */
export async function pollBatch(
  db: Sql, batch: BatchRow, vendor: BatchVendor, now: () => number = Date.now,
): Promise<boolean> {
  const handle = await vendor.retrieve(batch.vendor_batch_id!);
  const ended = handle.processing_status === "ended";
  await db.run(
    `update enrichment_batches set polled_at = ?, state = ?, ended_at = ? where id = ?`,
    formatStamp(now()), ended ? "ended" : batch.state,
    ended ? formatStamp(now()) : null, batch.id);
  return ended;
}

export type SettleOutcome = "succeeded" | "errored" | "expired" | "canceled";

/**
 * Read an ended batch's results and hand each to `onResult`.
 *
 * Results arrive in ANY order, keyed by custom_id -- never by position -- so
 * each is matched to its request row by that id. A result whose row is gone,
 * or already settled, is skipped rather than applied twice: settling is
 * re-entrant because a worker can die halfway through a download.
 */
export async function settleBatch(
  db: Sql, batch: BatchRow, vendor: BatchVendor,
  onResult: (row: BatchRequestRow, result: BatchResult["result"]) => Promise<void>,
  now: () => number = Date.now,
): Promise<Record<SettleOutcome, number>> {
  const rows = await db.all(
    `select id, batch_id, job_id, custom_id, attempt, context, state
       from enrichment_batch_requests where batch_id = ?`, batch.id) as BatchRequestRow[];
  const byCustomId = new Map(rows.map((r) => [r.custom_id, r]));
  const tally: Record<SettleOutcome, number> = { succeeded: 0, errored: 0, expired: 0, canceled: 0 };

  for await (const result of await vendor.results(batch.vendor_batch_id!)) {
    const row = byCustomId.get(result.custom_id);
    if (!row || row.state !== "submitted") continue;
    tally[result.result.type]++;
    await onResult(row, result.result);
    await db.run(
      `update enrichment_batch_requests set state = ?, settled_at = ?, last_error = ?
        where id = ?`,
      result.result.type, formatStamp(now()),
      result.result.type === "errored"
        ? String(JSON.stringify(result.result.error)).slice(0, 500) : null,
      row.id);
  }

  const left = Number((await db.get(
    `select count(*) n from enrichment_batch_requests
      where batch_id = ? and state = 'submitted'`, batch.id) as { n: number }).n);
  if (left === 0) {
    await db.run(`update enrichment_batches set state = 'settled', settled_at = ? where id = ?`,
                 formatStamp(now()), batch.id);
  }
  return tally;
}
