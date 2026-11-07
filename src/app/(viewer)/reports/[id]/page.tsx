import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { listCompanies } from "../../../../lib/profile/company.ts";
import {
  describeFilter, dropUnknown, facetOptions, filterRows, isNarrowed, parseRosterParams, sortRows, toRosterParams,
} from "../../../../lib/profile/roster.ts";
import { canEdit, getReport } from "../../../../lib/reports/reports.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Page from "../../../_ui/Page.tsx";
import AiNotice from "../../../_ui/AiNotice.tsx";
import Icon from "../../../_ui/Icon.tsx";
import { fmtDate } from "../../../_ui/format.ts";
import RosterTable, { RosterLegend } from "../../companies/RosterTable.tsx";
import { ReportControls } from "../ReportControls.tsx";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Not the report's name: the tab title is drawn before anyone is asked who may see it. */
export const metadata: Metadata = { title: "Report" };

/**
 * One saved report, read-only: the companies its filters find in the current
 * published data, with its columns and its sort. Nothing here filters; its
 * filters change only from the Companies page ("Open in Companies"), so there
 * is one place to filter and one way to change a report.
 */
export default async function ReportPage({ params }: Props) {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { id } = await params;
  const report = await getReport(ctx.db, ctx.user, id);
  if (!report) {
    return <Refusal title="No such report"
                    body="It may have been deleted, or it is private to the person who saved it."
                    action={{ href: "/reports", label: "All reports" }} />;
  }

  const rows = await listCompanies(ctx.db, { allowDraft: ctx.user.role !== "viewer" });
  if (rows.length === 0) {
    return <Refusal title="No companies yet"
                    body="Nothing has been published, so there is nothing for this report to show." />;
  }
  const facets = facetOptions(rows);
  const filter = dropUnknown(parseRosterParams(new URLSearchParams(report.params)), facets);
  const saved = toRosterParams(filter).toString();
  const shown = sortRows(filterRows(rows, filter), filter.sort, filter.dir);
  const mine = report.ownerId === ctx.user.id;
  const deloitteAudits = shown.filter((s) => s.row.auditor === "Deloitte").length;
  const exportHref = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams(saved);
    p.set("format", format);
    p.set("report", report.id);
    return `/api/companies/export?${p.toString()}`;
  };

  return (
    <Page title={report.name} back={{ href: "/reports", label: "Reports" }}
          meta={<>
            {report.visibility === "public" ? "Public" : "Private"}
            {" · saved by "}{mine ? "you" : report.ownerName}
            {" · updated "}{fmtDate(report.updatedAt)}
          </>}>
      <div className="reading wide rise">
        <AiNotice compact full />
        <p className="rp-words">
          <span className="rp-k">Filters</span>
          {isNarrowed(filter) ? describeFilter(filter, facets) : "None: every company in the period"}
        </p>
        <div className="tools">
          <span className="meta" role="status">
            <span className="fig-sm">{shown.length}</span> of <span className="fig-sm">{rows.length}</span>
            {" companies · Deloitte audits "}<span className="fig-sm">{deloitteAudits}</span>
          </span>
          <span className="spacer" />
          <a className="btn sm secondary" href={exportHref("xlsx")} download>
            <Icon name="download" size={13} />Excel
          </a>
          <a className="btn sm quiet" href={exportHref("csv")} download>CSV</a>
          <Link className="btn sm quiet" prefetch={false}
                href={`/companies?${[saved, `from=${report.id}`].filter(Boolean).join("&")}` as Route}>
            <Icon name="building-2" size={13} />Open in Companies
          </Link>
          <ReportControls report={{
            id: report.id, name: report.name, visibility: report.visibility, ownerName: report.ownerName,
            mine, canEdit: canEdit(report, ctx.user),
          }} />
        </div>
        {shown.length === 0
          ? <p className="empty">No company matches this report in the current published data.</p>
          : <RosterTable shown={shown} filter={filter} />}
        <RosterLegend />
      </div>
    </Page>
  );
}
