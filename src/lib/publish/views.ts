/**
 * Dashboard views, computed from the frozen snapshot.
 *
 * Two rules shape all of this.
 *
 * REFUSE TO DRAW A CHART THAT WOULD LIE. With stage blank for 242 of 259 the
 * tier function returns one value for everyone and the chart renders a single
 * full-width bar: confident, well-formed and entirely false. An empty chart
 * gets ignored; a full one that is wrong gets believed. So a chart below its
 * coverage floor renders a METER in the same footprint -- no layout jump -- and
 * links into the filtered review queue.
 *
 * EVERY POPULATION CHART CARRIES A PROOF LINE. `121 + 61 + 12 + 7 + 5 + 53 =
 * 259 ✓`, computed at query time as a passing or failing assertion. This is the
 * one genuinely good idea in the source workbook, and it is the thing that
 * would have caught the 258-versus-259 discrepancy on its own screen.
 */

import { formatMoney } from "../format/fields.ts";

export type Bucket = { bucket: string; sub: string; n: number };
export type Aggregates = Record<string, Bucket[]>;

export type Bar = {
  label: string;
  n: number;
  pct: number;
  /** De-emphasised: a terminal bucket, or a firm that is not ours. */
  muted?: boolean;
  /** Accented: the one bar the view is actually about. */
  accent?: boolean;
  /** Always last, never sorted into the ranking. */
  terminal?: boolean;
  note?: string;
};

export type Proof = { parts: number[]; total: number; population: number; ties: boolean; text: string };

export function proofLine(bars: readonly Bar[], population: number): Proof {
  const parts = bars.map((b) => b.n);
  const total = parts.reduce((a, b) => a + b, 0);
  const ties = total === population;
  return {
    parts, total, population, ties,
    text: `${parts.join(" + ")} = ${total} ${ties ? "✓" : `✗ expected ${population}`}`,
  };
}

/* ------------------------------------------------------------ gating */

export type Gated =
  | { kind: "chart"; coveragePct: number }
  | { kind: "meter"; coveragePct: number; resolved: number; population: number;
      floorPct: number; message: string; reviewLink: string };

/**
 * With one meaningful class, a meter beats a chart. The meter occupies the same
 * footprint so the layout does not jump when coverage crosses the floor.
 */
export function gateChart(
  chart: string, label: string, drivingField: string,
  resolved: number, population: number, floorPct: number | null,
): Gated {
  const pct = population === 0 ? 0 : Math.round((1000 * resolved) / population) / 10;
  if (floorPct === null || pct >= floorPct) return { kind: "chart", coveragePct: pct };
  return {
    kind: "meter", coveragePct: pct, resolved, population, floorPct,
    message: `${label}: ${resolved} of ${population} researched (${pct}%). ` +
             `This view unlocks at ${floorPct}%.`,
    reviewLink: `/review/${drivingField}?bucket=need_review`,
  };
}

/* ------------------------------------------------- population and tiles */

export type Tile = { label: string; value: string; note?: string };

/**
 * A four-bar chart of four numbers is the one-bar-chart anti-pattern, so
 * population is stat tiles. The real headline is how much of this market is
 * not ours.
 */
export function populationTiles(agg: Aggregates): { tiles: Tile[]; hero: string } {
  const exchange = agg.exchange ?? [];
  const total = (agg.tier_distribution ?? []).reduce((a, b) => a + b.n, 0);
  const auditors = agg.auditor_share ?? [];
  const deloitte = auditors.find((a) => a.bucket === "Deloitte")?.n ?? 0;
  const pct = total === 0 ? 0 : Math.round((1000 * deloitte) / total) / 10;

  return {
    tiles: [
      { label: "Companies", value: String(total) },
      ...exchange.map((e) => ({ label: e.bucket, value: String(e.n) })),
    ],
    hero: `Deloitte audits ${deloitte} of ${total} (${pct}%)`,
  };
}

/* --------------------------------------------------------- market view */

export const FOREIGN_HQ = "__foreign_hq__";

