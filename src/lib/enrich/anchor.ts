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

/**
 * How a claim that did not anchor was found in its document all the same:
 *
 *   punctuation  the quote, once punctuation and spacing are set aside
 *   stitched     every passage of a quote joined with "..."
 *   unlabelled   the figure at its declared scale, in a document with no label for it
 *   quoted       the figure in the quote, and the quote in the document
 *
 * Mode stays "none" -- nothing here anchors -- and the gate holds it for a
 * person rather than counting it as invented.
 */
export type Inexact = "punctuation" | "stitched" | "unlabelled" | "quoted";

export type AnchorResult = {
  mode: AnchorMode;
  start: number | null;
  end: number | null;
  documentHash: string | null;
  /** Why it failed, when it did. Never a silent drop. */
  reason?: string;
  matched?: { numeral?: string; label?: string; year?: string; currency?: string };
  inexact?: Inexact;
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

/**
 * The ways a filing states its scale. Run 1 found "(C$ thousands)" -- the form
 * Agnico Eagle's AIF uses, and a common one -- missing, so a correct fee read
 * as $8,052 instead of $8,052,000 and was held. A currency prefix inside the
 * brackets, and "thousands of ... dollars", are now read; "thousands" of
 * anything else ("(thousands of ounces)", "thousands of hectares") is not.
 */
function scalePattern(word: string, extra: string[]): RegExp {
  const cur = String.raw`(?:[a-z]{0,3}\$\s*)?`;                       // "c$ ", "us$", "$"
  const ofDollars = String.raw`\s+of\s+(?:[a-z.$]+\s+){0,2}dollars`;  // "of canadian dollars"
  return new RegExp([
    String.raw`\bin\s+${word}\b`,
    // "(c$ thousands)", "(in thousands of us dollars)", "(thousands, except per share)"
    String.raw`\(\s*${cur}(?:in\s+)?${word}(?:${ofDollars})?\s*(?:[,;][^)]{0,40})?\)`,
    String.raw`\b${word}${ofDollars}\b`,
    ...extra,
  ].join("|"), "gi");
}

const SCALE_PATTERNS: Array<[RegExp, Scale]> = [
  [scalePattern("thousands?", [
    String.raw`\(\s*(?:[a-z]{0,3}\$\s*)?000'?s?\s*\)`, String.raw`\$\s*000'?s\b`,
    String.raw`\ben\s+milliers\b`, String.raw`\bmilliers\s+de\b`,
  ]), "thousands"],
  [scalePattern("millions?", [String.raw`\ben\s+millions\b`]), "millions"],
];

/**
 * The document as the numeric check reads it: normalised, with thousands
 * separators taken out of numerals so "8,052" is found as 8052.
 *
 * Before this, the needle was reduced to digits and the haystack kept its
 * commas, so no fee of 1,000 or more printed with a separator could ever
 * anchor (Run 1: every fee held). A comma between digit groups is a separator;
 * so is a thin or no-break space, which is how French filings group digits.
 * An ordinary space is NOT, because two table cells -- "421 154" -- must not
 * become one number. A group that is not exactly three digits is left alone,
 * so a footnote fused to a figure ("$610,6283") still does not match.
 */
export function numericHaystack(text: string): string {
  // No-break, figure, narrow no-break and thin space -- written as escapes,
  // because an ordinary space in their place would merge adjacent table cells.
  const grouped = (text ?? "").replace(/(\d)[\u00A0\u2007\u202F\u2009](?=\d{3}(?!\d))/g, "$1");
  return normalize(grouped).replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

/**
 * The scale phrase in force in a document, or at a position within it.
 *
 * At a position, the phrase in force is the nearest one before it in the
 * 3,000 characters above (a table's heading), else the nearest in the 200
 * after (a footer). The first pattern to match anywhere in the window used to
 * win, so a "(in millions)" table above a "(C$ thousands)" fee table would
 * have read the fees as millions.
 */
export function detectScale(text: string, near?: number): Scale | null {
  if (near === undefined) {
    for (const [re, scale] of SCALE_PATTERNS) if (text.search(re) !== -1) return scale;
    return null;
  }
  const lo = Math.max(0, near - 3000);
  const window = text.slice(lo, near + 200);
  const at = near - lo;
  let best: { scale: Scale; distance: number } | null = null;
  for (const [re, scale] of SCALE_PATTERNS) {
    for (const m of window.matchAll(re)) {
      // Before the figure is always nearer in the sense that matters than after it.
      const distance = m.index <= at ? at - m.index : 1_000_000 + (m.index - at);
      if (!best || distance < best.distance) best = { scale, distance };
    }
  }
  return best?.scale ?? null;
}

/**
 * The currency a figure is in, where the document says so -- in one of two
 * places only:
 *
 *   its own prefix      "US$517,116", "C$ 8,052"
 *   a heading above it  "(C$ thousands)", "(in thousands of US dollars)",
 *                       "expressed in Canadian dollars"
 *
 * A currency merely mentioned nearby -- "gold at US$2,000 an ounce" above a
 * fee table in Canadian dollars -- is neither, and must not overrule the
 * table. A bare "$" says nothing, so a filing that only writes "$" has no
 * currency here and the claim stands on the model's reading. Run on the
 * normalised haystack, like detectScale.
 */
const CURRENCY_TOKEN: Array<[RegExp, string]> = [
  [/^(?:u\.?s\.?\s?\$|usd|u\.?s\.? dollars?|united states dollars?)$/, "USD"],
  [/^(?:c\$|ca\$|cdn\$|can\$|cad|canadian dollars?|dollars? canadiens?)$/, "CAD"],
  [/^(?:a\$|au\$|aud|australian dollars?)$/, "AUD"],
  [/^(?:£|gbp|pounds? sterling)$/, "GBP"],
  [/^(?:€|eur|euros?)$/, "EUR"],
];
const TOKEN = String.raw`u\.?s\.?\s?\$|usd|c\$|ca\$|cdn\$|can\$|cad|a\$|au\$|aud|£|gbp|€|eur`;
const DOLLARS = String.raw`(?:canadian|u\.?s\.?|united states|australian) dollars?|dollars? canadiens?`;
const PREFIX_RE = new RegExp(String.raw`(?:^|[^a-z])(${TOKEN})\s?$`);
const HEADING_RE = new RegExp(
  String.raw`\(\s*(?:in\s+)?(${TOKEN})\s*(?:thousands?|millions?|000'?s?)?[^)]{0,40}\)` +
  String.raw`|\((?:in\s+)?(?:thousands?|millions?)\s+of\s+(${DOLLARS}|${TOKEN})[^)]{0,40}\)` +
  String.raw`|(?:expressed|stated|presented|reported|amounts?(?: are)?|all amounts(?: are)?)\s+in\s+(?:thousands\s+of\s+|millions\s+of\s+)?(${DOLLARS})` +
  // A fee column headed with its currency, bracketed or not: Graphite One's
  // "Audit fees(1) CA$ … Tax fees(3) CA$" over "2025 $137,393 - $59,704".
  // Not a figure's own prefix in prose ("an annual retainer fee US$ 50,000"):
  // the token may be followed by a year, as a column header is, never by an
  // amount.
  String.raw`|\bfees?\s*(?:\(\w{1,2}\)|\d)?\s*(${TOKEN})(?![a-z0-9])(?!\s*\$?\s*(?!(?:19|20)\d\d\b)\d)`,
  "g");

function codeOf(token: string): string | null {
  const t = token.trim();
  return CURRENCY_TOKEN.find(([re]) => re.test(t))?.[1] ?? null;
}

/**
 * Every currency the document names anywhere -- its symbol, its code or its
 * words. Used to catch a claim the document never supports: Run 2 proposed
 * Barrick's audit fee in Australian dollars from a table reading "$10.3",
 * in a circular that talks about US dollars and never mentions AUD.
 *
 * A filing that names NO currency (only "$") tells us nothing, so nothing is
 * concluded from its silence -- the claim stands on the model's reading, as
 * it did before.
 */
const CURRENCY_MENTIONS: Array<[string, RegExp]> = [
  ["USD", /\bu\.?s\.?\s?\$|\busd\b|\bu\.?s\.? dollars?\b|\bunited states dollars?\b|\bdollars? am[ée]ricains?\b|\$\s?us\b/],
  ["CAD", /\bc\$|\bca\$|\bcdn\s?\$|\bcan\$|\bcad\b|\bcanadian dollars?\b|\bdollars? canadiens?\b|\$\s?ca(?:n|d)?\b/],
  ["AUD", /\ba\$|\bau\$|\baud\b|\baustralian dollars?\b/],
  ["GBP", /£|\bgbp\b|\bpounds? sterling\b/],
  ["EUR", /€|\beur\b|\beuros?\b/],
];

export function currenciesMentioned(text: string): string[] {
  return CURRENCY_MENTIONS.filter(([, re]) => re.test(text)).map(([code]) => code);
}

/**
 * What the document as a whole says its amounts are in, once, near the front:
 *
 *   "Unless otherwise indicated, all references to "$" or "US$" in this
 *    Circular refer to United States dollars."               (Trilogy Metals)
 *   "All references to currency in this Information Circular are to United
 *    States dollars, unless otherwise indicated."                 (Vista Gold)
 *   "All dollar amounts referenced in this Information Circular are in United
 *    States dollars and are referred to as "$"."                 (Andean, APM)
 *
 * The Q4 2026 fee re-run proposed all three companies' fees in Canadian
 * dollars: the model read a Canadian issuer's plain "$" as CAD, and the fee
 * table, thousands of characters further on, has no heading of its own to
 * contradict it. Two shapes are read, and only as a general statement -- one
 * that says "all" or "unless otherwise", and is not about a plan, a per-share
 * price or a conversion:
 *
 *   what "$" means      "references to "$" ... are to Canadian dollars"
 *   what amounts are in "all dollar amounts ... are expressed in US dollars"
 *
 * The document's first such statement is the one that counts: it is the
 * front matter's, and speaks for the whole. A later one speaks for its own
 * part -- GoldMining's AIF says "$" is Canadian dollars up front and, two
 * thirds of the way in, that its PEA's section is in US dollars; the fee
 * table after that is in Canadian dollars. It ranks below the figure's own
 * prefix and a heading over its table, and is not used for a nil row (see
 * anchorNil).
 */
const STATED_CUR = String.raw`(?:(?:thousands|millions) of )?(?:(?:canadian|cdn|united states|us|u\.?s\.?|australian) dollars?|` +
  String.raw`u\.?s\.?\s?\$|usd|c\$|cdn\$|ca\$|cad|a\$|aud)(?![a-z])|` +
  String.raw`(?:(?:milliers|millions) de )?dollars? (?:canadiens?|am[ée]ricains?|des [ée]tats-unis|australiens?)`;
/**
 * One clause: no full stop or semicolon, except the ones in "U.S." and in a
 * company's name ("Trilogy Metals Inc. are ...").
 */
const ABBREVIATED = String.raw`\bu|\bu\.s|\binc|\bltd|\bcorp|\bco|\bno`;
const CLAUSE = String.raw`(?:[^.;]|(?<=${ABBREVIATED})\.)`;
const ABBREVIATED_END = new RegExp(String.raw`(?:${ABBREVIATED})$`);
const SIGN_MEANS = new RegExp(
  String.raw`["«]\s?\$,?\s?["»]${CLAUSE}{0,120}?\b(?:are|is|mean|means|refer|refers|d[ée]signent|d[ée]signe|renvoient|renvoie)\b` +
  String.raw`${CLAUSE}{0,40}?(${STATED_CUR})`, "g");
// What the amounts are in -- not "amounts in Canadian dollars are denoted C$",
// which says how a subset is marked.
const AMOUNTS_IN = new RegExp(
  String.raw`\b(?:(?:dollar|money|monetary|currency) amounts|amounts|figures|values|financial information|monetary references|` +
  String.raw`references to (?:currency|money|dollars|dollar amounts|money amounts)|currency references|montants|sommes)\b` +
  String.raw`${CLAUSE}{0,100}?\b(?:in|to|en|are|is|mean|means|sont)\s+(?:the\s+|le\s+|les\s+)?(${STATED_CUR})` +
  String.raw`(?!,?\s*(?:are|is|will be|sont)\s+(?:denoted|indicated|identified|shown|designated|referred to|marked|preceded|noted|d[ée]sign[ée]s?|indiqu[ée]s?|identifi[ée]s?|pr[ée]c[ée]d[ée]s?)\b)` +
  String.raw`(?!\s+(?:which|that|qui)\b)`, "g");
/** A statement for the whole document: "all", "unless otherwise", or naming the document. */
const GENERAL = new RegExp(String.raw`\b(?:all|unless|except|tous|toutes|sauf|herein|aux pr[ée]sentes)\b|` +
  String.raw`\b(?:in|of) (?:this|the) (?:management )?(?:information circular|circular|proxy statement|annual information form|aif|document|annual report|form 40-f)\b|` +
  String.raw`dans (?:la pr[ée]sente|le pr[ée]sent|ce document)`);
/** The document itself, named: such a statement outranks one about anything else. */
const NAMES_DOCUMENT = /\bherein\b|\b(?:this|the) (?:management )?(?:information circular|circular|proxy statement|annual information form|aif|document|annual report|form 40-f)\b|aux pr[ée]sentes|dans (?:la pr[ée]sente|le pr[ée]sent|ce document)/;
/** A part of the document, or something other than its amounts, speaking for itself. */
const SCOPED = new RegExp(String.raw`\bplan\b|\bper share\b|\bpar action\b|convert|translat|following table|\btables?\b|\btableau\b|` +
  String.raw`\bbelow\b|\babove\b|\bletter\b|\blettre\b|\bschedule\b|\bappendix\b|\bexhibit\b|\bannexe\b|r[ée]gime|\bsection\b|\bpea\b|` +
  String.raw`\bstudy\b|[ée]tude|technical report|rapport technique|feasibility|faisabilit|compensation|r[ée]mun[ée]ration|\bsalar|` +
  String.raw`\brates?\b|\btaux\b|exchange|\bloans?\b|\bpr[êe]t\b|facilit|\bcredit\b|\bdebt\b|\bdette\b|payable|outstanding|` +
  String.raw`\bprices?\b|\bpriced\b|\bsales\b|\bcosts?\b|\brevenues?\b`);
/** Statements are front matter: read only the start of a document. */
const STATEMENT_REACH = 120_000;

function statedCode(words: string): string | null {
  if (/canad|cdn|^c\$|^ca\$|^cad/.test(words.replace(/^(?:thousands|millions|milliers) (?:of|de) /, ""))) return "CAD";
  if (/austral|^a\$|^aud/.test(words)) return "AUD";
  if (/united states|\bus\b|u\.?s\.?|usd|am[ée]ricain|[ée]tats-unis/.test(words)) return "USD";
  return null;
}

let statementsMemo: { hay: string; found: Array<{ at: number; code: string; namesDocument: boolean }> } | null = null;

/** Every general statement of currency near the start of a normalised haystack, in order. */
export function currencyStatements(hay: string): Array<{ at: number; code: string; namesDocument: boolean }> {
  if (statementsMemo && statementsMemo.hay === hay) {
    // Rebind, so the next call with this same string compares by reference.
    statementsMemo.hay = hay;
    return statementsMemo.found;
  }
  const head = hay.slice(0, STATEMENT_REACH);
  const found: Array<{ at: number; code: string; namesDocument: boolean }> = [];
  for (const re of [SIGN_MEANS, AMOUNTS_IN]) {
    for (const m of head.matchAll(re)) {
      const at = m.index ?? 0;
      // The clause the statement stands in: back to the last full stop or
      // semicolon (not one of "U.S." or "Inc."), forward to the next.
      let lo = at;
      while (lo > 0 && lo > at - 200 &&
             !(/[.;]/.test(head[lo - 1]) && !(head[lo - 1] === "." && ABBREVIATED_END.test(head.slice(Math.max(0, lo - 6), lo - 1))))) lo--;
      const end = at + m[0].length;
      const tail = head.slice(end, end + 80).split(/;|\.(?!s\.)(?<!\bu\.)/)[0];
      const subject = head.slice(lo, end);
      const clause = subject + tail;
      // Scope is judged on what the statement says, not on its tail:
      // "... in US dollars, except per share amounts" still speaks for all.
      if (!GENERAL.test(clause) || SCOPED.test(subject)) continue;
      // "References to "US$" and "$" are to United States dollars and
      // Canadian dollars, respectively": which is which needs more reading
      // than a pattern can do.
      if (re === SIGN_MEANS && /respective/.test(clause)) continue;
      const code = statedCode(m[1]);
      if (code) found.push({ at, code, namesDocument: NAMES_DOCUMENT.test(clause) });
    }
  }
  found.sort((a, b) => a.at - b.at);
  statementsMemo = { hay, found };
  return found;
}

/**
 * The currency the document says it uses: its first statement that names
 * the document ("in this Circular", "herein"), else its first general one.
 */
function documentCurrency(hay: string): string | null {
  const stated = currencyStatements(hay);
  return (stated.find((s) => s.namesDocument) ?? stated[0])?.code ?? null;
}

/**
 * The currency a figure is in, and where the document says so.
 *
 * The document's statement is the weakest of the three, and is used only
 * where nothing near the figure names any currency at all: a table may say
 * "(in Canadian dollars)", "($CAD)", "fees billed … in Canadian dollars" or
 * "$101,700 USD" in more ways than a pattern can read, and where it says
 * anything, the model's reading of it stands, as it did before.
 */
export function currencyAt(text: string, near: number, end = near): { code: string; how: "prefix" | "heading" | "statement" } | null {
  const prefix = text.slice(Math.max(0, near - 8), near).match(PREFIX_RE);
  if (prefix) {
    const code = codeOf(prefix[1]);
    if (code) return { code, how: "prefix" };
  }
  const lo = Math.max(0, near - 3000);
  let nearest: string | null = null;
  for (const m of text.slice(lo, near).matchAll(HEADING_RE)) nearest = codeOf(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  if (nearest) return { code: nearest, how: "heading" };
  const stated = documentCurrency(text);
  if (!stated) return null;
  if (currenciesMentioned(text.slice(lo, end + 400)).length > 0) return null;
  return { code: stated, how: "statement" };
}

/** Why a claimed currency is not the document's. */
function currencyMismatch(where: { code: string; how: string }, claimed: string): string {
  return where.how === "statement"
    ? `the document states its amounts are in ${where.code}, not ${claimed}`
    : `the figure is in ${where.code} where it appears, not ${claimed}`;
}

export function detectCurrency(text: string, near: number): string | null {
  return currencyAt(text, near)?.code ?? null;
}

/**
 * Controlled bilingual label lists. Quebec issuers file in French, so an
 * English-only list silently fails on a real subset of the population.
 */
export const FIELD_LABELS: Record<string, string[]> = {
  // Run 2 threw away real fees at Teck and Pan American because their filings
  // head the rows "Audit Services" and "Tax-Related Fees", which were not on
  // this list. A label list is a controlled vocabulary, and it is only as good
  // as the wordings actually in use.
  audit_fee: [
    "audit fees", "audit fee", "audit service fees", "fees for audit services",
    "audit services", "audit and review services", "audit and review fees",
    "honoraires d'audit", "honoraires de verification", "honoraires de vérification",
    "frais d'audit", "honoraires pour services d'audit", "services d'audit",
  ],
  tax_fee: [
    "tax fees", "tax fee", "tax services", "fees for tax services",
    "tax-related fees", "tax related fees", "tax compliance and advisory fees",
    "tax compliance fees", "tax advisory fees", "tax compliance", "tax advice",
    "honoraires fiscaux", "honoraires pour services fiscaux",
    "frais fiscaux", "honoraires de services fiscaux", "services fiscaux",
  ],
  // The two other lines of the same fee table, worded as the audit and tax
  // lines are.
  audit_related_fee: [
    "audit-related fees", "audit related fees", "audit-related services", "audit related services",
    "fees for audit-related services", "audit-related",
    "honoraires pour services liés à l'audit", "honoraires liés à l'audit", "services liés à l'audit",
    "honoraires pour services liés a l'audit", "honoraires lies a l'audit",
  ],
  other_fee: [
    "all other fees", "other fees", "all other services", "other services", "fees for all other services",
    "tous les autres honoraires", "autres honoraires", "autres services",
  ],
  // The statements' own line items, and the selected annual information's.
  total_revenue: [
    "total revenue", "total revenues", "revenue", "revenues", "net revenue", "metal sales", "sales",
    "revenue from mining operations", "royalty revenue", "stream revenue",
    "produits des activités ordinaires", "chiffre d'affaires", "revenus", "produits",
  ],
  net_income: [
    "net income", "net loss", "net income (loss)", "net (loss) income", "net earnings", "net earnings (loss)",
    "net loss and comprehensive loss", "net income and comprehensive income", "loss for the year",
    "income for the year", "profit for the year", "loss and comprehensive loss",
    "résultat net", "perte nette", "bénéfice net", "perte de l'exercice", "bénéfice de l'exercice",
  ],
  total_assets: [
    "total assets", "total de l'actif", "actif total", "total des actifs",
  ],
  auditor: [
    "auditor", "independent auditor", "chartered professional accountants",
    "auditeur", "verificateur", "vérificateur", "auditeur independant",
  ],
};

export function hasTextLayer(doc: StoredDocument): boolean {
  // The fetcher knows the document's type and the gate does not: its verdict
  // stands either way. Characters per page are only worked out here for a
  // document stored without one.
  if (doc.hasTextLayer === false) return false;
  if (doc.hasTextLayer === true) return true;
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

/** Fewer letters and digits than this, and a loose match proves nothing. */
export const MIN_LOOSE_CHARS = 15;

/** Escapes a quote picks up on its way through JSON: a literal \n, \", ’. */
const ESCAPES = /\\+(?:[nrt]|u[0-9a-f]{4})/gi;
/** Where a quote was cut: "...", "[...]", "[..]" ("…" is folded to "..." first). */
const ELLIPSIS = /\[\s*\.{2,}\s*\]|\.{3,}/;

/** Letters and digits only, each with its offset in `text`. */
function lettersAndDigits(text: string): { chars: string; at: number[] } {
  let chars = "";
  const at: number[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    chars += m[0];
    for (let i = 0; i < m[0].length; i++) at.push(m.index + i);
  }
  return { chars, at };
}

/**
 * A quote that is in the document, but not exactly as the model gave it.
 *
 * Of the 145 findings Q4 2026 called unsupported -- 2.63% against a 2.0%
 * ceiling on publish -- most were in their own document once punctuation was
 * set aside (a dash dropped, an apostrophe written \", a line break written
 * \n) or were stitched from passages that are each there. Nothing in them was
 * invented, and counting them as fabrication is what held the period.
 *
 * Only after an exact match fails, and never a proposal: offsets are into the
 * normalised text, as for an exact match.
 */
export function anchorLoosely(excerpt: string, doc: StoredDocument): AnchorResult | null {
  const parts = normalize((excerpt ?? "").replace(ESCAPES, " ")).split(ELLIPSIS)
    .map(lettersAndDigits).filter((p) => p.chars.length > 0);
  if (parts.reduce((n, p) => n + p.chars.length, 0) < MIN_LOOSE_CHARS) return null;
  const hay = lettersAndDigits(normalize(doc.text));
  let start = Infinity;
  let end = -Infinity;
  for (const p of parts) {
    const i = hay.chars.indexOf(p.chars);
    if (i === -1) return null;
    start = Math.min(start, hay.at[i]);
    end = Math.max(end, hay.at[i + p.chars.length - 1] + 1);
  }
  const stitched = parts.length > 1;
  return {
    mode: "none", start, end, documentHash: doc.contentHash,
    inexact: stitched ? "stitched" : "punctuation",
    reason: stitched
      ? `the quote joins ${parts.length} passages with "..."; each is in the document, but not as one`
      : "the quote is in the document once punctuation and spacing are set aside, not exactly",
  };
}

export type NumericClaim = {
  /** The value as the finding asserts it, already in real units. */
  value: number;
  /** What the finding says the document's figure is expressed in. */
  scale: Scale;
  fiscalYear?: number | string | null;
  fieldKey: string;
  /** ISO code the finding says the figure is in; checked where the document says. */
  currency?: string | null;
};

/** The lines of an auditor's fee table, where a company that paid nothing prints "Nil" or a dash. */
const NIL_FEE_FIELDS = ["audit_fee", "audit_related_fee", "tax_fee", "other_fee"] as const;
/** A footnote marker or colon between a label or figure and the next cell: "Tax Fees(3)", "Tax fees:", "$5,000*". */
const ROW_MARKER = /^\s*(?:\(\w{1,2}\)|\*+|:|[¹²³⁴⁵])/;
/**
 * One cell of a fee row: a nil word, a dash, or a figure, with or without "$"
 * or "C$", "US$", "CAD$", and an optional full stop. numericHaystack has
 * already taken the thousands separators out. The currency must be one a
 * fee table prints: "Nil $5,000" is two cells, not one in "nil" dollars.
 */
const ROW_CELL = /^\s*(?:(?:c|ca|cad|us|usd|a|au)\$|\$)?\s*(nil|none|néant|neant|aucun|aucuns|-+|\d[\d,]*(?:\.\d+)?)\.?(?=\s|$|\)|\*)/;
const NIL_CELL = /^(nil|none|néant|neant|aucun|aucuns|-+|0+(?:\.0+)?)$/;
const NIL_WORD = /^(nil|none|néant|neant|aucun|aucuns)$/;
/** A bare year: in a table by column, the next row's key, not a cell of this one. */
const YEAR_CELL = /^(19|20)\d\d$/;
/** A year as a table prints it in a heading or a row's key, not inside a figure. */
const YEAR_AT = /(?<![\d$.,])(?:19|20)\d\d(?!\d)/g;
/** What may stand between two labels of a header: footnotes and a currency, nothing that is a column of its own. */
const HEADER_GAP = /^(?:\s|\(\w{1,3}\)|\((?:c|ca|cad|us|usd)?\$\)|(?:c|ca|cad|us|usd)?\$|\d|\*)*$/;
/** A fee label, whatever words it is written in: an unknown column in a header, or the next row of a table. */
const ANY_FEES = /\bfees?\b/;

/**
 * The cells of one row from `from`, footnotes skipped, up to `most`. Laid
 * out by column, a row stops at the next row's year; laid out by row, a
 * year-shaped figure ("2,000", once the separator is out) is a cell, and not
 * a nil one.
 */
function readCells(hay: string, from: number, most: number, stopAtYear: boolean): { cells: string[]; start: number; end: number } {
  let i = from;
  const skip = () => { for (let m = ROW_MARKER.exec(hay.slice(i)); m; m = ROW_MARKER.exec(hay.slice(i))) i += m[0].length; };
  skip();
  const start = i;
  const cells: string[] = [];
  for (let m = ROW_CELL.exec(hay.slice(i)); m && cells.length < most; m = ROW_CELL.exec(hay.slice(i))) {
    if (stopAtYear && YEAR_CELL.test(m[1]) && !/\$/.test(m[0])) break;
    cells.push(m[1]);
    i += m[0].length;
    skip();
  }
  return { cells, start, end: i };
}

const isNil = (cell: string) => NIL_CELL.test(cell.replace(/,/g, ""));

/** Where a label occurs as a whole phrase, not inside a longer word or after "non". */
function labelAt(hay: string, label: string, at: number): boolean {
  return !/[\p{L}\p{N}-]/u.test(hay[at - 1] ?? "") && !/[\p{L}]/u.test(hay[at + label.length] ?? "") &&
    !/\bnon[- ]?\s*$/.test(hay.slice(Math.max(0, at - 5), at));
}

/**
 * The years a row's columns are for: the last two told apart in the 300
 * characters above the label. "2025 2024 Audit fees … Tax fees Nil Nil";
 * not the date a circular was signed, further up ("Dated May 1, 2025. Fees
 * for 2024 and 2023: …").
 */
function rowYears(hay: string, at: number): Set<string> {
  const above = [...hay.slice(Math.max(0, at - 300), at).matchAll(YEAR_AT)].map((m) => m[0]);
  const years: string[] = [];
  for (let k = above.length - 1; k >= 0 && years.length < 2; k--) if (!years.includes(above[k])) years.push(above[k]);
  return new Set(years);
}

/**
 * A fee of zero, printed the way fee tables print it. There is no "0" on the
 * page for the numeric path to find, so until 11 November 2026 every such
 * finding was held as label-only: in Q4 2026, 71 tax fees, and why the tax
 * fee column trailed the audit fee column by half.
 *
 * Deliberately narrow: a nil read wrongly is a fee of zero put to the
 * analyst as found in the filing (fees are never accepted in bulk,
 * review/threshold.ts), and a nil missed is one they read for themselves,
 * as before. Two layouts:
 *
 *   by row      "Tax fees Nil Nil", "Tax Fees(3) $- $-", "Tax fees3 – –".
 *               The row must start at the fee's label, every cell on it
 *               must be nil, and the fiscal year must be one of the two
 *               the table's heading names just above. "Tax fees $9,100
 *               Nil" says one year was zero but not which. One cell alone
 *               is a row only if it is a word ("Nil", not a dash, which
 *               prose uses too: "Tax Fees – tax compliance, advice …")
 *               and the table goes on after it.
 *   by column   "Year  Audit fees(1)  Audit related fees(2)  Tax fees(3)
 *               All other fees(4)" over "2025  C$284,000  C$53,500  Nil  Nil".
 *               The fee's column is its place in the table's own header:
 *               the labels side by side, with only footnotes or a currency
 *               between them and no other column of fees beside them; the
 *               fiscal year's row must have a cell for every column (and
 *               perhaps a total), and no more.
 *
 * Prose ("no tax fees were billed") has no cells, and is held.
 */
function anchorNil(hay: string, claim: NumericClaim, doc: StoredDocument): AnchorResult | null {
  const yearStr = claim.fiscalYear ? String(claim.fiscalYear).slice(0, 4) : null;
  if (!yearStr) return null;
  const labelsOf = (key: string) => (FIELD_LABELS[key] ?? []).map(normalize).filter(Boolean);
  const own = labelsOf(claim.fieldKey);
  const claimed = (claim.currency ?? "").toUpperCase();
  const found = (start: number, end: number, label: string, numeral: string): AnchorResult => {
    // A nil row is nil in any currency, but the finding still records one,
    // so a nil whose own cell or table heading names another currency is
    // held. What the document says up front is not enough: NovaGold's
    // circular says "$" is US dollars and prints its fee table in C$, with
    // "Nil" cells that carry no currency of their own.
    const where = claimed ? currencyAt(hay, start) : null;
    if (where && where.how !== "statement" && where.code !== claimed) {
      return { mode: "label_only", start: null, end: null, documentHash: doc.contentHash,
               reason: currencyMismatch(where, claimed) };
    }
    return { mode: "proximity", start, end, documentHash: doc.contentHash,
             matched: { numeral, label, year: yearStr, currency: where?.code === claimed ? claimed : undefined } };
  };

  for (const label of own) {
    for (let at = hay.indexOf(label); at !== -1; at = hay.indexOf(label, at + 1)) {
      if (!labelAt(hay, label, at)) continue;
      let after = at + label.length;
      // A footnote fused onto the label, as "Tax fees3 – –" prints it.
      if (/^\d\s/.test(hay.slice(after, after + 2))) after += 1;

      // By row.
      const row = readCells(hay, after, 6, false);
      const rest = hay.slice(row.end, row.end + 40);
      const goesOn = /^\s*($|total\b|\(\d\)|\d)/.test(rest) ||
        (ANY_FEES.test(rest.slice(0, 30)) && /^\s*[\p{L}-]+(?:\s+[\p{L}-]+){0,3}\s+fees?\b/u.test(rest));
      const rowOk = row.cells.length > 1 || (row.cells.length === 1 && NIL_WORD.test(row.cells[0]) && goesOn);
      if (rowOk && row.cells.every(isNil) && rowYears(hay, at).has(yearStr)) {
        return found(row.start, row.end, label, row.cells.join(" "));
      }

      // By column: this label in a header beside the table's other fee labels.
      const header: Array<{ key: string; at: number; end: number }> = [{ key: claim.fieldKey, at, end: after }];
      for (const key of NIL_FEE_FIELDS) {
        if (key === claim.fieldKey) continue;
        let best: { at: number; end: number } | null = null;
        for (const other of labelsOf(key)) {
          for (let o = hay.indexOf(other, Math.max(0, at - 250)); o !== -1 && o < at + 250; o = hay.indexOf(other, o + 1)) {
            if (!labelAt(hay, other, o) || (o < at + label.length && o + other.length > at)) continue;
            if (!best || Math.abs(o - at) < Math.abs(best.at - at)) best = { at: o, end: o + other.length };
          }
        }
        if (best) header.push({ key, ...best });
      }
      header.sort((a, b) => a.at - b.at);
      if (header.length < 3 || !header.some((h) => h.key === "audit_fee")) continue;
      // Side by side: nothing between two labels but footnotes and a
      // currency. Prose has "and" and commas there; a table laid out by row
      // has figures; a header with a column this code does not know has
      // that column's name.
      const sideBySide = header.every((h, j) => j === 0 ||
        (h.at >= header[j - 1].end && h.at - header[j - 1].end <= 40 && HEADER_GAP.test(hay.slice(header[j - 1].end, h.at))));
      if (!sideBySide) continue;
      const headerStart = header[0].at;
      const headerEnd = header[header.length - 1].end;
      // No other column of fees just before or after the ones found.
      if (/fees?\s*(?:\(\w{1,3}\)|\d)?\s*$/.test(hay.slice(Math.max(0, headerStart - 30), headerStart))) continue;
      const column = header.findIndex((h) => h.key === claim.fieldKey);
      for (let y = hay.indexOf(yearStr, headerEnd); y !== -1 && y < headerEnd + 400; y = hay.indexOf(yearStr, y + 1)) {
        if (/[\d$.,]/.test(hay[y - 1] ?? "") || /\d/.test(hay[y + 4] ?? "")) continue;
        if (ANY_FEES.test(hay.slice(headerEnd, y))) break;
        const cells = readCells(hay, y + 4, header.length + 2, true);
        if (cells.cells.length < header.length || cells.cells.length > header.length + 1) break;
        const cell = cells.cells[column];
        if (!isNil(cell)) break;
        return found(cells.start, cells.end, label, cell);
      }
    }
  }
  return null;
}

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
  const hay = numericHaystack(doc.text);
  const labels = (FIELD_LABELS[claim.fieldKey] ?? []).map(normalize).filter(Boolean);

  if (claim.value === 0 && (NIL_FEE_FIELDS as readonly string[]).includes(claim.fieldKey)) {
    const nil = anchorNil(hay, claim, doc);
    if (nil) return nil;
  }

  // The figure as printed: the asserted value divided back down by its scale.
  const printed = claim.value / SCALE_MULTIPLIER[claim.scale];
  const asPrinted = normalizeNumeral(printed);
  const asFull = normalizeNumeral(claim.value);

  const candidates: Array<{ needle: string; scale: Scale }> = [
    { needle: asPrinted, scale: claim.scale },
    ...(asFull === asPrinted && claim.scale === "units" ? [] : [{ needle: asFull, scale: "units" as Scale }]),
  ];

  let sawLabel = false;
  let unlabelled: { at: number; needle: string; clash?: string } | null = null;
  let currencyClash: string | null = null;
  // A currency the document never names, in a document that names others, is
  // not this document's figure whatever the digits say.
  const claimed = (claim.currency ?? "").toUpperCase();
  const mentioned = claimed ? currenciesMentioned(hay) : [];
  if (claimed && mentioned.length > 0 && !mentioned.includes(claimed)) {
    currencyClash = `the document never mentions ${claimed}; it states amounts in ` +
                    `${mentioned.join(", ")}`;
  }
  const currencyUnsupported = currencyClash !== null;
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
      // Only a labelled occurrence can anchor; of the unlabelled, only the
      // first is kept. Skipping the rest spares a scale and currency check at
      // every bare "5" in a long filing.
      else if (unlabelled) continue;
      const yearStr = claim.fiscalYear ? String(claim.fiscalYear).slice(0, 4) : null;
      const yearHit = !yearStr || window.includes(yearStr);

      // Scale is checked against the document, not taken on the model's word.
      // This alone prevents thousandfold errors.
      // Read from the same string the position was found in: an offset into
      // the normalised text is not an offset into the raw one.
      const docScale = detectScale(hay, at) ?? "units";
      if (docScale !== scale) {
        continue;
      }
      // The currency too, where the document states one: US$517,116 claimed
      // as Canadian dollars is a different amount, and the page would say C$.
      if (currencyUnsupported) {
        sawLabel = sawLabel || Boolean(label);
        continue;
      }
      const where = currencyAt(hay, at, at + needle.length);
      // What the figure's own prefix or heading says is recorded on the
      // anchor (worker.ts fills a missing currency from it); what the
      // document says up front only tests a claim.
      const docCurrency = where && where.how !== "statement" ? where.code : null;
      if (claim.currency && where && where.code !== claimed) {
        currencyClash = currencyMismatch(where, claimed);
        // A bare row held as unlabelled stays held, with the reason.
        if (!label) unlabelled ??= { at, needle, clash: currencyClash };
        continue;
      }
      if (label && yearHit) {
        return {
          mode: "proximity", start: at, end: at + needle.length,
          documentHash: doc.contentHash,
          matched: { numeral: needle, label, year: yearStr ?? undefined, currency: docCurrency ?? undefined },
        };
      }
      unlabelled ??= { at, needle };
    }
  }

  if (sawLabel || labels.some((l) => hay.includes(l))) {
    return { mode: "label_only", start: null, end: null, documentHash: doc.contentHash,
             reason: currencyClash ?? "the label appears but the figure does not, at the declared scale" };
  }
  // A balance sheet's total row often has no words on it at all: most of Q4
  // 2026's 24 unsupported total assets were a bare row of figures under a
  // column of others. Five digits or more: a year heads every column, and a
  // stray "2022" or "12" is not a find.
  if (unlabelled && unlabelled.needle.replace(/\D/g, "").length >= 5) {
    return { mode: "none", start: unlabelled.at, end: unlabelled.at + unlabelled.needle.length,
             documentHash: doc.contentHash, inexact: "unlabelled",
             reason: unlabelled.clash ??
               "the figure appears at its declared scale, but no label for it appears anywhere in the document" };
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
    // A full stop after a figure ends a sentence; followed by a digit it is a
    // decimal point, and 1234.5 is not 1234. The same for a decimal comma.
    const boundedAfter = !/\d/.test(after)
      && !(/[.,]/.test(after) && /\d/.test(hay[at + needle.length + 1] ?? ""));
    if (boundedBefore && boundedAfter) return at;
    i = at + 1;
  }
}

