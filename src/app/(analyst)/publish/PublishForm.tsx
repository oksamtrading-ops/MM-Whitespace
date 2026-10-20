"use client";

import { useActionState, useState } from "react";
import { publish } from "./actions.ts";
import Callout from "../../_ui/Callout.tsx";

const MIN_REASON = 20;

/**
 * The publish control. Three shapes, because three different things are true:
 * the gate is open, the gate is blocked and you may override it, or the gate
 * is blocked and you may not.
 */
export default function PublishForm({ periodId, publishable, isAdmin, amending, blockers, unchangedSince }: {
  periodId: string; publishable: boolean; isAdmin: boolean; amending: boolean; blockers: number;
  /** The revision this one would be identical to, apart from its reasons; null when it differs. */
  unchangedSince: number | null;
}) {
  const [state, action, pending] = useActionState(publish, null);
  const [reason, setReason] = useState("");
  const overriding = !publishable;
  const armed = !overriding || reason.trim().length >= MIN_REASON;

  if (overriding && !isAdmin) {
    return (
      <Callout tone="danger" title="Blocked">{blockers} thing{blockers === 1 ? "" : "s"} must be resolved before this period can be
          published. An Admin may publish through a blocked gate with a recorded reason.</Callout>
    );
  }

  return (
    <form action={action} className="commit">
      <input type="hidden" name="periodId" value={periodId} />

      {overriding && (
        <p className="field">
          <label htmlFor="overrideReason">Why publish through a blocked gate?</label>
          <textarea id="overrideReason" name="overrideReason" rows={3} required
                    value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="What the practice gains by seeing this now, and what is still missing." />
          <span className="hint">
            Printed on the dashboard header for as long as this revision stands. That is the
            point of it: an override nobody can see is an override nobody questions.
            {reason.trim().length > 0 && reason.trim().length < MIN_REASON && (
              <> <b>{MIN_REASON - reason.trim().length} more characters.</b></>
            )}
          </span>
        </p>
      )}

      {amending && (
        <p className="field">
          <label htmlFor="amendmentReason">Why amend?</label>
          <input id="amendmentReason" name="amendmentReason" required autoComplete="off"
                 placeholder="What changed since the last revision." />
          <span className="hint">
            The published revision is never replaced. This writes a new one beside it. Name what
            the list of changes above shows.
          </span>
        </p>
      )}

      {/* Not refused: a revision that corrects only its header is legitimate
          (revision 8 was one). But it is asked, here and again on the server. */}
      {amending && unchangedSince !== null && (
        <p className="check">
          <input type="checkbox" id="nothingChanged" name="nothingChanged" value="yes" required />
          <label htmlFor="nothingChanged">
            Nothing has changed since revision {unchangedSince}. Publish a revision that differs from it
            only in its reasons.
          </label>
        </p>
      )}

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <Callout tone="danger" title="Not published">{state.message}</Callout>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending || !armed}>
        {pending
          ? "Freezing the snapshot…"
          : overriding
            ? "Publish through the blocked gate"
            : amending ? "Publish an amendment" : "Publish this period"}
      </button>
      <p className="meta" style={{ marginTop: 12 }}>
        {pending
          ? "Writing every resolved value and aggregate into a frozen revision."
          : "Publishing freezes a snapshot. Dashboards read only that, never the live tables."}
      </p>
    </form>
  );
}
