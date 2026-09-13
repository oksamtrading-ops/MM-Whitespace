import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { findDuplicateCandidates } from "../../../lib/identity/merge.ts";
import { listCompanies } from "../../../lib/profile/company.ts";
import Refusal from "../../_ui/Refusal.tsx";
import Roster from "./Roster.tsx";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import Page from "../../_ui/Page.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default async function Companies(
  { searchParams }: { searchParams: Promise<{ province?: string }> },
) {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { province } = await searchParams;
  const allowDraft = ctx.user.role !== "viewer";
  const rows = await listCompanies(ctx.db, { allowDraft });
  if (rows.length === 0) {
    return <Refusal title="No companies yet"
                    body="Nothing has been published. Company profiles read the frozen snapshot, so there is nothing to look up until a period is published." />;
  }
  const deloitteAudits =rows.filter((r) => r.auditor === "Deloitte").length;
  // Surfaced where the companies are, rather than in a menu nobody opens.
  const duplicates = allowDraft
    ? (await findDuplicateCandidates(ctx.db, 200)).length
    : 0;

  return (
    <Page title="Companies" count={rows.length}>
    <div className="reading wide rise">
      <p className="sub">
        Every company in the published population. Open one before a pursuit conversation:
        its tier, the rule that produced it, and the evidence behind every researched value.
      </p>
      {duplicates > 0 && (
        <Callout tone="warn" title={`${duplicates} possible duplicate${duplicates === 1 ? "" : "s"}`}
                 icon="merge"
                 actions={<Link className="btn sm secondary" href="/companies/merge" prefetch={false}>
                            Look at them<Icon name="arrow-right" size={13} /></Link>}>
          Pairs of rows that look like one company.
        </Callout>
      )}
      <Roster rows={rows} deloitteAudits={deloitteAudits} province={province ?? null} />
    </div>
    </Page>
  );
}
