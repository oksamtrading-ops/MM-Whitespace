/**
 * The worker: drain the ledger until it is empty or the clock runs out.
 *
 * This is the stateless drainer docs/design/03 describes. It has no platform
 * bindings: the same function runs inside a Vercel invocation (api/worker),
 * as a long-lived local process (scripts/worker.mjs), and on a container
 * later. Everything it knows about where it is running arrives as an option.
 *
 * It holds ONE slot for its whole life and takes jobs one at a time, so the
 * number of live workers is the number of leased slots and nothing else. A
 * heartbeat extends its leases while a job is in flight; if the platform ends
 * the invocation mid-job, the lease lapses, the tick returns the job to the
 * queue, and no attempt is charged for the interruption.
 *
 * Every invocation writes a row to worker_runs before it does anything and
 * closes it before it returns. That row is the measurement spike S1 needs:
 * how long an invocation actually lived, and why it stopped.
 */
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import type { Mode } from "./cassette.ts";
import {
  claimJobs, claimSlot, ensureSlots, heartbeat, HEARTBEAT_SECONDS, nextClaimableRun,
  releaseSlot, settleRun, WORKER_SLOTS,
} from "./ledger.ts";
import {
  cassetteDir as defaultCassetteDir, JobFailed, prepareJobForBatch, processJob, settleBatchResult,
  type RunOptions,
} from "./worker.ts";
import {
  BATCH_ENABLED, BATCH_SIZE, openBatches, pollBatch, sdkBatchVendor, settleBatch,
  submitBatch, type BatchVendor, type Submission,
} from "./batch.ts";

export type EndReason =
  | "drained" | "deadline" | "no_slot" | "no_work" | "probe" | "error";

