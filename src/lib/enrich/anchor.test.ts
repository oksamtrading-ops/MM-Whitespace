import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorNumeric, currenciesMentioned, detectCurrency, detectScale, gate, hasTextLayer, normalize,
  normalizeNumeral, numericHaystack, type StoredDocument,
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
  // Elemental's 40-F names US dollars and never Canadian ones, so the broader
  // check answers first; both readings say the same thing.
  assert.match(cad.reason ?? "", /never mentions CAD|in USD where it appears, not CAD/);

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

// --- Run 2, 13 September 2026 -------------------------------------------------

test("a fee in a currency the document never names is held, whatever the digits say", async () => {
  // Barrick: the circular's table reads "$10.3" in millions and talks about US
  // dollars throughout; the model proposed Australian dollars. The amount, the
  // label and the year all line up, so only the currency can catch it.
  const barrick = doc("Audit and other fees (in millions of US dollars) for the years ended " +
                      "December 31, 2025 and 2024 Audit fees(2) $10.3 $9.7");
  const claim = { value: 10_300_000, scale: "millions" as const, fiscalYear: 2025, fieldKey: "audit_fee" };
  const aud = anchorNumeric({ ...claim, currency: "AUD" }, barrick);
  assert.equal(aud.mode, "label_only");
  assert.match(aud.reason ?? "", /never mentions AUD; it states amounts in USD/);
  assert.equal(anchorNumeric({ ...claim, currency: "USD" }, barrick).mode, "proximity",
               "the same figure in the currency the document states anchors");

  // A filing that names no currency at all says nothing either way, so the
  // model's reading stands rather than everything being held.
  const silent = doc("Audit fees for the year ended December 31, 2025 (in millions) $10.3");
  assert.equal(anchorNumeric({ ...claim, currency: "CAD" }, silent).mode, "proximity");
  assert.deepEqual(currenciesMentioned(numericHaystack(silent.text)), []);
});

