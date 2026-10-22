/**
 * The vocabulary of a run's scope, shared by the start-run screen and the
 * action behind it. Nothing here touches the database or the filesystem, so
 * a client component can import it without dragging node built-ins into the
 * browser bundle.
 */
export type Scope = "unresearched" | "all";

/** Live research's two passes, website first. See src/lib/enrich/live.ts. */
export type Pass = "identity" | "general";

export const PASS_COPY: Record<Pass, { label: string; detail: string }> = {
  identity: {
    label: "Pass 1 — identity",
    detail: "Official website, SEC registration, fiscal year-end and head office, and the filings pass 2 " +
            "will read. A website only unlocks pass 2 once it is accepted in review.",
  },
  general: {
    label: "Pass 2 — fields",
    detail: "Stage, auditor, tenure, change of auditor, fees and the rest, read from filings on the " +
            "company's own website and SEC EDGAR. Only companies with a trusted website.",
  },
};

export const SCOPE_COPY: Record<Scope, { label: string; detail: string }> = {
  unresearched: {
    label: "Companies not yet researched",
    detail: "Every company in the period with no finding from any run. The default, and " +
            "the only scope that never re-spends on work already done.",
  },
  all: {
    label: "Every company in the period",
    detail: "A full re-run. Existing findings are not replaced; a new attempt becomes a " +
            "new, visible proposal. Admin-only once the period has findings or carries research.",
  },
};

/**
 * The values a pass produces, in the groups a run's "not yet done" counts.
 *
 * A company has had a pass when every group of it is researched: a job of
 * that pass in this period that asked for the group (completed or in flight
 * -- a pass can find nothing and still be done), or a value of the group
 * settled in review, here or in an earlier period and carried here. Settled
 * means accepted research, an accepted "found nothing", or an override. A
 * finding nobody decided is not carried, so it does not count next quarter.
 *
 * A group is researched when ANY of its values is. Pass 2 abstains often --
 * 22 "not found" were left undecided in Q3 on purpose -- so asking for every
 * field would offer nearly every company again each quarter.
 *
 * Pass 1's group includes fiscal year-end and head office, which pass 2 also
 * reads from filings: either way they are researched, and pass 1 would only
 * look them up again. Pass 2's groups leave them out, so that pass 1 alone
 * never marks pass 2 done.
 *
 * ERP (12 October) sits in the filing fields rather than a group of its own:
 * a company names its ERP so rarely (one accepted in Q3) that a group of it
 * alone would almost never be researched. Commodities (16 October) and the
 * financials (17 October) are one group for the same reason, and no pass 2
 * ran between the two days.
 */
export type FieldGroup = {
  key: string;
  /** In the screen's words. */
  label: string;
  fields: readonly string[];
  /**
   * The live rules version (live.ts, LIVE_RULES_VERSION) from which pass
   * asked for these fields. A job run under older rules did not ask, so it
   * does not count for them. Null: asked for from the start.
   */
  since: string | null;
  /**
   * false for a signal: collected whenever the pass runs, and never what
   * decides whether a company still needs research. Research is carried into
   * the next quarter through accepted values, and a field almost every
   * company's filings are silent on would almost never have one, so as a
   * required group it would leave every company "not yet done" after every
   * roll-forward. Absent: required.
   */
  required?: false;
};

export const FIELD_GROUPS: Record<Pass, readonly FieldGroup[]> = {
  identity: [{
    key: "identity", label: "website, SEC registration, fiscal year-end or head office",
    fields: ["website", "sec_registrant", "fiscal_year_end", "head_office_location", "head_office_region"],
    since: null,
  }],
  general: [
    {
      key: "filings", label: "the filing fields",
      fields: ["stage_evidence_state", "auditor", "auditor_since", "auditor_change", "audit_fee", "tax_fee",
               "incumbent_erp"],
      since: null,
    },
    {
      key: "october", label: "commodities and the financials",
      fields: ["commodities", "total_revenue", "net_income", "total_assets", "audit_related_fee", "other_fee",
               "reporting_currency"],
      since: "2026-10-17.1",
    },
    {
      // Its own group, as the financials had: a run before 22 October never
      // asked, so it cannot count as having researched it. Not required: see
      // FieldGroup.required.
      key: "erp_change", label: "the ERP change signal",
      fields: ["erp_change"],
      since: "2026-10-22.1",
      required: false,
    },
  ],
};

