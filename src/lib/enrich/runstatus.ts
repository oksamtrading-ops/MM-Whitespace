/**
 * What a run is doing, in words a person can act on.
 *
 * docs/design/03: run state is "explicit and user-visible: queued, running,
 * stalled, halted, completed, completed with errors, failed. NEVER A BARE
 * SPINNER." Two of those are not stored anywhere -- `stalled` and `completed
 * with errors` are derived, because the database records what the run was told
 * to be and neither of these is something anything tells it.
 */
import type { Sql } from "../db/sql.ts";
import { budgetState, type BudgetState } from "./ledger.ts";

/** docs/design/03: a stall is visible within three minutes. */
export const STALL_SECONDS = 180;

export type RunPhase =
  | "queued" | "running" | "stalled" | "awaiting_batch"
  | "halted" | "completed" | "completed_with_errors" | "failed";

/** What each phase means, and what the reader is meant to do about it. */
export const PHASE_COPY: Record<RunPhase, { label: string; detail: string }> = {
  queued: { label: "Queued", detail: "Created, and waiting for a worker to pick it up." },
  running: { label: "Running", detail: "Workers are claiming jobs and results are landing." },
  stalled: {
    label: "Stalled",
    detail: "Nothing has moved for three minutes and there is work left. A worker " +
            "usually died holding its jobs; the next tick returns them to the queue " +
            "and charges no attempt.",
  },
  awaiting_batch: {
    label: "Awaiting batch",
    detail: "Submitted to the vendor's batch API. This is a long wait by design, " +
            "not a fault.",
  },
  halted: {
    label: "Halted",
    detail: "Stopped deliberately. Everything unfinished was moved to halted with it.",
  },
  completed: { label: "Completed", detail: "Every job finished and none was abandoned." },
  completed_with_errors: {
    label: "Completed with errors",
    detail: "Finished, but some jobs exhausted their attempts and were abandoned. " +
            "Their errors are below; a replay creates a new attempt and a new visible " +
            "finding, never a silent overwrite.",
  },
  failed: { label: "Failed", detail: "The run itself failed rather than its jobs." },
};

export type RunStatus = {
  runId: string;
  phase: RunPhase;
  /** The status column, which is not always what the run is actually doing. */
  storedStatus: string;
  mode: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
  counts: Array<{ state: string; n: number }>;
  total: number;
  finished: number;
  pct: number;
  deadLetters: Array<{ companyName: string; fieldGroup: string; attempts: number; lastError: string | null }>;
  expiredLeases: number;
  secondsSinceProgress: number | null;
  budget: BudgetState;
  haltReason: string | null;
};

/** Stored stamps are UTC without a zone written on them. */
function toMs(stamp: string | null): number | null {
  if (!stamp) return null;
  const iso = stamp.includes("T") ? stamp : stamp.replace(" ", "T");
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso.slice(10)) ? iso : `${iso}Z`);
  return Number.isNaN(t) ? null : t;
}

const FINISHED = new Set(["completed", "halted", "dead_letter"]);

export async function readRunStatus(
  db: Sql, runId: string, now: number = Date.now(),
): Promise<RunStatus | null> {
  const run = await db.get(`select r.id, r.status, r.mode, r.model, r.prompt_version, r.created_at,
            r.completed_at, r.halt_reason, u.email as created_by
       from enrichment_runs r left join app_users u on u.id = r.created_by
      where r.id = ?`, runId) as {
    id: string; status: string; mode: string; model: string; prompt_version: string;
    created_at: string; completed_at: string | null; halt_reason: string | null;
    created_by: string | null;
  } | undefined;
  if (!run) return null;

  const counts = await db.all("select state, count(*) n from enrichment_jobs where run_id = ? group by state order by n desc", runId) as Array<{ state: string; n: number }>;
  const total = counts.reduce((n, c) => n + c.n, 0);
  const finished = counts.filter((c) => FINISHED.has(c.state)).reduce((n, c) => n + c.n, 0);
  const deadLetterCount = counts.find((c) => c.state === "dead_letter")?.n ?? 0;

  const progress = await db.get("select max(updated_at) t from enrichment_jobs where run_id = ?", runId) as { t: string | null };
  const lastMs = toMs(progress.t);
  const secondsSinceProgress = lastMs === null ? null : Math.max(0, Math.round((now - lastMs) / 1000));

  // A job still held by a worker whose lease has run out: the ordinary shape
  // of a stall, and the thing the next tick returns to the queue for free.
  const nowStamp = new Date(now).toISOString().replace("T", " ").slice(0, 19);
  const expiredLeases = (await db.get(`select count(*) n from enrichment_jobs
      where run_id = ? and state in ('claimed', 'researching')
        and lease_expires_at is not null and lease_expires_at < ?`, runId, nowStamp) as { n: number }).n;

  const deadLetters = deadLetterCount === 0 ? [] : await db.all(`select c.canonical_name as "companyName", j.field_group as "fieldGroup",
            j.attempts, j.last_error as "lastError"
       from enrichment_jobs j join companies c on c.id = j.company_id
      where j.run_id = ? and j.state = 'dead_letter'
      order by c.canonical_name limit 50`, runId) as RunStatus["deadLetters"];

  return {
    runId: run.id,
    phase: derivePhase(run.status, {
      unfinished: total - finished, deadLetters: deadLetterCount, secondsSinceProgress,
    }),
    storedStatus: run.status,
    mode: run.mode,
    model: run.model,
    promptVersion: run.prompt_version,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    createdBy: run.created_by,
    counts, total, finished,
    pct: total === 0 ? 0 : Math.round((1000 * finished) / total) / 10,
    deadLetters,
    expiredLeases,
    secondsSinceProgress,
    budget: await budgetState(db, runId),
    haltReason: run.halt_reason,
  };
}

/**
 * The two derived phases.
 *
 * `stalled` applies only to a run the database believes is RUNNING. A run
 * awaiting a batch is meant to sit still -- calling that stalled would train
 * an Analyst to ignore the word on the one occasion it matters.
 */
export function derivePhase(
  storedStatus: string,
  o: { unfinished: number; deadLetters: number; secondsSinceProgress: number | null },
): RunPhase {
  if (storedStatus === "failed") return "failed";
  if (storedStatus === "halted") return "halted";
  if (storedStatus === "completed") {
    return o.deadLetters > 0 ? "completed_with_errors" : "completed";
  }
  if (storedStatus === "awaiting_batch") return "awaiting_batch";
  if (storedStatus === "running") {
    const stalled = o.unfinished > 0 && o.secondsSinceProgress !== null &&
                    o.secondsSinceProgress >= STALL_SECONDS;
    return stalled ? "stalled" : "running";
  }
  return "queued";
}

/** Every run for a period, most recent first. */
export async function listRuns(db: Sql, periodId: string, now: number = Date.now()): Promise<RunStatus[]> {
  const ids = await db.all("select id from enrichment_runs where period_id = ? order by created_at desc", periodId) as Array<{ id: string }>;
  const statuses = await Promise.all(ids.map((r) => readRunStatus(db, r.id, now)));
  return statuses.filter((r): r is RunStatus => r !== null);
}