/**
 * Markets have no natural order, so one hue sorted descending -- never a ramp
 * by value, which double-encodes bar length.
 *
 * The foreign-HQ bucket is rendered explicitly, in the de-emphasis grey, ALWAYS
 * LAST and never sorted into the ranking. It is labelled "no Deloitte market"
 * rather than "Other", because the workbook already uses "Others" to mean three
 * specific markets and reusing the word would collide with a meaning partners
 * already hold.
 */
export function marketBars(agg: Aggregates): { bars: Bar[]; proof: Proof } {
  const rows = agg.market ?? [];
  const population = rows.reduce((a, b) => a + b.n, 0);
  const named: Bar[] = rows.filter((r) => r.bucket !== FOREIGN_HQ)
    .sort((a, b) => b.n - a.n)
    .map((r) => bar(r.bucket, r.n, population));
  const foreign = rows.find((r) => r.bucket === FOREIGN_HQ);
  const bars: Bar[] = [...named];
  if (foreign) {
    bars.push({
      ...bar("Foreign HQ — no Deloitte market", foreign.n, population),
      muted: true, terminal: true,
      note: "Foreign-headquartered companies have no Deloitte market. Being " +
            "disproportionately the large interlisted names, they are shown rather " +
            "than dropped.",
    });
  }
  return { bars, proof: proofLine(bars, population) };
}

/* ------------------------------------------------------ footprint views */

/**
 * NOT "producing mines by province".
 *
 * Property location and stage are both recorded at COMPANY level with no link
 * between them, so "producing mines in province X" cannot be derived at any
 * confidence: a producing company with properties in three jurisdictions does
 * not have a producing mine in all three. Rebuilding the view as named would
 * count every exploration-stage property owned by a producing company as a
 * producing mine, and nothing on screen would say so. The broken reference at
 * least announced itself.
 *
 * So it ships under an honest name, which is computable today and true.
 */
export const PROVINCE_TITLE = "Companies with properties in each province or territory";
export const JURISDICTION_TITLE = "Companies with properties in each foreign jurisdiction";

export function footprintBars(
  agg: Aggregates, key: string, topN?: number,
): { bars: Bar[]; othered: number } {
  const rows = [...(agg[key] ?? [])].sort((a, b) => b.n - a.n);
  const max = rows[0]?.n ?? 1;
  if (!topN || rows.length <= topN) {
    const all: Bar[] = rows.map((r) => bar(r.bucket, r.n, max));
    return { bars: all, othered: 0 };
  }
  const head = rows.slice(0, topN);
  const tail = rows.slice(topN);
  const otherTotal = tail.reduce((a, b) => a + b.n, 0);
  const bars: Bar[] = [
      ...head.map((r) => bar(r.bucket, r.n, max)),
      { ...bar(`Other (${tail.length} jurisdictions)`, otherTotal, max), muted: true, terminal: true },
  ];
  return { bars, othered: tail.length };
}

/* --------------------------------------------------------- auditor share */

export const UNKNOWN_AUDITOR = "__unknown__";

/**
 * An EMPHASIS bar, not a categorical palette. The story is not who audits what;
 * it is how much of this market is not ours.
 *
 * "Unknown" is its own bar and will be the longest -- that is the actual
 * finding, not a gap to tidy away.
 */
export function auditorBars(agg: Aggregates): { bars: Bar[]; proof: Proof } {
  const rows = agg.auditor_share ?? [];
  const population = rows.reduce((a, b) => a + b.n, 0);
  const known: Bar[] = rows.filter((r) => r.bucket !== UNKNOWN_AUDITOR)
    .sort((a, b) => b.n - a.n)
    .map((r) => ({
      ...bar(r.bucket, r.n, population),
      accent: r.bucket === "Deloitte",
      muted: r.bucket !== "Deloitte",
    }));
  const unknown = rows.find((r) => r.bucket === UNKNOWN_AUDITOR);
  const bars: Bar[] = [...known];
  if (unknown) {
    bars.push({
      ...bar("Unknown", unknown.n, population), muted: true, terminal: true,
      note: "The largest single value. Not a gap in the chart — a finding about " +
            "how much of this market has never been established.",
    });
  }
  return { bars, proof: proofLine(bars, population) };
}

