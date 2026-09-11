import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorNumeric, detectCurrency, detectScale, gate, hasTextLayer, normalize, normalizeNumeral,
  numericHaystack, type StoredDocument,
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

// --- Run 1, 11 September 2026: every fee held --------------------------------
// The passages below are the real text the application fetched, from the
// issuers' own filings, trimmed to the fee disclosure. Each was held as
// anchor_mismatch in production; the first three are correct and must anchor.

const ZW = "\u200B";  // the zero-width spaces Agnico's HTML puts between cells

/** Agnico Eagle, 2025 AIF: a table headed "(C$ thousands)". */
const AGNICO = `External Auditor Service Fees Ernst & Young LLP has served as the Company’s independent public auditor for each of the fiscal years ended December 31, 2025 and 2024. Fees paid to Ernst & Young LLP in 2025 and 2024 are set out below. ${ZW} ${ZW} ${ZW} ${ZW} Year Ended December 31 ${ZW} ${ZW} ${ZW} ${ZW} ${ZW} 2025 ${ZW} ${ZW} 2024 ${ZW} ${ZW} ${ZW} ${ZW} ${ZW} (C$ thousands) ${ZW} ${ZW} Audit fees ${ZW} ${ZW} ${ZW} ${ZW} 8,052 ${ZW} ${ZW} ${ZW} ${ZW} ${ZW} 9,088 ${ZW} ${ZW} ${ZW} Audit-related fees (1) ${ZW} ${ZW} 421 ${ZW} 154 Tax fees (2) ${ZW} ${ZW} ${ZW} ${ZW} 382 ${ZW} ${ZW} ${ZW} ${ZW} ${ZW} 915`;

/** Elemental Altus, 2025 40-F: the fee in a sentence, in dollars. */
const ELEMENTAL = "fees billed to the Registrant for professional services rendered by PwC and its affiliates during the fiscal years ended December 31, 2025 and 2024, respectively, are detailed below. Audit Fees PWC’s agreed upon fees for audit services for the fiscal years ended December 31, 2025 and December 31, 2024 were US$517,116 and US$212,082, respectively. Audit-Related Fees PwC’s fees incurred";

/** Nouveau Monde, 2024 AIF (the PDF's text layer): years across, dollars. */
const NOUVEAU_MONDE = `EXTERNAL AUDITOR SERVICE FEES
The following table sets out the service fees invoiced by PricewaterhouseCoopers LLP (“PwC”) for the fiscal
years ended December 31, 2023 and December 31, 2024:
2023 2024
Audit Fees(1) $387,566 $353,190
Audit-Related Fees(2) $6,691 $5,979
Tax Fees(3) - -
All Other Fees(4) $90,785 $1,440
Total $485,042 $360,608`;

/** Wesdome: a footnote marker fused onto each figure by the text layer. */
const WESDOME = `Audit Fees Audit-Related Fees Tax Fees All Other Fees Total
December 31, 2025 $610,6283 $49,8344 - $450,000 $1,110,462`;

