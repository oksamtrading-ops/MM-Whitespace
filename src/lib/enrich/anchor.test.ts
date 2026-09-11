import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorNumeric, detectScale, gate, hasTextLayer, normalize, normalizeNumeral,
  type StoredDocument,
} from "./anchor.ts";

/** A fee table as filings actually print one: label and figure not contiguous. */
const FEE_TABLE = `
Independent Auditor's Fees

The following table sets out the fees billed by the auditor for the years
indicated. All amounts are expressed in thousands of Canadian dollars.

                                        2025          2024
Audit fees                               412           388
Audit-related fees                        45            41
Tax fees                                 118           102
All other fees                             -             7
Total                                    575           538
`;

/** A document that never mentions fees at all. */
const PRESS_RELEASE = `
Northco Mining Corp. Announces Assay Results from the Kirkland Property

TORONTO, 12 March 2025 -- Northco Mining Corp. today announced results from the
2024 winter drilling programme at its wholly owned Kirkland property in northern
Ontario. Hole KL-24-118 returned 4.2 grams per tonne gold over 18.5 metres,
including 11.6 grams per tonne over 3.1 metres. The programme comprised 42 holes
totalling 11,400 metres and was completed on schedule.

The Company intends to expand the programme in 2025 and has engaged a consulting
group to prepare an updated mineral resource estimate. Metallurgical testwork is
ongoing. The Company had 160,963,905 common shares outstanding at year end.

This release contains forward-looking information within the meaning of
applicable securities legislation. Readers are cautioned not to place undue
reliance on such statements.
`;

const doc = (text: string, over: Partial<StoredDocument> = {}): StoredDocument => ({
  contentHash: "sha256:abc", text, pageCount: 3,
  charCount: text.length, charsPerPage: text.length / 3,
  hasTextLayer: true, ...over,
});

test("normalisation folds the unicode that real filings carry", async () => {
  assert.equal(normalize("Audit fees"), "audit fees");          // nbsp
  assert.equal(normalize("veriﬁcation"), "verification");        // fi ligature
  assert.equal(normalize("soft­hyphen"), "softhyphen");
  assert.equal(normalize("2024–2025"), "2024-2025");             // en dash
  assert.equal(normalize("  Audit   Fees  "), "audit fees");
});

test("numerals reduce to digits regardless of separator", async () => {
  assert.equal(normalizeNumeral("$1,234,567"), "1234567");
  assert.equal(normalizeNumeral("1 234 567"), "1234567");             // French spacing
  assert.equal(normalizeNumeral("1 234 567"), "1234567");   // nbsp separator
  assert.equal(normalizeNumeral("(412)"), "412");
  assert.equal(normalizeNumeral(412000), "412000");
});

