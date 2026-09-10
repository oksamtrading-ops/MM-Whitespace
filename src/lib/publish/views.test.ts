import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditorBars, classifyMovement, footprintBars, FOREIGN_HQ, gateChart, marketBars,
  JURISDICTION_TITLE, nearThreshold, populationTiles, proofLine, PROVINCE_TITLE,
  thresholdNote, tierMigration, UNKNOWN_AUDITOR, type Aggregates,
} from "./views.ts";

/** The real distribution, as published. */
const AGG: Aggregates = {
  tier_distribution: [
    { bucket: "unclassified_no_stage_evidence", sub: "-", n: 242 },
    { bucket: "4", sub: "-", n: 17 },
  ],
  exchange: [
    { bucket: "TSX", sub: "-", n: 144 },
    { bucket: "TSXV", sub: "-", n: 115 },
  ],
  market: [
    { bucket: "British Columbia", sub: "-", n: 121 },
    { bucket: "Ontario", sub: "-", n: 61 },
    { bucket: FOREIGN_HQ, sub: "-", n: 53 },
    { bucket: "Quebec & NCR", sub: "-", n: 12 },
    { bucket: "Prairies Region", sub: "-", n: 7 },
    { bucket: "Atlantic", sub: "-", n: 5 },
  ],
  auditor_share: [
    { bucket: UNKNOWN_AUDITOR, sub: "-", n: 117 },
    { bucket: "PwC", sub: "-", n: 46 },
    { bucket: "KPMG", sub: "-", n: 29 },
    { bucket: "Deloitte", sub: "-", n: 17 },
    { bucket: "MNP", sub: "-", n: 9 },
  ],
  province_footprint: [
    { bucket: "BC", sub: "-", n: 27 }, { bucket: "ON", sub: "-", n: 25 },
    { bucket: "QC", sub: "-", n: 17 },
  ],
};

// ------------------------------------------------------------ proof line

test("the proof line ties, and says so", async () => {
  const { bars, proof } = marketBars(AGG);
  assert.equal(proof.text, "121 + 61 + 12 + 7 + 5 + 53 = 259 ✓");
  assert.equal(proof.ties, true);
  assert.equal(bars.length, 6);
});

test("the proof line FAILS VISIBLY when a bucket is dropped", async () => {
  // This is the assertion that would have caught the 258-versus-259
  // discrepancy on its own screen.
  const bars = [{ label: "a", n: 121, pct: 0 }, { label: "b", n: 61, pct: 0 }];
  const proof = proofLine(bars, 259);
  assert.equal(proof.ties, false);
  assert.match(proof.text, /✗ expected 259/);
});

// --------------------------------------------------------- market view

test("the foreign-HQ bucket is shown, always last, and never sorted into the ranking", async () => {
  const { bars } = marketBars(AGG);
  const last = bars[bars.length - 1];
  assert.match(last.label, /no Deloitte market/);
  assert.equal(last.n, 53);
  assert.equal(last.terminal, true);
  assert.equal(last.muted, true);
  // 53 would sort third by size; it must not.
  assert.equal(bars[2].label, "Quebec & NCR");
  // Not "Other": the workbook already uses "Others" for three specific markets.
  assert.ok(!bars.some((b) => b.label === "Other"));
});

test("the named markets are sorted descending, with no value ramp", async () => {
  const { bars } = marketBars(AGG);
  const named = bars.filter((b) => !b.terminal).map((b) => b.n);
  assert.deepEqual(named, [...named].sort((a, b) => b - a));
});

// -------------------------------------------------------- auditor share

test("Unknown is its own bar, is the longest, and is labelled as the finding", async () => {
  const { bars, proof } = auditorBars(AGG);
  const unknown = bars[bars.length - 1];
  assert.equal(unknown.label, "Unknown");
  assert.equal(unknown.n, 117);
  assert.equal(unknown.terminal, true);
  assert.ok(unknown.n > Math.max(...bars.slice(0, -1).map((b) => b.n)),
    "the longest bar in the chart");
  assert.match(unknown.note ?? "", /a finding about/);
  assert.equal(proof.ties, true);
});

test("auditor share is an emphasis encoding: Deloitte accented, everyone else grey", async () => {
  const { bars } = auditorBars(AGG);
  const deloitte = bars.find((b) => b.label === "Deloitte")!;
  assert.equal(deloitte.accent, true);
  assert.equal(deloitte.muted, false);
  for (const other of bars.filter((b) => b.label !== "Deloitte")) {
    assert.notEqual(other.accent, true, `${other.label} must not be accented`);
  }
});

test("the hero figure is how much of this market is not ours", async () => {
  const { hero, tiles } = populationTiles(AGG);
  assert.equal(hero, "Deloitte audits 17 of 259 (6.6%)");
  // Stat tiles, not a four-bar chart of four numbers.
  assert.deepEqual(tiles.map((t) => t.label), ["Companies", "TSX", "TSXV"]);
});

