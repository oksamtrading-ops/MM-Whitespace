import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import Facts from "../../_ui/Facts.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { fmtDate, periodName } from "../../_ui/format.ts";
import PublishForm from "./PublishForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publish" };

/** Where each kind of blocker is actually resolved. */
function fixAt(kind: string, chart?: string): { href: Route; label: string } | null {
  if (kind === "coverage") {
    return { href: `/review/${chart === "auditor_crosstab" ? "auditor" : "stage_evidence_state"}?bucket=need_review` as Route,
             label: "Research the gap" };
  }
  if (kind === "unresolved_conflicts") {
    return { href: "/review/auditor?bucket=conflict" as Route, label: "Resolve the conflicts" };
  }
  return null;
}

export default async function Publish() {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Publishing is for Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const period = await ctx.db.get("select id, label, status, market_cap_as_of from periods order by market_cap_as_of desc limit 1") as { id: string; label: string; status: string; market_cap_as_of: string } | undefined;
  if (!period) {
    return <Refusal title="Nothing to publish"
                    body="No period has been committed yet. A workbook has to be read and committed first."
                    action={{ href: "/upload", label: "Upload a workbook" }} />;
  }

  const gate = await evaluateGate(ctx.db, period.id);
  const revisions = await ctx.db.all(`select p.revision, p.published_at, p.override_reason, p.amendment_reason,
            p.unresolved_count, u.email as by_email
       from period_publications p left join app_users u on u.id = p.published_by
      where p.period_id = ? order by p.revision desc`, period.id) as Array<{
    revision: number; published_at: string; override_reason: string | null;
    amendment_reason: string | null; unresolved_count: number; by_email: string | null;
  }>;

  const { name: periodTitle } = periodName(period.label);
  const isAdmin = ctx.user.role === "admin";

  return (
    <div className="withrail">
      <div className="reading">
        <h1 className="rise">Publish {periodTitle}</h1>
        <p className="sub rise">
          Publishing freezes a snapshot of every resolved value. Dashboards read only that,
          which is why a published revision is never edited — corrections are amendments
          that stand beside it.
        </p>

        {gate.publishable
          ? <div className="notice ok rise" role="status">
              <b>The gate is open</b>
              <span>Every floor is met and nothing is unresolved. This period may be published.</span>
            </div>
          : <div className="notice rise" role="status">
              <b>The gate is blocked</b>
              <span>
                {gate.blockers.length} thing{gate.blockers.length === 1 ? "" : "s"} below.{" "}
                {isAdmin
                  ? "You may publish through it with a reason, which is printed on the dashboard header."
                  : "An Admin may publish through it with a recorded reason."}
              </span>
            </div>}

        <Section id="gate" title="The gate" index={1}
                 caption={gate.blockers.length === 0
                   ? "Nothing is holding this period back."
                   : "Each of these is a fact about the data, not a setting."}>
          {gate.blockers.length === 0
            ? <p className="gateline ok"><span className="mark" aria-hidden="true">✓</span>
                <span className="what">Open</span></p>
            : (
              <ul className="gatelist">
                {gate.blockers.map((b, i) => {
                  const fix = fixAt(b.kind, "chart" in b ? b.chart : undefined);
                  return (
                    <li key={i} className="gateline no">
                      <span className="mark" aria-hidden="true">✗</span>
                      <span className="what">{b.detail}</span>
                      {fix && <Link href={fix.href} prefetch={false}>{fix.label} →</Link>}
                    </li>
                  );
                })}
              </ul>
            )}
        </Section>

        <Section id="coverage" title="Coverage against its floors" index={2}
                 caption="A chart below its floor is not drawn on the dashboard, so publishing does not make it appear.">
          <div className="gauges">
            {gate.coverage.map((c, i) => (
              <Gauge key={c.chart} label={c.label} resolved={c.resolved} population={c.population}
                     floorPct={c.floorPct} index={i} compact />
            ))}
          </div>
        </Section>

        <Section id="freeze" title="What gets frozen" index={3}
                 caption="A revision is a copy, not a pointer. This is what it will contain.">
          <Facts items={[
            { label: "Companies", value:gate.population, figure: true },
            { label: "Companies with unresolved values", value:gate.unresolvedCount, figure: true },
            { label: "Revision", value: revisions.length + 1, figure: true },
          ]} />
        </Section>

        {revisions.length > 0 && (
          <Section id="revisions" title="Revisions already published" index={4}
                   caption="None of these change. A correction is the next one down.">
            <table>
              <thead>
                <tr><th className="n">Rev</th><th>Published</th><th>By</th><th>Note</th></tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.revision}>
                    <td className="n">{r.revision}</td>
                    <td>{fmtDate(r.published_at)}</td>
                    <td>{r.by_email ?? <span className="meta">a script</span>}</td>
                    <td>
                      {r.override_reason
                        ? <><span className="pill warn">override</span> {r.override_reason}</>
                        : r.amendment_reason
                          ? <><span className="pill quiet">amendment</span> {r.amendment_reason}</>
                          : <span className="meta">first publication</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section id="publish" title={revisions.length > 0 ? "Publish an amendment" : "Publish"} index={5}>
          <PublishForm periodId={period.id} publishable={gate.publishable} isAdmin={isAdmin}
                       amending={revisions.length > 0} blockers={gate.blockers.length} />
        </Section>
      </div>

      <aside className="rail rise" aria-label="About this period">
        <p className="k">This period</p>
        <Facts items={[
          { label: "Period", value: periodTitle, figure: true },
          { label: "Market cap as of", value: fmtDate(period.market_cap_as_of) },
          { label: "Status", value: (
              <span className={`pill ${period.status === "published" ? "ok" : "warn"}`}>{period.status}</span>
            ) },
          { label: "Gate", value:gate.publishable
              ? <span className="pill ok">open</span>
              : <span className="pill no">blocked</span> },
          ...(revisions.length > 0
            ? [{ label: "Published", value: `Revision ${revisions[0].revision}`, figure: true }]
            : []),
        ]} />
      </aside>
    </div>
  );
}
