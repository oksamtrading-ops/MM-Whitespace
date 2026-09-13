import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { listPursuits, strandedStatuses, vocabulary } from "../../../lib/pursuit/index.ts";
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

  const pursuits = await listPursuits(ctx.db);
  const v = await vocabulary(ctx.db);
  const stranded = await strandedStatuses(ctx.db);
  const open = pursuits.reduce((n, p) => n + p.openActions, 0);

  return (
    <>
      <h1>Pursuits</h1>
      <p className="lede">
        What the practice has decided to do about a company, and who is doing it.
        Everything here is somebody&rsquo;s judgement rather than a researched value,
        so nothing on this page is proposed, scored or published.
      </p>

      <Facts items={[
        { label: "Pursuits", value: pursuits.length, figure: true },
        { label: "Open actions", value: open, figure: true },
        { label: "Unprioritised", value: pursuits.filter((p) => !p.priority).length, figure: true },
      ]} />

      {stranded.length > 0 && (
        <Section id="stranded" title="Actions left behind by a renamed status"
                 caption="Renaming a status does not rewrite anybody's record, so actions in the old term are still in it — and count as open, because nothing now says they close.">
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
                  <td className="fig-sm">{p.notes}</td>
                  <td>{fmtDate(p.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
