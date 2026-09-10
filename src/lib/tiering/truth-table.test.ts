import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, deriveFootprint, type Footprint, type Stage } from "./index.ts";

const FOOTPRINTS: Footprint[] = ["canada_and_abroad", "canada_only", "abroad", "none"];
const ALL: Stage[] = ["exploration", "development", "production", "royalty_streaming"];

/** The 16 subsets, keyed by initials in E-D-P-R order. "" is the empty set. */
function subsets(): Array<{ key: string; stages: Stage[] }> {
  const out: Array<{ key: string; stages: Stage[] }> = [];
  for (let mask = 0; mask < 16; mask++) {
    const stages = ALL.filter((_, i) => mask & (1 << i));
    const key = stages.map((s) => s[0].toUpperCase()).join("");
    out.push({ key, stages });
  }
  return out;
}

type Expected = { tier: number | null; status: string; ruleId: string };

/**
 * Expectations as DATA, not as a second implementation. Sets without
 * production are footprint-independent; sets with production are listed per
 * footprint because that is exactly where footprint changes the answer.
 */
const WITHOUT_PRODUCTION: Record<string, Expected> = {
  "":    { tier: null, status: "unclassified_conflicting", ruleId: "catch_all" },
  "E":   { tier: 6, status: "classified", ruleId: "rule_6_exploration" },
  "D":   { tier: 5, status: "classified", ruleId: "rule_5_development" },
  "ED":  { tier: 5, status: "classified", ruleId: "rule_5_development" },
  "R":   { tier: 4, status: "classified", ruleId: "rule_4_royalty" },
  "ER":  { tier: 4, status: "classified", ruleId: "rule_4_royalty" },
  "DR":  { tier: 4, status: "classified", ruleId: "rule_4_royalty" },
  "EDR": { tier: 4, status: "classified", ruleId: "rule_4_royalty" },
};

const WITH_PRODUCTION: Record<Footprint, Expected> = {
  canada_and_abroad: { tier: 1, status: "classified", ruleId: "rule_1_production_both" },
  canada_only:       { tier: 2, status: "classified", ruleId: "rule_2_production_canada" },
  abroad:            { tier: 3, status: "classified", ruleId: "rule_3_production_abroad" },
  none: { tier: null, status: "unclassified_no_property_evidence", ruleId: "guard_no_property_evidence" },
};

/**
 * Appendix C transcribed verbatim from the workbook formula, so divergence is
 * measured against the real thing rather than asserted from memory:
 *   =IF(AND(R="X",U="Canada & Abroad"),1, IF(AND(R="X",U="Canada only"),2,
 *    IF(AND(R="X",U="Abroad"),3, IF(S="X",4, IF(AND(Q="X",R<>"X"),5,
 *    IF(AND(P="X",R<>"X",Q<>"X"),6,4))))))
 * The workbook never emits a "none" footprint -- its else-branch calls that
 * "Canada only" -- which is the defect itself.
 */
function workbookTier(stages: Stage[], footprint: Footprint): number {
  const P = stages.includes("exploration");
  const Q = stages.includes("development");
  const R = stages.includes("production");
  const S = stages.includes("royalty_streaming");
  const U = footprint === "none" ? "canada_only" : footprint;
  if (R && U === "canada_and_abroad") return 1;
  if (R && U === "canada_only") return 2;
  if (R && U === "abroad") return 3;
  if (S) return 4;
  if (Q && !R) return 5;
  if (P && !R && !Q) return 6;
  return 4;
}

test("truth table: all 64 stage-footprint pairs", async () => {
  let checked = 0;
  for (const { key, stages } of subsets()) {
    for (const footprint of FOOTPRINTS) {
      const expected = stages.includes("production")
        ? WITH_PRODUCTION[footprint]
        : WITHOUT_PRODUCTION[key];
      assert.ok(expected, `no expectation for stages=${key || "(none)"}`);

      const got = classify({
        stages,
        stageEvidence: "complete",
        footprint,
        propertyEvidence: footprint === "none" ? "none" : "complete",
      });
      const where = `stages=${key || "(none)"} footprint=${footprint}`;
      assert.equal(got.tier, expected.tier, `tier for ${where}`);
      assert.equal(got.status, expected.status, `status for ${where}`);

      // The trace is the product feature; an unasserted trace rots.
      const fired = got.trace.filter((t) => t.matched);
      assert.equal(fired.length, 1, `exactly one rule should fire for ${where}`);
      assert.equal(fired[0].ruleId, expected.ruleId, `ruleId for ${where}`);
      assert.equal(got.footprint, footprint, `footprint echoed for ${where}`);
      checked++;
    }
  }
  assert.equal(checked, 64);
});

