import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { isStageField } from "../../../../lib/review/decide.ts";
import { cellLabel, fieldRows, formatValue, tierConsequence } from "../../../../lib/review/queue.ts";
import { chosenThreshold, DEFAULT_THRESHOLD, THRESHOLDS } from "../../../../lib/review/threshold.ts";
import Refusal from "../../../_ui/Refusal.tsx";
import Facts from "../../../_ui/Facts.tsx";
import { periodName } from "../../../_ui/format.ts";
import Grid, { type GridRow } from "./Grid.tsx";
import Page from "../../../_ui/Page.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

const BUCKETS: Array<[string, string]> = [
  ["all", "All"], ["conflict", "Conflict"], ["need_review", "Need review"],
  ["bulkable", "Bulk-acceptable"], ["no_evidence", "No evidence"], ["quarantined", "Quarantined"],
  // Decided, and researched again since. Every other tab asks what is left to
  // do; this one asks what was settled before the answer improved.
  ["superseded", "Newer research"],
];

export default async function FieldReview(
  { params, searchParams }: {
    params: Promise<{ field: string }>;
    searchParams: Promise<{ bucket?: string; q?: string; threshold?: string }>;
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
  const { bucket = "all", q = "", threshold: askedThreshold } = await searchParams;
  const threshold = chosenThreshold(askedThreshold);
  // Every link on this screen carries the bucket, the search and the floor,
  // so none of them silently resets another.
  const query = (over: { bucket?: string; threshold?: number }) => {
    const parts = [`bucket=${over.bucket ?? bucket}`];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    const t = over.threshold ?? threshold;
    if (t !== DEFAULT_THRESHOLD) parts.push(`threshold=${t}`);
    return `/review/${field}?${parts.join("&")}` as Route;
  };

  const period = await ctx.db.get("select id, label from periods order by market_cap_as_of desc limit 1") as { id: string; label: string } | undefined;
  if (!period) notFound();

  const catalogue = await ctx.db.get("select key, label from field_catalog where key = ?", field) as
    { key: string; label: string } | undefined;
  if (!catalogue) notFound();

  const raw = await fieldRows(ctx.db, period.id, field, bucket, threshold);
  const rows: GridRow[] = await Promise.all(raw.map(async (r) => ({
    companyId: r.companyId,
    companyName: r.companyName,
    value: r.abstained ? "abstained" : formatValue(r.proposedValue, r.fieldKey),
    band: r.band,
    strength: r.evidenceStrength,
    state: r.findingState,
    decided: r.decided,
    decision: r.decision,
    newerThanDecision: r.newerThanDecision,
    conflict: r.conflict,
    sourceCount: r.sourceCount,
    excerpt: r.excerpt,
    sourceUrl: r.sourceUrl,
    anchorMode: r.anchorMode,
    findingId: r.findingId,
    findingAttempt: r.findingAttempt,
    extractValue: r.extractValue === null ? null : formatValue(r.extractValue, r.fieldKey),
    cellLabel: cellLabel(r, catalogue.label),
    tierNote: await tierConsequence(ctx.db, period.id, r),
  })));

  // A count on every filter, so the choice of batch is made before the click.
  const counts = Object.fromEntries(await Promise.all(BUCKETS.map(async ([key]) =>
    [key, key === bucket
      ? raw.length
      : (await fieldRows(ctx.db, period.id, field, key, threshold)).length])));

  return (
    <Page title={catalogue.label} count={rows.length}
          back={{ href: "/review", label: "Review" }}
          meta={`${periodName(period.label).name} · evidence, weakest first`}>

      <nav className="filters rise" aria-label="Filter" style={{ "--i": 1 } as React.CSSProperties}>
        {BUCKETS.map(([key, label]) => (
          <Link key={key} href={query({ bucket: key })}
                prefetch={false} aria-current={key === bucket ? "page" : undefined}>
            {label} <span className="fig-sm">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      {/* The floor for bulk accept. A number the reviewer sets, not one the
          application decides for them -- and it moves the bulk-acceptable
          count above, so the consequence is visible before anything is
          accepted. */}
      <nav className="filters rise" aria-label="Bulk accept floor"
           style={{ "--i": 1 } as React.CSSProperties}>
        <span className="meta">Bulk accept at evidence</span>
        {THRESHOLDS.map((t) => (
          <Link key={t} href={query({ threshold: t })} prefetch={false}
                aria-current={t === threshold ? "page" : undefined}>
            {t.toFixed(2)}
          </Link>
        ))}
      </nav>

      <Grid
        periodId={period.id}
        fieldKey={field}
        fieldLabel={catalogue.label}
        bucket={bucket}
        threshold={threshold}
        isStageField={isStageField(field)}
        rows={rows}
        initialQuery={q}
      />
    </Page>
  );
}
