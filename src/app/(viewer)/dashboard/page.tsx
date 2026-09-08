import { authContext } from "../../../lib/auth/context.ts";
import { assertRole, Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { readPublished } from "../../../lib/publish/snapshot.ts";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  "1": "Tier 1", "2": "Tier 2", "3": "Tier 3", "4": "Tier 4", "5": "Tier 5", "6": "Tier 6",
  unclassified_no_stage_evidence: "Unclassified - no stage research",
  unclassified_no_property_evidence: "Unclassified - no property evidence",
  unclassified_conflicting: "Unclassified - conflicting",
};

export default async function Dashboard() {
  const ctx = await authContext();
  let user;
  try {
    // Every role may read the dashboard, but a session is still required.
    user = await assertRole(ctx, ["viewer", "analyst", "admin"]);
  } catch (err) {
    return <SignedOut err={err} />;
  }

  const period = ctx.db.prepare(
    "select id, label, status, market_cap_as_of from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string; status: string; market_cap_as_of: string } | undefined;

  if (!period) return <NoData />;

  // A dashboard reads ONLY the frozen snapshot -- never the live tables.
  const snap = readPublished(ctx.db, period.id);
  if (!snap) {
    return (
      <>
        <h1>{period.label}</h1>
        <p className="sub">Signed in as {user.email}</p>
        <div className="empty">
          <b>This period has not been published.</b>
          <p>Dashboards read only a frozen snapshot, so there is nothing to show until
             a period is published. Run <code>npm run publish -- ./period.db --publish</code>.</p>
        </div>
      </>
    );
  }

  const tiers = snap.aggregates.tier_distribution ?? [];
  const footprint = snap.aggregates.footprint ?? [];
  const exchange = snap.aggregates.exchange ?? [];
  const total = tiers.reduce((a, b) => a + b.n, 0);
  const max = Math.max(1, ...tiers.map((t) => t.n));

  return (
    <>
      <h1>{period.label}</h1>
      <p className="sub">
        Published revision {snap.publication.revision} · as of {period.market_cap_as_of} ·
        signed in as {user.email} ({user.role})
      </p>

      {snap.publication.override_reason && (
        <div className="banner" role="status">
          <b>Published through a blocked gate</b>
          {snap.publication.override_reason}
        </div>
      )}

      <div className="cards">
        <div className="card"><div className="n">{total}</div><div className="k">Companies</div></div>
        {exchange.map((e) => (
          <div className="card" key={e.bucket}>
            <div className="n">{e.n}</div><div className="k">{e.bucket}</div>
          </div>
        ))}
        <div className="card">
          <div className="n">{snap.publication.unresolved_count}</div>
          <div className="k">Unresolved</div>
        </div>
      </div>

      <h2>Tier distribution</h2>
      <table>
        <caption className="sub" style={{ captionSide: "bottom", textAlign: "left" }}>
          Unclassified is shown as its own state. The source workbook reports all
          {" "}{total} companies at Tier 4, which is a defect, not a finding.
        </caption>
        <thead><tr><th>Band</th><th style={{ width: 220 }}>Share</th><th>Companies</th></tr></thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.bucket}>
              <td>{TIER_LABEL[t.bucket] ?? t.bucket}</td>
              <td>
                <div className={`bar${t.bucket.startsWith("unclassified") ? " muted" : ""}`}
                     style={{ width: `${Math.round((t.n / max) * 100)}%` }}
                     role="img"
                     aria-label={`${t.n} of ${total} companies`} />
              </td>
              <td className="n">{t.n}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Footprint</h2>
      <table>
        <thead><tr><th>Footprint</th><th>Companies</th></tr></thead>
        <tbody>
          {footprint.map((f) => (
            <tr key={f.bucket}>
              <td>
                {f.bucket === "none" ? "None - no properties" : f.bucket.replace(/_/g, " ")}
              </td>
              <td className="n">{f.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: ".5rem", maxWidth: 640 }}>
        <b>None</b> is a real footprint, not a gap: royalty and streaming companies hold no
        properties. The source workbook files them as Canada only.
      </p>
    </>
  );
}

function SignedOut({ err }: { err: unknown }) {
  const forbidden = err instanceof Forbidden;
  return (
    <>
      <h1>{forbidden ? "Not permitted" : "Sign in"}</h1>
      <div className="empty">
        {forbidden
          ? <p>Your account does not have access to this view.</p>
          : <p>This application is invite-only. In development, sign in with:
              <br /><br />
              <code>{`curl -X POST localhost:3000/api/dev/signin -H 'content-type: application/json' -d '{"email":"you@example.invalid"}' -c cookies.txt`}</code>
            </p>}
        {err instanceof Unauthenticated && <p className="sub">{err.message}</p>}
      </div>
    </>
  );
}

function NoData() {
  return (
    <>
      <h1>No period yet</h1>
      <div className="empty">
        <p>Ingest and commit a workbook first:</p>
        <p><code>python3 -m mmparser.cli &lt;workbook&gt; --json /tmp/p.json</code><br />
           <code>node scripts/commit_period.mjs /tmp/p.json ./period.db --fresh</code></p>
      </div>
    </>
  );
}
