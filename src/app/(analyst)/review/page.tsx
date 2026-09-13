import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import { queueBuckets, reviewableFields } from "../../../lib/review/queue.ts";
import Gauge from "../../_ui/Gauge.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Icon, { type IconName } from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import Panel from "../../_ui/Panel.tsx";
import Facts from "../../_ui/Facts.tsx";
import Contents from "../../_ui/Contents.tsx";
import { fmtDate, periodName } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

/** Each queue bucket's reserved glyph (docs/design/18 section 8). */
const BUCKET_ICON: Record<string, IconName> = {
  conflict: "git-compare",
  need_review: "eye",
  quarantined: "shield-off",
  no_evidence: "search-x",
  bulk: "list-checks",
  above_threshold: "list-checks",
  newer: "history",
};

export default async function ReviewBoard() {
  let ctx;
  try {
    // A Viewer must not reach the review workspace. This is the boundary; the
    // nav not rendering a link is not.
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Review is for Analysts and Admins. Your account is a Viewer, which opens the published dashboard."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const period = await ctx.db.get("select id, label, status from periods order by market_cap_as_of desc limit 1") as { id: string; label: string; status: string } | undefined;

  if (!period) {
    return <Refusal title="Review" body="No period has been committed yet. Ingest a workbook and commit it first." />;
  }

  const gate = await evaluateGate(ctx.db, period.id);
  const fields = await reviewableFields(ctx.db, period.id);
  const buckets = await queueBuckets(ctx.db, period.id);
  const totalValues = buckets.reduce((a, b) => a + b.count, 0);
  const firstField = fields[0]?.fieldKey;
  const { name: periodTitle, asOf } = periodName(period.label);

  const BOARD_SECTIONS = [
    { id: "coverage", label: "Enrichment coverage" },
    { id: "queue", label: "Your queue" },
    ...(fields.length > 0 ? [{ id: "fields", label: "Fields" }] : []),
    { id: "gate", label: "Publish gate" },
  ];

  return (
    <Page title="Review" count={totalValues || undefined}
          meta={`${periodTitle} · ${period.status}`}
          actions={gate.blockers.length === 0
            ? <Link className="btn sm primary" href="/publish" prefetch={false}>
                <Icon name="badge-check" size={13} />Publish
              </Link>
            : <Link className="btn sm secondary" href="/publish" prefetch={false}>
                <Icon name="octagon-alert" size={13} />{gate.blockers.length} blocking publish
              </Link>}>
    <div className="withrail">
    <aside className="rail rise" aria-label="About this period">
      <p className="k">This period</p>
      <Facts items={[
        { label: "Period", value: periodTitle, figure: true },
        ...(asOf ? [{ label: "Market cap as of", value: fmtDate(asOf) }] : []),
        { label: "Status", value: <span className={`pill ${period.status === "published" ? "ok" : "warn"}`}>{period.status}</span> },
        { label: "Companies", value:gate.population, figure: true },
        ...(totalValues > 0 ? [{ label: "Proposals", value: totalValues, figure: true }] : []),
        { label: "Publish gate", value:gate.blockers.length === 0
            ? <span className="pill ok">open</span>
            : <><span className="pill no">blocked</span><span className="sub"><a href="#gate">{gate.blockers.length} reason{gate.blockers.length === 1 ? "" : "s"}</a></span></> },
      ]} />
      <Contents items={BOARD_SECTIONS} />
    </aside>
    <div className="reading">
      <Section id="coverage" title="Enrichment coverage" index={1} icon="gauge" lead
               caption="How much of each field has been researched, against the floor its chart needs.">
        <div className="gauges">
          {gate.coverage.map((c, i) => (
            <Gauge key={c.chart} label={c.label} resolved={c.resolved} population={c.population}
                   floorPct={c.floorPct} index={i} compact />
          ))}
        </div>
      </Section>

      <Section id="queue" title="Your queue" index={2} icon="list-checks" lead
               caption={totalValues > 0 ? "Pick a batch. Each count opens the grid filtered to it, worst work first." : undefined}>
        {totalValues === 0 ? (
          <p className="empty">
            <b>Nothing to review.</b> No enrichment has run against this period. Enrichment is
            replay-only in this build; seed a synthetic queue with{" "}
            <code>node scripts/seed_review_fixture.mjs ./period.db</code>.
          </p>
        ) : (
          <Panel icon="list-checks" title="Proposals waiting"
                 right={<><span className="fig-sm">{totalValues}</span> in all</>} bare>
          <ul className="queue">
            {buckets.map((b) => {
              // The field that actually holds these rows, not merely the first
              // field in the catalogue.
              const field = b.firstField ?? firstField;
              const href = field && b.count > 0 ? `/review/${field}?bucket=${b.key}` : null;
              const inner = (
                <>
                  <span className="fig-lg">{b.count}</span>
                  <span className="lab"><Icon name={BUCKET_ICON[b.key] ?? "circle-dashed"} size={13} />{b.label}</span>
                  {b.startHere && <span className="start"><Icon name="arrow-right" size={12} />start here</span>}
                </>
              );
              return (
                <li key={b.key} className={b.startHere ? "here" : ""}>
                  {href ? <Link href={href as Route} prefetch={false}>{inner}</Link> : <span className="cell">{inner}</span>}
                </li>
              );
            })}
          </ul>
          </Panel>
        )}
      </Section>

      {fields.length > 0 && (
        <Section id="fields" title="Fields" index={3}
                 caption={<>Reviewed one field down the column, not one company across the row.{" "}
                   <Link href="/review/by-company" prefetch={false}>Look by company instead →</Link></>}>
          <table>
            <thead>
              <tr><th scope="col">Field</th><th scope="col" className="n">Proposals</th>
                  <th scope="col" className="n">Decided</th><th scope="col">Bulk accept</th></tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.fieldKey}>
                  <th scope="row"><Link href={`/review/${f.fieldKey}` as Route} prefetch={false}>{f.label}</Link></th>
                  <td className="n">{f.proposals}</td>
                  <td className="n">{f.decided}</td>
                  <td>{f.bulkAcceptable
                    ? <span className="pill ok"><Icon name="list-checks" size={12} />allowed above threshold</span>
                    : <span className="pill no"><Icon name="lock" size={12} />never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section id="gate" title="Publish gate" index={4} icon="badge-check">
        {gate.blockers.length === 0
          ? (
            <Panel icon="circle-check" title="The gate is open" bare>
              <p className="gateline ok">
                <span className="mark"><Icon name="circle-check" size={16} /></span>
                <span className="what">Every floor is met. This period may be published.</span>
                <Link className="btn sm primary" href="/publish" prefetch={false}>
                  <Icon name="badge-check" size={13} />Publish
                </Link>
              </p>
            </Panel>
          )
          : (
            <>
              <Panel icon="octagon-alert" title={`Blocked by ${gate.blockers.length}`} bare>
                <ul className="gatelist">
                  {gate.blockers.map((b, i) => (
                    <li key={i} className="gateline no">
                      <span className="mark"><Icon name="octagon-alert" size={16} /></span>
                      <span className="what">{b.detail}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <p className="note">
                An Admin may publish through a blocked gate with a reason, which is then
                printed on the dashboard header.
              </p>
              <Link className="btn sm secondary" href="/publish" prefetch={false} style={{ marginTop: 14 }}>
                <Icon name="badge-check" size={13} />Go to publish
              </Link>
            </>
          )}
      </Section>
    </div>

    </div>
    </Page>
  );
}
