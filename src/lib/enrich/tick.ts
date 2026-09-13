/**
 * The tick, as a function of the database and one injected side effect.
 *
 * It does ALMOST NOTHING on purpose (docs/design/03): reap expired leases,
 * ask whether work exists and whether a slot is free, and if both, ask a
 * worker to start. It never does the work itself, so a leaked cron secret
 * only causes a no-op invocation, and a worker invoked by mistake finds
 * nothing to claim and exits.
 *
 * It records itself even when it does nothing. Cron delivery is best-effort
 * and a missed tick produces no error -- only a run that stops advancing --
 * so the row is the only evidence that the schedule is being honoured.
 */
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import { ensureSlots, reapExpiredLeases, WORKER_SLOTS } from "./ledger.ts";
import { openBatchCount } from "./batch.ts";

/** A week of ticks at one a minute is about ten thousand rows. Enough. */
export const TICK_RETENTION_DAYS = 7;

export type Kick = () => Promise<{ ok: boolean; note: string }>;

export type TickResult = {
  tickId: string;
  reapedLeases: number;
  pending: number;
  /** Batches still owing an answer, or owing their results being read. */
  openBatches: number;
  freeSlots: number;
  invokedWorker: boolean;
  note: string;
};

export async function tick(
  db: Sql, opts: { kick?: Kick; now?: () => number } = {},
): Promise<TickResult> {
  const now = opts.now ?? Date.now;
  const reaped = await reapExpiredLeases(db);

  // A database that has never run a worker has no slot rows, and counting
  // free slots on it says zero -- which reads as "every slot is busy" and
  // would keep a fresh deployment from ever invoking a worker.
  await ensureSlots(db, WORKER_SLOTS);

  const pending = (await db.get(`select count(*) n from enrichment_jobs
      where state = 'queued' and (available_at is null or available_at <= ?)`,
    formatStamp(now())) as { n: number }).n;

  const freeSlots = (await db.get(`select count(*) n from worker_slots
      where leased_by is null or lease_expires_at < ?`, formatStamp(now())) as { n: number }).n;

  // An open batch is work too. Without this, a run whose every job has been
  // submitted has nothing queued, no worker is ever invoked, and the answers
  // are never collected -- a period that stops advancing with no error
  // anywhere, which is the exact failure the tick's own row exists to expose.
  const batches = await openBatchCount(db);

  let invoked = false;
  let note = "nothing to do";
  if ((pending > 0 || batches > 0) && freeSlots > 0) {
    if (opts.kick) {
      const result = await opts.kick();
      invoked = result.ok;
      note = result.note;
    } else {
      note = "work exists and a slot is free, but no worker is configured";
    }
  }

  const row = await db.get(
    `insert into cron_ticks (ticked_at, reaped, pending, free_slots, invoked, note)
     values (?, ?, ?, ?, ?, ?) returning id`,
    formatStamp(now()), reaped, pending, freeSlots, invoked,
    batches > 0 ? `${note} (${batches} open batch(es))` : note) as { id: string };

  await db.run("delete from cron_ticks where ticked_at < ?",
               formatStamp(now() - TICK_RETENTION_DAYS * 86_400_000));

  return { tickId: row.id, reapedLeases: reaped, pending, openBatches: batches,
           freeSlots, invokedWorker: invoked, note };
}
