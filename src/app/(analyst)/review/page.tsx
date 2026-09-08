import { authContext } from "../../../lib/auth/context.ts";
import { assertRole, Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";

export const dynamic = "force-dynamic";

export default async function Review() {
  const ctx = await authContext();
  let user;
  try {
    // A Viewer must not reach the review workspace. This assertion is the
    // boundary; the rail simply not rendering a link is not.
    user = await assertRole(ctx, ["analyst", "admin"]);
  } catch (err) {
    return (
      <>
        <h1>{err instanceof Forbidden ? "Not permitted" : "Sign in"}</h1>
        <div className="empty">
          {err instanceof Forbidden
            ? <p>Review is for Analysts and Admins. Your account is a Viewer.</p>
            : <p>This application is invite-only.</p>}
          {err instanceof Unauthenticated && <p className="sub">{err.message}</p>}
        </div>
      </>
    );
  }

  const period = ctx.db.prepare(
    "select id, label, status from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string; status: string } | undefined;

  if (!period) {
    return (
      <>
        <h1>Review</h1>
        <div className="empty"><p>No period has been committed yet.</p></div>
      </>
    );
  }

  const gate = evaluateGate(ctx.db, period.id);
  const queue = ctx.db.prepare(
    `select count(*) n from company_period_field_values
      where period_id = ? and evidence_state = 'unknown'`).get(period.id) as { n: number };

  return (
    <>
      <h1>Review — {period.label}</h1>
      <p className="sub">
        {period.status} · signed in as {user.email} ({user.role})
      </p>

      <div className="cards">
        <div className="card">
          <div className="n">{gate.population}</div><div className="k">Companies</div>
        </div>
        <div className="card">
          <div className="n">{queue.n}</div><div className="k">Unresolved values</div>
        </div>
        <div className="card">
          <div className="n">{gate.blockers.length}</div><div className="k">Publish blockers</div>
        </div>
      </div>

      <h2>Publish gate</h2>
      <table>
        <thead>
          <tr><th>Chart</th><th>Resolved</th><th>Floor</th><th>State</th></tr>
        </thead>
        <tbody>
          {gate.coverage.map((c) => (
            <tr key={c.chart}>
              <td>{c.label}</td>
              <td className="n">{c.resolved}/{c.population} ({c.actualPct}%)</td>
              <td className="n">{c.floorPct === null ? "—" : `${c.floorPct}%`}</td>
              <td>
                {c.floorPct === null
                  ? <span className="pill">no floor</span>
                  : c.meetsFloor
                    ? <span className="pill ok">ok</span>
                    : <span className="pill no">below floor</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {gate.blockers.length > 0 && (
        <div className="banner" role="status" style={{ marginTop: "1.5rem" }}>
          <b>Publish is blocked</b>
          {gate.blockers.map((b) => b.detail).join("; ")}.
          {" "}An Admin may override with a reason, which is then printed on the dashboard header.
        </div>
      )}

      <h2>The review grid</h2>
      <div className="empty">
        <p><b>Not built yet.</b> This is the keyboard-driven grid where an Analyst
        accepts or overrides each proposed value beside its evidence.</p>
        <p className="sub">
          It is the screen where a WCAG 2.1 AA claim will actually fail, so it has specific
          obligations: evidence must not be colour-only, the company cell is the row header,
          each cell announces value, evidence band and review state, and a polite live region
          announces each decision and its consequence.
        </p>
      </div>
    </>
  );
}
