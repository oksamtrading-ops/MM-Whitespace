/**
 * The job ledger.
 *
 * Global concurrency lives in the database, not in worker memory: in-process
 * governors do not compose across instances. Workers lease a slot before
 * claiming any job and exit if none is free.
 *
 * A lease that expires returns its job to queued and charges NO attempt. That
 * distinction matters: a worker killed mid-run must not burn a retry.
 */
import type { Sql } from "../db/sql.ts";

export const LEASE_SECONDS = 120;
export const HEARTBEAT_SECONDS = 30;

/**
 * How many workers may hold jobs at once, across every instance. Four is the
 * design's placeholder until spike S3 sets it from the account's real rate
 * limits; it is the ceiling on concurrent vendor calls, not on function
 * instances, and a fifth worker exits at the door rather than queueing.
 */
export const WORKER_SLOTS = 4;

export type JobState =
  | "queued" | "claimed" | "researching" | "awaiting_batch"
  | "persisting" | "completed" | "halted" | "dead_letter";

/** Legal transitions. Anything else throws rather than silently corrupting state. */
const TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ["claimed"],
  claimed: ["researching", "queued"],
  researching: ["awaiting_batch", "persisting", "queued", "halted", "dead_letter"],
  awaiting_batch: ["persisting", "halted"],
  persisting: ["completed", "dead_letter"],
  completed: [],
  halted: ["queued"],
  dead_letter: [],
};

export class IllegalTransition extends Error {
  from: JobState;
  to: JobState;
  constructor(from: JobState, to: JobState) {
    super(`illegal job transition ${from} -> ${to}`);
    this.name = "IllegalTransition";
    this.from = from;
    this.to = to;
  }
}

const stamp = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);

export async function ensureSlots(db: Sql, count: number): Promise<void> {
  const ins = "insert into worker_slots (id) values (?) on conflict do nothing";
  for (let i = 1; i <= count; i++) await db.run(ins, i);
}

/** Returns a slot id, or null when every slot is taken. The worker then exits. */
export async function claimSlot(db: Sql, workerId: string): Promise<number | null> {
  const free = await db.get(`select id from worker_slots
      where leased_by is null or lease_expires_at < ? order by id limit 1`, stamp()) as { id: number } | undefined;
  if (!free) return null;
  const r = await db.run(`update worker_slots set leased_by = ?, lease_expires_at = ?
      where id = ? and (leased_by is null or lease_expires_at < ?)`, workerId, stamp(LEASE_SECONDS), free.id, stamp());
  return r.changes === 1 ? free.id : null;
}

export async function releaseSlot(db: Sql, slotId: number): Promise<void> {
  await db.run("update worker_slots set leased_by = null, lease_expires_at = null where id = ?", slotId);
}

export type ClaimedJob = { id: string; company_id: string; field_group: string; attempts: number };

/**
 * On Postgres this is `select ... for update skip locked` in one statement.
 * SQLite serialises writers, so select-then-conditional-update is equivalent
 * here; the production form is the Postgres one.
 */
export async function claimJobs(
  db: Sql, runId: string, workerId: string, limit: number): Promise<ClaimedJob[]> {
  const rows = await db.all(`select id, company_id, field_group, attempts from enrichment_jobs
      where run_id = ? and state = 'queued'
        and (available_at is null or available_at <= ?)
      order by created_at limit ?`, runId, stamp(), limit) as ClaimedJob[];

  const upd = `update enrichment_jobs
        set state = 'claimed', leased_by = ?, lease_expires_at = ?, updated_at = ?
      where id = ? and state = 'queued'`;

  const claimed: ClaimedJob[] = [];
  for (const row of rows) {
    if ((await db.run(upd, workerId, stamp(LEASE_SECONDS), stamp(), row.id)).changes === 1) {
      claimed.push(row);
    }
  }
  return claimed;
}

/**
 * The run a worker should drain next: the oldest one that still has a job it
 * could claim now. A run whose remaining jobs are all backing off is skipped
 * rather than waited on, so one throttled run cannot park the worker.
 */