export type GateInput = {
  fieldKey: string;
  excerpt?: string | null;
  numeric?: NumericClaim | null;
  /** A proposed stage: the quote must name the stage that decides the tier. */
  stage?: Record<string, boolean | null> | null;
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

  let anchor = input.numeric
    ? anchorNumeric(input.numeric, doc)
    : anchorExcerpt(input.excerpt ?? "", doc);
  if (anchor.mode === "none" && !anchor.inexact) {
    anchor = (input.numeric
      ? quotedFigure(input.numeric, input.excerpt ?? "", doc)
      : anchorLoosely(input.excerpt ?? "", doc)) ?? anchor;
  }

  if (anchor.mode === "exact_normalized" || anchor.mode === "proximity") {
    const unsupported = input.stage ? unsupportedStage(input.stage, input.excerpt ?? "") : null;
    if (unsupported) {
      // The quote is real but does not say what decides the tier. Held for a
      // person, never bulk-accepted -- not "unsupported", which counts as a
      // fabrication: nothing here was invented, only over-read.
      return { state: "anchor_mismatch", anchor, bulkAcceptable: false,
               reason: `the quote does not mention ${unsupported}, the stage that decides the tier` };
    }
    return { state: "proposed", anchor, bulkAcceptable: true };
  }
  if (anchor.mode === "label_only") {
    // Plausible but unanchored. Quarantined, never bulk-acceptable, shown
    // beside the document so a human can adjudicate against the source.
    return { state: "anchor_mismatch", anchor, bulkAcceptable: false, reason: anchor.reason };
  }
  if (anchor.inexact) {
    // In the document, but not as claimed. Held the same way: a person reads
    // it beside the source. Not a fabrication, so not counted as one.
    return { state: "anchor_mismatch", anchor, bulkAcceptable: false, reason: anchor.reason };
  }
  // Absent from the document. Never surfaced as a proposal; counted in the
  // per-run hallucination rate that gates publish.
  return { state: "unsupported", anchor, bulkAcceptable: false, reason: anchor.reason };
}

