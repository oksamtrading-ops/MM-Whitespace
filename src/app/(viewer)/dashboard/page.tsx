import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import { EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE } from "../../../lib/publish/notices.ts";
import { readPublished } from "../../../lib/publish/snapshot.ts";
import {
  auditorBars, footprintBars, gateChart, JURISDICTION_TITLE, marketBars,
  populationTiles, PROVINCE_TITLE, proofLine, tierMigration, UNKNOWN_AUDITOR,
  type Aggregates, type Bar, type Gated,
} from "../../../lib/publish/views.ts";
import Bars from "../../_ui/Bars.tsx";
import Contents from "../../_ui/Contents.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Ledger from "../../_ui/Ledger.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Facts from "../../_ui/Facts.tsx";
import { fmtCompact, fmtDate, periodName } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

const TIER_LABEL: Record<string, string> = {
  "1": "Tier 1", "2": "Tier 2", "3": "Tier 3", "4": "Tier 4", "5": "Tier 5", "6": "Tier 6",
  unclassified_no_stage_evidence: "Unclassified — no stage research",
  unclassified_no_property_evidence: "Unclassified — no property evidence",
  unclassified_conflicting: "Unclassified — conflicting",
};

const FOOTPRINT_LABEL: Record<string, string> = {
  canada_only: "Canada only", abroad: "Abroad only", canada_and_abroad: "Canada and abroad",
  none: "None — no properties",
};

const SECTIONS = [
  { id: "coverage", label: "Coverage" },
  { id: "tiers", label: "Tier distribution" },
  { id: "footprint", label: "Footprint" },
  { id: "market", label: "Office by market" },
  { id: "auditor", label: "Auditor share" },
  { id: "province", label: "Provinces and territories" },
  { id: "jurisdiction", label: "Foreign jurisdictions" },
  { id: "migration", label: "Tier migration" },
  { id: "entrants", label: "Entrants and drop-outs" },
];