export async function nextClaimableRun(db: Sql): Promise<string | null> {
  const row = await db.get(`select r.id from enrichment_runs r
      where r.status in ('queued', 'running')
        and exists (select 1 from enrichment_jobs j
                     where j.run_id = r.id and j.state = 'queued'
                       and (j.available_at is null or j.available_at <= ?))
      order by r.created_at limit ?`, stamp(), 1) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Keep the run's stored status honest about its jobs.
 *
 * `queued` becomes `running` the moment a job is taken, and `running` becomes
 * `completed` when no job is left unfinished -- with `completed_at` set once
 * and never moved. A halted or failed run is left alone: those are statuses
 * something decided, and this only reports what the jobs did.
 */
export async function settleRun(db: Sql, runId: string): Promise<string> {
  const run = await db.get("select status from enrichment_runs where id = ?", runId) as
    { status: string } | undefined;
  if (!run) throw new Error(`no such run ${runId}`);
  if (run.status !== "queued" && run.status !== "running") return run.status;

  const n = await db.get(`select
       sum(case when state in ('completed', 'halted', 'dead_letter') then 0 else 1 end) as unfinished,
       sum(case when state = 'queued' then 1 else 0 end) as queued,
       count(*) as total
     from enrichment_jobs where run_id = ?`, runId) as
    { unfinished: number | null; queued: number | null; total: number };
  const unfinished = n.unfinished ?? 0;

  if (n.total > 0 && unfinished === 0) {
    await db.run(`update enrichment_runs set status = 'completed', completed_at = ?
        where id = ? and status in ('queued', 'running')`, stamp(), runId);
    return "completed";
  }
  if (run.status === "queued" && (n.queued ?? 0) < n.total) {
    await db.run("update enrichment_runs set status = 'running' where id = ? and status = 'queued'", runId);
    return "running";
  }
  return run.status;
}

export async function heartbeat(db: Sql, workerId: string): Promise<number> {
  const r = await db.run(`update enrichment_jobs set lease_expires_at = ?, updated_at = ?
      where leased_by = ? and state in ('claimed','researching','persisting')`, stamp(LEASE_SECONDS), stamp(), workerId);
  await db.run("update worker_slots set lease_expires_at = ? where leased_by = ?", stamp(LEASE_SECONDS), workerId);
  // node:sqlite reports `changes` as number | bigint.
  return Number(r.changes);
}

/** Returns expired jobs to queued WITHOUT charging an attempt. */
export async function reapExpiredLeases(db: Sql): Promise<number> {
  const r = await db.run(`update enrichment_jobs
        set state = 'queued', leased_by = null, lease_expires_at = null, updated_at = ?
      where state in ('claimed','researching','persisting') and lease_expires_at < ?`, stamp(), stamp());
  await db.run(`update worker_slots set leased_by = null, lease_expires_at = null
      where lease_expires_at < ?`, stamp());
  return Number(r.changes);
}

export async function transition(
  db: Sql, jobId: string, to: JobState,
  opts: { error?: string; chargeAttempt?: boolean; batchId?: string } = {}): Promise<void> {
  const row = await db.get("select state, attempts, max_attempts from enrichment_jobs where id = ?", jobId) as { state: JobState; attempts: number; max_attempts: number } | undefined;
  if (!row) throw new Error(`no such job ${jobId}`);
  if (!TRANSITIONS[row.state].includes(to)) throw new IllegalTransition(row.state, to);

  const attempts = row.attempts + (opts.chargeAttempt ? 1 : 0);
  const clears = ["completed", "dead_letter", "queued", "halted"].includes(to);
  await db.run(`update enrichment_jobs
        set state = ?, attempts = ?, last_error = ?,
            batch_id = coalesce(?, batch_id), updated_at = ?,
            leased_by = case when ? = 1 then null else leased_by end,
            lease_expires_at = case when ? = 1 then null else lease_expires_at end
      where id = ?`, to, attempts, opts.error ?? null, opts.batchId ?? null, stamp(),
        clears ? 1 : 0, clears ? 1 : 0, jobId);
}

/** Warn at 80%, halt at 100%. A run cannot exist without a budget. */
export type BudgetState = {
  spend: number; budget: number; pct: number; warn: boolean; halt: boolean;
};

export async function budgetState(db: Sql, runId: string): Promise<BudgetState> {
  const r = await db.get("select budget_usd, spend_usd from enrichment_runs where id = ?", runId) as { budget_usd: number; spend_usd: number };
  const pct = r.budget_usd > 0 ? r.spend_usd / r.budget_usd : 1;
  return { spend: r.spend_usd, budget: r.budget_usd, pct, warn: pct >= 0.8, halt: pct >= 1 };
}

export async function recordSpend(db: Sql, runId: string, usd: number): Promise<BudgetState> {
  await db.run("update enrichment_runs set spend_usd = spend_usd + ? where id = ?", usd, runId);
  const state = await budgetState(db, runId);
  if (state.halt) {
    await haltRun(db, runId, `budget exhausted: ${state.spend.toFixed(2)} of ${state.budget.toFixed(2)}`);
  }
  return state;
}

/**
 * Stop a run and everything unfinished in it, recording why.
 *
 * Two causes arrive here and the runbook tells them apart by the reason: the
 * run's own budget ("budget exhausted: ..."), and the vendor refusing on a
 * spend limit, credentials or billing (the vendor's message, verbatim). Jobs
 * move to `halted`, not `dead_letter`, because nothing is wrong with them --
 * the runbook's resume requeues exactly these.
 */
export async function haltRun(db: Sql, runId: string, reason: string): Promise<void> {
  await db.run(`update enrichment_runs set status = 'halted', halt_reason = ?
      where id = ? and status in ('queued', 'running', 'awaiting_batch')`, reason.slice(0, 500), runId);
  await db.run(`update enrichment_jobs set state = 'halted', leased_by = null, lease_expires_at = null,
        updated_at = ?
      where run_id = ? and state in ('queued','claimed','researching','awaiting_batch')`, stamp(), runId);
}

/**
 * Put a job back in the queue, not before `availableAt`.
 *
 * `refundAttempt` gives back the attempt charged on entering `researching`,
 * for failures that say nothing about the job: an overloaded vendor is the
 * design's example (docs/design/03 -- "does not count as an attempt").
 */
export async function requeueLater(
  db: Sql, jobId: string, availableAt: Date, error: string, refundAttempt = false,
): Promise<void> {
  await transition(db, jobId, "queued", { error });
  await db.run(`update enrichment_jobs
        set available_at = ?, attempts = attempts - ?
      where id = ?`, availableAt.toISOString().replace("T", " ").slice(0, 19),
        refundAttempt ? 1 : 0, jobId);
}
