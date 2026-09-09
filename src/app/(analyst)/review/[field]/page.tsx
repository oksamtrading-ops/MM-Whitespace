import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { isStageField } from "../../../../lib/review/decide.ts";
import { cellLabel, fieldRows, formatValue, tierConsequence } from "../../../../lib/review/queue.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Grid, { type GridRow } from "./Grid.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

const THRESHOLD = 0.8;

const BUCKETS: Array<[string, string]> = [
  ["all", "All"], ["conflict", "Conflict"], ["need_review", "Need review"],
  ["bulkable", "Bulk-acceptable"], ["no_evidence", "No evidence"], ["quarantined", "Quarantined"],
];

export default async function FieldReview(
  { params, searchParams }: {
    params: Promise<{ field: string }>;
    searchParams: Promise<{ bucket?: string; q?: string }>;
  },
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

  const { field } = await params;
  const { bucket = "all", q = "" } = await searchParams;

  const period = ctx.db.prepare(
    "select id, label from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string } | undefined;
  if (!period) notFound();

  const catalogue = ctx.db.prepare(
    "select key, label from field_catalog where key = ?").get(field) as
    { key: string; label: string } | undefined;
  if (!catalogue) notFound();

  const raw = fieldRows(ctx.db, period.id, field, bucket, THRESHOLD);
  const rows: GridRow[] = raw.map((r) => ({
    companyId: r.companyId,
    companyName: r.companyName,
    value: r.abstained ? "abstained" : formatValue(r.proposedValue),
    band: r.band,
    strength: r.evidenceStrength,
    state: r.findingState,
    decided: r.decided,
    decision: r.decision,
    conflict: r.conflict,
    sourceCount: r.sourceCount,
    excerpt: r.excerpt,
    sourceUrl: r.sourceUrl,
    anchorMode: r.anchorMode,
    findingId: r.findingId,
    findingAttempt: r.findingAttempt,
    extractValue: r.extractValue === null ? null : formatValue(r.extractValue),
    cellLabel: cellLabel(r, catalogue.label),
    tierNote: tierConsequence(ctx.db, period.id, r),
  }));

  // A count on every filter, so the choice of batch is made before the click.
  const counts = Object.fromEntries(BUCKETS.map(([key]) =>
    [key, key === bucket ? raw.length : fieldRows(ctx.db, period.id, field, key, THRESHOLD).length]));

  return (
    <>
      <p className="crumb rise"><Link href="/review" prefetch={false}>← Review</Link></p>
      <div className="titlerow rise">
        <h1>{catalogue.label}</h1>
        <span className="count">{period.label} · sorted by evidence, weakest first</span>
      </div>

      <nav className="filters rise" aria-label="Filter" style={{ "--i": 1 } as React.CSSProperties}>
        {BUCKETS.map(([key, label]) => (
          <Link key={key} href={`/review/${field}?bucket=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}` as Route}
                prefetch={false} aria-current={key === bucket ? "page" : undefined}>
            {label} <span className="fig-sm">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      <Grid
        periodId={period.id}
        fieldKey={field}
        fieldLabel={catalogue.label}
        bucket={bucket}
        threshold={THRESHOLD}
        isStageField={isStageField(field)}
        rows={rows}
        initialQuery={q}
      />
    </>
  );
}
