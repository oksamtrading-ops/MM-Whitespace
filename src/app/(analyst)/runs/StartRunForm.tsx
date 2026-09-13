"use client";

import { useActionState, useState } from "react";
import { start } from "./actions.ts";
import {
  CONFIRM_ABOVE, estimate, parseTickers, type Estimate, type Pass, type Scope,
} from "../../../lib/enrich/scope.ts";
import { formatMoney } from "../../../lib/format/fields.ts";

/** One thing the Analyst may start: a scope, and in live mode the pass it belongs to. */
export type ScopeOffer = {
  key: string; pass: Pass | null; scope: Scope;
  label: string; detail: string;
  estimate: Estimate; allowed: boolean; why?: string;
  /** Every ticker the scope covers, so a typed list can be counted here. */
  tickers: string[];
};

/**
 * The pre-flight estimate, blocking (docs/design/01). Nothing here is the
 * boundary: the action re-derives the scope, the estimate and every refusal.
 */
export default function StartRunForm({ periodId, offers, defaultBudgetUsd, mode, workerSlots, batched }: {
  periodId: string; offers: ScopeOffer[]; defaultBudgetUsd: number; mode: string;
  workerSlots: number; batched: boolean;
}) {
  const [state, action, pending] = useActionState(start, null);
  const [key, setKey] = useState<string>(offers.find((o) => o.allowed)?.key ?? offers[0].key);
  const [budget, setBudget] = useState(String(defaultBudgetUsd));
  const [limit, setLimit] = useState("");
  const chosen = offers.find((o) => o.key === key) ?? offers[0];
  const budgetNumber = Number(budget.replace(/[$,\s]/g, ""));

  // A typed list narrows the scope; a ticker outside it is shown, and refused on submit.
  const wanted = parseTickers(limit);
  const outside = wanted.filter((t) => !chosen.tickers.includes(t));
  // When the tickers belong to another option -- typically "every eligible
  // company", because they have already had this pass -- say which, rather
  // than only that they are refused. Run 1: "not yet done" was selected for
  // four companies that had just had pass 2, and the button greyed out.
  const covering = outside.length
    ? offers.find((o) => o.key !== chosen.key && o.allowed && outside.every((t) => o.tickers.includes(t)))
    : undefined;
  const count = wanted.length ? wanted.length - outside.length : chosen.estimate.count;
  const est = wanted.length
    ? estimate(count, Number.isFinite(budgetNumber) ? budgetNumber : 0, workerSlots, chosen.pass, batched)
    : chosen.estimate;
  const overBudget = Number.isFinite(budgetNumber) && est.estimatedUsd > budgetNumber;

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
        <label htmlFor="tickers">Limit to these tickers <span className="hint">(optional)</span></label>
        <input id="tickers" name="tickers" value={limit} autoComplete="off" spellCheck={false}
               placeholder="e.g. AEM, WDO, ELE" onChange={(e) => setLimit(e.target.value)} />
        <span className="hint">
          {outside.length
            ? covering
              ? <>
                  {`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not in the selected option. `}
                  {covering.pass === chosen.pass && chosen.scope === "unresearched"
                    ? "They have already had this pass. "
                    : ""}
                  <button type="button" className="btn quiet" onClick={() => setKey(covering.key)}>
                    Switch to “{covering.label}”
                  </button>
                </>
              : `Not in any option here: ${outside.join(", ")}. Check the tickers, or that pass 2 companies have an accepted website.`
            : "For a sample run, or to research named companies again. Leave empty for the whole scope."}
        </span>
      </p>

      <p className="field">
        <label htmlFor="budgetUsd">Budget</label>
        <span className="withunit">
          <span className="unit" aria-hidden="true">US$</span>
          <input id="budgetUsd" name="budgetUsd" value={budget} required inputMode="decimal"
                 autoComplete="off" onChange={(e) => setBudget(e.target.value)} />
        </span>
        <span className="hint">Warns at 80%, halts at 100%. A run cannot exist without one.</span>
      </p>

      <div className={`notice${overBudget ? " alert" : ""}`} role="status" aria-live="polite">
        <b>Estimate</b>
        <span>
          {est.count} {est.count === 1 ? "company" : "companies"}, about{" "}
          <strong>{formatMoney(est.estimatedUsd, "USD", { cents: true })}</strong> and{" "}
          <strong>{est.estimatedMinutes} min</strong> at the current worker cap.
          {overBudget && " That is more than the budget, so the run would halt part-way."}
          {chosen.pass
            ? " The per-company figure is Run 1's measured cost for this pass, plus a margin."
            : " The per-company figure is the design's placeholder."}
        </span>
      </div>

      {est.needsTypedCount && (
        <p className="field">
          <label htmlFor="confirmCount">Type the company count to confirm</label>
          <input id="confirmCount" name="confirmCount" inputMode="numeric" autoComplete="off"
                 placeholder={String(est.count)} />
          <span className="hint">
            Required above {CONFIRM_ABOVE} companies. The number is {est.count}.
          </span>
        </p>
      )}

      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <div className="notice alert"><b>Not started</b><span>{state.message}</span></div>
        )}
      </div>

      <button type="submit" className="btn primary"
              disabled={pending || !chosen.allowed || outside.length > 0 || (wanted.length > 0 && count === 0)}>
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