/**
 * A figure whose quote is in the document (loosely) and contains the figure.
 * Neither its label nor its scale was confirmed where it appears -- a
 * thousandfold error would pass here -- which is why it is held, not proposed.
 */
function quotedFigure(claim: NumericClaim, excerpt: string, doc: StoredDocument): AnchorResult | null {
  const found = anchorLoosely(excerpt, doc);
  if (!found) return null;
  const quote = numericHaystack(excerpt.replace(ESCAPES, " "));
  const figures = [normalizeNumeral(claim.value / SCALE_MULTIPLIER[claim.scale]), normalizeNumeral(claim.value)];
  if (!figures.some((n) => n && indexOfNumeral(quote, n, 0) !== -1)) return null;
  return { ...found, inexact: "quoted",
           reason: "the figure is in the quote and the quote is in the document; its label, scale and " +
                   "currency were not confirmed where it appears" };
}

/**
 * The stage that decides a tier, in the order the rules read them, and the
 * words that name it in English and French filings.
 *
 * Run 1: Radisson's finding set royalty/streaming true on a quote that said
 * only "an exploration and development project". The quote was real, so the
 * gate passed it; royalty outranks development, so the company was published
 * as a royalty company. Only the deciding stage is checked: a producer's
 * quote about production need not also mention its exploration.
 */
const DECIDING_ORDER = ["production", "royalty_streaming", "development", "exploration"] as const;
const STAGE_NAMED: Record<typeof DECIDING_ORDER[number], { words: RegExp; label: string }> = {
  production: { words: /produc|commercial production|operating mines?|mining operations?|en exploitation/, label: "production" },
  royalty_streaming: { words: /royalt|\bstream|redevance|\bflux\b/, label: "a royalty or stream" },
  development: { words: /develop|développ|construction|feasibility|faisabilité|mise en valeur/, label: "development" },
  exploration: { words: /explor/, label: "exploration" },
};

export function unsupportedStage(stage: Record<string, boolean | null>, excerpt: string): string | null {
  const deciding = DECIDING_ORDER.find((s) => stage[s] === true);
  if (!deciding) return null;
  return STAGE_NAMED[deciding].words.test(normalize(excerpt)) ? null : STAGE_NAMED[deciding].label;
}
