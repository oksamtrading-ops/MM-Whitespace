import type { Metadata } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { listCompanies } from "../../../../lib/profile/company.ts";
import { dropUnknown, facetOptions, parseRosterParams, toRosterParams } from "../../../../lib/profile/roster.ts";
import { canEdit, getReport } from "../../../../lib/reports/reports.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Page from "../../../_ui/Page.tsx";
import AiNotice from "../../../_ui/AiNotice.tsx";
import { fmtDate } from "../../../_ui/format.ts";
import Roster from "../../companies/Roster.tsx";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Not the report's name: the tab title is drawn before anyone is asked who may see it. */
export const metadata: Metadata = { title: "Report" };

/**
 * One saved report: the companies table with its filters applied to the
 * current published data. ?edit=1 means "as changed since it was saved" and
 * carries the changed filters, so a changed view reloads as it was left.
 */
export default async function ReportPage({ params, searchParams }: Props) {
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
  const deloitteAudits = rows.filter((r) => r.auditor === "Deloitte").length;
  const facets = facetOptions(rows);
  const query = await searchParams;
  const edited = query.edit !== undefined;
  const saved = dropUnknown(parseRosterParams(new URLSearchParams(report.params)), facets);
  const initial = edited ? dropUnknown(parseRosterParams(query), facets) : saved;
  const mine = report.ownerId === ctx.user.id;

  return (
    <Page title={report.name} back={{ href: "/reports", label: "Reports" }}
          meta={<>
            {report.visibility === "public" ? "Public" : "Private"}
            {" · saved by "}{mine ? "you" : report.ownerName}
            {" · updated "}{fmtDate(report.updatedAt)}
          </>}>
      <div className="reading wide rise">
        <AiNotice compact full />
        <Roster rows={rows} deloitteAudits={deloitteAudits} initial={initial}
                report={{
                  id: report.id, name: report.name, visibility: report.visibility,
                  params: toRosterParams(saved).toString(), ownerName: report.ownerName,
                  mine, canEdit: canEdit(report, ctx.user),
                }} />
      </div>
    </Page>
  );
}