export default async function Dashboard() {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body="Whitespace is invite-only. Sign in to see the published dashboard."
                 action={{ href: "/signin", label: "Sign in" }} />;
  }
  const canReview = ctx.user.role !== "viewer";

  const period = await ctx.db.get("select id, label, market_cap_as_of, threshold_amount, threshold_currency, proximity_band_pct " +
    "from periods order by market_cap_as_of desc limit 1") as {
    id: string; label: string; market_cap_as_of: string;
    threshold_amount: number; threshold_currency: string; proximity_band_pct: number;
  } | undefined;
  if (!period) {
    return <Refusal title="No period yet" body="Nothing has been committed. The dashboard appears once a workbook is ingested and a period is published." />;
  }

  const snap = await readPublished(ctx.db, period.id);
  if (!snap) {
    return (
      <Refusal title="Not published"
               body={`${period.label} has not been published. The dashboard reads only a frozen snapshot, so there is nothing to show until it is.`}
               action={canReview ? { href: "/review", label: "Open the review board" } : undefined} />
    );
  }
  const publisher =snap.publication.published_by
    ? (await ctx.db.get("select email from app_users where id = ?",snap.publication.published_by) as { email: string } | undefined)?.email ?? null
    : null;

  const agg =snap.aggregates as Aggregates;
  const { tiles } = populationTiles(agg);
  const population = Number(tiles.find((t) => t.label === "Companies")?.value ?? "0");
  const deloitte = (agg.auditor_share ?? []).find((a) => a.bucket === "Deloitte")?.n ?? 0;
  const unknownAuditor = (agg.auditor_share ?? []).find((a) => a.bucket === UNKNOWN_AUDITOR)?.n ?? 0;

  const coverage = new Map<string, { resolved: number; population: number }>();
  for (const row of agg.coverage ?? []) {
    const entry = coverage.get(row.bucket) ?? { resolved: 0, population: 0 };
    if (row.sub === "resolved") entry.resolved = row.n;
    if (row.sub === "population") entry.population = row.n;
    coverage.set(row.bucket, entry);
  }
  const floors = await ctx.db.all("select chart, label, driving_field, floor_pct from coverage_floors") as
    Array<{ chart: string; label: string; driving_field: string; floor_pct: number | null }>;
  const gateFor = (chart: string): Gated => {
    const f = floors.find((x) => x.chart === chart);
    const c = coverage.get(chart) ?? { resolved: 0, population: 0 };
    return gateChart(chart, f?.label ?? chart, f?.driving_field ?? "auditor",
                     c.resolved, c.population, f?.floor_pct ?? null);
  };

  const tierBars: Bar[] = (agg.tier_distribution ?? [])
    .slice().sort((a, b) => bandOrder(a.bucket) - bandOrder(b.bucket))
    .map((t) => ({
      label: TIER_LABEL[t.bucket] ?? t.bucket, n: t.n,
      pct: Math.round((1000 * t.n) / population) / 10,
      muted: t.bucket.startsWith("unclassified"),
    }));
  const footprint: Bar[] = (agg.footprint ?? []).slice().sort((a, b) => b.n - a.n)
    .map((f) => ({
      label: FOOTPRINT_LABEL[f.bucket] ?? f.bucket.replace(/_/g, " "),
      n: f.n, pct: Math.round((1000 * f.n) / population) / 10,
    }));
  const market = marketBars(agg);
  const auditor = auditorBars(agg);
  const province = footprintBars(agg, "province_footprint");
  const jurisdiction = footprintBars(agg, "jurisdiction_footprint", 12);
  const migration = tierMigration(agg, Boolean(agg.migration));

  const publishedOn = fmtDate(snap.publication.published_at);
  const { name: periodTitle } = periodName(period.label);
  const threshold = `${period.threshold_currency} ${fmtCompact(Number(period.threshold_amount))}`;

  return (
    <div className="withrail">
      <h1 className="sr-only">{periodTitle} dashboard</h1>
      <aside className="rail rise" aria-label="About this period">
        <p className="k">This period</p>
        <Facts items={[
          { label: "Period", value: periodTitle, figure: true },
          { label: "Market cap as of", value: fmtDate(period.market_cap_as_of) },
          { label: "Threshold", value: <>{threshold}<span className="sub">and above, ±{period.proximity_band_pct}% band</span></>, figure: true },
          { label: "Published", value: (
              <>
                Revision {snap.publication.revision}
                {snap.publication.override_reason && <> <span className="pill warn">through a blocked gate</span></>}
                <span className="sub">{publishedOn}{publisher && ` · ${publisher}`}</span>
              </>
            ) },
        ]} />
        {snap.publication.override_reason && (
          <div className="notice" role="status">
            <b>Published through a blocked gate</b>
            <span>{snap.publication.override_reason}</span>
          </div>
        )}
        <Contents items={SECTIONS} />
      </aside>
      <div className="reading">

        <p className="hero rise" style={{ "--i": 1 } as React.CSSProperties}>
          Deloitte audits <span className="fig-xl">{deloitte}</span> of{" "}
          <span className="fig-xl">{population}</span>
          <span className="stop" aria-hidden="true" />
        </p>
        {unknownAuditor > 0 && (
          <p className="hero-sub rise" style={{ "--i": 2 } as React.CSSProperties}>
            The auditor of <span className="fig">{unknownAuditor}</span> is not yet known.
          </p>
        )}

        <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
          <Ledger items={[
            ...tiles.map((t) => ({ value: t.value, label: t.label })),
            { value:snap.publication.unresolved_count, label: "Unresolved values", quiet: true },
          ]} />
        </div>

        <Section id="coverage" title="Enrichment coverage" queryKey="coverage" index={4}
                 caption="How much of each field has been researched. A chart below its floor is replaced by its gauge.">
          <div className="gauges">
            {floors.map((f, i) => {
              const c = coverage.get(f.chart) ?? { resolved: 0, population: 0 };
              return <Gauge key={f.chart} label={f.label} resolved={c.resolved}
                            population={c.population} floorPct={f.floor_pct} index={i} />;
            })}
          </div>
        </Section>

        <Gated id="tiers" title="Tier distribution" queryKey="tier_distribution" index={5}
               gate={gateFor("tier_distribution")} canReview={canReview}
               caption="In tier order. Unclassified is shown as a gap, not a seventh tier.">
          <Bars bars={tierBars} proof={proofLine(tierBars, population)} mutedStyle="gap" />
          <p className="note">
            <b>Unclassified is a displayed state.</b> Folding it into Tier 4 would fuse
            royalty companies with companies that simply have no stage evidence yet.
          </p>
        </Gated>

        <Section id="footprint" title="Footprint" queryKey="footprint" index={6}
                 caption="Where each company holds properties: Canada, abroad, both, or none.">
          <Bars bars={footprint} proof={proofLine(footprint, population)} />
          <p className="note">
            <b>None is a real footprint.</b> Royalty and streaming companies hold no properties;
            the source workbook files them as Canada only.
          </p>
        </Section>

        <Section id="market" title="Corporate office by Deloitte market" queryKey="market" index={7}
                 caption="Sorted by count. Foreign head offices sit last because they belong to no Deloitte market.">
          <Bars bars={market.bars} proof={market.proof} />
        </Section>

        <Gated id="auditor" title="Auditor share" queryKey="auditor_share" index={8}
               gate={gateFor("auditor_crosstab")} canReview={canReview}
               caption="Who audits the population. Deloitte is the accented bar; the rest of the market is grey.">
          <Bars bars={auditor.bars} proof={auditor.proof} />
        </Gated>

        <Section id="province" title={PROVINCE_TITLE} queryKey="province_footprint" index={9}
                 caption="A company is counted in every province or territory where it holds a property. This is not producing mines by province: property location and stage are recorded separately, with no link between them.">
          <Bars bars={province.bars} />
        </Section>

        <Section id="jurisdiction" title={JURISDICTION_TITLE} queryKey="jurisdiction_footprint" index={10}
                 caption="The twelve most common, with the remainder grouped.">
          <Bars bars={jurisdiction.bars} />
        </Section>

        <Section id="migration" title="Tier migration" queryKey="migration" index={11}
                 caption="Prior tier against current. Direction carries an icon and a word, never colour alone.">
          {migration.kind === "first_period"
            ? <p className="empty">{migration.message}</p>
            : (
              <>
                <p className="note">
                  <b>{migration.moved} companies changed tier.</b>{" "}
                  {migration.researchCompleted > 0 && (
                    <>{migration.researchCompleted} moved from Unclassified to a tier — that is
                      research completing, and it is not counted as movement.</>
                  )}
                </p>
                <table className="matrix">
                  <thead><tr><th>From → to</th><th className="n">Companies</th><th>Direction</th></tr></thead>
                  <tbody>
                    {migration.cells.map((c) => (
                      <tr key={`${c.from}-${c.to}`}>
                        <td>{TIER_LABEL[c.from] ?? c.from} → {TIER_LABEL[c.to] ?? c.to}</td>
                        <td className="n">{c.n}</td>
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
        </Section>

        <Section id="entrants" title="Entrants and drop-outs" queryKey="movement" index={12}
                 caption={`Companies within ${period.proximity_band_pct}% of the threshold are marked: an ordinary market move crosses the line without anything having happened.`}>
          <p className="empty">
            Nothing to compare against until a second period is published. Then this view
            separates new listings from threshold crossings, and a rename never appears as a movement.
          </p>
        </Section>

        <footer className="notices">
          <p>{INTERNAL_USE}</p>
          <p>{EXCHANGE_NOTICE}</p>
          <p>{VENDOR_NOTICE}</p>
        </footer>
      </div>
    </div>
  );
}

function bandOrder(bucket: string): number {
  const n = Number(bucket);
  return Number.isFinite(n) ? n : 100;
}

/** Below its floor the chart is replaced by a gauge in the same footprint. */
function Gated({ id, title, queryKey, caption, index, gate, canReview, children }: {
  id: string; title: string; queryKey: string; caption?: string; index: number;
  gate: Gated; canReview: boolean; children: React.ReactNode;
}) {
  if (gate.kind === "chart") {
    return <Section id={id} title={title} queryKey={queryKey} caption={caption} index={index}>{children}</Section>;
  }
  return (
    <Section id={id} title={title} queryKey={queryKey} index={index}>
      <div className="meter">
        <Gauge label="Researched" resolved={gate.resolved} population={gate.population}
               floorPct={gate.floorPct} />
        <p className="msg">
          <span className="fig">{gate.resolved}</span> of <span className="fig">{gate.population}</span> researched.
          This view unlocks at {gate.floorPct}%.
          {canReview && (
            <>{" "}
              {/* typedRoutes cannot validate a href built from a field key; the
                  value comes from coverage_floors, not user input. */}
              <Link href={gate.reviewLink as Route}>Review the gap →</Link>
            </>
          )}
        </p>
        <p className="why">A chart drawn at this coverage would be well formed and wrong.</p>
      </div>
    </Section>
  );
}
