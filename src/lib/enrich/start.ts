/**
 * Starting a run: scope, estimate, refusals, and the run itself.
 *
 * docs/design/01 makes the pre-flight estimate BLOCKING and docs/design/11
 * makes it a security control: the scope shows the company count, the
 * estimated spend and the estimated duration; above a threshold the Analyst
 * types the company count to confirm; and a full-scope re-run is Admin-only.
 * Every refusal lives here rather than in the form, because a server action
 * is addressable whether or not the control that calls it renders.
 */
import type { Sql } from "../db/sql.ts";
import type { Mode } from "./cassette.ts";
import type { Role } from "../auth/session.ts";
import { WORKER_SLOTS } from "./ledger.ts";
import { CONFIRM_ABOVE, type Estimate, type Scope } from "./scope.ts";
import { cassetteDir, createRun } from "./worker.ts";

export { CONFIRM_ABOVE, SCOPE_COPY, type Estimate, type Scope } from "./scope.ts";

/**
 * The design's synchronous mid-point (docs/design/06: $0.25–0.45 per company,
 * $0.12–0.25 batched). A placeholder until spike S2 measures a real company;
 * it is here so the screen shows a number that can be wrong out loud rather
 * than no number at all.
 */
export const ESTIMATED_USD_PER_COMPANY = 0.25;
/** p95 per-company job on the synchronous path, docs/design/12. */
export const ESTIMATED_SECONDS_PER_COMPANY = 90;

export function estimate(count: number, budgetUsd: number): Estimate {
  const estimatedUsd = Math.round(count * ESTIMATED_USD_PER_COMPANY * 100) / 100;
  const estimatedMinutes = Math.ceil((count * ESTIMATED_SECONDS_PER_COMPANY) / WORKER_SLOTS / 60);
  return {
    count, estimatedUsd, estimatedMinutes,
    exceedsBudget: estimatedUsd > budgetUsd,
    needsTypedCount: count > CONFIRM_ABOVE,
  };
}

/** The companies a scope names, in period order. */
export async function scopeCompanies(db: Sql, periodId: string, scope: Scope): Promise<string[]> {
  const inPeriod = `select distinct v.company_id from company_period_field_values v
       where v.period_id = ?`;
  const rows = scope === "all"
    ? await db.all(`${inPeriod} order by v.company_id`, periodId)
    : await db.all(`${inPeriod}
         and v.company_id not in (
           select f.company_id from enrichment_findings f
             join enrichment_runs r on r.id = f.run_id where r.period_id = ?)
         and v.company_id not in (
           select j.company_id from enrichment_jobs j
             join enrichment_runs r on r.id = j.run_id
            where r.period_id = ? and j.state not in ('completed', 'halted', 'dead_letter'))
       order by v.company_id`, periodId, periodId, periodId);
  return (rows as Array<{ company_id: string }>).map((r) => r.company_id);
}

export async function periodHasFindings(db: Sql, periodId: string): Promise<boolean> {
  const r = await db.get(`select count(*) n from enrichment_findings f
      join enrichment_runs r on r.id = f.run_id where r.period_id = ?`, periodId) as { n: number };
  return r.n > 0;
}

export async function runInProgress(db: Sql, periodId: string): Promise<string | null> {
  const r = await db.get(`select id from enrichment_runs
      where period_id = ? and status in ('queued', 'running', 'awaiting_batch')
      order by created_at desc limit 1`, periodId) as { id: string } | undefined;
  return r?.id ?? null;
}

export class StartRefused extends Error {}

export type StartInput = {
  periodId: string;
  scope: Scope;
  budgetUsd: number;
  mode: Mode;
  actor: { id: string; role: Role };
  /** What the Analyst typed to confirm a large scope, if anything. */
  confirmCount?: number | null;
};

export async function startRun(
  db: Sql, input: StartInput,
): Promise<{ runId: string; jobs: number; estimate: Estimate }> {
  if (!(input.budgetUsd > 0)) throw new StartRefused("A run cannot be created without a budget.");

  const inProgress = await runInProgress(db, input.periodId);
  if (inProgress) {
    throw new StartRefused("A run is already in progress for this period. One at a time: a second " +
                           "run would compete for the same slots and the same budget line.");
  }

  if (input.scope === "all" && input.actor.role !== "admin" && await periodHasFindings(db, input.periodId)) {
    throw new StartRefused("A full re-run of a period that already has findings is Admin-only.");
  }

  const companies = await scopeCompanies(db, input.periodId, input.scope);
  if (companies.length === 0) {
    throw new StartRefused(input.scope === "unresearched"
      ? "Every company in this period already has a finding or a job in flight. Nothing to research."
      : "This period has no companies.");
  }

  const est = estimate(companies.length, input.budgetUsd);
  if (est.needsTypedCount && input.confirmCount !== est.count) {
    throw new StartRefused(`This scope is ${est.count} companies. Type that number to confirm it.`);
  }
  if (est.exceedsBudget) {
    throw new StartRefused(`The estimate is $${est.estimatedUsd.toFixed(2)} against a budget of ` +
                           `$${input.budgetUsd.toFixed(2)}. A run that halts part-way is wasted; ` +
                           "raise the budget or narrow the scope.");
  }

  const { runId, jobIds } = await createRun(db, input.periodId, companies, {
    budgetUsd: input.budgetUsd, mode: input.mode, cassetteDir: cassetteDir(),
    createdBy: input.actor.id,
  });
  await db.run(`insert into audit_log (event, actor_id, period_id, detail) values ('run_started', ?, ?, ?)`,
               input.actor.id, input.periodId,
               JSON.stringify({ runId, scope: input.scope, companies: companies.length,
                                budgetUsd: input.budgetUsd, mode: input.mode, estimate: est }));
  return { runId, jobs: jobIds.length, estimate: est };
}