test("the labels real filings actually use", async () => {
  // Run 2 threw away Teck's and Pan American's fees over the wording of a row.
  const teck = doc("EXTERNAL AUDITOR SERVICE FEES Year Ended 2025 ($000) Year Ended 2024 ($000) " +
                   "Audit Services (1) 6,526 7,955");
  assert.equal(anchorNumeric(
    { value: 6_526_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_fee" }, teck).mode,
    "proximity");

  const panAmerican = doc("Fees billed by the auditor for the year ended December 31, 2024, in " +
                          "United States dollars. Tax-Related Fees (4) 5,100 3,300");
  assert.equal(anchorNumeric(
    { value: 5_100, scale: "units", fiscalYear: 2024, fieldKey: "tax_fee", currency: "USD" },
    panAmerican).mode, "proximity");

  const barrickTax = doc("Fees in millions of US dollars. Tax compliance and advisory fees(4) $0.2 $0.2 " +
                         "for the year ended December 31, 2025");
  assert.equal(anchorNumeric(
    { value: 200_000, scale: "millions", fiscalYear: 2025, fieldKey: "tax_fee", currency: "USD" },
    barrickTax).mode, "proximity");
});

/** A mid-tier producer's statements, as they are printed: a loss in brackets. */
const STATEMENTS = `
CONSOLIDATED STATEMENTS OF LOSS AND COMPREHENSIVE LOSS
(Expressed in thousands of United States dollars)
                                          2025          2024
Revenue                                 84,512        61,230
Cost of sales                          (70,118)      (55,904)
Net loss for the year                  (12,345)       (8,901)

CONSOLIDATED STATEMENTS OF FINANCIAL POSITION
                                          2025          2024
Total assets                           512,870       498,112
`;

test("the other two fee lines anchor in the same table as audit and tax", async () => {
  const related = anchorNumeric(
    { value: 45_000, scale: "thousands", fiscalYear: 2025, fieldKey: "audit_related_fee", currency: "CAD" },
    doc(FEE_TABLE));
  assert.equal(related.mode, "proximity");
  assert.equal(related.matched?.label, "audit-related fees");
  // "All other fees -" is nil: no figure to find, so it is held for a person, as a nil tax fee is.
  const nil = gate({ fieldKey: "other_fee", numeric: { value: 0, scale: "thousands", fiscalYear: 2025,
                     fieldKey: "other_fee" }, document: doc(FEE_TABLE) });
  assert.equal(nil.state, "anchor_mismatch");
});

test("revenue, a net loss and total assets anchor in the statements, at their scale and currency", async () => {
  const at = (fieldKey: string, value: number, currency = "USD") =>
    anchorNumeric({ value, scale: "thousands", fiscalYear: 2025, fieldKey, currency }, doc(STATEMENTS));
  assert.equal(at("total_revenue", 84_512_000).mode, "proximity");
  // A loss is stored negative; the gate is given the figure as printed.
  assert.equal(at("net_income", 12_345_000).mode, "proximity");
  assert.equal(at("net_income", 12_345_000).matched?.label, "net loss");
  assert.equal(at("total_assets", 512_870_000).mode, "proximity");
  assert.equal(at("total_assets", 512_870_000, "CAD").mode, "label_only",
               "claimed in Canadian dollars where the statements are in US dollars");
  assert.equal(at("total_assets", 512_870).mode, "label_only", "a thousandfold error is still caught");
});

/*
 * Q4 2026, 1 November: 145 of 5,522 findings unsupported, 2.63% against the
 * 2.0% ceiling on publish. Most were quotes that ARE in their document, but
 * not character for character. Unsupported counts as invented; these are held.
 */
const CIRCULAR = `
Appointment of Auditor. Brightwater & Company LLP, Chartered Professional
Accountants, is the current auditor of the Company, and was first appointed as
auditor of the Company on May 14, 2019. KPMG LLP, the Company’s former auditor,
resigned effective August 8, 2018. The Board re-appointed the auditor for the
2025-2026 financial year.

INDEPENDENT AUDITOR’S REPORT
To the Shareholders of Northco Mining Corp.
`;

test("Q4 2026: a quote in its document, but not exactly as given, is held -- not counted as invented", async () => {
  for (const excerpt of [
    "The Board re-appointed the auditor for the 2025 2026 financial year",   // a dropped dash
    "KPMG LLP, the Company\\\"s former auditor, resigned",                     // an apostrophe written \"
    "Brightwater & Company LLP, Chartered Professional\\nAccountants, is the current auditor", // a line break written \n
  ]) {
    const v = gate({ fieldKey: "auditor", excerpt, document: doc(CIRCULAR) });
    assert.equal(v.state, "anchor_mismatch", excerpt);
    assert.equal(v.anchor.mode, "none", "nothing here anchors; the grid still says so");
    assert.equal(v.anchor.inexact, "punctuation");
    assert.equal(v.bulkAcceptable, false);
  }
  const v = gate({ fieldKey: "auditor", excerpt: "KPMG LLP, the Company\\\"s former auditor", document: doc(CIRCULAR) });
  assert.equal(normalize(CIRCULAR).slice(v.anchor.start!, v.anchor.end!), "kpmg llp, the company's former auditor",
               "its span is in the normalised text, as an exact match's is");
});

test("Q4 2026: a quote stitched with \"...\" is held when every passage is in the document", async () => {
  const stitched = gate({ fieldKey: "auditor", document: doc(CIRCULAR),
    excerpt: "Brightwater & Company LLP ... INDEPENDENT AUDITOR’S REPORT To the Shareholders of Northco Mining Corp." });
  assert.equal(stitched.state, "anchor_mismatch");
  assert.equal(stitched.anchor.inexact, "stitched");
  const unspaced = gate({ fieldKey: "auditor", document: doc(CIRCULAR),
    excerpt: "the current auditor of the Company...first appointed as auditor of the Company on May 14, 2019" });
  assert.equal(unspaced.anchor.inexact, "stitched");

  const oneInvented = gate({ fieldKey: "auditor", document: doc(CIRCULAR),
    excerpt: "Brightwater & Company LLP ... the engagement partner is Jane Q. Example" });
  assert.equal(oneInvented.state, "unsupported", "every passage, not most of them");
});

test("Q4 2026: an invented quote, or one too short to prove anything, is still unsupported", async () => {
  // The partner named in the finding appears nowhere in the company's filings.
  const invented = gate({ fieldKey: "auditor", document: doc(CIRCULAR),
    excerpt: "The engagement partner on the audit resulting in this report is Jane Q. Example." });
  assert.equal(invented.state, "unsupported");
  // Ten letters: "Northco-Mining" would be found in half the filings stored.
  const short = gate({ fieldKey: "auditor", excerpt: "Northco-Mining", document: doc(CIRCULAR) });
  assert.equal(short.state, "unsupported");
});

/** A statement of financial position whose total rows carry no words. */
const POSITION = `
CONSOLIDATED STATEMENTS OF FINANCIAL POSITION
(Expressed in Canadian dollars)
                              2023            2022
Cash                     1,204,551       2,330,118
Receivables                 84,210          61,904
Mineral properties      13,688,599      11,412,007
                        14,977,360      13,804,029
Accounts payable           402,113         388,021
`;

test("Q4 2026: a total row with no label is held, at its declared scale and currency", async () => {
  const claim = (value: number, currency = "CAD") => gate({ fieldKey: "total_assets", document: doc(POSITION),
    numeric: { value, scale: "units", fiscalYear: 2023, fieldKey: "total_assets", currency } });
  const total = claim(14_977_360);
  assert.equal(total.state, "anchor_mismatch");
  assert.equal(total.anchor.inexact, "unlabelled");
  assert.equal(claim(14_977_630).state, "unsupported", "a figure that is not there");
  assert.equal(claim(14_977_360, "USD").state, "unsupported", "nor one in a currency the document never names");
  assert.equal(claim(2_022).state, "unsupported", "a column's year is not a find");
});

test("Q4 2026: a figure in a quote that is in the document is held, even at a scale not confirmed", async () => {
  const inThousands = `(in thousands of Canadian dollars)
                          2023        2022
Mineral properties      13,689      11,412
Total                   14,977      13,804`;
  // Read as units under a thousands heading: the thousandfold error the gate
  // exists to stop. It is not proposed; it is put in front of a person.
  const held = gate({ fieldKey: "total_assets", document: doc(inThousands), excerpt: "Total 14,977 13,804",
    numeric: { value: 14_977, scale: "units", fiscalYear: 2023, fieldKey: "total_assets", currency: "CAD" } });
  assert.equal(held.state, "anchor_mismatch");
  assert.equal(held.anchor.inexact, "quoted");
  assert.equal(held.bulkAcceptable, false);

  const notInQuote = gate({ fieldKey: "total_assets", document: doc(inThousands), excerpt: "Total 14,977 13,804",
    numeric: { value: 15_977, scale: "units", fiscalYear: 2023, fieldKey: "total_assets", currency: "CAD" } });
  assert.equal(notInQuote.state, "unsupported", "the quote is real, but it does not carry the figure");
});

/** A venture issuer's fee table, as Q4 2026's circulars print a fee nobody was billed. */
const NIL_TABLE = `
External Auditor Service Fees

Financial Year Ending      Audit Fees   Audit Related Fees   Tax Fees(3)   All Other Fees
December 31, 2025          $145,450     Nil                  Nil.          $18,000
December 31, 2024          $120,000     Nil                  Nil.          Nil
`;

test("a fee of nil anchors on the row that prints it, not on a figure", async () => {
  // Q4 2026: "Tax fees Nil Nil", "Tax Fees $- $-", "Tax fees (3) - -" and
  // "Tax Fees $nil $nil" were all held as label-only, for want of a "0".
  for (const row of ["Tax fees Nil Nil", "Tax Fees $- $-", "Tax fees (3) - -", "Tax Fees $nil $nil",
                     "Tax Fees(3) Nil. Nil.", "Tax fees: – –", "Honoraires fiscaux néant néant"]) {
    const text = `Fiscal year ended December 31, 2025 and 2024\nAudit fees $62,000 $58,000\n${row}\n`;
    const r = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" }, doc(text));
    assert.equal(r.mode, "proximity", row);
  }
  // A table laid out by column puts the label in its header, not on a row of
  // cells: which nil is the tax fee is the layout's to say, so a person reads it.
  // Laid out by column, the fee's column is its place in the table's header.
  const byColumn = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" }, doc(NIL_TABLE));
  assert.equal(byColumn.mode, "proximity");
  assert.equal(byColumn.matched?.label, "tax fees");
  // Through the gate, a nil row is a proposal like any anchored figure.
  const g = gate({ fieldKey: "audit_related_fee", document: doc("For the years ended 2025 and 2024: Audit-related fees Nil Nil"),
    numeric: { value: 0, scale: "units", fiscalYear: 2025, fieldKey: "audit_related_fee" } });
  assert.equal(g.state, "proposed");
});

test("a nil is not read where the row says which year it is not, or where no year is near", async () => {
  // One year billed, one not: which is which is the column's to say, and the
  // row does not. Held for a person, as before.
  const mixed = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" },
    doc("For the years 2025 and 2024: Tax fees $9,100 Nil"));
  assert.notEqual(mixed.mode, "proximity");
  // Prose has no cells.
  const prose = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" },
    doc("In 2025 no tax fees were billed by the auditor."));
  assert.notEqual(prose.mode, "proximity");
  // A nil with no fiscal year anywhere near it.
  const far = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" },
    doc(`Annual report 2025. ${"x ".repeat(600)} Tax fees Nil Nil`));
  assert.notEqual(far.mode, "proximity");
  // Only a fee line: a revenue of nil is not this rule's to read.
  const revenue = anchorNumeric({ value: 0, scale: "units", fiscalYear: 2025, fieldKey: "total_revenue" },
    doc("2025 Revenue Nil Nil"));
  assert.notEqual(revenue.mode, "proximity");
  // A non-zero claim never anchors on a nil.
  const claimed = anchorNumeric({ value: 18_000, scale: "units", fiscalYear: 2025, fieldKey: "tax_fee" }, doc(NIL_TABLE));
  assert.notEqual(claimed.matched?.numeral, "nil");
});

