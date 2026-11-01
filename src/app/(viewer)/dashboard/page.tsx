import { newestPeriod, newestPublishedPeriod } from "../../../lib/db/periods.ts";
import type { Metadata, Route } from "next";
import { cookies } from "next/headers";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import { AI_NOTICE, EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE } from "../../../lib/publish/notices.ts";
import { readPublished } from "../../../lib/publish/snapshot.ts";
import { readAtlas } from "../../../lib/publish/atlas.ts";
import { marketPenetration } from "../../../lib/publish/crosstabs.ts";
import { populationTiles, type Aggregates } from "../../../lib/publish/views.ts";
import Refusal from "../../_ui/Refusal.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import AiNotice from "../../_ui/AiNotice.tsx";
import WorkingToggle from "../../_ui/WorkingToggle.tsx";
import { showsWorking, WORKING_COOKIE } from "../../_ui/theme.ts";
import { periodName } from "../../_ui/format.ts";
import Atlas from "./Atlas.tsx";
import { viewFromParams } from "./words.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard (doc 19): one published revision, read once, drawn as a
 * globe and a memo that both follow the same filters.
 *
 * The server reads the frozen snapshot and renders the first view from the
 * URL, so the sentence, its proof and the globe's first frame are in the
 * HTML; the browser then re-draws everything from the same companies as the
 * filters change, without a round trip. What the browser receives is what a
 * Viewer may read: no company's Deloitte market, which only ever leaves the
 * server as totals.
 */
export default async function Dashboard({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body="The Market Assessment Tool is invite-only. Sign in to see the published dashboard."
                 action={{ href: "/signin", label: "Sign in" }} />;
  }
  const canReview = ctx.user.role !== "viewer";

  // The dashboard reads only frozen snapshots, so it shows the newest PUBLISHED
  // period to everyone; a draft of next quarter leaves it as it was. With no
  // published period at all, the newest one names what is still in draft.
  const period = await newestPublishedPeriod(ctx.db) ?? await newestPeriod(ctx.db);
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

  const db = ctx.db;
  const [atlas, markets, floors, publisher, params, jar] = await Promise.all([
    readAtlas(db, period.id, snap.publication.id),
    marketPenetration(db, snap.publication.id, "Foreign HQ — no Deloitte market"),
    db.all("select chart, label, floor_pct from coverage_floors") as Promise<Array<{ chart: string; label: string; floor_pct: number | null }>>,
    snap.publication.published_by
      ? db.get("select email from app_users where id = ?", snap.publication.published_by) as Promise<{ email: string } | undefined>
      : Promise.resolve(undefined),
    searchParams,
    cookies(),
  ]);

  const agg = snap.aggregates as Aggregates;
  const coverageOf = new Map<string, { resolved: number; population: number }>();
  for (const row of agg.coverage ?? []) {
    const entry = coverageOf.get(row.bucket) ?? { resolved: 0, population: 0 };
    if (row.sub === "resolved") entry.resolved = row.n;
    if (row.sub === "population") entry.population = row.n;
    coverageOf.set(row.bucket, entry);
  }
  const coverage = floors.map((f) => ({
    chart: f.chart, label: f.label, floorPct: f.floor_pct, ...(coverageOf.get(f.chart) ?? { resolved: 0, population: 0 }),
  }));
  // The totals frozen at publication, for the page to check its own arithmetic against.
  const frozen = {
    population: Number(populationTiles(agg).tiles.find((t) => t.label === "Companies")?.value ?? 0),
    deloitte: (agg.auditor_share ?? []).find((a) => a.bucket === "Deloitte")?.n ?? 0,
  };
  const { name: periodTitle } = periodName(period.label);

  return (
    <Page title="Dashboard" count={atlas.companies.length}
          meta={`${periodTitle} · revision ${snap.publication.revision}${snap.publication.override_reason ? " · through a blocked gate" : ""}`}
          actions={<>
            {/* Each memo point names the fields it is counted from (doc 09). */}
            <WorkingToggle initial={showsWorking(jar.get(WORKING_COOKIE)?.value, canReview)} />
            {/* The period workbook carries the WORKING period, so /api/export
                refuses a Viewer -- and a button that only ever answers 403 is
                a broken promise. A Viewer exports from Companies instead,
                where the table carries only what they may read. */}
            {canReview
              ? <a className="btn sm secondary" href={`/api/export?period=${period.id}` as Route} download>
                  <Icon name="file-spreadsheet" size={13} /><span className="lbl">Export</span>
                </a>
              : <a className="btn sm secondary" href={"/companies" as Route}>
                  <Icon name="file-spreadsheet" size={13} /><span className="lbl">Export from Companies</span>
                </a>}
          </>}>
      <h1 className="sr-only">{periodTitle} dashboard</h1>
      <Atlas atlas={atlas} periodTitle={periodTitle} initial={viewFromParams(params, atlas)}
             markets={markets.rows.length ? markets : null} coverage={coverage} frozen={frozen}
             publisher={publisher?.email ?? null} />
      <AiNotice compact />
      <footer className="notices">
        <p>{INTERNAL_USE}</p>
        <p>{EXCHANGE_NOTICE}</p>
        <p>{VENDOR_NOTICE}</p>
        <p>{AI_NOTICE}</p>
      </footer>
    </Page>
  );
}
