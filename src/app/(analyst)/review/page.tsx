import Link from "next/link";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import { queueBuckets, reviewableFields } from "../../../lib/review/queue.ts";

export const dynamic = "force-dynamic";

export default async function ReviewBoard() {
  let ctx;
  try {
    // A Viewer must not reach the review workspace. This is the boundary; the
    // rail not rendering a link is not.
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return (
      <>
        <h1>{err instanceof Forbidden ? "Not permitted" : "Sign in"}</h1>
        <div className="empty">
          <p>{err instanceof Forbidden
            ? "Review is for Analysts and Admins. Your account is a Viewer."
            : (err as Unauthenticated).message}</p>
        </div>
      </>
    );
  }

  const period = ctx.db.prepare(
    "select id, label, status from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string; status: string } | undefined;

  if (!period) {
    return (<><h1>Review</h1>
      <div className="empty"><p>No period has been committed yet.</p></div></>);
  }

  const gate = evaluateGate(ctx.db, period.id);
  const fields = reviewableFields(ctx.db, period.id);
  const buckets = queueBuckets(ctx.db, period.id);
  const totalValues = buckets.reduce((a, b) => a + b.count, 0);

  return (
    <>
      <h1>Review — {period.label}</h1>
      <p className="sub">
        {period.status} · {gate.population} companies · signed in as {ctx.user.email}
      </p>

      <h2>Enrichment coverage</h2>
      <p className="sub">Coverage is the only view with real data on day one, which is why it leads.</p>
      <table>
        <thead><tr><th>Field</th><th style={{ width: 200 }}>Coverage</th><th>Resolved</th></tr></thead>
        <tbody>
          {gate.coverage.map((c) => (
            <tr key={c.chart}>
              <td>{c.label}</td>
              <td><div className={`bar${c.meetsFloor ? "" : " muted"}`}
                       style={{ width: `${Math.max(2, c.actualPct)}%` }}
                       role="img" aria-label={`${c.actualPct} percent`} /></td>
              <td className="n">{c.resolved}/{c.population} ({c.actualPct}%)</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Your queue <span className="sub">{totalValues} values</span></h2>
      {totalValues === 0 ? (
        <div className="empty">
          <p><b>Nothing to review.</b> No enrichment has run against this period.</p>
          <p className="sub">
            Enrichment is replay-only in this build: live mode needs credentials and
            spike S3. Seed a synthetic queue with{" "}
            <code>node scripts/seed_review_fixture.mjs ./period.db</code>.
          </p>
        </div>
      ) : (
        <table>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <td className="n">{b.count}</td>
                <td>
                  {/* Every number is a link that opens the grid pre-filtered.
                      The Analyst chooses a batch; they never face 2,590
                      undifferentiated cells. */}
                  {fields.length > 0
                    ? <Link href={`/review/${fields[0].fieldKey}?bucket=${b.key}`}>{b.label}</Link>
                    : b.label}
                  {b.startHere && <span className="tag warn"> start here</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {fields.length > 0 && (
        <>
          <h2>Fields</h2>
          <p className="sub">
            Reviewed one field down a column, not one company across a row: judging one
            field reuses a single mental model, which is the difference between a
            two-hour review and a two-day one.
          </p>
          <table>
            <thead><tr><th>Field</th><th>Proposals</th><th>Decided</th><th></th></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.fieldKey}>
                  <td><Link href={`/review/${f.fieldKey}`}>{f.label}</Link></td>
                  <td className="n">{f.proposals}</td>
                  <td className="n">{f.decided}</td>
                  <td>{f.bulkAcceptable
                    ? <span className="pill ok">bulk-acceptable</span>
                    : <span className="pill no">never bulk</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Publish gate</h2>
      {gate.blockers.length === 0
        ? <p><span className="pill ok">open</span> This period may be published.</p>
        : (
          <div className="banner" role="status">
            <b>Publish is blocked</b>
            {gate.blockers.map((b) => b.detail).join("; ")}.
            {" "}An Admin may override with a reason, which is then printed on the
            dashboard header.
          </div>
        )}
    </>
  );
}
