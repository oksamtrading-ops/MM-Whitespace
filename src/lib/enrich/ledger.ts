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
import { DatabaseSync } from "node:sqlite";

export const LEASE_SECONDS = 120;
export const HEARTBEAT_SECONDS = 30;

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

export function ensureSlots(db: DatabaseSync, count: number): void {
  const ins = db.prepare("insert into worker_slots (id) values (?) on conflict do nothing");
  for (let i = 1; i <= count; i++) ins.run(i);
}

/** Returns a slot id, or null when every slot is taken. The worker then exits. */
export function claimSlot(db: DatabaseSync, workerId: string): number | null {
  const free = db.prepare(
    `select id from worker_slots
      where leased_by is null or lease_expires_at < ? order by id limit 1`,
  ).get(stamp()) as { id: number } | undefined;
  if (!free) return null;
  const r = db.prepare(
    `update worker_slots set leased_by = ?, lease_expires_at = ?
      where id = ? and (leased_by is null or lease_expires_at < ?)`,
  ).run(workerId, stamp(LEASE_SECONDS), free.id, stamp());
  return r.changes === 1 ? free.id : null;
}

export function releaseSlot(db: DatabaseSync, slotId: number): void {
  db.prepare("update worker_slots set leased_by = null, lease_expires_at = null where id = ?")
    .run(slotId);
}

export type ClaimedJob = { id: string; company_id: string; field_group: string; attempts: number };

/**
 * On Postgres this is `select ... for update skip locked` in one statement.
 * SQLite serialises writers, so select-then-conditional-update is equivalent
 * here; the production form is the Postgres one.
 */
export function claimJobs(
  db: DatabaseSync, runId: string, workerId: string, limit: number,
): ClaimedJob[] {
  const rows = db.prepare(
    `select id, company_id, field_group, attempts from enrichment_jobs
      where run_id = ? and state = 'queued'
        and (available_at is null or available_at <= ?)
      order by created_at limit ?`,
  ).all(runId, stamp(), limit) as ClaimedJob[];

  const upd = db.prepare(
    `update enrichment_jobs
        set state = 'claimed', leased_by = ?, lease_expires_at = ?, updated_at = ?
      where id = ? and state = 'queued'`);

  const claimed: ClaimedJob[] = [];
  for (const row of rows) {
    if (upd.run(workerId, stamp(LEASE_SECONDS), stamp(), row.id).changes === 1) {
      claimed.push(row);
    }
  }
  return claimed;
}

export function heartbeat(db: DatabaseSync, workerId: string): number {
  const r = db.prepare(
    `update enrichment_jobs set lease_expires_at = ?, updated_at = ?
      where leased_by = ? and state in ('claimed','researching','persisting')`,
  ).run(stamp(LEASE_SECONDS), stamp(), workerId);
  db.prepare("update worker_slots set lease_expires_at = ? where leased_by = ?")
    .run(stamp(LEASE_SECONDS), workerId);
  // node:sqlite reports `changes` as number | bigint.
  return Number(r.changes);
}

/** Returns expired jobs to queued WITHOUT charging an attempt. */
export function reapExpiredLeases(db: DatabaseSync): number {
  const r = db.prepare(
    `update enrichment_jobs
        set state = 'queued', leased_by = null, lease_expires_at = null, updated_at = ?
      where state in ('claimed','researching','persisting') and lease_expires_at < ?`,
  ).run(stamp(), stamp());
  db.prepare(
    `update worker_slots set leased_by = null, lease_expires_at = null
      where lease_expires_at < ?`).run(stamp());
  return Number(r.changes);
}

export function transition(
  db: DatabaseSync, jobId: string, to: JobState,
  opts: { error?: string; chargeAttempt?: boolean; batchId?: string } = {},
): void {
  const row = db.prepare(
    "select state, attempts, max_attempts from enrichment_jobs where id = ?",
  ).get(jobId) as { state: JobState; attempts: number; max_attempts: number } | undefined;
  if (!row) throw new Error(`no such job ${jobId}`);
  if (!TRANSITIONS[row.state].includes(to)) throw new IllegalTransition(row.state, to);

  const attempts = row.attempts + (opts.chargeAttempt ? 1 : 0);
  const clears = ["completed", "dead_letter", "queued", "halted"].includes(to);
  db.prepare(
    `update enrichment_jobs
        set state = ?, attempts = ?, last_error = ?,
            batch_id = coalesce(?, batch_id), updated_at = ?,
            leased_by = case when ? = 1 then null else leased_by end,
            lease_expires_at = case when ? = 1 then null else lease_expires_at end
      where id = ?`,
  ).run(to, attempts, opts.error ?? null, opts.batchId ?? null, stamp(),
        clears ? 1 : 0, clears ? 1 : 0, jobId);
}

/** Warn at 80%, halt at 100%. A run cannot exist without a budget. */
export type BudgetState = {
  spend: number; budget: number; pct: number; warn: boolean; halt: boolean;
};

export function budgetState(db: DatabaseSync, runId: string): BudgetState {
  const r = db.prepare(
    "select budget_usd, spend_usd from enrichment_runs where id = ?",
  ).get(runId) as { budget_usd: number; spend_usd: number };
  const pct = r.budget_usd > 0 ? r.spend_usd / r.budget_usd : 1;
  return { spend: r.spend_usd, budget: r.budget_usd, pct, warn: pct >= 0.8, halt: pct >= 1 };
}

export function recordSpend(db: DatabaseSync, runId: string, usd: number): BudgetState {
  db.prepare("update enrichment_runs set spend_usd = spend_usd + ? where id = ?").run(usd, runId);
  const state = budgetState(db, runId);
  if (state.halt) {
    db.prepare("update enrichment_runs set status = 'halted', halt_reason = ? where id = ?")
      .run(`budget exhausted: ${state.spend.toFixed(2)} of ${state.budget.toFixed(2)}`, runId);
    // Both spend-limit error shapes route to halt, not retry.
    db.prepare(
      `update enrichment_jobs set state = 'halted', leased_by = null, lease_expires_at = null
        where run_id = ? and state in ('queued','claimed','researching','awaiting_batch')`,
    ).run(runId);
  }
  return state;
}