// ------------------------------------------------------------- gating

test("a chart below its coverage floor becomes a meter, not a lie", async () => {
  // Day one: 17 of 259 have stage evidence. The tier chart would render one
  // full-width bar -- confident, well-formed and entirely false.
  const gated = gateChart(
    "tier_distribution", "Stage of operations", "stage_evidence_state", 17, 259, 95);
  assert.equal(gated.kind, "meter");
  if (gated.kind !== "meter") return;
  assert.equal(gated.coveragePct, 6.6);
  assert.match(gated.message, /17 of 259 researched \(6\.6%\)/);
  assert.match(gated.message, /unlocks at 95%/);
  assert.match(gated.reviewLink, /^\/review\/stage_evidence_state/);
});

test("a chart at or above its floor draws", async () => {
  const gated = gateChart("footprint", "Footprint", "footprint", 247, 259, 95);
  assert.equal(gated.kind, "chart");
  assert.equal(gated.coveragePct, 95.4);
});

test("a view with no floor always draws", async () => {
  assert.equal(gateChart("fee_views", "Fees", "audit_fee", 0, 259, null).kind, "chart");
});

// ---------------------------------------------------------- footprints

test("the footprint views are named for what they actually compute", async () => {
  // Property location and stage are both recorded at COMPANY level with no link
  // between them, so "producing mines in province X" is underivable at any
  // confidence. Naming the view for the join would manufacture the number.
  assert.match(PROVINCE_TITLE, /Companies with properties/);
  assert.ok(!/producing mines/i.test(PROVINCE_TITLE),
    "the view must not claim to count producing mines");
  assert.ok(!/producing mines/i.test(JURISDICTION_TITLE));
});

test("a long axis is topped and tailed rather than truncated silently", async () => {
  const many: Aggregates = {
    jurisdiction_footprint: Array.from({ length: 20 }, (_, i) => ({
      bucket: `J${i}`, sub: "-", n: 20 - i,
    })),
  };
  const { bars, othered } = footprintBars(many, "jurisdiction_footprint", 12);
  assert.equal(bars.length, 13);
  assert.equal(othered, 8);
  const last = bars[bars.length - 1];
  assert.match(last.label, /Other \(8 jurisdictions\)/);
  assert.equal(last.terminal, true);
  assert.equal(last.n, bars.slice(12).reduce((a, b) => a + b.n, 0));
});

test("a short axis is not othered at all", async () => {
  const { bars, othered } = footprintBars(AGG, "province_footprint", 12);
  assert.equal(othered, 0);
  assert.equal(bars.length, 3);
});

// ---------------------------------------------------------- migration

test("the first published period renders an empty state, not a blank grid", async () => {
  const m = tierMigration(AGG, false);
  assert.equal(m.kind, "first_period");
  if (m.kind !== "first_period") return;
  assert.match(m.message, /first published period/);
});

test("research completing is NOT migration", async () => {
  // Without this the first enrichment run shows 242 phantom upgrades and the
  // view is noise on its debut.
  assert.equal(classifyMovement("unclassified_no_stage_evidence", "1"), "research");
  assert.equal(classifyMovement("none", "4"), "research");
  // A lower tier number is a better tier.
  assert.equal(classifyMovement("3", "1"), "up");
  assert.equal(classifyMovement("1", "3"), "down");
  assert.equal(classifyMovement("2", "2"), "same");

  const withPrior: Aggregates = {
    migration: [
      { bucket: "unclassified_no_stage_evidence", sub: "1", n: 242 },
      { bucket: "3", sub: "1", n: 2 },
      { bucket: "1", sub: "3", n: 1 },
      { bucket: "4", sub: "4", n: 14 },
    ],
  };
  const m = tierMigration(withPrior, true);
  assert.equal(m.kind, "matrix");
  if (m.kind !== "matrix") return;
  assert.equal(m.researchCompleted, 242, "counted separately from movement");
  assert.equal(m.moved, 3, "only genuine tier movement");
});

// -------------------------------------------------- entrants & drop-outs

test("a company just above the threshold is marked as near it", async () => {
  const threshold = 200_000_000;
  // Generation Mining and Greenland Resources sit 0.85% and 0.86% above.
  assert.equal(nearThreshold(201_700_000, threshold, 2), true);
  assert.equal(nearThreshold(201_720_000, threshold, 2), true);
  // A company well clear of the line is not.
  assert.equal(nearThreshold(5_000_000_000, threshold, 2), false);
  assert.equal(nearThreshold(null, threshold, 2), false);
});

test("a threshold change is distinguished from a market move", async () => {
  // Otherwise switching the parameter once produces hundreds of spurious entrants.
  assert.equal(thresholdNote(200_000_000, 200_000_000, "CAD"), null);
  assert.equal(thresholdNote(200_000_000, null, "CAD"), null);
  const note = thresholdNote(50_000_000, 200_000_000, "CAD");
  assert.match(note ?? "", /parameter-driven, not price-driven/);
});