test("a nil is read from the fee's own column, and from no other", async () => {
  const claim = (fieldKey: string, fiscalYear = 2025) => ({ value: 0, scale: "units" as const, fiscalYear, fieldKey });
  // "All other fees" for 2025 is $18,000: the nil beside it is not its.
  assert.notEqual(anchorNumeric(claim("other_fee"), doc(NIL_TABLE)).mode, "proximity");
  // For 2024 it is Nil.
  assert.equal(anchorNumeric(claim("other_fee", 2024), doc(NIL_TABLE)).mode, "proximity");
  assert.equal(anchorNumeric(claim("audit_related_fee"), doc(NIL_TABLE)).mode, "proximity");
  // An audit fee is never zero by this path: the 2025 cell is a figure.
  assert.notEqual(anchorNumeric(claim("audit_fee"), doc(NIL_TABLE)).mode, "proximity");

  // Currency-prefixed cells and footnotes, as venture issuers print them.
  const prefixed = `Year Audit Fees(1) Audit Related Fees(2) Tax Fees(3) All Other Fees(4)
2025 C$284,000 C$53,500 Nil Nil
2024 C$250,000 C$40,000 C$12,000 Nil`;
  assert.equal(anchorNumeric(claim("tax_fee"), doc(prefixed)).mode, "proximity");
  assert.notEqual(anchorNumeric(claim("tax_fee", 2024), doc(prefixed)).mode, "proximity");

  // A different column order: tax before audit-related.
  const reordered = `Fiscal year Audit Fees Tax Fees Audit-Related Fees All Other Fees
2025 $96,000 $4,500 Nil Nil`;
  assert.notEqual(anchorNumeric(claim("tax_fee"), doc(reordered)).mode, "proximity");
  assert.equal(anchorNumeric(claim("audit_related_fee"), doc(reordered)).mode, "proximity");

  // A row short of a cell (a firm's name where a figure should be) says
  // nothing about which column is which: held.
  const firm = `Year Audit Fees Audit Related Fees Tax Fees All Other Fees
December 31, 2025 KPMG $495,732 $Nil $Nil $Nil`;
  assert.notEqual(anchorNumeric(claim("tax_fee"), doc(firm)).mode, "proximity");

  // A dash in prose is punctuation, not a cell.
  assert.notEqual(anchorNumeric(claim("tax_fee", 2021),
    doc("for the financial year ended December 31, 2021. Tax Fees - the auditor invoiced approximately $4,000 for tax returns.")).mode, "proximity");
  // One dash alone, even where the table goes on, is held: the 52-110
  // footnote "(3) Tax Fees – tax compliance, tax advice …" looks the same.
  assert.notEqual(anchorNumeric(claim("tax_fee", 2026),
    doc("year ended April 30, 2026 Audit fees(1) 345,075 Tax fees(3) - All other fees(4) 9,558")).mode, "proximity");
  // One "Nil" where the table goes on is a row.
  assert.equal(anchorNumeric(claim("tax_fee", 2026),
    doc("year ended April 30, 2026 Audit fees(1) 345,075 Tax fees(3) Nil All other fees(4) 9,558")).mode, "proximity");

  // A footnote digit fused onto the label of a row.
  assert.equal(anchorNumeric(claim("tax_fee"), doc("For 2025 and 2024: Tax fees3 – –")).mode, "proximity");
});

