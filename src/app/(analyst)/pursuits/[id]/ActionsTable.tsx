"use client";

import { useActionState } from "react";
import { moveAction, type ActionResult } from "../actions.ts";
import type { Action, Vocabulary } from "../../../../lib/pursuit/index.ts";

/**
 * Moving an action lives on the row it belongs to.
 *
 * The alternative -- one control that asks which action -- makes the person
 * carry an identifier from one part of the screen to another, which is work
 * the screen should be doing.
 */
export default function ActionsTable({ pursuitId, actions, vocabulary }: {
  pursuitId: string; actions: Action[]; vocabulary: Vocabulary;
}) {
  const [state, move, moving] = useActionState(
    async (_: ActionResult | null, form: FormData) => moveAction(form), null);

  return (
    <>
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Owner</th>
            <th scope="col">Due</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id}>
              <th scope="row">{a.description}</th>
              <td>{a.ownerEmail ?? <span className="meta">unassigned</span>}</td>
              <td>{a.dueDate ?? <span className="meta">—</span>}</td>
              <td>
                <form action={move} className="inline">
                  <input type="hidden" name="pursuitId" value={pursuitId} />
                  <input type="hidden" name="actionId" value={a.id} />
                  <select name="status" defaultValue={a.status} disabled={moving}
                          aria-label={`Status of “${a.description}”`}>
                    {/* A status retired from the vocabulary is still this
                        action's status, so it stays selectable rather than
                        silently becoming the first option. */}
                    {a.statusRetired && <option value={a.status}>{a.status} — retired</option>}
                    {vocabulary.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button type="submit" className="btn" disabled={moving}>Move</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
