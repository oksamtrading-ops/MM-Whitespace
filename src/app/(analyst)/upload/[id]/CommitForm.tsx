"use client";

import { useActionState } from "react";
import { commitParsed } from "../actions.ts";

/**
 * The commit. The period label is required and editable because the quarter is
 * not in the workbook -- only the market-cap date is -- and the label is what
 * the period is called from then on.
 */
export default function CommitForm({ parseId, suggestedLabel, warnings, blocked }: {
  parseId: string; suggestedLabel: string; warnings: number; blocked: string | null;
}) {
  const [state, action, pending] = useActionState(commitParsed, null);

  if (blocked) {
    return (
      <div className="notice alert">
        <b>Cannot be committed</b>
        <span>{blocked}</span>
      </div>
    );
  }

  return (
    <form action={action} className="commit">
      <input type="hidden" name="parseId" value={parseId} />
      <p className="field">
        <label htmlFor="label">Name this period</label>
        <input id="label" name="label" defaultValue={suggestedLabel} required
               autoComplete="off" spellCheck={false} />
        <span className="hint">
          The workbook carries a market-cap date, not a quarter, so the name is yours to
          confirm. It is what the period is called from now on.
        </span>
      </p>

      {warnings > 0 && (
        <p className="check">
          <input type="checkbox" id="ack" name="acknowledged" value="yes" required />
          <label htmlFor="ack">
            I have read the {warnings} warning{warnings === 1 ? "" : "s"} above.
          </label>
        </p>
      )}

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <div className="notice alert"><b>Not committed</b><span>{state.message}</span></div>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Committing…" : "Commit this period"}
      </button>
    </form>
  );
}
