"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { beginPursuit, type ActionResult } from "../../../(analyst)/pursuits/actions.ts";
import Callout from "../../../_ui/Callout.tsx";
import Icon from "../../../_ui/Icon.tsx";

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
      <Link className="btn sm secondary" href={`/pursuits/${id}` as Route} prefetch={false}>
        <Icon name="crosshair" size={13} />Open the pursuit
      </Link>
    );
  }
  return (
    <form action={begin} className="inline">
      <input type="hidden" name="companyId" value={companyId} />
      <button type="submit" className={`btn sm primary${starting ? " loading" : ""}`}
              disabled={starting} aria-busy={starting || undefined}>
        <Icon name="crosshair" size={13} />Start a pursuit
      </button>
      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <Callout tone="danger" title="Not opened">{state.message}</Callout>
        )}
      </div>
    </form>
  );
}
