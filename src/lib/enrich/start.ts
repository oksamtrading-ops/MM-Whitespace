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
import { settledInReview } from "../profile/citations.ts";
import { WORKER_SLOTS } from "./ledger.ts";
import {
  askedFor, estimate as estimateFor, FIELD_GROUPS, type Estimate, type Pass, type Scope, type ScopeCounts,
} from "./scope.ts";
import { cassetteDir, createRun } from "./worker.ts";

export {
  CONFIRM_ABOVE, DONE_COPY, ESTIMATED_SECONDS_PER_COMPANY, ESTIMATED_USD_PER_COMPANY,
  ESTIMATED_SEARCH_USD_BY_PASS,
  ESTIMATED_USD_PER_COMPANY_BY_PASS, FIELD_GROUPS, PASS_COPY, parseTickers,
  SCOPE_COPY, scopeNote, type Estimate, type Pass, type Scope, type ScopeCounts,
} from "./scope.ts";

/** The estimate at this deployment's worker cap. */
export function estimate(
  count: number, budgetUsd: number, pass?: Pass | null, batched = false,
): Estimate {
  return estimateFor(count, budgetUsd, WORKER_SLOTS, pass, batched);
}

/** Each company in scope with its ticker, so a scope can be narrowed to named companies. */
export async function scopeWithTickers(
  db: Sql, periodId: string, scope: Scope, pass?: Pass,
): Promise<Array<{ companyId: string; ticker: string }>> {
  return withTickers(db, await scopeCompanies(db, periodId, scope, pass));
}

async function withTickers(db: Sql, ids: string[]): Promise<Array<{ companyId: string; ticker: string }>> {
  if (ids.length === 0) return [];
  // The current ticker interval: a graduation closes one and opens another.
  const rows = await db.all(`select company_id, value from company_identifiers
      where scheme = 'root_ticker' and valid_to is null`) as Array<{ company_id: string; value: string }>;
  const tickerOf = new Map(rows.map((r) => [String(r.company_id), String(r.value).toUpperCase()]));
  return ids.map((id) => ({ companyId: id, ticker: tickerOf.get(id) ?? "" }));
}

/** Where the research covering one of a pass's field groups was done. */
export type Covered = "here" | "carried";

export type PassCoverage = {
  /** Every company the pass could research, in period order, with the groups already researched. */
  companies: Array<{ companyId: string; groups: Map<string, Covered> }>;
  /** The periods research was carried from, by label. */
  carriedFrom: string[];
};

/**
 * Every company a pass could research in this period, and which of the
 * pass's field groups (FIELD_GROUPS) are already researched for it:
 *
 *   here     a job of this pass in this period that asked for the group,
 *            completed or in flight; or a value of the group accepted or
 *            overridden in this period
 *   carried  a value carried from an earlier period (committsx.ts) that
 *            was settled in review there -- accepted, accepted as "found
 *            nothing", or overridden
 *
 * Pass 1 could research every company; pass 2 only one with a website the
 * application trusts: the workbook's, or one an Analyst accepted from pass
 * 1, carried or not. Four queries, whatever the period's size.
 */
