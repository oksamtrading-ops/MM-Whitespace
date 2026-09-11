/**
 * What the tick and the workers have been doing lately, for the run screen.
 *
 * A run that is not moving has two possible causes and they need different
 * responses: the schedule is not being delivered, or it is and the workers
 * are failing. The tick ledger answers the first and the worker ledger the
 * second, so the screen can say which rather than "stalled".
 */
import type { Sql } from "../db/sql.ts";

export type TickRecord = {
  at: string; reaped: number; pending: number; freeSlots: number; invoked: boolean; note: string | null;
};

export type WorkerRecord = {
  id: string; workerId: string; host: string | null; probe: boolean;
  deadlineSeconds: number; startedAt: string; lastSeenAt: string; endedAt: string | null;
  endReason: string | null; jobsCompleted: number; jobsFailed: number; lastError: string | null;
  /** Seconds the invocation was observed alive: ended, or last heartbeat, less started. */
  livedSeconds: number | null;
};

export type WorkerHealth = {
  lastTick: TickRecord | null;
  /** Ticks in the last 24 hours, against the 1,440 a per-minute schedule would deliver. */
  ticksLast24h: number;
  recentWorkers: WorkerRecord[];
  /** The longest an invocation has been seen to live, from every non-probe worker run. */
  longestLivedSeconds: number | null;
  /**
   * The database predates migration 0013. A read of the worker ledger is
   * optional by nature, so this reads as "nothing recorded" with the reason
   * attached, rather than the run screen failing on a database that is one
   * migration behind -- the runbook's "a database is a migration behind".
   */
  ledgerMissing: boolean;
};

const EMPTY: WorkerHealth = {
  lastTick: null, ticksLast24h: 0, recentWorkers: [], longestLivedSeconds: null, ledgerMissing: true,
};

function toMs(stamp: string | null): number | null {
  if (!stamp) return null;
  const iso = stamp.includes("T") ? stamp : stamp.replace(" ", "T");
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso.slice(10)) ? iso : `${iso}Z`);
  return Number.isNaN(t) ? null : t;
}

export async function readWorkerHealth(db: Sql, now: number = Date.now()): Promise<WorkerHealth> {
  let t: Record<string, unknown> | undefined;
  try {
    t = await db.get(`select ticked_at, reaped, pending, free_slots, invoked, note
        from cron_ticks order by ticked_at desc limit 1`) as Record<string, unknown> | undefined;
  } catch {
    return EMPTY;
  }
  const lastTick: TickRecord | null = t ? {
    at: String(t.ticked_at), reaped: Number(t.reaped), pending: Number(t.pending),
    freeSlots: Number(t.free_slots), invoked: Boolean(t.invoked),
    note: t.note == null ? null : String(t.note),
  } : null;

  const dayAgo = new Date(now - 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  const ticksLast24h = (await db.get("select count(*) n from cron_ticks where ticked_at >= ?", dayAgo) as { n: number }).n;

  const rows = await db.all(`select id, worker_id, host, probe, deadline_seconds, started_at, last_seen_at,
            ended_at, end_reason, jobs_completed, jobs_failed, last_error
       from worker_runs order by started_at desc limit 8`) as Array<Record<string, unknown>>;
  const recentWorkers = rows.map(toWorkerRecord);

  const all = await db.all(`select started_at, last_seen_at, ended_at from worker_runs
      where probe = false`) as Array<Record<string, unknown>>;
  let longestLivedSeconds: number | null = null;
  for (const r of all) {
    const s = lived(r);
    if (s !== null && (longestLivedSeconds === null || s > longestLivedSeconds)) longestLivedSeconds = s;
  }

  return { lastTick, ticksLast24h, recentWorkers, longestLivedSeconds, ledgerMissing: false };
}

function lived(r: Record<string, unknown>): number | null {
  const start = toMs(String(r.started_at));
  const end = toMs(r.ended_at == null ? String(r.last_seen_at) : String(r.ended_at));
  return start === null || end === null ? null : Math.max(0, Math.round((end - start) / 1000));
}

function toWorkerRecord(r: Record<string, unknown>): WorkerRecord {
  return {
    id: String(r.id), workerId: String(r.worker_id),
    host: r.host == null ? null : String(r.host), probe: Boolean(r.probe),
    deadlineSeconds: Number(r.deadline_seconds),
    startedAt: String(r.started_at), lastSeenAt: String(r.last_seen_at),
    endedAt: r.ended_at == null ? null : String(r.ended_at),
    endReason: r.end_reason == null ? null : String(r.end_reason),
    jobsCompleted: Number(r.jobs_completed), jobsFailed: Number(r.jobs_failed),
    lastError: r.last_error == null ? null : String(r.last_error),
    livedSeconds: lived(r),
  };
}