test("a nil is not read from a footnote, an unknown column, a prose list, or a year further up", async () => {
  // Each found by review, 11 November 2026: in every one the fee was not zero.
  const claim = (fieldKey: string, fiscalYear = 2025) => ({ value: 0, scale: "units" as const, fiscalYear, fieldKey });
  const held = (fieldKey: string, text: string, fiscalYear = 2025) =>
    assert.notEqual(anchorNumeric(claim(fieldKey, fiscalYear), doc(text)).mode, "proximity", text);
  const table = `Year Audit Fees(1) Audit-Related Fees(2) Tax Fees(3) All Other Fees(4)
December 31, 2025 $45,000 $5,000 $8,500 $1,200
`;
  // The footnotes under a table, with a dash for punctuation.
  held("tax_fee", table + "(3) Tax Fees — tax compliance, tax advice and tax planning.");
  held("other_fee", table + "(4) All Other Fees – other products and services provided by the auditor.");
  held("audit_related_fee", table + "(2) Audit-Related Fees – Audit-related fees billed by KPMG in fiscal 2025 were $22,000.");
  // A column this code has no label for, between or beside the known ones.
  held("tax_fee", "Year Audit Fees Assurance Fees Tax Fees All Other Fees\n2025 80,000 Nil 5,000 3,000");
  held("other_fee", "Year Audit Fees Audit-Related Fees Tax Compliance Fees Tax Planning Fees All Other Fees\n2025 80,000 10,000 5,000 Nil 2,000");
  // A figure the shape of a year is a cell, not the end of the row.
  held("tax_fee", "2025 2024\nAudit fees $50,000 $45,000\nTax fees – 2,000", 2024);
  held("other_fee", "(C$ thousands) 2025 2024 Audit fees 1,200 1,100 All other fees – 2,031", 2024);
  // The four categories named in a sentence are not a header.
  held("tax_fee", "Fees are classified as audit fees, audit-related fees, tax fees and all other fees.\nYear ended December 31, 2025 80,000 10,000 - 7,000 97,000");
  // "Nil $5,000" is two cells.
  held("tax_fee", "Year Audit Fees Audit-Related Fees Tax Fees All Other Fees Total\n2025 $80,000 Nil $5,000 – $85,000");
  // A figure equal to the year is not the year's row.
  held("tax_fee", "Year Audit Fees Audit-Related Fees Tax Fees All Other Fees\n2024 $2,025 Nil Nil Nil\n2025 $45,000 $3,000 $8,000 Nil");
  // The year a circular was dated is not a year of the table.
  held("tax_fee", "Dated May 1, 2025. Fees for 2024 and 2023: Audit fees $40,000 $38,000 Tax fees Nil Nil");
  // "Non audit fees" is not the audit fee.
  held("audit_fee", "2025 2024 Audit fees $50,000 $45,000 Non audit fees Nil Nil");
});
