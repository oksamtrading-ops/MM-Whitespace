/**
 * Evidence strength replaces model self-confidence.
 *
 * A model's self-reported float is not calibrated, is not comparable across
 * fields, drifts with every prompt change, and clusters -- most values land in
 * a narrow band with errors distributed indistinguishably among them. Since
 * bulk-accept keys off this number, an uncalibrated float would be the
 * highest-leverage control in the product backed by nothing measured.
 *
 * This is a versioned function of observable components instead. The model's
 * self-report is stored beside it and excluded from the threshold until it
 * demonstrably adds signal on the labelled set.
 */
import type { AnchorMode } from "./anchor.ts";

export const EVIDENCE_VERSION = "1.0.0";

export type EvidenceInput = {
  /** Computed from the resolved URL and document classification, never asked of the model. */
  sourceTier: 1 | 2 | 3 | 4 | 5;
  /** Age of the SOURCE DOCUMENT, not of the research. */
  documentAgeDays: number | null;
  /** The field's expected cadence in days. */
  expectedCadenceDays: number;
  anchorMode: AnchorMode;
  /** Independent T1-T2 sources agreeing. Decisive for stage. */
  corroboratingSources: number;
  /** Two independent passes agreeing, on a sample. Null when not sampled. */
  extractionAgreement: boolean | null;
};

export type EvidenceScore = {
  strength: number;
  version: string;
  components: Record<string, number>;
};

const WEIGHTS = {
  sourceTier: 0.30,
  recency: 0.15,
  anchor: 0.35,
  corroboration: 0.15,
  agreement: 0.05,
} as const;

const TIER_SCORE: Record<number, number> = { 1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25, 5: 0.1 };
const ANCHOR_SCORE: Record<AnchorMode, number> = {
  exact_normalized: 1.0, proximity: 0.85, label_only: 0.25, none: 0,
};

export function evidenceStrength(input: EvidenceInput): EvidenceScore {
  const tier = TIER_SCORE[input.sourceTier] ?? 0;

  // A document at exactly its expected cadence scores 0.5; fresher rises,
  // staler falls, and nothing below zero.
  const recency = input.documentAgeDays === null
    ? 0.4
    : clamp(1 - input.documentAgeDays / (2 * input.expectedCadenceDays));

  const anchor = ANCHOR_SCORE[input.anchorMode];

  // One press release is weak; a filing plus a production disclosure is strong.
  const corroboration = clamp(input.corroboratingSources / 3);

  const agreement = input.extractionAgreement === null
    ? 0.5
    : (input.extractionAgreement ? 1 : 0);

  const components = { tier, recency, anchor, corroboration, agreement };
  const strength =
    tier * WEIGHTS.sourceTier +
    recency * WEIGHTS.recency +
    anchor * WEIGHTS.anchor +
    corroboration * WEIGHTS.corroboration +
    agreement * WEIGHTS.agreement;

  return { strength: round3(clamp(strength)), version: EVIDENCE_VERSION, components };
}

/**
 * Thresholds are calibrated so a level corresponds to a MEASURED precision, and
 * the calibration run is recorded beside the threshold so a prompt or model
 * change forces re-calibration rather than silently invalidating it.
 */
export type Threshold = {
  field: string;
  minStrength: number;
  calibrationRunId: string | null;
  measuredPrecision: number | null;
};

export function bulkAcceptable(score: EvidenceScore, threshold: Threshold,
                               anchorMode: AnchorMode): boolean {
  // An unanchored finding is never bulk-acceptable regardless of its score.
  if (anchorMode === "none" || anchorMode === "label_only") return false;
  // An uncalibrated threshold does not authorise bulk accept.
  if (threshold.calibrationRunId === null) return false;
  return score.strength >= threshold.minStrength;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
