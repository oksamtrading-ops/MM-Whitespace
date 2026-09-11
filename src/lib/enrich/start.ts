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
import { estimate as estimateFor, parseTickers, type Estimate, type Pass, type Scope } from "./scope.ts";
import { cassetteDir, createRun } from "./worker.ts";

export {
  CONFIRM_ABOVE, ESTIMATED_SECONDS_PER_COMPANY, ESTIMATED_USD_PER_COMPANY,
  ESTIMATED_USD_PER_COMPANY_BY_PASS, PASS_COPY, parseTickers,
  SCOPE_COPY, type Estimate, type Pass, type Scope,
} from "./scope.ts";

/** The estimate at this deployment's worker cap. */
export function estimate(count: number, budgetUsd: number, pass?: Pass | null): Estimate {
  return estimateFor(count, budgetUsd, WORKER_SLOTS, pass);
}

/** Each company in scope with its ticker, so a scope can be narrowed to named companies. */
export async function scopeWithTickers(
  db: Sql, periodId: string, scope: Scope, pass?: Pass,
): Promise<Array<{ companyId: string; ticker: string }>> {
  const ids = await scopeCompanies(db, periodId, scope, pass);
  if (ids.length === 0) return [];
  // The current ticker interval: a graduation closes one and opens another.
  const rows = await db.all(`select company_id, value from company_identifiers
      where scheme = 'root_ticker' and valid_to is null`) as Array<{ company_id: string; value: string }>;
  const tickerOf = new Map(rows.map((r) => [r.company_id, String(r.value).toUpperCase()]));
  return ids.map((id) => ({ companyId: id, ticker: tickerOf.get(id) ?? "" }));
}

/**
 * The companies a scope names, in period order.
 *
 * With a pass, "researched" means a job of that pass completed or is in flight
 * -- a pass can find nothing and still be done. Pass 2 only ever names a
 * company with a website the application trusts: the workbook's, or one an
 * Analyst accepted from pass 1. Without a pass (replay), it means "has a
 * finding", as before.
 */
export async function scopeCompanies(
  db: Sql, periodId: string, scope: Scope, pass?: Pass,
): Promise<string[]> {
  if (pass) {
    const base = pass === "identity"
      ? `select distinct v.company_id from company_period_field_values v where v.period_id = ?`
      : `select v.company_id from company_period_field_values v
          where v.period_id = ? and v.field_key = 'website'
            and v.value is not null and v.value not in ('null', '""')`;
    const rows = scope === "all"
      ? await db.all(`${base} order by 1`, periodId)
      : await db.all(`${base} and v.company_id not in (
             select j.company_id from enrichment_jobs j join enrichment_runs r on r.id = j.run_id
              where r.period_id = ? and j.field_group = ? and j.state not in ('halted', 'dead_letter'))
           order by 1`, periodId, periodId, pass);
    return (rows as Array<{ company_id: string }>).map((r) => r.company_id);
  }
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
  /** Live research's pass. Absent in replay, where the recordings are the scope. */
  pass?: Pass;
  /**
   * Narrow the scope to these tickers -- a sample run, or one company again.
   * Every other rule still applies: a ticker outside the scope is refused,
   * not added.
   */
  tickers?: string[];
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

  let companies = await scopeCompanies(db, input.periodId, input.scope, input.pass);
  const wanted = (input.tickers ?? []).map((t) => t.toUpperCase());
  if (wanted.length > 0) {
    const inScope = await scopeWithTickers(db, input.periodId, input.scope, input.pass);
    const outside = wanted.filter((t) => !inScope.some((c) => c.ticker === t));
    if (outside.length > 0) {
      throw new StartRefused(`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not in this scope — ` +
        "not in the period, already researched in this pass, or (pass 2) without a trusted website.");
    }
    companies = inScope.filter((c) => wanted.includes(c.ticker)).map((c) => c.companyId);
  }
  if (companies.length === 0) {
    throw new StartRefused(
      input.pass === "general"
        ? "No company has a website the application trusts and an unfinished pass 2. Accept websites from pass 1 first."
        : input.scope === "unresearched"
          ? "Every company in this period has already been researched or has a job in flight. Nothing to research."
          : "This period has no companies.");
  }

  const est = estimate(companies.length, input.budgetUsd, input.pass);
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
    createdBy: input.actor.id, fieldGroup: input.pass ?? "general",
  });
  await db.run(`insert into audit_log (event, actor_id, period_id, detail) values ('run_started', ?, ?, ?)`,
               input.actor.id, input.periodId,
               JSON.stringify({ runId, scope: input.scope, pass: input.pass ?? null,
                                tickers: wanted.length ? wanted : null, companies: companies.length,
                                budgetUsd: input.budgetUsd, mode: input.mode, estimate: est }));
  return { runId, jobs: jobIds.length, estimate: est };
}
