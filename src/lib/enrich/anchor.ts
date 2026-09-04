/**
 * The grounding gate.
 *
 * A numeric fee must appear, after normalisation, in text the application
 * itself retrieved from a URL the application itself fetched. Failing that the
 * finding is created in a state that can never be bulk-accepted.
 *
 * "Verify the excerpt against the cached document" is under-specified in
 * exactly the ways real filings break it, so each hole has an explicit rule:
 *
 *   re-extraction drift  verify against the byte-identical stored artifact,
 *                        keyed by hash; never re-extract at verification time
 *   unicode              compare a normalised form on both sides, versioned
 *   tables               a fee and its label are rarely contiguous, so for
 *                        numerics drop contiguity and require a proximity
 *                        conjunction instead
 *   scale words          "$412" under an "in thousands" header is $412,000
 *   no text layer        a chars-per-page gate BEFORE the document is sent
 *   language             Quebec issuers file in French; labels are bilingual
 *
 * See docs/design/06-enrichment-pipeline.md.
 */

export const NORMALIZATION_VERSION = "1.0.0";

/** Below this, a PDF is scanned rather than text-bearing. */
export const MIN_CHARS_PER_PAGE = 100;

/** Normalised characters either side of a numeral in which the conjunction must sit. */
export const PROXIMITY_WINDOW = 400;

export type AnchorMode = "exact_normalized" | "proximity" | "label_only" | "none";
export type Scale = "units" | "thousands" | "millions";

export type StoredDocument = {
  contentHash: string;
  text: string;
  charCount?: number;
  pageCount?: number;
  charsPerPage?: number | null;
  scalePhrase?: string | null;
  hasTextLayer?: boolean;
  normalizationVersion?: string;
};

export type AnchorResult = {
  mode: AnchorMode;
  start: number | null;
  end: number | null;
  documentHash: string | null;
  /** Why it failed, when it did. Never a silent drop. */
  reason?: string;
  matched?: { numeral?: string; label?: string; year?: string };
};

const SCALE_MULTIPLIER: Record<Scale, number> = {
  units: 1, thousands: 1_000, millions: 1_000_000,
};

/** Ligatures and lookalikes that survive NFKC or that NFKC does not cover. */
const CHAR_FOLD: Array<[RegExp, string]> = [
  [/­/g, ""],                       // soft hyphen
  [/[​-‍﻿]/g, ""],        // zero-width
  [/[‐-―−]/g, "-"],       // dash variants, minus
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/…/g, "..."],
  [/[     ]/g, " "],  // nbsp and thin spaces
];

/** Versioned. Both sides of every comparison pass through this. */
export function normalize(text: string): string {
  let t = (text ?? "").normalize("NFKC");
  for (const [re, to] of CHAR_FOLD) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A numeral as it would appear in a document, reduced to its digits. */
export function normalizeNumeral(value: string | number): string {
  const raw = String(value);
  const cleaned = raw
    .replace(/[   ]/g, " ")
    .replace(/[$€£¥]/g, "")
    .replace(/[,\s](?=\d{3}\b)/g, "")   // thousands separators, comma or space
    .replace(/[()]/g, "")
    .trim();
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0].replace(/\.0+$/, "") : "";
}

