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
            "new, visible proposal. Admin-only once the period has findings.",
  },
};

/** Above this many companies, the Analyst types the count to confirm. */
export const CONFIRM_ABOVE = 50;

export type Estimate = {
  count: number;
  estimatedUsd: number;
  estimatedMinutes: number;
  exceedsBudget: boolean;
  needsTypedCount: boolean;
};
