import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { cellLabel, companyRows, formatValue, tierConsequence } from "../../../../lib/review/queue.ts";
import Facts from "../../../_ui/Facts.tsx";
import Refusal from "../../../_ui/Refusal.tsx";
import { periodName } from "../../../_ui/format.ts";
import CompanyGrid, { type Row } from "./CompanyGrid.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "By company" };

const THRESHOLD = 0.8;

export default async function ByCompany(
  { searchParams }: { searchParams: Promise<{ q?: string }> },
) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Review is for Analysts and Admins."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { q = "" } = await searchParams;
  const period = ctx.db.prepare(
    "select id, label from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string } | undefined;
  if (!period) {
    return <Refusal title="Review" body="No period has been committed yet."
                    action={{ href: "/upload", label: "Upload a workbook" }} />;
  }

  const { fields, rows } = companyRows(ctx.db, period.id, THRESHOLD);
  const grid: Row[] = rows.map((r) => ({
    companyId: r.companyId,
    companyName: r.companyName,
    cells: r.cells.map((c, i) => c && {
      fieldKey: c.fieldKey,
      value: c.abstained ? "abstained" : formatValue(c.proposedValue),
      band: c.band,
      strength: c.evidenceStrength,
      decided: c.decided,
      decision: c.decision,
      conflict: c.conflict,
      sourceCount: c.sourceCount,
      excerpt: c.excerpt,
      sourceUrl: c.sourceUrl,
      anchorMode: c.anchorMode,
      findingId: c.findingId,
      findingAttempt: c.findingAttempt,
      extractValue: c.extractValue === null ? null : formatValue(c.extractValue),
      cellLabel: cellLabel(c, fields[i].label),
      tierNote: tierConsequence(ctx.db, period.id, c),
    }),
  }));

  return (
    <>
      <p className="crumb rise"><Link href="/review" prefetch={false}>← Review</Link></p>
      <div className="titlerow rise">
        <h1>By company</h1>
        <Facts items={[
          { label: "Period", value: periodName(period.label).name, figure: true },
          { label: "Companies", value: rows.length, figure: true },
        ]} />
      </div>
      <p className="sub rise" style={{ maxWidth: "68ch" }}>
        One company across the row, for the conversation where the unit of interest genuinely
        is one company. Reviewing is faster down a column, because judging one field reuses a
        single mental model — the{" "}
        <Link href="/review" prefetch={false}>field view</Link> is where the queue lives.
        Left and right move between fields here.
      </p>

      <CompanyGrid periodId={period.id} fields={fields.map((f) => ({ fieldKey: f.fieldKey, label: f.label }))}
                   rows={grid} initialQuery={q} />
    </>
  );
}
