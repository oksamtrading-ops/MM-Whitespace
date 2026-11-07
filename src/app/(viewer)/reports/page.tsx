import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { listCompanies } from "../../../lib/profile/company.ts";
import { describeFilter, dropUnknown, facetOptions, parseRosterParams } from "../../../lib/profile/roster.ts";
import { canEdit, listReports } from "../../../lib/reports/reports.ts";
import Refusal from "../../_ui/Refusal.tsx";
import Page from "../../_ui/Page.tsx";
import Icon from "../../_ui/Icon.tsx";
import { fmtDate } from "../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

/**
 * Saved reports: the companies table, filtered and kept under a name. Yours,
 * private and public, then everybody else's public ones. Each opens as the
 * filtered table, reading the current published data.
 */
export default async function Reports() {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const reports = await listReports(ctx.db, ctx.user);
  const rows = reports.length ? await listCompanies(ctx.db, { allowDraft: ctx.user.role !== "viewer" }) : [];
  const facets = facetOptions(rows);
  const mine = reports.filter((r) => r.ownerId === ctx.user.id);
  const theirs = reports.filter((r) => r.ownerId !== ctx.user.id);

  const table = (list: typeof reports, caption: string, showOwner: boolean) => (
    <div className="tablewrap">
      <table className="reports">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Report</th>
            <th scope="col">Who can see it</th>
            {showOwner && <th scope="col">Saved by</th>}
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <Link href={`/reports/${r.id}` as Route} prefetch={false}>{r.name}</Link>
                <span className="rp-filter">
                  {describeFilter(dropUnknown(parseRosterParams(new URLSearchParams(r.params)), facets), facets)}
                </span>
              </th>
              <td>
                {r.visibility === "public"
                  ? <span className="pill quiet"><Icon name="users" size={12} />Public</span>
                  : <span className="pill quiet"><Icon name="lock" size={12} />Private</span>}
              </td>
              {showOwner && <td>{r.ownerName}{canEdit(r, ctx.user) && <span className="meta"> · you can edit</span>}</td>}
              <td className="fig-sm">{fmtDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Page title="Reports">
      <div className="reading wide rise">
        <p className="sub">
          Saved views of the companies table. Each opens with its filters applied to the current published data,
          and downloads as Excel.
        </p>
        {reports.length === 0 ? (
          <div className="rp-empty">
            <p className="empty">
              No reports yet. Filter the companies table, then choose <b>Save as report</b>.
            </p>
            <Link className="btn secondary" href="/companies" prefetch={false}>
              <Icon name="building-2" size={15} />Go to Companies
            </Link>
          </div>
        ) : (
          <>
            <h2 className="rp-h">Yours</h2>
            {mine.length
              ? table(mine, "Your reports", false)
              : <p className="meta">You have not saved a report. Filter the companies table, then choose Save as report.</p>}
            {theirs.length > 0 && (
              <>
                <h2 className="rp-h">Shared by others</h2>
                {table(theirs, "Public reports saved by other people", true)}
              </>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