/** What "not yet done" leaves out, per pass, as the start form says it. */
export const DONE_COPY: Record<Pass, string> = {
  identity: "Not yet done leaves out a company whose website, SEC registration, fiscal year-end or head " +
            "office is researched: by a pass 1 run in this period, or accepted, overridden or accepted as " +
            "not found in review, here or in an earlier quarter and carried here.",
  general: "Not yet done leaves out a company only when both halves of pass 2 are researched, here or in an " +
           "earlier quarter and carried here: the filing fields (stage, auditor, tenure, change of auditor, " +
           "audit and tax fees, ERP), and commodities with the financials (revenue, net income, total assets, " +
           "audit-related and other fees, reporting currency), which pass 2 has asked for since 17 October. " +
           "Research from before then covers the first half only. The ERP change signal, asked for since " +
           "22 October, is collected whenever pass 2 runs and does not decide what is done.",
};

/** The counts behind a pass's two options (start.ts, passScopes). */
export type ScopeCounts = {
  /** Every company the pass could research. */
  eligible: number;
  /** Left out of "not yet done": researched by a run or review here, or by research carried in alone. */
  doneHere: number;
  doneCarried: number;
  /** In "not yet done" with part of the pass researched, by the groups they still lack. */
  partly: Array<{ lacking: string; n: number }>;
  /** The periods carried research came from, by label. */
  carriedFrom: string[];
};

/**
 * What an option leaves out or takes in, counted, so a quarter's cost is
 * read before it is spent: a period rolled forward from TSX's list offers
 * every company, and its carried research is what narrows that.
 */
export function scopeNote(pass: Pass, scope: Scope, c: ScopeCounts,
                          name: (label: string) => string = (l) => l): string {
  const from = c.carriedFrom.map(name).join(" and ") || "an earlier quarter";
  const carried = (n: number) => `${n} whose research was carried from ${from}`;
  const done = c.doneHere + c.doneCarried;
  const which = c.doneCarried === 0 ? `${c.doneHere} researched in this period`
    : c.doneHere === 0 ? carried(c.doneCarried)
    : `${done}: ${c.doneHere} researched in this period and ${carried(c.doneCarried)}`;
  if (scope === "all") return done === 0 ? "" : `Includes ${which}, which a full re-run pays for again.`;
  return [
    done === 0 ? "" : `Leaves out ${which}.`,
    ...c.partly.map((p) => `Includes ${p.n} researched only in part, still without ${p.lacking}.`),
    DONE_COPY[pass],
  ].filter(Boolean).join(" ");
}

/** The live rules a run was asked under, from its prompt version ("2026-09-04.1+live.2026-10-17.1"). */
export function liveRulesOf(promptVersion: string | null | undefined): string | null {
  return String(promptVersion ?? "").match(/\+live\.(\S+)$/)?.[1] ?? null;
}

