import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import { queueBuckets, reviewableFields } from "../../../lib/review/queue.ts";
import Gauge from "../../_ui/Gauge.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Facts from "../../_ui/Facts.tsx";
import Contents from "../../_ui/Contents.tsx";
import { fmtDate, periodName } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

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

  const period = ctx.db.prepare(
    "select id, label, status from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string; status: string } | undefined;

  if (!period) {
    return <Refusal title="Review" body="No period has been committed yet. Ingest a workbook and commit it first." />;
  }

  const gate = evaluateGate(ctx.db, period.id);
  const fields = reviewableFields(ctx.db, period.id);
  const buckets = queueBuckets(ctx.db, period.id);
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
    <div className="withrail">
    <aside className="rail rise" aria-label="About this period">
      <p className="k">This period</p>
      <Facts items={[
        { label: "Period", value: periodTitle, figure: true },
        ...(asOf ? [{ label: "Market cap as of", value: fmtDate(asOf) }] : []),
        { label: "Status", value: <span className={`pill ${period.status === "published" ? "ok" : "warn"}`}>{period.status}</span> },
        { label: "Companies", value: gate.population, figure: true },
        ...(totalValues > 0 ? [{ label: "Proposals", value: totalValues, figure: true }] : []),
        { label: "Publish gate", value: gate.blockers.length === 0
            ? <span className="pill ok">open</span>
            : <><span className="pill no">blocked</span><span className="sub"><a href="#gate">{gate.blockers.length} reason{gate.blockers.length === 1 ? "" : "s"}</a></span></> },
      ]} />
      <Contents items={BOARD_SECTIONS} />
    </aside>
    <div className="reading">
      <h1 className="rise">Review</h1>

      <Section id="coverage" title="Enrichment coverage" index={1}
               caption="How much of each field has been researched, against the floor its chart needs.">
        <div className="gauges">
          {gate.coverage.map((c, i) => (
            <Gauge key={c.chart} label={c.label} resolved={c.resolved} population={c.population}
                   floorPct={c.floorPct} index={i} compact />
          ))}
        </div>
      </Section>

      <Section id="queue" title="Your queue" index={2}
               caption={totalValues > 0 ? "Pick a batch. Each count opens the grid filtered to it." : undefined}>
        {totalValues === 0 ? (
          <p className="empty">
            <b>Nothing to review.</b> No enrichment has run against this period. Enrichment is
            replay-only in this build; seed a synthetic queue with{" "}
            <code>node scripts/seed_review_fixture.mjs ./period.db</code>.
          </p>
        ) : (
          <ul className="queue">
            {buckets.map((b) => {
              const href = firstField ? `/review/${firstField}?bucket=${b.key}` : null;
              const inner = (
                <>
                  <span className="fig-lg">{b.count}</span>
                  <span className="lab">{b.label}</span>
                  {b.startHere && <span className="start"><span className="dot" aria-hidden="true" />start here</span>}
                </>
              );
              return (
                <li key={b.key} className={b.startHere ? "here" : ""}>
                  {href ? <Link href={href as Route} prefetch={false}>{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {fields.length > 0 && (
        <Section id="fields" title="Fields" index={3}
                 caption="Reviewed one field down the column, not one company across the row.">
          <table>
            <thead>
              <tr><th>Field</th><th className="n">Proposals</th><th className="n">Decided</th><th>Bulk accept</th></tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.fieldKey}>
                  <td><Link href={`/review/${f.fieldKey}` as Route} prefetch={false}>{f.label}</Link></td>
                  <td className="n">{f.proposals}</td>
                  <td className="n">{f.decided}</td>
                  <td>{f.bulkAcceptable
                    ? <span className="pill ok">allowed above threshold</span>
                    : <span className="pill no">never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section id="gate" title="Publish gate" index={4}>
        {gate.blockers.length === 0
          ? <p className="gateline ok"><span className="mark" aria-hidden="true">✓</span> Open. This period may be published.</p>
          : (
            <>
              <ul className="gatelist">
                {gate.blockers.map((b, i) => (
                  <li key={i} className="gateline no"><span className="mark" aria-hidden="true">✗</span> {b.detail}</li>
                ))}
              </ul>
              <p className="note">
                An Admin may publish through a blocked gate with a reason, which is then
                printed on the dashboard header.
              </p>
            </>
          )}
      </Section>
    </div>

    </div>
  );
}