export type DrainOptions = {
  /** Wall clock this invocation may use. Leave a margin under the platform's ceiling. */
  deadlineSeconds: number;
  /**
   * Do not START a job unless this much time remains. A live job -- a search,
   * several filings, an extraction -- runs for minutes, and one the platform
   * cuts off mid-way costs its calls and gets requeued to pay for them again.
   */
  reserveSeconds?: number;
  mode: Mode;
  cassetteDir?: string;
  workerId?: string;
  /** Where this is running, for the record: a platform region, or "local". */
  host?: string;
  /**
   * Hold the invocation open, doing nothing but heartbeating, until the
   * deadline. This is how the platform's real wall clock is measured without
   * spending anything: the last heartbeat that lands is how long it lived.
   */
  probe?: boolean;
  /**
   * Send each pass's model call to the Batch API instead of waiting on it.
   * Half price. Defaults to MM_ENRICH_BATCH=1, and a test injects its own
   * vendor to drive the whole cycle without one.
   */
  batch?: boolean;
  batchVendor?: BatchVendor;
  /** Injected live dependencies, as RunOptions takes them. Tests only. */
  live?: RunOptions["live"];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type DrainOutcome = {
  workerRunId: string;
  workerId: string;
  reason: EndReason;
  jobsCompleted: number;
  jobsFailed: number;
  /** Sent back to the queue with a delay: throttled or overloaded, not wrong. */
  jobsRetried: number;
  /** Requests handed to the Batch API by this worker. */
  jobsBatched: number;
  /** Batch results read back and turned into findings by this worker. */
  jobsSettled: number;
  /** Claimable work was still waiting when this worker stopped. */
  workRemains: boolean;
  seconds: number;
  lastError: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function drain(db: Sql, opts: DrainOptions): Promise<DrainOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const started = now();
  const deadline = started + opts.deadlineSeconds * 1000;
  const workerId = opts.workerId ?? `worker-${opts.host ?? "local"}-${process.pid}-${started}`;

  const run = await db.get(
    `insert into worker_runs (worker_id, host, probe, deadline_seconds, started_at, last_seen_at)
     values (?, ?, ?, ?, ?, ?) returning id`,
    workerId, opts.host ?? null, Boolean(opts.probe), opts.deadlineSeconds,
    formatStamp(started), formatStamp(started)) as { id: string };

  let reason: EndReason = "no_work";
  let completed = 0;
  let failed = 0;
  let retried = 0;
  let batched = 0;
  let settled = 0;
  let lastError: string | null = null;
  let slot: number | null = null;

  const touch = () => db.run("update worker_runs set last_seen_at = ? where id = ?",
                             formatStamp(now()), run.id);

  try {
    if (opts.probe) {
      // Sleep in heartbeat-sized steps so the last_seen_at that survives is
      // within one step of when the platform pulled the plug.
      while (now() < deadline) {
        await sleep(Math.min(HEARTBEAT_SECONDS * 1000, Math.max(0, deadline - now())));
        await touch();
      }
      reason = "probe";
      return await close();
    }

    await ensureSlots(db, WORKER_SLOTS);
    slot = await claimSlot(db, workerId);
    if (slot === null) {
      reason = "no_slot";
      return await close();
    }

    // Leases outlive a single job's expected duration only if something
    // extends them. This does, for as long as this worker is alive.
    const beat = setInterval(() => {
      void heartbeat(db, workerId).then(touch).catch(() => { /* the next beat retries */ });
    }, HEARTBEAT_SECONDS * 1000);
    beat.unref?.();

    const periodAsOf = new Map<string, string>();
    const batching = opts.batch ?? BATCH_ENABLED;
    const pending = new Map<string, Submission[]>();
    const batchVendor = async () => opts.batchVendor ?? await sdkBatchVendor();

    /** Send what has accumulated for one run, and forget it. */
    const flush = async (runId: string): Promise<number> => {
      const queue = pending.get(runId) ?? [];
      pending.delete(runId);
      if (queue.length === 0) return 0;
      const { count } = await submitBatch(db, runId, queue, await batchVendor(), now);
      return count;
    };

    // Answers first: a batch already paid for is worth more than a job not yet
    // started, and its companies have been waiting longest.
    if (batching) settled += await settleReady(db, await batchVendor(), opts, now);

    let emptyClaims = 0;
    try {
      for (;;) {
        if (now() + (opts.reserveSeconds ?? 0) * 1000 >= deadline) { reason = "deadline"; break; }

        const runId = await nextClaimableRun(db);
        if (!runId) { reason = completed + failed > 0 ? "drained" : "no_work"; break; }

        const [job] = await claimJobs(db, runId, workerId, 1);
        if (!job) {
          // Another worker took it between the two queries. Look again, but
          // not forever: three empty claims in a row means the ledger is
          // moving without us and we should get out of its way.
          if (++emptyClaims >= 3) { reason = "drained"; break; }
          continue;
        }
        emptyClaims = 0;

        if (!periodAsOf.has(runId)) {
          const p = await db.get(`select p.market_cap_as_of as as_of from enrichment_runs r
              join periods p on p.id = r.period_id where r.id = ?`, runId) as { as_of: string };
          periodAsOf.set(runId, String(p.as_of).slice(0, 10));
        }

        try {
          const jobOpts = {
            mode: opts.mode, cassetteDir: opts.cassetteDir ?? defaultCassetteDir(),
            ...(opts.live ? { live: opts.live } : {}),
          };
          if (batching) {
            const r = await prepareJobForBatch(db, runId, job, periodAsOf.get(runId)!, jobOpts);
            if ("submission" in r) {
              (pending.get(runId) ?? pending.set(runId, []).get(runId)!).push(r.submission);
              // A batch is also the unit of waiting: every company in it is
              // held until the last is answered, so it goes as soon as it is
              // full rather than at the end of the drain.
              if (pending.get(runId)!.length >= BATCH_SIZE) batched += await flush(runId);
            } else {
              completed++;   // nothing to ask; the pass finished on its own
            }
          } else {
            await processJob(db, runId, job, periodAsOf.get(runId)!, jobOpts);
            completed++;
          }
        } catch (err) {
          // processJob has already routed the job -- back to the queue, the
          // run halted, or abandoned. A retry is not a failure: the job comes
          // back after its delay. What is left is to remember why.
          const outcome = err instanceof JobFailed ? err.outcome : "dead_letter";
          if (outcome === "retry") retried++; else failed++;
          lastError = (err as Error).message.split("\n")[0].slice(0, 500);
        }
        await settleRun(db, runId);
        await touch();
      }
      // Whatever did not fill a batch still has to go, or those companies
      // wait for a worker that may never claim them again.
      for (const runId of [...pending.keys()]) {
        try { batched += await flush(runId); }
        catch (err) { lastError = (err as Error).message.slice(0, 500); }
      }
    } finally {
      clearInterval(beat);
    }
    return await close();
  } catch (err) {
    reason = "error";
    lastError = (err as Error).message.slice(0, 500);
    return await close();
  } finally {
    if (slot !== null) await releaseSlot(db, slot);
  }

  async function close(): Promise<DrainOutcome> {
    const ended = now();
    await db.run(
      `update worker_runs set ended_at = ?, last_seen_at = ?, end_reason = ?,
              jobs_completed = ?, jobs_failed = ?, last_error = ?
        where id = ?`,
      formatStamp(ended), formatStamp(ended), reason, completed, failed, lastError, run.id);
    const workRemains = opts.probe ? false : (await nextClaimableRun(db)) !== null;
    return {
      workerRunId: run.id, workerId, reason, jobsCompleted: completed, jobsFailed: failed,
      jobsRetried: retried, jobsBatched: batched, jobsSettled: settled,
      workRemains, seconds: Math.round((ended - started) / 1000), lastError,
    };
  }
}

/**
 * Poll every open batch and turn whatever has finished into findings.
 *
 * Run before any new job is claimed: a batch already paid for is worth more
 * than one not yet started, and its companies have waited longest. Settling is
 * re-entrant -- a request row moves off 'submitted' only once -- so a worker
 * killed halfway through a download costs nothing but the download.
 */
export async function settleReady(
  db: Sql, vendor: BatchVendor, opts: DrainOptions, now: () => number = Date.now,
): Promise<number> {
  let settled = 0;
  for (const batch of await openBatches(db)) {
    try {
      if (batch.state !== "ended" && !await pollBatch(db, batch, vendor, now)) continue;
      const tally = await settleBatch(db, { ...batch, state: "ended" }, vendor, async (row, result) => {
        try {
          await settleBatchResult(db, batch.run_id, row, result, {
            mode: opts.mode, cassetteDir: opts.cassetteDir ?? defaultCassetteDir(),
            ...(opts.live ? { live: opts.live } : {}),
          });
        } catch (err) {
          // settleBatchResult has already routed the job. One company's bad
          // answer must not abandon the rest of the batch's results, which are
          // downloaded and would otherwise be read again next time.
          if (!(err instanceof JobFailed)) throw err;
        }
      }, now);
      settled += tally.succeeded;
    } catch {
      // A batch that cannot be polled or read is left open and tried again on
      // the next worker; nothing about it has been consumed.
      continue;
    }
    await settleRun(db, batch.run_id);
  }
  return settled;
}
