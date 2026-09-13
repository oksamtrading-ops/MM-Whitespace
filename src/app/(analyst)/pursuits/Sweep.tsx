"use client";

import { useActionState } from "react";
import { sweepStatus, type ActionResult } from "./actions.ts";
import { strandedNoun, type Stranded, type Vocabulary } from "../../../lib/pursuit/index.ts";
import Callout from "../../_ui/Callout.tsx";

/**
 * The repair for a renamed term, offered only when there is something to
 * repair.
 *
 * A control that is always on screen asking which terms to merge is a control
 * nobody reads. This section does not exist unless rows are carrying a term the
 * vocabulary no longer knows, and then it names the term, says how many carry
 * it, and moves them in one act that leaves one audit line.
 *
 * Statuses and priorities are the same problem, so they are the same form. Only
 * the noun and the list of destinations differ.
 */
export default function Sweep({ stranded, vocabulary }: {
  stranded: Stranded[]; vocabulary: Vocabulary;
}) {
  const [state, sweep, sweeping] = useActionState(
    async (_: ActionResult | null, form: FormData) => sweepStatus(form), null);

  return (
    <>
      {stranded.map((s) => {
        const noun = strandedNoun(s.kind);
        const options = s.kind === "status"
          ? vocabulary.statuses.map((v) => v.name)
          : vocabulary.priorities;
        const key = `${s.kind}-${s.value}`;
        return (
          <form action={sweep} className="field" key={key}>
            <input type="hidden" name="kind" value={s.kind} />
            <input type="hidden" name="from" value={s.value} />
            <label htmlFor={`to-${key}`}>
              {s.count === 1
                ? `One ${noun} carries “${s.value}”, which is no longer a ${s.kind} in use.`
                : `${s.count} ${noun}s carry “${s.value}”, which is no longer a ${s.kind} in use.`}
            </label>
            <span className="withunit">
              <span className="hint">Move {s.count === 1 ? "it" : "them"} to</span>
              <select id={`to-${key}`} name="to" defaultValue={options[0]}>
                {options.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button type="submit" className="btn" disabled={sweeping}>
                {sweeping ? "Moving…" : "Move"}
              </button>
            </span>
            <span className="hint">
              {s.kind === "status"
                ? "They count as open until they are moved, which is why they are listed here rather than hidden."
                : "They sort last until they are moved, among the pursuits nobody has judged."}
              {" "}Each keeps its own history; this changes the {s.kind} and nothing else.
            </span>
          </form>
        );
      })}
      <div role="status" aria-live="polite">
        {state && (
          <Callout tone={state.ok ? "ok" : "danger"}
                   title={state.ok ? "Moved" : "Not moved"}>{state.message}</Callout>
        )}
      </div>
    </>
  );
}
