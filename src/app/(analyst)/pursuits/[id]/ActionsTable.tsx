"use client";

import { useActionState } from "react";
import { assignAction, dateAction, moveAction, type ActionResult } from "../actions.ts";
import type { Action, Vocabulary } from "../../../../lib/pursuit/index.ts";
import type { Person } from "./PursuitDesk.tsx";
import Callout from "../../../_ui/Callout.tsx";

/**
 * Moving an action lives on the row it belongs to.
 *
 * The alternative -- one control that asks which action -- makes the person
 * carry an identifier from one part of the screen to another, which is work
 * the screen should be doing.
 */
export default function ActionsTable({ pursuitId, actions, vocabulary, people }: {
  pursuitId: string; actions: Action[]; vocabulary: Vocabulary; people: Person[];
}) {
  const [state, move, moving] = useActionState(
    async (_: ActionResult | null, form: FormData) => moveAction(form), null);
  const [assigned, assign, assigning] = useActionState(
    async (_: ActionResult | null, form: FormData) => assignAction(form), null);
  const [dated, date, dating] = useActionState(
    async (_: ActionResult | null, form: FormData) => dateAction(form), null);
  // Whichever of the three answered last owns the one live region.
  const latest = [state, assigned, dated].filter(Boolean).at(-1) ?? null;

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
              <td>
                <form action={assign} className="inline">
                  <input type="hidden" name="pursuitId" value={pursuitId} />
                  <input type="hidden" name="actionId" value={a.id} />
                  <select name="ownerId" defaultValue={a.ownerId ?? ""} disabled={assigning}
                          aria-label={`Owner of “${a.description}”`}>
                    <option value="">Unassigned</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
                  </select>
                  <button type="submit" className="btn" disabled={assigning}>Assign</button>
                </form>
              </td>
              <td>
                <form action={date} className="inline">
                  <input type="hidden" name="pursuitId" value={pursuitId} />
                  <input type="hidden" name="actionId" value={a.id} />
                  <input type="date" name="dueDate" defaultValue={a.dueDate ?? ""}
                         disabled={dating} aria-label={`Due date of “${a.description}”`} />
                  <button type="submit" className="btn" disabled={dating}>Set</button>
                  {/* Said in words, not by colour alone: the tag carries the
                      state for anyone who cannot see the red. */}
                  {a.due === "overdue" && <span className="tag alert">overdue</span>}
                  {a.due === "soon" && <span className="tag">due soon</span>}
                </form>
              </td>
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
                    {vocabulary.statuses.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn" disabled={moving}>Move</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="status" aria-live="polite">
        {latest && (
          <Callout tone={latest.ok ? "ok" : "danger"}
                   title={latest.ok ? "Recorded" : "Not recorded"}>{latest.message}</Callout>
        )}
      </div>
    </>
  );
}