/** "2026-10-09.1" against "2026-10-17.1", part by part as numbers, so ".10" follows ".9". */
export function compareRules(a: string, b: string): number {
  const pa = a.split(/[-.]/).map(Number);
  const pb = b.split(/[-.]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Whether a job, run under this prompt version, asked for the group's fields.
 * Replay names no live rules: it plays recordings back, never in production,
 * and counts as it always has, for everything.
 */
export function askedFor(group: FieldGroup, promptVersion: string | null | undefined): boolean {
  if (group.since === null) return true;
  const rules = liveRulesOf(promptVersion);
  return rules === null || compareRules(rules, group.since) >= 0;
}

/**
 * The Batch API's discount. Every token in a batched request is half price.
 *
 * Here rather than beside the meter because the ESTIMATE needs it too, and
 * this module is the one with no node imports -- a client component draws the
 * estimate, and reaching the meter would drag the fetch stack into the bundle.
 */
export const BATCH_DISCOUNT = 0.5;

/** Above this many companies, the Analyst types the count to confirm. */
export const CONFIRM_ABOVE = 50;

export type Estimate = {
  count: number;
  estimatedUsd: number;
  estimatedMinutes: number;
  exceedsBudget: boolean;
  needsTypedCount: boolean;
};

/**
 * What a company costs to research, per pass, measured on Run 1 (11 September
 * 2026, five companies, live, synchronous): pass 1 $1.25 for 5 ($0.25 each),
 * pass 2 $0.59 for 5 and $0.42 for 4 ($0.10-0.12 each). Each is the measured
 * mean plus about 20%, because the start form refuses a run whose estimate
 * exceeds its budget and a run that halts part-way is wasted. Spend is
 * recorded per run, not per company, so these are means, not a p95.
 *
 * Pass 2 rose from 0.15 to 0.18 on 17 October, when it took six more fields
 * (revenue, net income, total assets, two fee lines, reporting currency):
 * about a thousand more output tokens and a few more windows on Sonnet, some
 * three cents a company. An estimate, until a run measures it.
 *
 * And to 0.30 on 21 October, when pass 2 began searching again for a company
 * whose pass-1 list holds no current filing of the kind its fees are printed
 * in. Measured that day on 75 TSX companies: $0.30 for a company that
 * searched again (49 of them, US$14.75), $0.13 for one that did not (26,
 * US$3.30). How many search depends on the companies, so the figure is what
 * a searching company costs: a run cannot outspend it, whatever its mix.
 */
export const ESTIMATED_USD_PER_COMPANY_BY_PASS: Record<Pass, number> = {
  identity: 0.30,
  general: 0.30,
};
/**
 * What of that is web search, which the Batch API does NOT discount -- "Web
 * search tool calls through the Messages Batches API are priced the same as
 * those in regular Messages API requests".
 *
 * Measured, not assumed: across 75 real jobs in production, pass 1 made
 * exactly six searches for every company it touched (34 jobs, 204 searches,
 * no exceptions) and pass 2 made none at all -- it reads filings from the
 * trusted domain and EDGAR rather than searching. Pass 1 always used every
 * search it was allowed, so the cap is the count: six, at a cent each, owed
 * in full by a batched run.
 *
 * Pass 2 searches only when it searches again for the filing the fees are in
 * (21 October), and then as pass 1 does: six. Counted for every company, as
 * the figure above is.
 */
export const ESTIMATED_SEARCH_USD_BY_PASS: Record<Pass, number> = {
  identity: 0.06,
  general: 0.06,
};
/**
 * Replay, which spends nothing, and any run with no pass: the design's
 * synchronous mid-point (docs/design/06: $0.25-0.45 per company).
 */
export const ESTIMATED_USD_PER_COMPANY = 0.25;
/** p95 per-company job on the synchronous path, docs/design/12. */
export const ESTIMATED_SECONDS_PER_COMPANY = 90;

export function estimate(count: number, budgetUsd: number, workerSlots: number,
                         pass?: Pass | null, batched = false): Estimate {
  const full = pass ? ESTIMATED_USD_PER_COMPANY_BY_PASS[pass] : ESTIMATED_USD_PER_COMPANY;
  // The discount reaches the tokens; the searches inside `full` are due either
  // way. Discounting them too under-quotes pass 1 by three cents a company.
  const searchUsd = pass ? ESTIMATED_SEARCH_USD_BY_PASS[pass] : 0;
  const perCompany = batched ? (full - searchUsd) * BATCH_DISCOUNT + searchUsd : full;
  const estimatedUsd = Math.round(count * perCompany * 100) / 100;
  const estimatedMinutes = Math.ceil((count * ESTIMATED_SECONDS_PER_COMPANY) / workerSlots / 60);
  return {
    count, estimatedUsd, estimatedMinutes,
    exceedsBudget: estimatedUsd > budgetUsd,
    needsTypedCount: count > CONFIRM_ABOVE,
  };
}

/** "AEM, wdo  ELE" -> ["AEM", "WDO", "ELE"]. Empty means no limit. */
export function parseTickers(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
}
