import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { isStageField } from "../../../../lib/review/decide.ts";
import { cellLabel, fieldRows, formatValue, tierConsequence } from "../../../../lib/review/queue.ts";
import Grid, { type GridRow } from "./Grid.tsx";

export const dynamic = "force-dynamic";

const THRESHOLD = 0.8;

export default async function FieldReview(
  { params, searchParams }: {
    params: Promise<{ field: string }>;
    searchParams: Promise<{ bucket?: string }>;
  },
) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return (
      <>
        <h1>{err instanceof Forbidden ? "Not permitted" : "Sign in"}</h1>
        <div className="empty">
          <p>{err instanceof Forbidden
            ? "Review is for Analysts and Admins."
            : (err as Unauthenticated).message}</p>
        </div>
      </>
    );
  }

  const { field } = await params;
  const { bucket = "all" } = await searchParams;

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

  const buckets = ["all", "conflict", "need_review", "bulkable", "no_evidence", "quarantined"];

  return (
    <>
      <p className="crumb"><Link href="/review">← Review</Link></p>
      <h1>{catalogue.label}</h1>
      <p className="sub">
        {period.label} · {rows.length} companies · sorted by evidence ascending, so the
        worst work comes first
      </p>

      <nav className="filters" aria-label="Filter">
        {buckets.map((b) => (
          <Link key={b} href={`/review/${field}?bucket=${b}`}
                aria-current={b === bucket ? "page" : undefined}>
            {b.replace(/_/g, " ")}
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
      />
    </>
  );
}