test("Run 1: a fee under \"(C$ thousands)\" anchors at that scale", async () => {
  assert.equal(detectScale(AGNICO), "thousands");
  const audit = anchorNumeric(
    { value: 8_052_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" }, doc(AGNICO));
  assert.equal(audit.mode, "proximity", audit.reason ?? "");
  assert.equal(audit.matched?.numeral, "8052");
  const tax = anchorNumeric(
    { value: 382_000, scale: "thousands", fiscalYear: 2025, fieldKey: "tax_fee" }, doc(AGNICO));
  assert.equal(tax.mode, "proximity", tax.reason ?? "");

  // And the thousandfold misreading is still refused: $8,052 in units is wrong.
  const units = anchorNumeric(
    { value: 8_052, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee" }, doc(AGNICO));
  assert.equal(units.mode, "label_only");
});

test("Run 1: a comma-grouped fee in a sentence anchors", async () => {
  // The needle was reduced to 517116 and the document kept 517,116, so no fee
  // of 1,000 or more printed with a separator could ever be found.
  const r = anchorNumeric(
    { value: 517_116, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee" }, doc(ELEMENTAL));
  assert.equal(r.mode, "proximity", r.reason ?? "");
  assert.ok(["audit fees", "fees for audit services"].includes(r.matched?.label ?? ""));
});

test("Run 1: a fee in a PDF table in dollars anchors, and a fabricated one does not", async () => {
  const right = gate({
    fieldKey: "audit_fee",
    numeric: { value: 353_190, scale: "units", fiscalYear: 2024, fieldKey: "audit_fee" },
    document: doc(NOUVEAU_MONDE),
  });
  assert.equal(right.state, "proposed", right.reason ?? "");
  // A plausible fee nowhere in the table is still held.
  const invented = gate({
    fieldKey: "audit_fee",
    numeric: { value: 353_910, scale: "units", fiscalYear: 2024, fieldKey: "audit_fee" },
    document: doc(NOUVEAU_MONDE),
  });
  assert.equal(invented.state, "anchor_mismatch");
});

test("Run 1: a figure with a footnote fused onto it is still not proof", async () => {
  // "$610,6283" is $610,628 and footnote 3 -- but it might as well be 6,106,283.
  // The gate cannot tell, so a person must: held, not proposed.
  const r = anchorNumeric(
    { value: 610_628, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee" }, doc(WESDOME));
  assert.notEqual(r.mode, "proximity");
});

test("digit grouping: separators come out, adjacent cells stay apart", async () => {
  const d = (t: string) => doc(`Audit fees for 2025 (in thousands) ${t}`);
  const claim = { value: 1_234_000, scale: "thousands" as const, fiscalYear: 2025, fieldKey: "audit_fee" };
  assert.equal(anchorNumeric(claim, d("1,234")).mode, "proximity");
  assert.equal(anchorNumeric(claim, d("1\u00A0234")).mode, "proximity", "French grouping, no-break space");
  assert.equal(anchorNumeric(claim, d("1\u202F234")).mode, "proximity", "narrow no-break space");
  // Two table cells separated by an ordinary space are two numbers.
  assert.notEqual(anchorNumeric(claim, d("1 234")).mode, "proximity");
  // A decimal is not a grouping: 1,234.5 thousands is not 1,234 thousands.
  assert.notEqual(anchorNumeric(claim, d("1,234.5")).mode, "proximity");
});

test("detectScale reads currency-prefixed and long-form headings, not other quantities", async () => {
  for (const s of ["(C$ thousands)", "(US$ thousands)", "($ thousands)", "(in thousands of US dollars)",
                   "(thousands of Canadian dollars)", "(thousands, except per share amounts)",
                   "expressed in thousands of Canadian dollars", "(C$000s)", "$000s"]) {
    assert.equal(detectScale(s), "thousands", s);
  }
  for (const s of ["(C$ millions)", "(US$ millions, except where noted)", "millions of US dollars"]) {
    assert.equal(detectScale(s), "millions", s);
  }
  for (const s of ["(thousands of ounces)", "thousands of hectares of claims", "(millions of tonnes)"]) {
    assert.equal(detectScale(s), null, s);
  }
});

test("detectScale at a position takes the heading nearest above it", async () => {
  const text = `Revenue (in millions) 1,200 ... Fees paid to the auditor (C$ thousands) Audit fees 8,052`;
  assert.equal(detectScale(text, text.indexOf("8,052")), "thousands");
  assert.equal(detectScale(text, text.indexOf("1,200")), "millions");
});

// --- Run 1: Radisson published as a royalty company ---------------------------

const RADISSON = "The O’Brien Gold Project is an exploration and development project centred on the historic O’Brien Gold Mine located in the Abitibi region of Québec on the prolific Larder Lake-Cadillac Break (“LLCB”).";

test("a stage whose quote does not name the deciding stage is held, not proposed", async () => {
  const stageGate = (stage: Record<string, boolean | null>, excerpt: string) =>
    gate({ fieldKey: "stage_evidence_state", excerpt, stage, document: doc(excerpt) });

  // What the model proposed for Radisson: royalty true on a quote about exploration and development.
  const radisson = stageGate({ exploration: true, development: true, production: false, royalty_streaming: true }, RADISSON);
  assert.equal(radisson.state, "anchor_mismatch");
  assert.equal(radisson.bulkAcceptable, false);
  assert.match(radisson.reason ?? "", /royalty or stream, the stage that decides the tier/);

  // Without the royalty flag the same quote supports development, which then decides.
  assert.equal(stageGate({ exploration: true, development: true, production: false, royalty_streaming: false }, RADISSON).state,
               "proposed");
  // The other four of Run 1, as accepted: each quote names its deciding stage.
  assert.equal(stageGate({ production: true, development: true, exploration: true, royalty_streaming: true },
    "In 2025, the Company had payable gold production of 3,447,367 ounces of gold").state, "proposed",
    "a producer's quote about production need not also mention the rest");
  assert.equal(stageGate({ production: true, development: false, exploration: true, royalty_streaming: false },
    "Wesdome is a Canadian-focused gold producer with two high-grade underground mine and milling assets").state, "proposed");
  assert.equal(stageGate({ production: false, development: true, exploration: true, royalty_streaming: false },
    "The Company specializes in exploration, evaluation and development of mineral properties located in Québec").state, "proposed");
  assert.equal(stageGate({ production: null, development: null, exploration: null, royalty_streaming: true },
    "ELEMENTAL ROYALTY CORPORATION").state, "proposed");
  // French filings name stages in French.
  assert.equal(stageGate({ production: false, development: true, exploration: true, royalty_streaming: false },
    "La Société se consacre à la mise en valeur de ses propriétés au Québec").state, "proposed");
});

test("a fee claimed in a currency the document contradicts is held; a bare $ decides nothing", async () => {
  const usd = anchorNumeric({ value: 517_116, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee", currency: "USD" },
                            doc(ELEMENTAL));
  assert.equal(usd.mode, "proximity", usd.reason ?? "");
  assert.equal(usd.matched?.currency, "USD");
  const cad = anchorNumeric({ value: 517_116, scale: "units", fiscalYear: 2025, fieldKey: "audit_fee", currency: "CAD" },
                            doc(ELEMENTAL));
  assert.equal(cad.mode, "label_only");
  assert.match(cad.reason ?? "", /in USD where it appears, not CAD/);

  // Agnico's heading says C$; the model saying CAD agrees.
  assert.equal(anchorNumeric({ value: 8_052_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee",
                               currency: "CAD" }, doc(AGNICO)).mode, "proximity");
  // Nouveau Monde prints only "$": nothing to contradict the model's CAD.
  assert.equal(anchorNumeric({ value: 353_190, scale: "units", fiscalYear: 2024, fieldKey: "audit_fee",
                               currency: "CAD" }, doc(NOUVEAU_MONDE)).mode, "proximity");
});

test("currency comes from the figure's prefix or a heading, never from a mention nearby", async () => {
  const at = (text: string, figure: string) => {
    const hay = numericHaystack(text);
    return detectCurrency(hay, hay.indexOf(figure));
  };
  assert.equal(at("Gold averaged US$2,000 an ounce. Audit Fees(1) $387,566 $353,190", "353190"), null);
  assert.equal(at("All amounts are expressed in Canadian dollars. Audit fees $412,000", "412000"), "CAD");
  assert.equal(at("(in thousands of U.S. dollars) Audit fees 412", "412"), "USD");
  assert.equal(at("Audit fees C$ 1,200", "1200"), "CAD");
});
