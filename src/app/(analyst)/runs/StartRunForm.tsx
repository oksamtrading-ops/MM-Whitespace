"use client";

import { useActionState, useState } from "react";
import { start } from "./actions.ts";
import { CONFIRM_ABOVE, type Estimate, type Pass, type Scope } from "../../../lib/enrich/scope.ts";

/** One thing the Analyst may start: a scope, and in live mode the pass it belongs to. */
export type ScopeOffer = {
  key: string; pass: Pass | null; scope: Scope;
  label: string; detail: string;
  estimate: Estimate; allowed: boolean; why?: string;
};

/**
 * The pre-flight estimate, blocking (docs/design/01). Nothing here is the
 * boundary: the action re-derives the scope, the estimate and every refusal.
 */
export default function StartRunForm({ periodId, offers, defaultBudgetUsd, mode }: {
  periodId: string; offers: ScopeOffer[]; defaultBudgetUsd: number; mode: string;
}) {
  const [state, action, pending] = useActionState(start, null);
  const [key, setKey] = useState<string>(offers.find((o) => o.allowed)?.key ?? offers[0].key);
  const [budget, setBudget] = useState(String(defaultBudgetUsd));
  const chosen = offers.find((o) => o.key === key) ?? offers[0];
  const budgetNumber = Number(budget.replace(/[$,\s]/g, ""));
  const overBudget = Number.isFinite(budgetNumber) && chosen.estimate.estimatedUsd > budgetNumber;

  return (
    <form action={action} className="commit settings">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="scope" value={chosen.scope} />
      <input type="hidden" name="pass" value={chosen.pass ?? ""} />

      <fieldset className="field">
        <legend>Scope</legend>
        {offers.map((o) => (
          <p key={o.key} style={{ margin: "6px 0" }}>
            <label>
              <input type="radio" name="offer" value={o.key} checked={key === o.key}
                     disabled={!o.allowed} onChange={() => setKey(o.key)} />{" "}
              {o.label} — <b>{o.estimate.count}</b>
              {o.estimate.count === 1 ? " company" : " companies"}
            </label>
            <span className="hint">{o.allowed ? o.detail : o.why}</span>
          </p>
        ))}
      </fieldset>

      <p className="field">
        <label htmlFor="budgetUsd">Budget</label>
        <span className="withunit">
          <span className="unit" aria-hidden="true">$</span>
          <input id="budgetUsd" name="budgetUsd" value={budget} required inputMode="decimal"
                 autoComplete="off" onChange={(e) => setBudget(e.target.value)} />
        </span>
        <span className="hint">Warns at 80%, halts at 100%. A run cannot exist without one.</span>
      </p>

      <div className={`notice${overBudget ? " alert" : ""}`} role="status" aria-live="polite">
        <b>Estimate</b>
        <span>
          {chosen.estimate.count} {chosen.estimate.count === 1 ? "company" : "companies"}, about{" "}
          <strong>${chosen.estimate.estimatedUsd.toFixed(2)}</strong> and{" "}
          <strong>{chosen.estimate.estimatedMinutes} min</strong> at the current worker cap.
          {overBudget && " That is more than the budget, so the run would halt part-way."}
          {" "}The per-company figure is the design's placeholder until a real company has been measured.
        </span>
      </div>

      {chosen.estimate.needsTypedCount && (
        <p className="field">
          <label htmlFor="confirmCount">Type the company count to confirm</label>
          <input id="confirmCount" name="confirmCount" inputMode="numeric" autoComplete="off"
                 placeholder={String(chosen.estimate.count)} />
          <span className="hint">
            Required above {CONFIRM_ABOVE} companies. The number is {chosen.estimate.count}.
          </span>
        </p>
      )}

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <div className="notice alert"><b>Not started</b><span>{state.message}</span></div>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={pending || !chosen.allowed}>
        {pending ? "Starting…" : "Start run"}
      </button>
      <p className="meta" style={{ marginTop: 12 }}>
        Mode: <code>{mode}</code>.{" "}
        {mode === "replay"
          ? "Replay sends nothing to the vendor. A company with no recording is abandoned, not researched, and the run says so."
          : "Live mode searches the web and sends prompts to the model vendor, within the budget above. " +
            "Every result is a proposal for review; nothing changes a value until someone accepts it."}
      </p>
    </form>
  );
}
