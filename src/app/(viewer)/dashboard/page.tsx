import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { readPublished } from "../../../lib/publish/snapshot.ts";
import {
  auditorBars, footprintBars, gateChart, JURISDICTION_TITLE, marketBars,
  populationTiles, PROVINCE_TITLE, proofLine, tierMigration,
  type Aggregates, type Bar, type Gated, type Proof,
} from "../../../lib/publish/views.ts";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  "1": "Tier 1", "2": "Tier 2", "3": "Tier 3", "4": "Tier 4", "5": "Tier 5", "6": "Tier 6",
  unclassified_no_stage_evidence: "Unclassified — no stage research",
  unclassified_no_property_evidence: "Unclassified — no property evidence",
  unclassified_conflicting: "Unclassified — conflicting",
};

export default async function Dashboard() {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return (
      <>
        <h1>{err instanceof Forbidden ? "Not permitted" : "Sign in"}</h1>
        <div className="empty">
          <p>{err instanceof Forbidden
            ? "Your account does not have access to this view."
            : <>This application is invite-only. <a href="/signin">Sign in</a>.</>}</p>
          {err instanceof Unauthenticated && <p className="sub">{err.message}</p>}
        </div>
      </>
    );
  }

  const period = ctx.db.prepare(
    "select id, label, market_cap_as_of, threshold_amount, threshold_currency, proximity_band_pct " +
    "from periods order by market_cap_as_of desc limit 1",
  ).get() as {
    id: string; label: string; market_cap_as_of: string;
    threshold_amount: number; threshold_currency: string; proximity_band_pct: number;
  } | undefined;
  if (!period) return <Empty title="No period yet" body="Ingest and commit a workbook first." />;

  const snap = readPublished(ctx.db, period.id);
  if (!snap) {
    return (
      <>
        <h1>{period.label}</h1>
        <Empty title="Not published"
               body="Dashboards read only a frozen snapshot, so there is nothing to show until this period is published." />
      </>
    );
  }

  const agg = snap.aggregates as Aggregates;
  const { tiles, hero } = populationTiles(agg);
  const coverage = Object.fromEntries(
    (agg.coverage ?? []).reduce((map, row) => {
      const entry = map.get(row.bucket) ?? { resolved: 0, population: 0 };
      if (row.sub === "resolved") entry.resolved = row.n;
      if (row.sub === "population") entry.population = row.n;
      map.set(row.bucket, entry);
      return map;
    }, new Map<string, { resolved: number; population: number }>()));

  const floors = ctx.db.prepare(
    "select chart, label, driving_field, floor_pct from coverage_floors").all() as
    Array<{ chart: string; label: string; driving_field: string; floor_pct: number | null }>;
  const floorFor = (chart: string) => floors.find((f) => f.chart === chart);

  const gateFor = (chart: string): Gated => {
    const f = floorFor(chart);
    const c = coverage[chart] ?? { resolved: 0, population: 0 };
    return gateChart(chart, f?.label ?? chart, f?.driving_field ?? "auditor",
                     c.resolved, c.population, f?.floor_pct ?? null);
  };

  const population = tiles.find((t) => t.label === "Companies")?.value ?? "0";
  const tierBars: Bar[] = (agg.tier_distribution ?? [])
    .slice()
    .sort((a, b) => bandOrder(a.bucket) - bandOrder(b.bucket))
    .map((t) => ({
      label: TIER_LABEL[t.bucket] ?? t.bucket,
      n: t.n,
      pct: Math.round((1000 * t.n) / Number(population)) / 10,
      muted: t.bucket.startsWith("unclassified"),
    }));
  const footprint: Bar[] = (agg.footprint ?? [])
    .slice().sort((a, b) => b.n - a.n)
    .map((f) => ({
      label: f.bucket === "none" ? "None — no properties" : f.bucket.replace(/_/g, " "),
      n: f.n, pct: Math.round((1000 * f.n) / Number(population)) / 10,
    }));

  const market = marketBars(agg);
  const auditor = auditorBars(agg);
  const province = footprintBars(agg, "province_footprint");
  const jurisdiction = footprintBars(agg, "jurisdiction_footprint", 12);
  const migration = tierMigration(agg, Boolean(agg.migration));

  return (
    <>
      <h1>{period.label}</h1>
      <p className="sub">
        Published revision {snap.publication.revision} · as of {period.market_cap_as_of} ·
        threshold {period.threshold_currency} {Number(period.threshold_amount).toLocaleString()} ·
        signed in as {ctx.user.email} ({ctx.user.role})
      </p>

      {snap.publication.override_reason && (
        <div className="banner" role="status">
          <b>Published through a blocked gate</b>
          {snap.publication.override_reason}
        </div>
      )}

      <p className="hero"><b>{hero}</b></p>
      <div className="cards">
        {tiles.map((t) => (
          <div className="card" key={t.label}>
            <div className="n">{t.value}</div><div className="k">{t.label}</div>
          </div>
        ))}
        <div className="card">
          <div className="n">{snap.publication.unresolved_count}</div>
          <div className="k">Unresolved</div>
        </div>
      </div>

      {/* The only view with real data at launch, so it leads. */}
      <View title="Enrichment coverage"
            sub="The only view with real data at launch, so it leads.">
        <div className="bars">
          {floors.map((f) => {
            const c = coverage[f.chart] ?? { resolved: 0, population: 0 };
            const pct = c.population === 0 ? 0
              : Math.round((1000 * c.resolved) / c.population) / 10;
            return (
              <div className="barrow" key={f.chart}>
                <span className="lab">{f.label}</span>
                <span className="track">
                  <span className={`fill${f.floor_pct !== null && pct < f.floor_pct ? " muted" : ""}`}
                        style={{ width: `${Math.max(1, pct)}%` }} />
                </span>
                <span className="n">{pct}%</span>
              </div>
            );
          })}
        </div>
      </View>

      <GatedView title="Tier distribution" gate={gateFor("tier_distribution")}
                 sub="Ordered by tier, not by size: tier order is meaningful.">
        <Bars bars={tierBars} proof={proofLine(tierBars, Number(population))} />
        <p className="notewrap">
          <b>Unclassified is a displayed state.</b> Tier 4 today would otherwise fuse two
          disjoint populations — genuine royalty companies, and companies with no stage
          evidence at all.
        </p>
      </GatedView>

      <View title="Footprint" sub="Canada, abroad, both — or none.">
        <Bars bars={footprint} proof={proofLine(footprint, Number(population))} />
        <p className="notewrap">
          <b>None</b> is a real footprint, not a gap: royalty and streaming companies hold
          no properties. The source workbook files them as Canada only.
        </p>
      </View>

      <View title="Corporate office by Deloitte market"
            sub="Markets have no natural order, so one hue sorted descending.">
        <Bars bars={market.bars} proof={market.proof} />
      </View>

      <GatedView title="Auditor share" gate={gateFor("auditor_crosstab")}
                 sub="An emphasis encoding: the story is how much of this market is not ours.">
        <Bars bars={auditor.bars} proof={auditor.proof} />
      </GatedView>

      <View title={PROVINCE_TITLE}
            sub="Not “producing mines by province”: property location and stage are both
                 recorded at company level with no link between them, so that view cannot be
                 derived at any confidence.">
        <Bars bars={province.bars} />
      </View>

      <View title={JURISDICTION_TITLE} sub="Top 12, with the remainder grouped.">
        <Bars bars={jurisdiction.bars} />
      </View>

      <View title="Tier migration" sub="Prior tier against current.">
        {migration.kind === "first_period"
          ? <p className="notewrap">{migration.message}</p>
          : (
            <>
              <p className="notewrap">
                {migration.moved} companies changed tier.{" "}
                {migration.researchCompleted > 0 && (
                  <>
                    <b>{migration.researchCompleted} completed research</b> rather than
                    migrating — a company moving from Unclassified to tiered is research
                    completing, and counting it as movement would show phantom upgrades.
                  </>
                )}
              </p>
              <table className="matrix">
                <caption className="sub">Direction carries an icon and a label, never colour alone.</caption>
                <thead><tr><th>from → to</th><th>Companies</th><th>Direction</th></tr></thead>
                <tbody>
                  {migration.cells.map((c) => (
                    <tr key={`${c.from}-${c.to}`}>
                      <td>{TIER_LABEL[c.from] ?? c.from} → {TIER_LABEL[c.to] ?? c.to}</td>
                      <td>{c.n}</td>
                      <td className={c.direction === "same" ? "diag" : c.direction}>
                        {c.direction === "up" ? "▲ improved"
                          : c.direction === "down" ? "▼ declined"
                          : c.direction === "research" ? "● research completed"
                          : "— unchanged"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
      </View>

      <View title="Entrants and drop-outs"
            sub={`Companies within ${period.proximity_band_pct}% of the threshold are marked: a normal market move crosses the line without anything happening.`}>
        <p className="notewrap">
          Nothing to compare against until a second period is published. When there is,
          this separates new listings from threshold crossings, and does not surface a
          rename as a movement at all.
        </p>
      </View>
    </>
  );
}

function bandOrder(bucket: string): number {
  const n = Number(bucket);
  return Number.isFinite(n) ? n : 100;
}

function View({ title, sub, children }: {
  title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className="viewcard">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}

/** Below its floor the chart is replaced by a meter in the same footprint. */
function GatedView({ title, sub, gate, children }: {
  title: string; sub?: string; gate: Gated; children: React.ReactNode;
}) {
  if (gate.kind === "chart") return <View title={title} sub={sub}>{children}</View>;
  return (
    <section className="viewcard">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      <div className="meter">
        <div className="track">
          <div className="fill" style={{ width: `${Math.max(1, gate.coveragePct)}%` }}
               role="img" aria-label={`${gate.coveragePct} percent coverage`} />
        </div>
        <p className="msg">{gate.message}</p>
        <p className="floor">
          With one meaningful class, a meter beats a chart — a full chart that is wrong
          gets believed. {/* typedRoutes cannot validate a href built from a field key at
              compile time; the value comes from coverage_floors, not user input. */}
          <Link href={gate.reviewLink as Route}>Review the gap →</Link>
        </p>
      </div>
    </section>
  );
}

function Bars({ bars, proof }: { bars: Bar[]; proof?: Proof }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <>
      <div className="bars">
        {bars.map((b) => (
          <div className={`barrow${b.terminal ? " terminal" : ""}`} key={b.label}>
            <span className="lab">{b.label}</span>
            <span className="track">
              <span className={`fill${b.muted ? " muted" : ""}${b.accent ? " accent" : ""}`}
                    style={{ width: `${Math.max(1, (b.n / max) * 100)}%` }}
                    role="img" aria-label={`${b.n} companies`} />
            </span>
            {/* A green fill on white obliges a relief channel: the value is
                always a visible direct label, never left to colour. */}
            <span className="n">{b.n}</span>
          </div>
        ))}
      </div>
      {bars.some((b) => b.note) && (
        <p className="notewrap">{bars.find((b) => b.note)!.note}</p>
      )}
      {proof && (
        <p className={`proof${proof.ties ? "" : " fail"}`}>{proof.text}</p>
      )}
    </>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (<><h1>{title}</h1><div className="empty"><p>{body}</p></div></>);
}