test("a fee whose label and figure are not contiguous still anchors", async () => {
  // 412 sits in a table cell; "Audit fees" is at the start of the row. No
  // contiguous excerpt containing both exists, so exact matching cannot work.
  const r = anchorNumeric(
    { value: 412_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" },
    doc(FEE_TABLE));
  assert.equal(r.mode, "proximity");
  assert.equal(r.matched?.numeral, "412");
  assert.equal(r.matched?.label, "audit fees");
  assert.equal(r.matched?.year, "2025");
});

test("the scale word prevents a thousandfold error", async () => {
  // The document says thousands. A finding claiming $412 in units is wrong by
  // three orders of magnitude, and the figure 412 IS present -- so only the
  // scale check can catch it.
  const wrong = gate({
    fieldKey: "audit_fee",
    numeric: { value: 412, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee" },
    document: doc(FEE_TABLE),
  });
  assert.notEqual(wrong.state, "proposed");
  assert.equal(wrong.anchor.mode, "label_only");
  assert.equal(wrong.bulkAcceptable, false);

  const right = gate({
    fieldKey: "audit_fee",
    numeric: { value: 412_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" },
    document: doc(FEE_TABLE),
  });
  assert.equal(right.state, "proposed");
});

test("detectScale reads the phrase in force", async () => {
  assert.equal(detectScale("amounts in thousands of dollars"), "thousands");
  assert.equal(detectScale("expressed in millions"), "millions");
  assert.equal(detectScale("(000s)"), "thousands");
  assert.equal(detectScale("les montants sont en milliers de dollars"), "thousands");
  assert.equal(detectScale("a plain sentence with no scale"), null);
});

test("a French filing anchors on the French label", async () => {
  const french = `
Honoraires du vérificateur indépendant
Les montants sont exprimés en milliers de dollars canadiens.
                                        2025          2024
Honoraires d'audit                       412           388
Honoraires fiscaux                       118           102
`;
  const r = anchorNumeric(
    { value: 412_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" },
    doc(french));
  assert.equal(r.mode, "proximity", "a Quebec issuer must not fail for want of an English label");
  assert.equal(r.matched?.label, "honoraires d'audit");
});

test("THE PLANTED FABRICATED FEE IS REJECTED", async () => {
  // The failure this system exists to prevent: a plausible, well-formed,
  // confidently-stated audit fee that appears nowhere in the document.
  const fabricated = gate({
    fieldKey: "audit_fee",
    numeric: { value: 750_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" },
    document: doc(FEE_TABLE),
  });
  assert.equal(fabricated.state, "anchor_mismatch");
  assert.equal(fabricated.bulkAcceptable, false,
    "an unanchored fee must never be bulk-acceptable");
  assert.match(fabricated.reason ?? "", /the figure does not/);

  // And a fee for a field the document never discusses at all is unsupported,
  // which is a different state and is counted in the hallucination rate.
  const unrelated = gate({
    fieldKey: "audit_fee",
    numeric: { value: 999_999, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee" },
    document: doc(PRESS_RELEASE),
  });
  assert.equal(unrelated.state, "unsupported",
    "a document that never discusses fees yields unsupported, not anchor_mismatch");
});

test("a numeral does not match inside a larger number", async () => {
  const d = doc(`All amounts in thousands.
Audit fees for 2025 were 1412000 in aggregate across the group.`);
  const r = anchorNumeric(
    { value: 412_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" }, d);
  assert.notEqual(r.mode, "proximity", "412 must not match inside 1412000");
});

test("a scanned filing is its own state, not a rejection", async () => {
  // No stored verdict, so characters per page decide.
  const scanned = doc("  \n \n ", { pageCount: 40, charCount: 6, charsPerPage: 0.15, hasTextLayer: undefined });
  assert.equal(hasTextLayer(scanned), false);
  // And a fetcher's verdict stands: it knows a short web page from a scanned PDF.
  assert.equal(hasTextLayer(doc("Northco", { charsPerPage: 7, hasTextLayer: true })), true);
  assert.equal(hasTextLayer(doc("x".repeat(500), { hasTextLayer: false })), false);
  const v = gate({ fieldKey: "audit_fee", excerpt: "anything", document: scanned });
  assert.equal(v.state, "no_text_layer");
  assert.equal(v.bulkAcceptable, false);
});

test("searched-and-found-nothing is not source-unreachable", async () => {
  const unreachable = gate({ fieldKey: "audit_fee", excerpt: "x", document: null });
  assert.equal(unreachable.state, "source_unreachable");

  const searched = gate({
    fieldKey: "audit_fee", excerpt: "a fee of one million dollars",
    document: doc(FEE_TABLE),
  });
  assert.equal(searched.state, "unsupported");
  assert.notEqual(unreachable.state, searched.state,
    "the workbook loses this distinction; the pipeline must keep it");
});

test("a contiguous excerpt anchors exactly and reports its span", async () => {
  const d = doc(FEE_TABLE);
  const v = gate({
    fieldKey: "auditor",
    excerpt: "All amounts are expressed in thousands of Canadian dollars.",
    document: d,
  });
  assert.equal(v.state, "proposed");
  assert.equal(v.anchor.mode, "exact_normalized");
  assert.equal(v.anchor.documentHash, "sha256:abc");
  assert.ok((v.anchor.start ?? -1) >= 0);
  assert.ok((v.anchor.end ?? 0) > (v.anchor.start ?? 0));
});

test("the anchor always names the document it was verified against", async () => {
  // Verification is against the byte-identical stored artifact, keyed by hash.
  // Re-extracting at verification time is what rejects correct findings when
  // column order drifts.
  const v = gate({
    fieldKey: "audit_fee",
    numeric: { value: 118_000, scale: "thousands", fiscalYear: 2025, fieldKey: "tax_fee" },
    document: doc(FEE_TABLE, { contentHash: "sha256:zzz" }),
  });
  assert.equal(v.anchor.documentHash, "sha256:zzz");
});
