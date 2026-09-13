/**
 * The evidence floor for bulk accept, and who sets it.
 *
 * It was fixed at 0.80. Run 2 put 25 companies' worth of anchored, quoted
 * values at 0.71-0.79 -- what a single cited filing scores, which is most of
 * them -- so every one had to be taken by hand, one keystroke each. How much
 * corroboration is enough is a judgement, and it belongs to the person doing
 * the review.
 *
 * Within limits. The floor never goes below 0.60, and it is one of seven
 * conditions: the bulk path still refuses fees, extract-versus-AI conflicts,
 * anything already overridden, anything the anchoring gate quarantined,
 * anything with no source, and stage flags without a typed opt-in -- whatever
 * the floor says (decide.ts).
 */
export const THRESHOLDS = [0.6, 0.7, 0.75, 0.8, 0.9] as const;
export const DEFAULT_THRESHOLD = 0.8;

/** A floor from a URL: one of the offered values, or the default. */
export function chosenThreshold(raw: string | number | undefined | null): number {
  const asked = Number(raw);
  return (THRESHOLDS as readonly number[]).includes(asked) ? asked : DEFAULT_THRESHOLD;
}
