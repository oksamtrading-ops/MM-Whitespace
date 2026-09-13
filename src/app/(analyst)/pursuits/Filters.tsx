import Link from "next/link";
import type { Route } from "next";
import { SORTS, UNASSIGNED, type PursuitFilter, type PursuitSort } from "../../../lib/pursuit/index.ts";
import type { Person } from "./[id]/PursuitDesk.tsx";
import Icon from "../../_ui/Icon.tsx";

/**
 * A plain GET form, and therefore no JavaScript at all.
 *
 * Every view this produces is a URL, which is the point: "the eleven you own
 * that are past their date" is a message someone can send, not a screenshot.
 * The review grid keeps its find text in the URL for the same reason.
 *
 * Submitting navigates, so the server does the narrowing and the page a
 * colleague opens is the page that was sent.
 */
export default function Filters({ filter, sort, people, priorities, active, total, mineId }: {
  filter: PursuitFilter; sort: PursuitSort; people: Person[]; priorities: string[];
  active: boolean; total: number; mineId: string;
}) {
  return (
    <form method="get" className="narrowing" role="search" aria-label="Narrow the pursuits">
      <p className="field">
        <label htmlFor="q">Company</label>
        <input id="q" name="q" defaultValue={filter.q ?? ""} autoComplete="off"
               placeholder="Any name" />
      </p>
      <p className="field">
        <label htmlFor="owner">Owner</label>
        <select id="owner" name="owner" defaultValue={filter.owner ?? ""}>
          <option value="">Anyone</option>
          <option value={mineId}>Mine</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
        </select>
      </p>
      <p className="field">
        <label htmlFor="priority">Priority</label>
        <select id="priority" name="priority" defaultValue={filter.priority ?? ""}>
          <option value="">Any</option>
          {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </p>
      <p className="field">
        <label htmlFor="due">Due</label>
        <select id="due" name="due" defaultValue={filter.due ?? ""}>
          <option value="">Any</option>
          <option value="overdue">Past its date</option>
          <option value="soon">This week, late ones included</option>
        </select>
      </p>
      <p className="field">
        <label htmlFor="sort">Order</label>
        <select id="sort" name="sort" defaultValue={sort}>
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </p>
      <p className="field actions">
        <button type="submit" className="btn primary sm"><Icon name="search" size={13} />Narrow</button>
        {active && <Link href={"/pursuits" as Route} prefetch={false}>Clear</Link>}
      </p>
      {active && (
        <p className="hint" role="status">
          Showing {total === 1 ? "one pursuit" : `${total} pursuits`} of those open.
          This view is its own address — the link can be sent.
        </p>
      )}
    </form>
  );
}