const SCALE_PATTERNS: Array<[RegExp, Scale]> = [
  [/\bin\s+thousands\b|\(\s*000'?s?\s*\)|\ben\s+milliers\b|\bmilliers\s+de\b/i, "thousands"],
  [/\bin\s+millions\b|\(\s*millions?\s*\)|\ben\s+millions\b/i, "millions"],
];

/** The scale phrase in force in a document, or near a position within it. */
export function detectScale(text: string, near?: number): Scale | null {
  const haystack = near === undefined
    ? text
    : text.slice(Math.max(0, near - 3000), near + 200);
  for (const [re, scale] of SCALE_PATTERNS) if (re.test(haystack)) return scale;
  return null;
}

/**
 * Controlled bilingual label lists. Quebec issuers file in French, so an
 * English-only list silently fails on a real subset of the population.
 */
export const FIELD_LABELS: Record<string, string[]> = {
  audit_fee: [
    "audit fees", "audit fee", "audit service fees", "fees for audit services",
    "honoraires d'audit", "honoraires de verification", "honoraires de vérification",
    "frais d'audit", "honoraires pour services d'audit",
  ],
  tax_fee: [
    "tax fees", "tax fee", "tax services", "fees for tax services",
    "honoraires fiscaux", "honoraires pour services fiscaux",
    "frais fiscaux", "honoraires de services fiscaux",
  ],
  auditor: [
    "auditor", "independent auditor", "chartered professional accountants",
    "auditeur", "verificateur", "vérificateur", "auditeur independant",
  ],
};

export function hasTextLayer(doc: StoredDocument): boolean {
  if (doc.hasTextLayer === false) return false;
  const cpp = doc.charsPerPage
    ?? (doc.pageCount ? (doc.charCount ?? doc.text.length) / doc.pageCount : null);
  if (cpp === null || cpp === undefined) return (doc.text ?? "").trim().length > 0;
  return cpp >= MIN_CHARS_PER_PAGE;
}

/** Contiguous match of a model-authored excerpt. The strongest text anchor. */
export function anchorExcerpt(excerpt: string, doc: StoredDocument): AnchorResult {
  const needle = normalize(excerpt);
  if (!needle) {
    return { mode: "none", start: null, end: null, documentHash: doc.contentHash,
             reason: "empty excerpt" };
  }
  const hay = normalize(doc.text);
  const at = hay.indexOf(needle);
  if (at === -1) {
    return { mode: "none", start: null, end: null, documentHash: doc.contentHash,
             reason: "excerpt does not appear in the stored document" };
  }
  return { mode: "exact_normalized", start: at, end: at + needle.length,
           documentHash: doc.contentHash, matched: { numeral: undefined } };
}

export type NumericClaim = {
  /** The value as the finding asserts it, already in real units. */
  value: number;
  /** What the finding says the document's figure is expressed in. */
  scale: Scale;
  fiscalYear?: number | string | null;
  fieldKey: string;
};

/**
 * Proximity conjunction for numeric fields.
 *
 * A fee and its label are rarely contiguous in a table, so a contiguous excerpt
 * often does not exist as a substring at all. Require instead that the
 * normalised numeral, a label from the controlled list, and the fiscal year all
 * appear within one window -- and that the declared scale matches the scale
 * phrase actually in force at that point in the document.
 */
export function anchorNumeric(claim: NumericClaim, doc: StoredDocument): AnchorResult {
  const hay = normalize(doc.text);
  const labels = (FIELD_LABELS[claim.fieldKey] ?? []).map(normalize).filter(Boolean);

  // The figure as printed: the asserted value divided back down by its scale.
  const printed = claim.value / SCALE_MULTIPLIER[claim.scale];
  const asPrinted = normalizeNumeral(printed);
  const asFull = normalizeNumeral(claim.value);

  const candidates: Array<{ needle: string; scale: Scale }> = [
    { needle: asPrinted, scale: claim.scale },
    { needle: asFull, scale: "units" },
  ];

  let sawLabel = false;
  for (const { needle, scale } of candidates) {
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = indexOfNumeral(hay, needle, from);
      if (at === -1) break;
      from = at + 1;

      const lo = Math.max(0, at - PROXIMITY_WINDOW);
      const hi = Math.min(hay.length, at + needle.length + PROXIMITY_WINDOW);
      const window = hay.slice(lo, hi);

      const label = labels.find((l) => window.includes(l));
      if (label) sawLabel = true;
      const yearStr = claim.fiscalYear ? String(claim.fiscalYear).slice(0, 4) : null;
      const yearHit = !yearStr || window.includes(yearStr);

      // Scale is checked against the document, not taken on the model's word.
      // This alone prevents thousandfold errors.
      const docScale = detectScale(doc.text, at) ?? "units";
      if (docScale !== scale) {
        continue;
      }
      if (label && yearHit) {
        return {
          mode: "proximity", start: at, end: at + needle.length,
          documentHash: doc.contentHash,
          matched: { numeral: needle, label, year: yearStr ?? undefined },
        };
      }
    }
  }

  if (sawLabel || labels.some((l) => hay.includes(l))) {
    return { mode: "label_only", start: null, end: null, documentHash: doc.contentHash,
             reason: "the label appears but the figure does not, at the declared scale" };
  }
  return { mode: "none", start: null, end: null, documentHash: doc.contentHash,
           reason: "neither the figure nor a controlled label appears in the document" };
}

/** Match a numeral on token boundaries, so 412 does not match inside 1412000. */
function indexOfNumeral(hay: string, needle: string, from: number): number {
  let i = from;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at === -1) return -1;
    const before = at === 0 ? "" : hay[at - 1];
    const after = hay[at + needle.length] ?? "";
    const boundedBefore = !/[\d.]/.test(before);
    const boundedAfter = !/[\d]/.test(after);
    if (boundedBefore && boundedAfter) return at;
    i = at + 1;
  }
}

export type GateInput = {
  fieldKey: string;
  excerpt?: string | null;
  numeric?: NumericClaim | null;
  document: StoredDocument | null;
  sourceReachable?: boolean;
};

export type GateVerdict = {
  state: "proposed" | "anchor_mismatch" | "unsupported" | "no_text_layer" | "source_unreachable";
  anchor: AnchorResult;
  bulkAcceptable: boolean;
  reason?: string;
};

/**
 * The single decision point. Every failure is an explicit state; none is a
 * silent drop, and searched-and-found-nothing stays distinct from
 * source-unreachable, which stays distinct from never-attempted.
 */
export function gate(input: GateInput): GateVerdict {
  const none: AnchorResult = { mode: "none", start: null, end: null, documentHash: null };

  if (input.sourceReachable === false || input.document === null) {
    return { state: "source_unreachable", anchor: none, bulkAcceptable: false,
             reason: "the application could not fetch and store the document" };
  }
  const doc = input.document;
  if (!hasTextLayer(doc)) {
    return {
      state: "no_text_layer",
      anchor: { ...none, documentHash: doc.contentHash },
      bulkAcceptable: false,
      reason: `below ${MIN_CHARS_PER_PAGE} characters per page: scanned, not text-bearing`,
    };
  }

  const anchor = input.numeric
    ? anchorNumeric(input.numeric, doc)
    : anchorExcerpt(input.excerpt ?? "", doc);

  if (anchor.mode === "exact_normalized" || anchor.mode === "proximity") {
    return { state: "proposed", anchor, bulkAcceptable: true };
  }
  if (anchor.mode === "label_only") {
    // Plausible but unanchored. Quarantined, never bulk-acceptable, shown
    // beside the document so a human can adjudicate against the source.
    return { state: "anchor_mismatch", anchor, bulkAcceptable: false, reason: anchor.reason };
  }
  // Absent from the document. Never surfaced as a proposal; counted in the
  // per-run hallucination rate that gates publish.
  return { state: "unsupported", anchor, bulkAcceptable: false, reason: anchor.reason };
}
