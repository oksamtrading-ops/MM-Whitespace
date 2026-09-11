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
import { cassetteDir as defaultCassetteDir, JobFailed, processJob } from "./worker.ts";

export type EndReason =
  | "drained" | "deadline" | "no_slot" | "no_work" | "probe" | "error";

export type DrainOptions = {
  /** Wall clock this invocation may use. Leave a margin under the platform's ceiling. */
  deadlineSeconds: number;
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
    let emptyClaims = 0;
    try {
      for (;;) {
        if (now() >= deadline) { reason = "deadline"; break; }

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
          await processJob(db, runId, job, periodAsOf.get(runId)!, {
            mode: opts.mode, cassetteDir: opts.cassetteDir ?? defaultCassetteDir(),
          });
          completed++;
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
      jobsRetried: retried, workRemains, seconds: Math.round((ended - started) / 1000), lastError,
    };
  }
}