/* ------------------------------------------------------- tier migration */

export type MigrationCell = {
  from: string; to: string; n: number;
  direction: "up" | "down" | "same" | "research";
};

export type Migration =
  | { kind: "first_period"; message: string }
  | { kind: "matrix"; cells: MigrationCell[]; researchCompleted: number; moved: number };

/**
 * Movement is a POLARITY encoding -- up, unchanged, down -- needing two opposed
 * hues with a neutral midpoint. Encoding direction as light-green versus
 * dark-green reads as MAGNITUDE, making "moved down three tiers" look like
 * "moved a lot" rather than "moved the wrong way". Direction ships with an icon
 * and a label always, which satisfies the colour-alone rule for free.
 *
 * Two states the brief omits and this handles: the first period has no prior,
 * and a company moving from Unclassified to tiered is RESEARCH COMPLETING, not
 * migration -- without which the first enrichment run shows 242 phantom
 * upgrades and the view is noise on its debut.
 */
export function tierMigration(agg: Aggregates, hasPrior: boolean): Migration {
  if (!hasPrior || !agg.migration) {
    return {
      kind: "first_period",
      message: "This is the first published period, so there is nothing to compare " +
               "against. Migration appears once a second period is published.",
    };
  }
  const cells: MigrationCell[] = [];
  let researchCompleted = 0;
  let moved = 0;
  for (const row of agg.migration) {
    const from = row.bucket;
    const to = row.sub;
    const direction = classifyMovement(from, to);
    if (direction === "research") researchCompleted += row.n;
    else if (direction !== "same") moved += row.n;
    cells.push({ from, to, n: row.n, direction });
  }
  return { kind: "matrix", cells, researchCompleted, moved };
}

export function classifyMovement(from: string, to: string): MigrationCell["direction"] {
  const a = Number(from);
  const b = Number(to);
  // Research completing is not migration.
  if (!Number.isFinite(a) && Number.isFinite(b)) return "research";
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "same";
  if (a === b) return "same";
  // A LOWER tier number is a better tier, so falling numerically is moving up.
  return b < a ? "up" : "down";
}

/* -------------------------------------------------- entrants & drop-outs */

export type Movement = {
  companyName: string;
  ticker: string | null;
  cause: "new_listing" | "crossed_threshold" | "renamed";
  marketCap: number | null;
  priorMarketCap: number | null;
  movePct: number | null;
  nearThreshold: boolean;
};

export type EntrantsView =
  | { kind: "first_period"; message: string }
  | { kind: "table"; entrants: Movement[]; dropouts: Movement[];
      thresholdChanged: boolean; note: string | null };

/**
 * A company appearing or vanishing has three causes with completely different
 * meanings, and one list presents them identically. A rename is resolved by
 * identity and is NOT surfaced as a movement at all.
 *
 * Two companies sit 0.85% and 0.86% above the threshold. A 1% market move drops
 * them out, and in a pursuit conversation "drop-out" reads as "we lost them"
 * when nothing happened -- so anything inside the proximity band is marked.
 */
export function nearThreshold(
  marketCap: number | null, threshold: number, bandPct: number,
): boolean {
  if (marketCap === null) return false;
  const distance = Math.abs(marketCap - threshold) / threshold;
  return distance * 100 <= bandPct;
}

/**
 * A threshold CHANGE must be distinguished from a market move, or switching the
 * parameter once produces hundreds of spurious entrants.
 */
export function thresholdNote(
  current: number, prior: number | null, currency: string,
): string | null {
  if (prior === null || prior === current) return null;
  return `The threshold changed from ${formatMoney(prior, currency)} to ` +
         `${formatMoney(current, currency)} this period. Movements below are ` +
         `parameter-driven, not price-driven, and are listed separately.`;
}

function bar(label: string, n: number, denominator: number): Bar {
  return { label, n, pct: denominator === 0 ? 0 : Math.round((1000 * n) / denominator) / 10 };
}
