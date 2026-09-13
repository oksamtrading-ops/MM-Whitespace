"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { beginPursuit, type ActionResult } from "../../../(analyst)/pursuits/actions.ts";

/**
 * The way into the pursuit workflow, from the one screen that has the evidence.
 *
 * docs/design/01's second journey is a partner reading this page before a
 * conversation. What the practice then decides to DO is a pursuit, so it starts
 * here rather than from an empty form somewhere else. Only an Analyst or Admin
 * sees this: a partner is a Viewer, and the tables are revoked from the Viewer
 * in policy, not in interface logic.
 */
export default function PursuitLink({ companyId, pursuitId }: {
  companyId: string; pursuitId: string | null;
}) {
  const [state, begin, starting] = useActionState(
    async (_: ActionResult | null, form: FormData) => beginPursuit(form), null);
  const id = state?.pursuitId ?? pursuitId;

  if (id) {
    return (
      <p className="meta">
        <Link href={`/pursuits/${id}` as Route} prefetch={false}>Open the pursuit →</Link>
      </p>
    );
  }
  return (
    <form action={begin} className="inline">
      <input type="hidden" name="companyId" value={companyId} />
      <button type="submit" className="btn" disabled={starting}>
        {starting ? "Opening…" : "Start a pursuit"}
      </button>
      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <div className="notice alert"><b>Not opened</b><span>{state.message}</span></div>
        )}
      </div>
    </form>
  );
}
