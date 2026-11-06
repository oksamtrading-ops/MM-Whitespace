/**
 * What an analyst can say a supplied document is, apart from the code that
 * reads one: review and the profile label a finding with it, and neither
 * should load the research worker to do so.
 */
import type { DocKind } from "../enrich/live.ts";

/** In the analyst's words, and the kind pass 2 orders the document by. */
export const SUPPLY_KINDS: ReadonlyArray<{ kind: DocKind; label: string }> = [
  { kind: "annual_information_form", label: "Annual information form" },
  { kind: "information_circular", label: "Management information circular" },
  { kind: "annual_financial_statements", label: "Annual financial statements" },
  { kind: "annual_mdna", label: "Annual MD&A" },
  { kind: "interim_report", label: "Interim financial statements or MD&A" },
  { kind: "news_release", label: "News release" },
  { kind: "other", label: "Something else from the company" },
];

export function kindLabel(kind: string): string {
  return SUPPLY_KINDS.find((k) => k.kind === kind)?.label ?? "A document";
}

/**
 * What review says of a finding read from a supplied document: who supplied
 * it, when, as what, and that the link is their word, not the application's
 * fetch. `when` is already written for a reader.
 */
export function suppliedWords(s: { by: string; kind: string }, when: string): string {
  return `${kindLabel(s.kind)} supplied by ${s.by} on ${when}. The application did not fetch it: ` +
    "the link is the address they gave, and the file there may since have changed. Never bulk-accepted.";
}
