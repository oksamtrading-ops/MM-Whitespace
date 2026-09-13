"use client";

import { useActionState, useState } from "react";
import { merge } from "./actions.ts";
import Callout from "../../../_ui/Callout.tsx";

/**
 * The direction is the whole decision: one name survives and the other becomes
 * a former name. Nothing is pre-selected, and the sentence under the choice
 * says what will be true afterwards.
 */
export default function MergeForm({ a, b, blocked }: {
  a: { id: string; name: string };
  b: { id: string; name: string };
  blocked: string | null;
}) {
  const [state, action, pending] = useActionState(merge, null);
  const [winner, setWinner] = useState<string | null>(null);
  const loser = winner === null ? null : winner === a.id ? b : a;
  const kept = winner === null ? null : winner === a.id ? a : b;

  if (blocked) {
    return <Callout tone="danger" title="Cannot be merged">{blocked}</Callout>;
  }
  if (state?.ok) {
    return <Callout tone="ok" live title="Merged">{state.message}</Callout>;
  }

  return (
    <form action={action} className="commit">
      <input type="hidden" name="winnerId" value={winner ?? ""} />
      <input type="hidden" name="loserId" value={loser?.id ?? ""} />
      <input type="hidden" name="confirm" value={winner ? "yes" : ""} />

      <fieldset className="direction">
        <legend>Which name survives?</legend>
        {[a, b].map((c) => (
          <label key={c.id} className={winner === c.id ? "on" : ""}>
            <input type="radio" name="keep" value={c.id}
                   checked={winner === c.id} onChange={() => setWinner(c.id)} />
            <span>{c.name}</span>
          </label>
        ))}
      </fieldset>

      <p className="hint">
        {kept && loser
          ? <>Every period recorded against <b>{loser.name}</b> will belong to{" "}
              <b>{kept.name}</b>, and “{loser.name}” is kept as a former name. Published
              revisions are not touched.</>
          : "Nothing is merged until you choose."}
      </p>

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <Callout tone="danger" title="Not merged">{state.message}</Callout>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending || !winner}>
        {pending ? "Merging…" : kept ? `Merge into ${kept.name}` : "Merge"}
      </button>
    </form>
  );
}