export async function passCoverage(db: Sql, periodId: string, pass: Pass): Promise<PassCoverage> {
  const base = pass === "identity"
    ? `select distinct v.company_id from company_period_field_values v where v.period_id = ?`
    : `select v.company_id from company_period_field_values v
        where v.period_id = ? and v.field_key = 'website'
          and v.value is not null and v.value not in ('null', '""')`;
  const eligible = (await db.all(`${base} order by 1`, periodId) as Array<{ company_id: string }>)
    .map((r) => String(r.company_id));

  const groups = FIELD_GROUPS[pass];
  const fields = [...new Set(groups.flatMap((g) => g.fields))];
  const groupsOf = (field: string) => groups.filter((g) => g.fields.includes(field));
  const covered = new Map<string, Map<string, Covered>>();
  const mark = (companyId: unknown, group: string, how: Covered) => {
    const id = String(companyId);
    if (!covered.has(id)) covered.set(id, new Map());
    const m = covered.get(id)!;
    if (m.get(group) !== "here") m.set(group, how);
  };

  // A run here. A job that halted or was abandoned researched nothing.
  for (const j of await db.all(`select j.company_id, r.prompt_version from enrichment_jobs j
      join enrichment_runs r on r.id = j.run_id
     where r.period_id = ? and j.field_group = ? and j.state not in ('halted', 'dead_letter')`,
    periodId, pass) as Array<{ company_id: string; prompt_version: string }>) {
    for (const g of groups) if (askedFor(g, j.prompt_version)) mark(j.company_id, g.key, "here");
  }

  // Review here: research accepted, or a reviewer's override.
  for (const v of await db.all(`select company_id, field_key from company_period_field_values
      where period_id = ? and source in ('ai_accepted', 'manual_override')
        and field_key in (${fields.map(() => "?").join(", ")})`, periodId, ...fields) as
      Array<{ company_id: string; field_key: string }>) {
    for (const g of groupsOf(v.field_key)) mark(v.company_id, g.key, "here");
  }

  // Carried here, and settled in review where it came from.
  const from = new Set<string>();
  for (const v of await carriedRows(db, periodId, fields)) {
    if (!settledInReview(v)) continue;
    for (const g of groupsOf(v.field_key)) mark(v.company_id, g.key, "carried");
    from.add(String(v.from_label));
  }

  return {
    companies: eligible.map((id) => ({ companyId: id, groups: covered.get(id) ?? new Map<string, Covered>() })),
    carriedFrom: [...from].sort(),
  };
}

/**
 * Each value of these fields carried into the period, with what the period
 * it came from published for it: its source and its frozen citation. The
 * newest revision there, as inheritedOrigin reads it; source_period_id names
 * the period a value first came from, so a second quarter still reaches the
 * review that settled it.
 *
 * Only what review could have settled is read. Most carried values are the
 * workbook's (a website, an auditor), and their citations would be fetched on
 * every load of /runs for nothing; the citation is needed only for a value
 * that was itself carried there.
 */
async function carriedRows(db: Sql, periodId: string, fields: string[]) {
  return await db.all(`select v.company_id, v.field_key, p.source,
         case when p.source = 'inherited' then p.sources end as sources, pl.label as from_label
      from company_period_field_values v
      join period_publications pp on pp.period_id = v.source_period_id
      join periods pl on pl.id = pp.period_id
      join published_period_values p on p.publication_id = pp.id
       and p.company_id = v.company_id and p.field_key = v.field_key
     where v.period_id = ? and v.source = 'inherited'
       and p.source in ('ai_accepted', 'manual_override', 'inherited')
       and v.field_key in (${fields.map(() => "?").join(", ")})
       and pp.revision = (select max(x.revision) from period_publications x where x.period_id = pp.period_id)`,
    periodId, ...fields) as Array<{ company_id: string; field_key: string; source: string; sources: unknown;
                                     from_label: string }>;
}

/** The groups that decide whether a pass is done: every one but a signal (FieldGroup.required). */
function requiredGroups(pass: Pass) {
  return FIELD_GROUPS[pass].filter((g) => g.required !== false);
}

/** Whether every required field group of the pass is researched for the company. */
function hadPass(groups: Map<string, Covered>, pass: Pass): boolean {
  return requiredGroups(pass).every((g) => groups.has(g.key));
}

function inScope(coverage: PassCoverage, scope: Scope, pass: Pass): string[] {
  return coverage.companies.filter((c) => scope === "all" || !hadPass(c.groups, pass)).map((c) => c.companyId);
}

/** A pass's two scopes, with the counts the start form says beside them (scopeNote). */
export type PassScopes = Record<Scope, Array<{ companyId: string; ticker: string }>> & ScopeCounts;

