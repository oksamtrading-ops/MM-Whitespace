/**
 * Run the tier engine across all 259 real companies and assert the difference
 * against the workbook's own computed column equals exactly the known-divergent
 * set. Runs against the private copy of the file, never in CI -- see
 * docs/design/13-testing-strategy.md for the licensing reason.
 *
 *   python3 -m mmparser.cli "<workbook>" --json /tmp/period.json
 *   node scripts/parity_check.mjs /tmp/period.json
 */
import { readFileSync } from "node:fs";
import { classify, deriveFootprint } from "../src/lib/tiering/index.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/parity_check.mjs <period.json>");
  process.exit(2);
}
const { companies, period } = JSON.parse(readFileSync(path, "utf8"));

const ABROAD = ["AFRICA", "ASIA", "AUS/NZ/PNG", "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"];
const WORKBOOK_FOOTPRINT = {
  "Canada & Abroad": "canada_and_abroad",
  "Canada only": "canada_only",
  "Abroad": "abroad",
};

const tierDiff = [];
const footprintDiff = [];
const statuses = new Map();

for (const c of companies) {
  const propsCanada = (c.regions?.CANADA ?? []).length > 0;
  const propsAbroad = ABROAD.some((k) => (c.regions?.[k] ?? []).length > 0);
  const footprint = deriveFootprint(propsCanada, propsAbroad, c.property_evidence);

  const got = classify({
    stages: c.stages,
    stageEvidence: c.stage_evidence,
    footprint,
    propertyEvidence: c.property_evidence,
  });

  statuses.set(got.status, (statuses.get(got.status) ?? 0) + 1);

  if (got.tier !== c.tier_workbook) {
    tierDiff.push({ name: c.name, ours: got.tier, workbook: c.tier_workbook, status: got.status });
  }
  const wbFootprint = WORKBOOK_FOOTPRINT[c.footprint_workbook] ?? null;
  if (wbFootprint !== null && footprint !== wbFootprint) {
    footprintDiff.push({ name: c.name, ours: footprint, workbook: wbFootprint });
  }
}

console.log(`period ${period}  companies ${companies.length}`);
console.log("status distribution:", Object.fromEntries(statuses));
console.log(`tier divergences      ${tierDiff.length}`);
console.log(`footprint divergences ${footprintDiff.length}`);

const byStatus = {};
for (const d of tierDiff) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
console.log("tier divergence causes:", byStatus);
console.log("footprint divergence sample:",
  footprintDiff.slice(0, 4).map((d) => `${d.name}: ${d.ours} vs ${d.workbook}`));

// --- the assertions --------------------------------------------------------
let failed = 0;
const expect = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual} (expected ${expected})`);
};

console.log("\nassertions");
expect("population", companies.length, 259);
expect("tier divergences", tierDiff.length, 242);
expect("all tier divergences are no-stage-evidence",
  byStatus.unclassified_no_stage_evidence ?? 0, 242);
expect("footprint divergences", footprintDiff.length, 12);
expect("all footprint divergences are none-vs-canada_only",
  footprintDiff.filter((d) => d.ours === "none" && d.workbook === "canada_only").length, 12);
expect("companies classified", statuses.get("classified") ?? 0, 17);

process.exit(failed ? 1 : 0);
