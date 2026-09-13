import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import Facts from "../../_ui/Facts.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import Panel, { StatRow } from "../../_ui/Panel.tsx";
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
    <Page title={`Publish ${periodTitle}`}
          meta={revisions.length > 0 ? `Latest: revision ${revisions[0].revision}` : "Never published"}
          actions={<>
            <a className="btn sm secondary" href={`/api/export?period=${period.id}` as Route} download>
              <Icon name="file-spreadsheet" size={13} />Workbook
            </a>
            <a className="btn sm quiet" href="#publish"><Icon name="badge-check" size={13} />Publish</a>
          </>}>
    <div className="withrail">
      <div className="reading">
        <p className="sub rise">
          Publishing freezes a snapshot of every resolved value. Dashboards read only that,
          which is why a published revision is never edited — corrections are amendments
          that stand beside it.
        </p>

        <div className="rise">
          {gate.publishable
            ? <Callout tone="ok" title="The gate is open">
                Every floor is met and nothing is unresolved. This period may be published.
              </Callout>
            : <Callout tone="danger"
                       title={`The gate is blocked by ${gate.blockers.length} thing${gate.blockers.length === 1 ? "" : "s"}`}>
                {isAdmin
                  ? "You may publish through it with a reason, which is printed on the dashboard header for as long as the revision stands."
                  : "An Admin may publish through it with a recorded reason."}
              </Callout>}
        </div>

        <Section id="gate" title="The gate" index={1} icon="badge-check"
                 caption={gate.blockers.length === 0
                   ? "Nothing is holding this period back."
                   : "Each of these is a fact about the data, not a setting."}>
          <Panel icon={gate.blockers.length === 0 ? "circle-check" : "octagon-alert"}
                 title={gate.blockers.length === 0 ? "Open" : `Blocked by ${gate.blockers.length}`} bare>
            {gate.blockers.length === 0
              ? <p className="gateline ok">
                  <span className="mark"><Icon name="circle-check" size={16} /></span>
                  <span className="what">Nothing is holding this period back.</span>
                </p>
              : (
                <ul className="gatelist">
                  {gate.blockers.map((b, i) => {
                    const fix = fixAt(b.kind, "chart" in b ? b.chart : undefined);
                    return (
                      <li key={i} className="gateline no">
                        <span className="mark"><Icon name="octagon-alert" size={16} /></span>
                        <span className="what">{b.detail}</span>
                        {fix && (
                          <Link className="btn sm quiet" href={fix.href} prefetch={false}>
                            {fix.label}<Icon name="arrow-right" size={13} />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          </Panel>
        </Section>

        <Section id="coverage" title="Coverage against its floors" index={2} icon="gauge"
                 caption="A chart below its floor is not drawn on the dashboard, so publishing does not make it appear.">
          <div className="gauges">
            {gate.coverage.map((c, i) => (
              <Gauge key={c.chart} label={c.label} resolved={c.resolved} population={c.population}
                     floorPct={c.floorPct} index={i} compact />
            ))}
          </div>
        </Section>

        <Section id="freeze" title="What gets frozen" index={3} icon="lock"
                 caption="A revision is a copy, not a pointer. This is what it will contain.">
          <Panel icon="lock" title="The next revision" bare>
            <StatRow items={[
              { value: gate.population, label: "Companies", icon: "building-2" },
              { value: gate.unresolvedCount, label: "With unresolved values", icon: "circle-dashed", quiet: true },
              { value: revisions.length + 1, label: "Revision", icon: "badge-check" },
            ]} />
          </Panel>
        </Section>

        {revisions.length > 0 && (
          <Section id="revisions" title="Revisions already published" index={4}
                   caption="None of these change. A correction is the next one down.">
            <table>
              <thead>
                <tr><th scope="col" className="n">Rev</th><th scope="col">Published</th>
                    <th scope="col">By</th><th scope="col">Note</th></tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.revision}>
                    <td className="n">{r.revision}</td>
                    <td>{fmtDate(r.published_at)}</td>
                    <td>{r.by_email ?? <span className="meta">a script</span>}</td>
                    <td className="wrap">
                      {r.override_reason
                        ? <><span className="pill warn"><Icon name="triangle-alert" size={12} />override</span> {r.override_reason}</>
                        : r.amendment_reason
                          ? <><span className="pill quiet"><Icon name="history" size={12} />amendment</span> {r.amendment_reason}</>
                          : <span className="meta">first publication</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section id="publish" title={revisions.length > 0 ? "Publish an amendment" : "Publish"} index={5} icon="badge-check" lead>
          <PublishForm periodId={period.id} publishable={gate.publishable} isAdmin={isAdmin}
                       amending={revisions.length > 0} blockers={gate.blockers.length} />
        </Section>

        <Section id="export" title="Take it away as a workbook" index={6} icon="file-spreadsheet"
                 caption={"A clean template the application controls. The uploaded workbook is an " +
                          "input artifact and is never written back into; this is the deliverable."}>
          <p className="actions">
            <a className="btn secondary" href={`/api/export?period=${period.id}` as Route} download>
              <Icon name="file-spreadsheet" size={15} />Download .xlsx
            </a>
            <a className="btn secondary" href={`/api/export?period=${period.id}&format=csv` as Route} download>
              <Icon name="download" size={15} />Flat .csv
            </a>
          </p>
          <p className="note">
            It carries the period as it stands now, including anything accepted in review since
            revision {revisions.length}{revisions.length === 0 ? " — nothing is published yet" : ""}.
            Every download is recorded in the audit log. The fee columns are written for whichever
            fees have been accepted, and left blank for the rest.
          </p>
        </Section>
      </div>

      <aside className="rail rise" aria-label="About this period">
        <p className="k">This period</p>
        <Facts items={[
          { label: "Period", value: periodTitle, figure: true },
          { label: "Market cap as of", value: fmtDate(period.market_cap_as_of) },
          { label: "Status", value: (
              <span className={`pill ${period.status === "published" ? "ok" : "warn"}`}>
                <Icon name={period.status === "published" ? "circle-check" : "circle-dashed"} size={12} />{period.status}
              </span>
            ) },
          { label: "Gate", value:gate.publishable
              ? <span className="pill ok"><Icon name="circle-check" size={12} />open</span>
              : <span className="pill no"><Icon name="octagon-alert" size={12} />blocked</span> },
          ...(revisions.length > 0
            ? [{ label: "Published", value: `Revision ${revisions[0].revision}`, figure: true }]
            : []),
        ]} />
      </aside>
    </div>
    </Page>
  );
}
