import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { listCompanies } from "../../../lib/profile/company.ts";
import Refusal from "../../_ui/Refusal.tsx";
import Finder from "./Finder.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default async function Companies() {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const allowDraft = ctx.user.role !== "viewer";
  const rows = listCompanies(ctx.db, { allowDraft });
  if (rows.length === 0) {
    return <Refusal title="No companies yet"
                    body="Nothing has been published. Company profiles read the frozen snapshot, so there is nothing to look up until a period is published." />;
  }
  const deloitteAudits = rows.filter((r) => r.auditor === "Deloitte").length;

  return (
    <div className="reading rise">
      <h1>Companies</h1>
      <p className="sub">
        Every company in the published population. Open one before a pursuit conversation:
        its tier, the rule that produced it, and the evidence behind every researched value.
      </p>
      <Finder rows={rows} deloitteAudits={deloitteAudits} />
    </div>
  );
}
