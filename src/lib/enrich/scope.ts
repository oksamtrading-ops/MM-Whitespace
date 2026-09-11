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

/**
 * The design's synchronous mid-point (docs/design/06: $0.25–0.45 per company,
 * $0.12–0.25 batched). A placeholder until Run 1 measures a real company;
 * it is here so the screen shows a number that can be wrong out loud rather
 * than no number at all.
 */
export const ESTIMATED_USD_PER_COMPANY = 0.25;
/** p95 per-company job on the synchronous path, docs/design/12. */
export const ESTIMATED_SECONDS_PER_COMPANY = 90;

export function estimate(count: number, budgetUsd: number, workerSlots: number): Estimate {
  const estimatedUsd = Math.round(count * ESTIMATED_USD_PER_COMPANY * 100) / 100;
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
