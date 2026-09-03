/**
 * The tier rules are correct as written; the inputs are what need fixing.
 *
 * Appendix C's nested condition was verified formula-for-formula against three
 * separate workbook rows and is implemented unchanged. What differs is the
 * signature: stages is a set (blank must not read as false), evidence state is
 * an input (Unclassified is underivable from values alone), footprint has four
 * values, and the workbook's catch-all to Tier 4 is replaced.
 *
 * See docs/design/07-classification-engine.md.
 */

export const RULE_SET_VERSION = "1.0.0";

export type Stage = "exploration" | "development" | "production" | "royalty_streaming";
export type Evidence = "none" | "partial" | "complete";
export type Footprint = "canada_only" | "abroad" | "canada_and_abroad" | "none";

export type Status =
  | "classified"
  | "unclassified_no_stage_evidence"
  | "unclassified_no_property_evidence"
  | "unclassified_conflicting";

export type TraceStep = {
  ord: number;
  ruleId: string;
  inputs: Record<string, unknown>;
  matched: boolean;
};

export type Classification = {
  tier: 1 | 2 | 3 | 4 | 5 | 6 | null;
  status: Status;
  footprint: Footprint;
  trace: TraceStep[];
  ruleSetVersion: string;
};

export type ClassifyInput = {
  stages: ReadonlySet<Stage> | readonly Stage[];
  stageEvidence: Evidence;
  footprint: Footprint;
  propertyEvidence: Evidence;
};

/**
 * Derive footprint from the region columns.
 *
 * The last branch is the correction. The workbook's else-branch swallows both
 * "properties in Canada only" and "no properties at all", which is how ~$146bn
 * of market capitalisation is filed under a Canadian footprint it does not have.
 */
export function deriveFootprint(
  propsCanada: boolean,
  propsAbroad: boolean,
  propertyEvidence: Evidence,
): Footprint {
  if (propertyEvidence === "none") return "none";
  if (propsCanada && propsAbroad) return "canada_and_abroad";
  if (!propsCanada && propsAbroad) return "abroad";
  if (propsCanada && !propsAbroad) return "canada_only";
  return "none";
}

export function classify(input: ClassifyInput): Classification {
  const stages = new Set<Stage>(
    Array.isArray(input.stages) ? input.stages : Array.from(input.stages as ReadonlySet<Stage>),
  );
  const { stageEvidence, footprint, propertyEvidence } = input;
  const trace: TraceStep[] = [];
  let ord = 0;

  const step = (ruleId: string, inputs: Record<string, unknown>, matched: boolean) => {
    trace.push({ ord: ord++, ruleId, inputs, matched });
    return matched;
  };

  const done = (tier: Classification["tier"], status: Status): Classification => ({
    tier,
    status,
    footprint,
    trace,
    ruleSetVersion: RULE_SET_VERSION,
  });

  // Guard 1 -- no stage evidence at all. 242 of 259 companies today.
  if (step("guard_no_stage_evidence", { stageEvidence }, stageEvidence === "none")) {
    return done(null, "unclassified_no_stage_evidence");
  }

  // Guard 2 -- rules 1-3 require a footprint and none exists.
  const production = stages.has("production");
  if (
    step(
      "guard_no_property_evidence",
      { production, footprint, propertyEvidence },
      production && footprint === "none",
    )
  ) {
    return done(null, "unclassified_no_property_evidence");
  }

  // Appendix C, unchanged.
  if (step("rule_1_production_both", { production, footprint },
      production && footprint === "canada_and_abroad")) {
    return done(1, "classified");
  }
  if (step("rule_2_production_canada", { production, footprint },
      production && footprint === "canada_only")) {
    return done(2, "classified");
  }
  if (step("rule_3_production_abroad", { production, footprint },
      production && footprint === "abroad")) {
    return done(3, "classified");
  }

  // The royalty rule deliberately does not consult footprint: that is what lets
  // the twelve companies with no properties resolve honestly to Tier 4 with a
  // footprint of none, rather than being assigned a fabricated Canadian one.
  if (step("rule_4_royalty", { royalty: stages.has("royalty_streaming") },
      stages.has("royalty_streaming"))) {
    return done(4, "classified");
  }
  if (step("rule_5_development", { development: stages.has("development"), production },
      stages.has("development") && !production)) {
    return done(5, "classified");
  }
  if (step("rule_6_exploration",
      { exploration: stages.has("exploration"), development: stages.has("development"), production },
      stages.has("exploration") && !production && !stages.has("development"))) {
    return done(6, "classified");
  }

  // The workbook's catch-all returns 4. We do not.
  step("catch_all", { stages: Array.from(stages).sort() }, true);
  return done(null, "unclassified_conflicting");
}

/** Renderable at the edge; storage stays structured so migrations can diff it. */
export function renderTrace(c: Classification): string {
  const fired = c.trace.find((t) => t.matched);
  if (!fired) return "No rule fired";
  return `${c.tier === null ? c.status : `Tier ${c.tier}`} via ${fired.ruleId} (${JSON.stringify(fired.inputs)})`;
}
