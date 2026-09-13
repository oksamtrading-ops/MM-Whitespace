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
import Composition, { type Part } from "../../_ui/Composition.tsx";
import Donut, { type Slice } from "../../_ui/Donut.tsx";
import DotPlot from "../../_ui/DotPlot.tsx";
import Treemap from "../../_ui/Treemap.tsx";
import Heatmap from "../../_ui/Heatmap.tsx";
import TierLadder, { type Rung } from "../../_ui/TierLadder.tsx";
import { companyMarks, marketPenetration, UNKNOWN as UNKNOWN_FIRM, whitespaceMatrix } from "../../../lib/publish/crosstabs.ts";
import FootprintMap from "../../_ui/FootprintMap.tsx";
import { foldProvinces, provinceName } from "../../../lib/publish/jurisdictions.ts";
import Contents from "../../_ui/Contents.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Ledger from "../../_ui/Ledger.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import Panel, { StatRow } from "../../_ui/Panel.tsx";
import WorkingToggle from "../../_ui/WorkingToggle.tsx";
import Facts from "../../_ui/Facts.tsx";
import { fmtDate, periodName } from "../../_ui/format.ts";
import { formatMoney } from "../../../lib/format/fields.ts";

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
  { id: "market-map", label: "The market" },
  { id: "map", label: "Footprint map" },
  { id: "coverage", label: "Coverage" },
  { id: "tiers", label: "Tier ladder" },
  { id: "footprint", label: "Footprint" },
  { id: "market", label: "Office by market" },
  { id: "auditor", label: "Auditor share" },
  { id: "matrix", label: "Whitespace matrix" },
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
  // Two cross-tabs read straight from the frozen snapshot rather than from
  // the precomputed aggregates, so an already-published revision grows these
  // views without being republished. One pass over 259 rows each.
  const matrix = await whitespaceMatrix(ctx.db, snap.publication.id,
                                        Number(period.threshold_amount), period.threshold_currency);
  const markets = await marketPenetration(ctx.db, snap.publication.id, "Foreign HQ — no Deloitte market");
  const tm = await companyMarks(ctx.db, snap.publication.id);
  const tierGate = gateFor("tier_distribution");
  const auditorGate = gateFor("auditor_crosstab");
  const money = (n: number) => formatMoney(n, period.threshold_currency, { compact: true });
  const pctText = (part: number, whole: number) =>
    `${whole === 0 ? 0 : Math.round((1000 * part) / whole) / 10}%`;
  const oursCap = tm.marks.filter((m) => m.firm === "Deloitte").reduce((a, b) => a + b.cap, 0);
  const gapCap = tm.marks.filter((m) => m.firm === UNKNOWN_FIRM).reduce((a, b) => a + b.cap, 0);
  const gapN = (agg.auditor_share ?? []).find((a) => a.bucket === UNKNOWN_AUDITOR)?.n ?? 0;
  const valueSlices: Slice[] = [
    { label: "Deloitte", n: oursCap, kind: "ours" },
    { label: "Another firm", n: tm.total - oursCap - gapCap, kind: "other" },
    { label: UNKNOWN_FIRM, n: gapCap, kind: "gap" },
  ];
  const countSlices: Slice[] = [
    { label: "Deloitte", n: deloitte, kind: "ours" },
    { label: "Another firm", n: population - deloitte - gapN, kind: "other" },
    { label: UNKNOWN_FIRM, n: gapN, kind: "gap" },
  ];
  const footprintCount = (bucket: string) =>
    (agg.footprint ?? []).find((f) => f.bucket === bucket)?.n ?? 0;
  const market = marketBars(agg);
  const auditor = auditorBars(agg);
  // Provinces, folded onto the controlled vocabulary so two spellings of one
  // territory are one number, on the map and in its twin alike.
  const provinceRows = [...foldProvinces(agg.province_footprint ?? [])]
    .map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
  const provinceMax = provinceRows[0]?.n ?? 1;
  const province = { bars: provinceRows.map((r): Bar => ({
    label: provinceName(r.code), n: r.n, pct: Math.round((1000 * r.n) / provinceMax) / 10,
  })) };
  const jurisdiction = footprintBars(agg, "jurisdiction_footprint", 12);
  const migration = tierMigration(agg, Boolean(agg.migration));

  const publishedOn = fmtDate(snap.publication.published_at);
  const { name: periodTitle } = periodName(period.label);
  const threshold = formatMoney(Number(period.threshold_amount), period.threshold_currency, { compact: true });

  return (
    <Page title="Dashboard" count={population}
          meta={`${periodTitle} · revision ${snap.publication.revision}${snap.publication.override_reason ? " · through a blocked gate" : ""}`}
          actions={<>
            <WorkingToggle initial={canReview} />
            <a className="btn sm secondary" href={`/api/export?period=${period.id}` as Route} download>
              <Icon name="file-spreadsheet" size={13} />Export
            </a>
          </>}>
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
          <Callout tone="warn" title="Published through a blocked gate">
            {snap.publication.override_reason}
          </Callout>
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

        {/* The hero: the map, lit by where the practice's whitespace is, and
            under it the footprint proof. Province counts count a company once
            per province and do not sum to the population, which is why the
            footing is the footprint's and the caption says so. */}
        {/* The one chart where the answer arrives before anything is read: a
            wall of grey with a few green tiles in it. The map keeps the space
            directly beneath, unchanged. */}
        {tm.marks.length > 0 && (
          <div id="market-map" className="rise" style={{ "--i": 3 } as React.CSSProperties}>
            <Treemap marks={tm.marks} total={tm.total} unsized={tm.unsized}
                     currency={period.threshold_currency} />
            <p className="note">
              Every company in the population, sized by market capitalisation. The four largest
              are <b>{tm.marks.slice(0, 4).map((m) => m.ticker || m.name).join(", ")}</b>, and{" "}
              {tm.marks[0]?.firm === "Deloitte" ? "the largest is ours" : `the largest is audited by ${tm.marks[0]?.firm}`}.
              Area is read badly, so every figure is also in the table on{" "}
              <Link href="/companies" prefetch={false}>Companies</Link>.
            </p>
          </div>
        )}

        <div id="map" className="rise" style={{ "--i": 4 } as React.CSSProperties}>
          <FootprintMap rows={provinceRows} hero twinHref="#province" />
          <Composition parts={footprintParts(footprint)} proof={proofLine(footprint, population)} />
          <p className="note">
            The bar under the map is the footprint proof: every company holds properties in
            Canada only, abroad only, both, or none, and the four add to the population. A
            province&rsquo;s count is companies with a property there, counted once per province,
            so the provinces themselves do not add up.
          </p>
        </div>

        <div className="rise" style={{ "--i": 5 } as React.CSSProperties}>
          <Panel icon="database" title="The population" bare
                 right={<>as of {fmtDate(period.market_cap_as_of)}</>}>
            <StatRow items={[
              ...tiles.map((t, i) => ({
                value: t.value, label: t.label,
                icon: (["building-2", "trending-up", "trending-up", "landmark"] as const)[i] ?? "building-2",
              })),
              { value: snap.publication.unresolved_count, label: "Unresolved values", icon: "circle-dashed", quiet: true },
            ]} />
          </Panel>
        </div>

        <Section id="coverage" title="Enrichment coverage" queryKey="coverage" index={4} icon="gauge" lead
                 caption="How much of each field has been researched. A chart below its floor is replaced by its gauge.">
          <div className="gauges">
            {floors.map((f, i) => {
              const c = coverage.get(f.chart) ?? { resolved: 0, population: 0 };
              return <Gauge key={f.chart} label={f.label} resolved={c.resolved}
                            population={c.population} floorPct={f.floor_pct} index={i} />;
            })}
          </div>
        </Section>

        {/* Below its floor the distribution is not drawn -- doc 09 is right and
            nothing here changes it. But a progress bar where a chart should be
            teaches nobody anything while they wait, so the ladder shows what the
            six tiers mean and the real footprint population each will be drawn
            from, with the refusal stated underneath rather than implied. */}
        <Section id="tiers" title={tierGate.kind === "chart" ? "Tier distribution" : "Tier ladder"}
                 queryKey="tier_distribution" index={5} icon="layers" lead
                 caption={tierGate.kind === "chart"
                   ? "In tier order. Unclassified is shown as a gap, not a seventh tier."
                   : "The classification rules are unchanged from the workbook. What they need is an input the source does not carry: blank stage means not researched, not no."}>
          {tierGate.kind === "chart"
            ? (
              <>
                <Bars bars={tierBars} mutedStyle="gap" />
                <Composition parts={marketParts(tierBars)} proof={proofLine(tierBars, population)} variant="mono" />
                <p className="note">
                  <b>Unclassified is a displayed state.</b> Folding it into Tier 4 would fuse
                  royalty companies with companies that simply have no stage evidence yet.
                </p>
              </>
            )
            : (
              <TierLadder rungs={tierRungs(agg, footprintCount)}
                          gate={{ resolved: tierGate.resolved, population: tierGate.population,
                                  floorPct: tierGate.floorPct, reviewLink: tierGate.reviewLink,
                                  canReview }} />
            )}
        </Section>

        <Section id="footprint" title="Footprint" queryKey="footprint" index={6} icon="map"
                 caption="Where each company holds properties: Canada, abroad, both, or none. Four parts of one population, so they are drawn as one bar that adds up rather than four that have to be added.">
          <Composition parts={footprintParts(footprint)} proof={proofLine(footprint, population)} />
          <p className="note">
            <b>None is a real footprint.</b> Royalty and streaming companies hold no properties;
            the source workbook files them as Canada only.
          </p>
        </Section>

        <Section id="market" title="Corporate office by Deloitte market" queryKey="market" index={7} icon="landmark"
                 caption="One dot for the market, one for Deloitte's book, and the rule between them is the whitespace. Foreign head offices sit last because they belong to no Deloitte market.">
          <DotPlot rows={markets.rows} />
          <Composition parts={marketParts(market.bars)} proof={market.proof} variant="mono" />
          <p className="note">
            <b>Two markets carry no Deloitte audit client at all.</b> They are the cleanest
            whitespace on this page: a market with companies in it and no relationship yet.
          </p>
        </Section>

        {/* Two donuts, because the count and the value tell different stories
            and the difference between them is the most flattering true thing
            on this page. Three slices, not two: the research gap is drawn as a
            gap, hatched and named, which is what makes the pair honest while
            the cross-tab below is still short of its floor. */}
        <Section id="auditor" title="Auditor share" queryKey="auditor_share" index={8} icon="landmark" lead
                 caption="Who audits the population, by company and by market capitalisation. Deloitte's share of the money is more than twice its share of the companies.">
          <div className="donuts">
            <Donut title="Audit share by market capitalisation"
                   slices={valueSlices} headline={pctText(oursCap, tm.total)}
                   caption={`${money(oursCap)} of ${money(tm.total)}`} />
            <Donut title="Audit share by company"
                   slices={countSlices} headline={pctText(deloitte, population)}
                   caption={`${deloitte} of ${population} companies`} />
          </div>
          <Bars bars={auditor.bars} />
          <Composition parts={auditorParts(auditor.bars)} proof={auditor.proof} variant="emphasis" />
          {auditorGate.kind === "meter" && (
            <div className="meter" style={{ minHeight: 0, marginTop: 24 }}>
              <Gauge label="Auditor researched" resolved={auditorGate.resolved}
                     population={auditorGate.population} floorPct={auditorGate.floorPct} compact />
              <p className="why">
                The cross-tab of auditor against tier stays shut until {auditorGate.floorPct}%. These
                shares are drawn because the unresearched part is drawn with them: it is the hatched
                slice, and it will move.
                {canReview && (
                  <>{" "}<Link href={auditorGate.reviewLink as Route}>Research the gap →</Link></>
                )}
              </p>
            </div>
          )}
        </Section>

        <Section id="matrix" title="Whitespace matrix" queryKey="whitespace_matrix" index={9} icon="layers" lead
                 caption="Market-cap band against incumbent auditor. Read down a column for one firm's book; read across a row to see who holds a size of company. It needs no research: both inputs come from the extract, so it is populated on day one.">
          {matrix.capMissing || matrix.bands.length === 0
            ? <p className="empty">
                <b>No market capitalisation is recorded for this period.</b> The bands are
                derived from it, so the matrix appears once the extract carries the column.
              </p>
            : (
              <>
                <Heatmap matrix={matrix} currency={period.threshold_currency} />
                <p className="note">
                  <b>The bottom band is almost entirely unresearched</b>, so the bottom-left of
                  this matrix will move once enrichment runs. The top rows will not: those
                  auditors came from the extract.
                </p>
              </>
            )}
        </Section>

        <Section id="province" title={PROVINCE_TITLE} queryKey="province_footprint" index={10} icon="map-pin"
                 caption="A company is counted in every province or territory where it holds a property. This is not producing mines by province: property location and stage are recorded separately, with no link between them.">
          <Bars bars={province.bars} />
        </Section>

        <Section id="jurisdiction" title={JURISDICTION_TITLE} queryKey="jurisdiction_footprint" index={11} icon="map-pin"
                 caption="The twelve most common, with the remainder grouped.">
          <Bars bars={jurisdiction.bars} />
        </Section>

        <Section id="migration" title="Tier migration" queryKey="migration" index={12} icon="trending-up"
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
                  <thead><tr><th scope="col">From → to</th><th scope="col" className="n">Companies</th>
                                 <th scope="col">Direction</th></tr></thead>
                  <tbody>
                    {migration.cells.map((c) => (
                      <tr key={`${c.from}-${c.to}`}>
                        <td>{TIER_LABEL[c.from] ?? c.from} → {TIER_LABEL[c.to] ?? c.to}</td>
                        <td className="n">{c.n}</td>
                        <td className={c.direction === "same" ? "diag" : c.direction}>
                          {c.direction === "up"
                            ? <><Icon name="trending-up" size={13} /> improved</>
                            : c.direction === "down"
                              ? <><Icon name="trending-down" size={13} /> declined</>
                              : c.direction === "research"
                                ? <><Icon name="circle-check" size={13} /> research completed</>
                                : <><Icon name="minus" size={13} /> unchanged</>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
        </Section>

        <Section id="entrants" title="Entrants and drop-outs" queryKey="movement" index={13} icon="history"
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
    </Page>
  );
}

/* The four footprint categories have no order, so they take the categorical
   slots in a fixed sequence -- and "none" is the absence bucket, drawn in the
   de-emphasis grey like every other terminal bucket in this product. */
const FOOTPRINT_SLOT: Record<string, Part["slot"]> = {
  "Canada only": 1, "Canada and abroad": 2, "Abroad only": 3, "None — no properties": "quiet",
};
function footprintParts(bars: Bar[]): Part[] {
  return bars.map((b) => ({ label: b.label, n: b.n, slot: FOOTPRINT_SLOT[b.label] ?? 1 }));
}

/* Auditor share: Deloitte is the one named part, every other firm is the
   market, and the research gap is its own quiet segment. Emphasis, not
   identity -- the page is about how much of this market is not ours. */
function auditorParts(bars: Bar[]): Part[] {
  return bars.map((b): Part => ({
    label: b.label, n: b.n, slot: b.accent ? 1 : "quiet",
  }));
}

/* A proof bar for a chart that has more parts than there are categorical
   slots. One hue and gaps: the names are in the chart above it, and cycling
   three hues over six markets would give two markets the same colour. */
function marketParts(bars: Bar[]): Part[] {
  return bars.map((b) => ({ label: b.label, n: b.n, slot: b.terminal || b.muted ? "quiet" : 1 }));
}

/* The ladder's six rungs. The basis figures are real and computable today:
   they are the footprint populations each tier will be drawn from once stage
   research lands. Tier 4 needs no research and carries its count already. */
function tierRungs(agg: Aggregates, footprintCount: (b: string) => number): Rung[] {
  const tier = (n: string) => (agg.tier_distribution ?? []).find((t) => t.bucket === n)?.n ?? null;
  return [
    { tier: 1, rule: "Production in Canada and abroad", detail: "Largest audit and tax footprint; multi-jurisdiction",
      basis: `${footprintCount("canada_and_abroad")} hold ground on both sides`, n: tier("1"), icon: "mountain" },
    { tier: 2, rule: "Production in Canada only", detail: "Domestic compliance, provincial mining tax",
      basis: `${footprintCount("canada_only")} hold Canadian ground only`, n: tier("2"), icon: "map-pin" },
    { tier: 3, rule: "Production abroad only", detail: "No Canadian producing property",
      basis: `${footprintCount("abroad")} hold foreign ground only`, n: tier("3"), icon: "map" },
    { tier: 4, rule: "Royalty, streaming and processing", detail: "Classified from the workbook — needs no research",
      basis: "Resolved at ingest", n: tier("4"), icon: "coins" },
    { tier: 5, rule: "Development stage", detail: "Permitted or financed, not yet producing",
      basis: "Requires stage research", n: tier("5"), icon: "hard-hat" },
    { tier: 6, rule: "Exploration stage", detail: "Smallest fee pool; a watchlist rather than a pursuit",
      basis: "Requires stage research", n: tier("6"), icon: "pickaxe" },
  ];
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
              <Link className="btn sm secondary" href={gate.reviewLink as Route}>
                <Icon name="clipboard-check" size={13} />Review the gap
              </Link>
            </>
          )}
        </p>
        <p className="why">A chart drawn at this coverage would be well formed and wrong.</p>
      </div>
    </Section>
  );
}
