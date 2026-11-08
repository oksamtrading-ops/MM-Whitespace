import { newestPeriod, newestPublishedPeriod } from "../../../lib/db/periods.ts";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { personSql } from "../../../lib/auth/person.ts";
import { Forbidden } from "../../../lib/auth/session.ts";
import { AI_NOTICE, EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE } from "../../../lib/publish/notices.ts";
import { readPublished } from "../../../lib/publish/snapshot.ts";
import { readAtlas } from "../../../lib/publish/atlas.ts";
import { attestFirms, headOffices, tierCounts } from "../../../lib/publish/board.ts";
import { dayLabel, fmtCap } from "../../../lib/publish/lens.ts";
import Refusal from "../../_ui/Refusal.tsx";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";
import { periodName } from "../../_ui/format.ts";
import About from "./About.tsx";
import Board from "./Board.tsx";
import BriefButton from "./BriefButton.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard (doc 19): one published revision on one screen, the same for
 * everybody who opens it. The market by tier, its head offices across Canada
 * by province and tier, and its attest firms by head office and by tier.
 * Nothing on it filters: every figure opens its companies in Companies,
 * which is where a reader narrows.
 *
 * The server reads the frozen snapshot and draws every figure. What reaches
 * the browser is what a Viewer may read: no company's Deloitte market, which
 * the snapshot keeps out of the companies Brief me is handed.
 */
export default async function Dashboard() {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body="The Mining & Metals Marketplace Assessment Tool is invite-only. Sign in to see the published dashboard."
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
  const [atlas, publisher] = await Promise.all([
    readAtlas(db, period.id, snap.publication.id),
    snap.publication.published_by
      ? db.get(`select ${personSql("u")} as name from app_users u where u.id = ?`, snap.publication.published_by) as Promise<{ name: string } | undefined>
      : Promise.resolve(undefined),
  ]);
  const { name: periodTitle } = periodName(period.label);
  const { threshold, currency, operator, asOf } = atlas.period;
  const line = operator === "gt" ? `worth more than ${fmtCap(threshold, currency)}` : `worth ${fmtCap(threshold, currency)} or more`;
  const pub = atlas.publication;

  return (
    <Page title="Dashboard" count={atlas.companies.length}
          meta={`${periodTitle} · revision ${pub.revision}${pub.overrideReason ? " · through a blocked gate" : ""}`}
          actions={<>
            <About label={`About revision ${pub.revision}`} warn={Boolean(pub.overrideReason)}>
              <p className="db-about-t">{periodTitle}, revision {pub.revision}</p>
              <p>Published {dayLabel(pub.publishedAt.slice(0, 10))}{publisher?.name ? ` by ${publisher.name}` : ""}.
                Market values as of {dayLabel(asOf)}; the population is every company {line}.</p>
              {pub.overrideReason && <Callout tone="warn" title="Published through a blocked gate">{pub.overrideReason}</Callout>}
              {pub.amendmentReason && <Callout tone="info" title={`What revision ${pub.revision} changed`}>{pub.amendmentReason}</Callout>}
              <p className="db-about-q">Every figure is a count of published values. Nothing here ranks a company or says which to approach.</p>
            </About>
            <BriefButton atlas={atlas} periodTitle={periodTitle} />
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
      <Board data={{
        total: atlas.companies.length,
        tiers: tierCounts(atlas.companies),
        hq: headOffices(atlas.companies),
        firms: attestFirms(atlas.companies),
        basis: `${line}, as of ${dayLabel(asOf)}`,
      }} />
      <footer className="notices">
        <p>{INTERNAL_USE}</p>
        <p>{EXCHANGE_NOTICE}</p>
        <p>{VENDOR_NOTICE}</p>
        <p>{AI_NOTICE}</p>
      </footer>
    </Page>
  );
}
