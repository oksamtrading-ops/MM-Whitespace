"use client";

import { useActionState } from "react";
import { sweepStatus, type ActionResult } from "./actions.ts";
import type { Stranded, Vocabulary } from "../../../lib/pursuit/index.ts";

/**
 * The repair for a renamed status, offered only when there is something to
 * repair.
 *
 * A control that is always on screen asking which statuses to merge is a
 * control nobody reads. This section does not exist unless actions are sitting
 * in a term the vocabulary no longer knows, and then it names the term, says
 * how many are stranded, and moves them in one act that leaves one audit line.
 */
export default function Sweep({ stranded, vocabulary }: {
  stranded: Stranded[]; vocabulary: Vocabulary;
}) {
  const [state, sweep, sweeping] = useActionState(
    async (_: ActionResult | null, form: FormData) => sweepStatus(form), null);

  return (
    <>
      {stranded.map((s) => (
        <form action={sweep} className="field" key={s.status}>
          <input type="hidden" name="from" value={s.status} />
          <label htmlFor={`to-${s.status}`}>
            {s.actions === 1
              ? `One action is in “${s.status}”, which is no longer a status in use.`
              : `${s.actions} actions are in “${s.status}”, which is no longer a status in use.`}
          </label>
          <span className="withunit">
            <span className="hint">Move them to</span>
            <select id={`to-${s.status}`} name="to" defaultValue={vocabulary.statuses[0].name}>
              {vocabulary.statuses.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
            <button type="submit" className="btn" disabled={sweeping}>
              {sweeping ? "Moving…" : "Move them"}
            </button>
          </span>
          <span className="hint">
            They count as open until they are moved, which is why they are listed
            here rather than hidden. Each keeps its own history; this changes the
            status and nothing else.
          </span>
        </form>
      ))}
      <div role="status" aria-live="polite">
        {state && (
          <div className={`notice ${state.ok ? "ok" : "alert"}`}>
            <b>{state.ok ? "Moved" : "Not moved"}</b>
            <span>{state.message}</span>
          </div>
        )}
      </div>
    </>
  );
}
