/**
 * Which decisions a review row still offers -- one answer for both grids, and
 * for their buttons and their keys.
 *
 * The two disagreed: a decided row drew no controls but still answered A, O
 * and F, so O opened the override editor where no Override button existed.
 * That is how two of the corrections on 13 September were made -- the shortcut
 * doing work the screen said was not available.
 */
export type Decidable = { decided: boolean; decision: string | null; newerThanDecision: boolean };

/**
 * Accept, Override and Flag: an undecided row, or one research has overtaken,
 * which must be takeable -- with its controls hidden there was no way to (Run 1,
 * twice).
 */
export function canAct<T extends Decidable>(row: T | null | undefined): row is T {
  return row != null && (!row.decided || row.newerThanDecision);
}

/**
 * Override, on a row whose standing decision is a flag. A flag says the
 * proposal cannot be used; it does not say what the value is, and finding that
 * out is what follows it. Until 31 October 2026 nothing could follow it: the
 * row drew no controls, and Undo walks back the field's LAST decision, whoever
 * it was for. Mkango's auditor, flagged on 21 October as PKF Littlejohn and
 * found to be MNP from its 2025 statements, could be corrected only by undoing
 * every auditor decision recorded since. Accepting the flagged proposal, or
 * flagging it again, stays withheld: the flag already answered both.
 */
export function canOverride<T extends Decidable>(row: T | null | undefined): row is T {
  return row != null && (!row.decided || row.newerThanDecision || row.decision === "flag");
}
