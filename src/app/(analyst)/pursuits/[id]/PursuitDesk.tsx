"use client";

import { useActionState } from "react";
import { action, assign, endPursuit, note, prioritise, reopen, type ActionResult } from "../actions.ts";
import type { Vocabulary } from "../../../../lib/pursuit/index.ts";

export type Person = { id: string; email: string };

type Props = {
  pursuitId: string;
  vocabulary: Vocabulary;
  people: Person[];
  priority: string | null;
  ownerId: string | null;
  outcome: string | null;
  closed: boolean;
};

/**
 * One notice for the whole desk rather than one per form.
 *
 * Four forms with four live regions means a screen reader hears three stale
 * results beside the new one. There is one region, and whichever form answered
 * last owns it.
 */
function Notice({ state }: { state: ActionResult | null }) {
  return (
    <div role="status" aria-live="polite">
      {state && (
        <div className={`notice ${state.ok ? "ok" : "alert"}`}>
          <b>{state.ok ? "Recorded" : "Not recorded"}</b>
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}

export default function PursuitDesk(props: Props) {
  const { pursuitId, vocabulary, people, priority, ownerId, closed } = props;
  const [judged, judge, judging] = useActionState(
    async (_: ActionResult | null, form: FormData) => prioritise(form), null);
  const [assigned, doAssign, assigning] = useActionState(
    async (_: ActionResult | null, form: FormData) => assign(form), null);
  const [noted, doNote, noting] = useActionState(
    async (_: ActionResult | null, form: FormData) => note(form), null);
  const [acted, doAct, acting] = useActionState(
    async (_: ActionResult | null, form: FormData) => action(form), null);
  const [ended, end, ending] = useActionState(
    async (_: ActionResult | null, form: FormData) => endPursuit(form), null);
  const [opened, open, opening] = useActionState(
    async (_: ActionResult | null, form: FormData) => reopen(form), null);

  const latest = [judged, assigned, noted, acted, ended, opened].filter(Boolean).at(-1) ?? null;

  // A closed pursuit is read, not worked. Its record stays whole and visible;
  // reopening is the one thing offered, and it is deliberate rather than a
  // side effect of typing into a form that should not have been there.
  if (closed) {
    return (
      <div className="desk">
        <form action={open} className="field">
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <p className="hint">
            This pursuit is closed. Its notes and actions stand as they are.
            Reopening it is recorded, and the outcome it was closed under stays
            on the record.
          </p>
          <button type="submit" className="btn" disabled={opening}>
            {opening ? "Reopening…" : "Reopen this pursuit"}
          </button>
        </form>
        <Notice state={latest} />
      </div>
    );
  }

  return (
    <div className="desk">
      <div className="row">
        <form action={judge} className="field">
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <label htmlFor="priority">Priority</label>
          <span className="withunit">
            <select id="priority" name="priority" defaultValue={priority ?? ""}>
              <option value="" disabled>Choose one</option>
              {vocabulary.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="submit" className="btn" disabled={judging}>
              {judging ? "Setting…" : "Set"}
            </button>
          </span>
        </form>

        <form action={doAssign} className="field">
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <label htmlFor="ownerId">Owner</label>
          <span className="withunit">
            <select id="ownerId" name="ownerId" defaultValue={ownerId ?? ""}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
            </select>
            <button type="submit" className="btn" disabled={assigning}>
              {assigning ? "Assigning…" : "Assign"}
            </button>
          </span>
        </form>
      </div>

      <form action={doNote} className="field">
        <input type="hidden" name="pursuitId" value={pursuitId} />
        <label htmlFor="body">Add a note</label>
        <textarea id="body" name="body" rows={3} required maxLength={4000}
                  placeholder="What happened, and what it means for the pursuit." />
        <button type="submit" className="btn" disabled={noting}>
          {noting ? "Adding…" : "Add note"}
        </button>
      </form>

      <form action={doAct} className="field">
        <input type="hidden" name="pursuitId" value={pursuitId} />
        <label htmlFor="description">Add an action</label>
        <input id="description" name="description" required maxLength={500}
               autoComplete="off" placeholder="One thing somebody will do." />
        <span className="withunit">
          <label htmlFor="dueDate" className="hint">Due</label>
          <input id="dueDate" name="dueDate" type="date" />
          <label htmlFor="actionOwner" className="hint">Owner</label>
          <select id="actionOwner" name="ownerId" defaultValue="">
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
          </select>
          <button type="submit" className="btn" disabled={acting}>
            {acting ? "Adding…" : "Add action"}
          </button>
        </span>
        <span className="hint">
          It starts as “{vocabulary.statuses[0].name}”. Move it below as it goes.
        </span>
      </form>

      <form action={end} className="field">
        <input type="hidden" name="pursuitId" value={pursuitId} />
        <label htmlFor="outcome">Close this pursuit</label>
        <span className="withunit">
          <select id="outcome" name="outcome" defaultValue={vocabulary.outcomes[0]}>
            {vocabulary.outcomes.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button type="submit" className="btn" disabled={ending}>
            {ending ? "Closing…" : "Close"}
          </button>
        </span>
        <span className="hint">
          What happened, not just that it is over. Open actions do not stop this —
          a pursuit is often lost with work outstanding.
        </span>
      </form>

      <Notice state={latest} />
    </div>
  );
}