test("no stage evidence short-circuits before every other rule", async () => {
  for (const footprint of FOOTPRINTS) {
    const got = classify({
      stages: [], stageEvidence: "none", footprint, propertyEvidence: "complete",
    });
    assert.equal(got.tier, null);
    assert.equal(got.status, "unclassified_no_stage_evidence");
    assert.equal(got.trace.length, 1, "guard 1 fires first and stops");
    assert.equal(got.trace[0].ruleId, "guard_no_stage_evidence");
  }
});

test("blank stages are not the same input as confirmed-no-stage", async () => {
  const unresearched = classify({
    stages: [], stageEvidence: "none", footprint: "canada_only", propertyEvidence: "complete",
  });
  const confirmed = classify({
    stages: [], stageEvidence: "complete", footprint: "canada_only", propertyEvidence: "complete",
  });
  assert.notEqual(unresearched.status, confirmed.status);
  assert.equal(unresearched.status, "unclassified_no_stage_evidence");
  assert.equal(confirmed.status, "unclassified_conflicting");
});

test("the three cases that diverge from the workbook", async () => {
  // Royalty with no properties: we say Tier 4 footprint none; workbook says
  // Tier 4 but calls the footprint Canada only. Same tier, different truth --
  // which is why this defect survives tier tests and reaches the dashboard.
  const royaltyNoProps = classify({
    stages: ["royalty_streaming"], stageEvidence: "complete",
    footprint: "none", propertyEvidence: "none",
  });
  assert.equal(royaltyNoProps.tier, 4);
  assert.equal(royaltyNoProps.footprint, "none");
  assert.equal(workbookTier(["royalty_streaming"], "none"), 4);

  // Production with no properties: we refuse to classify; workbook says Tier 2.
  const productionNoProps = classify({
    stages: ["production"], stageEvidence: "complete",
    footprint: "none", propertyEvidence: "none",
  });
  assert.equal(productionNoProps.tier, null);
  assert.equal(productionNoProps.status, "unclassified_no_property_evidence");
  assert.equal(workbookTier(["production"], "none"), 2);

  // No stage research: we say unclassified; workbook says Tier 4 for all 242.
  const noResearch = classify({
    stages: [], stageEvidence: "none", footprint: "canada_only", propertyEvidence: "complete",
  });
  assert.equal(noResearch.tier, null);
  assert.equal(workbookTier([], "canada_only"), 4);
});

test("tier agrees with the workbook everywhere evidence is complete and properties exist", async () => {
  for (const { stages } of subsets()) {
    for (const footprint of FOOTPRINTS) {
      if (footprint === "none") continue;      // the known divergence
      if (stages.length === 0) continue;        // the known divergence
      const got = classify({
        stages, stageEvidence: "complete", footprint, propertyEvidence: "complete",
      });
      assert.equal(got.tier, workbookTier(stages, footprint),
        `stages=${stages.join("+")} footprint=${footprint}`);
    }
  }
});

test("deriveFootprint emits the value the workbook never produces", async () => {
  assert.equal(deriveFootprint(true, true, "complete"), "canada_and_abroad");
  assert.equal(deriveFootprint(true, false, "complete"), "canada_only");
  assert.equal(deriveFootprint(false, true, "complete"), "abroad");
  // Both of these are "Canada only" in the workbook. Both are wrong there.
  assert.equal(deriveFootprint(false, false, "complete"), "none");
  assert.equal(deriveFootprint(false, false, "none"), "none");
  assert.equal(deriveFootprint(true, true, "none"), "none");
});
