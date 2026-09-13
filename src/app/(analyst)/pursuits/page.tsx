import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { listPursuits, strandedTerms, vocabulary } from "../../../lib/pursuit/index.ts";
import Sweep from "./Sweep.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Facts from "../../_ui/Facts.tsx";
import { fmtDate } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pursuits" };

export default async function Pursuits() {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Pursuits are Deloitte-internal and are kept to Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const all = await listPursuits(ctx.db);
  const pursuits = all.filter((p) => p.closedAt === null);
  const closed = all.filter((p) => p.closedAt !== null);
  const v = await vocabulary(ctx.db);
  const stranded = await strandedTerms(ctx.db);
  const open = pursuits.reduce((n, p) => n + p.openActions, 0);
  const overdue = pursuits.reduce((n, p) => n + p.overdueActions, 0);
  const soon = pursuits.reduce((n, p) => n + p.dueSoonActions, 0);

  return (
    <>
      <h1>Pursuits</h1>
      <p className="lede">
        What the practice has decided to do about a company, and who is doing it.
        Everything here is somebody&rsquo;s judgement rather than a researched value,
        so nothing on this page is proposed, scored or published.
      </p>

      {(overdue > 0 || soon > 0) && (
        <p className={`notice${overdue > 0 ? " alert" : ""}`} role="status">
          <b>
            {overdue > 0
              ? `${overdue} action${overdue === 1 ? " is" : "s are"} past its due date.`
              : `${soon} action${soon === 1 ? " is" : "s are"} due within a week.`}
          </b>
          <span>
            {overdue > 0 && soon > 0 && `${soon} more ${soon === 1 ? "is" : "are"} due within a week. `}
            A date nothing ever mentions is not a date, which is why this is here
            rather than only on the action.
          </span>
        </p>
      )}

      <Facts items={[
        { label: "Pursuits", value: pursuits.length, figure: true },
        { label: "Open actions", value: open, figure: true },
        { label: "Overdue", value: overdue, figure: true },
        { label: "Unprioritised", value: pursuits.filter((p) => !p.priority).length, figure: true },
        { label: "Closed", value: closed.length, figure: true },
      ]} />

      {stranded.length > 0 && (
        <Section id="stranded" title="Left behind by a renamed term"
                 caption="Renaming a status or a priority does not rewrite anybody's record, so rows carrying the old term still carry it. Moving them is one act, and it is recorded as one.">
          <Sweep stranded={stranded} vocabulary={v} />
        </Section>
      )}

      <Section id="list" title="Open pursuits" index={stranded.length > 0 ? 1 : 0}
               caption={pursuits.length === 0
                 ? "None yet. A pursuit starts from a company profile, where the evidence is."
                 : `Ranked by priority — ${v.priorities.join(", ")} — and then by what happened most recently.`}>
        {pursuits.length === 0 ? (
          <p className="meta">
            <Link href="/companies">Find a company</Link> and open its profile to start one.
          </p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Priority</th>
                <th scope="col">Owner</th>
                <th scope="col">Actions</th>
                <th scope="col">Due</th>
                <th scope="col">Notes</th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {pursuits.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/pursuits/${p.id}` as Route} prefetch={false}>{p.companyName}</Link>
                  </th>
                  <td>
                    {p.priority
                      ? <span className={`tag${p.priorityRetired ? " retired" : ""}`}>
                          {p.priority}{p.priorityRetired && " — retired"}
                        </span>
                      : <span className="meta">not set</span>}
                  </td>
                  <td>{p.ownerEmail ?? <span className="meta">unassigned</span>}</td>
                  {/* One text node, not three: React separates adjacent ones
                      in server-rendered HTML, which breaks the reading of
                      "1 open of 3" as much for a screen reader as for a test. */}
                  <td className="fig-sm">
                    {p.totalActions > p.openActions
                      ? `${p.openActions} open of ${p.totalActions}`
                      : `${p.openActions} open`}
                  </td>
                  <td>
                    {p.overdueActions > 0
                      ? <span className="tag alert">{p.overdueActions} overdue</span>
                      : p.dueSoonActions > 0
                        ? <span className="tag">{p.dueSoonActions} due soon</span>
                        : <span className="meta">—</span>}
                  </td>
                  <td className="fig-sm">{p.notes}</td>
                  <td>{fmtDate(p.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {closed.length > 0 && (
        <Section id="closed" title="Closed" index={2}
                 caption="Kept, with what happened. Nothing here is deleted, and any of them can be reopened.">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Outcome</th>
                <th scope="col">Closed by</th>
                <th scope="col">Closed</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/pursuits/${p.id}` as Route} prefetch={false}>{p.companyName}</Link>
                  </th>
                  <td>
                    <span className={`tag${p.outcomeRetired ? " retired" : ""}`}>
                      {p.outcome}{p.outcomeRetired && " — retired"}
                    </span>
                  </td>
                  <td>{p.closedByEmail ?? <span className="meta">unknown</span>}</td>
                  <td>{fmtDate(p.closedAt!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