export async function passScopes(db: Sql, periodId: string, pass: Pass): Promise<PassScopes> {
  const coverage = await passCoverage(db, periodId, pass);
  let doneHere = 0, doneCarried = 0;
  const partly = new Map<string, number>();
  for (const c of coverage.companies) {
    if (hadPass(c.groups, pass)) {
      if ([...c.groups.values()].includes("here")) doneHere++; else doneCarried++;
    } else if (c.groups.size > 0) {
      const lacking = requiredGroups(pass).filter((g) => !c.groups.has(g.key)).map((g) => g.label).join(" and ");
      partly.set(lacking, (partly.get(lacking) ?? 0) + 1);
    }
  }
  return {
    unresearched: await withTickers(db, inScope(coverage, "unresearched", pass)),
    all: await withTickers(db, inScope(coverage, "all", pass)),
    eligible: coverage.companies.length, doneHere, doneCarried,
    partly: [...partly].map(([lacking, n]) => ({ lacking, n })),
    carriedFrom: coverage.carriedFrom,
  };
}

/**
 * The companies a scope names, in period order.
 *
 * With a pass, "not yet researched" leaves out a company that has had it,
 * group by group (passCoverage): in this period, or carried from an earlier
 * one. Without a pass (replay), it means "has a finding", as before.
 */
export async function scopeCompanies(
  db: Sql, periodId: string, scope: Scope, pass?: Pass,
): Promise<string[]> {
  if (pass) return inScope(await passCoverage(db, periodId, pass), scope, pass);
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
  return (rows as Array<{ company_id: string }>).map((r) => String(r.company_id));
}

export async function periodHasFindings(db: Sql, periodId: string): Promise<boolean> {
  const r = await db.get(`select count(*) n from enrichment_findings f
      join enrichment_runs r on r.id = f.run_id where r.period_id = ?`, periodId) as { n: number };
  return r.n > 0;
}

/**
 * Findings from a run here, or research carried from an earlier period.
 * Either makes a full re-run one that pays again for work already done, so
 * either makes it Admin-only. A period rolled forward from TSX's list has no
 * findings of its own until its first run, and carries a quarter's research.
 */
export async function periodHasResearch(db: Sql, periodId: string): Promise<boolean> {
  if (await periodHasFindings(db, periodId)) return true;
  const fields = [...new Set(Object.values(FIELD_GROUPS).flat().flatMap((g) => g.fields))];
  return (await carriedRows(db, periodId, fields)).some(settledInReview);
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

  if (input.scope === "all" && input.actor.role !== "admin" && await periodHasResearch(db, input.periodId)) {
    throw new StartRefused("A full re-run of a period that already has findings, or carries research from an " +
                           "earlier one, is Admin-only.");
  }

  const coverage = input.pass ? await passCoverage(db, input.periodId, input.pass) : null;
  let companies = coverage
    ? inScope(coverage, input.scope, input.pass!)
    : await scopeCompanies(db, input.periodId, input.scope);
  const wanted = (input.tickers ?? []).map((t) => t.toUpperCase());
  if (wanted.length > 0) {
    const named = await withTickers(db, companies);
    const outside = wanted.filter((t) => !named.some((c) => c.ticker === t));
    if (outside.length > 0) {
      throw new StartRefused(`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not in this scope — ` +
        "not in the period, already researched in this pass (here, or in an earlier quarter and carried " +
        "here), or (pass 2) without a trusted website.");
    }
    companies = named.filter((c) => wanted.includes(c.ticker)).map((c) => c.companyId);
  }
  if (companies.length === 0) {
    throw new StartRefused(
      input.pass === "general" && coverage!.companies.length === 0
        ? "No company has a website the application trusts. Accept websites from pass 1 first."
        : input.scope === "unresearched"
          ? input.pass
            ? "Every company this pass could research has had it, here or in an earlier quarter and carried " +
              "here, or has a job in flight. Nothing to research."
            : "Every company in this period has already been researched or has a job in flight. Nothing to research."
          : "This period has no companies.");
  }

  const est = estimate(companies.length, input.budgetUsd, input.pass);
  if (est.needsTypedCount && input.confirmCount !== est.count) {
    throw new StartRefused(`This scope is ${est.count} companies. Type that number to confirm it.`);
  }
  if (est.exceedsBudget) {
    throw new StartRefused(`The estimate is US$${est.estimatedUsd.toFixed(2)} against a budget of ` +
                           `US$${input.budgetUsd.toFixed(2)}. A run that halts part-way is wasted; ` +
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
