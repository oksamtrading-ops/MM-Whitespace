/**
 * Every field's value, as a person reads it and as a person types it.
 *
 * One module for both directions, because the review grid fills its override
 * box with the DISPLAYED value: whatever is shown must parse back to the value
 * it came from, or editing one word of it stores something else. Run 1 found
 * exactly that: the stage showed as "exploration + development + royalty
 * streaming", and deleting "+ royalty streaming" would have stored a string
 * the tiering read as "no stage" -- a company silently unclassified. The
 * round trip is tested field by field (fields.test.ts).
 *
 * Money always carries its currency. A bare "$" is ambiguous on a page where
 * one company reports in Canadian dollars and the next in US dollars, so CAD
 * is written C$ and USD US$, never "$" alone.
 *
 * No node imports: client components use this too.
 */

/** A fee as research records it: the amount in units, its currency, its year. */
export type Money = { amount: number; currency: string | null; fiscal_year: number | null };

export type Stage = "exploration" | "development" | "production" | "royalty_streaming";
export const STAGE_ORDER: readonly Stage[] = ["exploration", "development", "production", "royalty_streaming"];

/** The regions the workbook uses, in the order it lists them. */
export const REGIONS = ["CANADA", "USA", "LATIN AMERICA", "UK/EUROPE", "AFRICA", "ASIA", "AUS/NZ/PNG", "OTHER"];

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

/* ----------------------------------------------------------------- money */

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/^(?:c\$|ca\$|cdn\$?|can\$|cad|canadian(?: dollars?)?)$/i, "CAD"],
  [/^(?:us\$|u\.s\.\$|usd|u\.?s\.? dollars?|us dollars?|united states dollars?)$/i, "USD"],
  [/^(?:a\$|au\$|aud|australian dollars?)$/i, "AUD"],
  [/^(?:£|gbp|pounds?(?: sterling)?)$/i, "GBP"],
  [/^(?:€|eur|euros?)$/i, "EUR"],
];

/** "C$", "cad", "Canadian dollars" -> "CAD". A bare "$" names no currency. */
export function currencyCode(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  for (const [re, code] of CURRENCY_ALIASES) if (re.test(t)) return code;
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : null;
}

const PREFIX: Record<string, string> = { CAD: "C$", USD: "US$", AUD: "A$", GBP: "£", EUR: "€" };

/**
 * 1060201462 CAD -> "C$1,060,201,462"; 517116 USD -> "US$517,116";
 * compact: 200000000 CAD -> "C$200M". Cents only when there are cents, or
 * when asked for (spend, where $0.42 must not read as $0).
 */
export function formatMoney(amount: number, currency: string | null,
                            opts: { compact?: boolean; cents?: boolean } = {}): string {
  const abs = Math.abs(amount);
  const digits = opts.cents || !Number.isInteger(abs) ? 2 : 0;
  const figure = opts.compact
    ? compact(abs)
    : new Intl.NumberFormat("en-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(abs);
  const code = currency ? currency.toUpperCase() : null;
  const sign = amount < 0 ? "-" : "";
  if (!code) return `${sign}${figure}`;
  const prefix = PREFIX[code];
  return prefix ? `${sign}${prefix}${figure}` : `${sign}${code} ${figure}`;
}

function compact(n: number): string {
  const cut = (x: number) => (Math.round(x * 10) / 10).toString();
  if (n >= 1e9) return `${cut(n / 1e9)}B`;
  if (n >= 1e6) return `${cut(n / 1e6)}M`;
  if (n >= 1e3) return `${cut(n / 1e3)}K`;
  return String(n);
}

export function formatInteger(n: number): string {
  return new Intl.NumberFormat("en-CA").format(n);
}

function isMoney(v: unknown): v is Money {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v) && typeof (v as Money).amount === "number";
}

/** "C$8,052,000 (FY2025)". A fee stored before currencies were kept says so. */
export function formatFee(v: unknown): string {
  if (isMoney(v)) {
    return `${formatMoney(v.amount, v.currency)}${v.fiscal_year ? ` (FY${v.fiscal_year})` : ""}` +
           (v.currency ? "" : " (currency not recorded)");
  }
  if (typeof v === "number") return `${formatInteger(v)} (currency not recorded)`;
  return v === null || v === undefined ? "—" : String(v);
}

/**
 * "C$353,190 (FY2024)", "US$517,116", "$1,200 CAD", "nil US$ FY2025" -> Money.
 * The currency is required: a fee without one is the ambiguity this exists
 * to remove.
 */
export function parseMoney(text: string, opts: { requireCurrency?: boolean } = {}): Parsed {
  let t = text.trim().replace(/[\u00A0\u202F\u2009]/g, " ");
  if (!t) return { ok: false, message: "Enter an amount, e.g. C$353,190 or US$517,116." };

  let fiscal: number | null = null;
  t = t.replace(/\(?\s*(?:FY|fiscal(?: year)?)\s*'?(\d{4})\s*\)?/i, (_, y: string) => { fiscal = Number(y); return " "; });
  t = t.replace(/\(currency not recorded\)/i, " ");

  let currency: string | null = null;
  const takeCurrency = (raw: string) => {
    const code = currencyCode(raw);
    if (code) currency = code;
    return code ? " " : raw;
  };
  // A symbol or code before or after the figure.
  t = t.replace(/(?:c\$|ca\$|cdn\$|can\$|us\$|u\.s\.\$|a\$|au\$|£|€)/gi, (m) => takeCurrency(m));
  t = t.replace(/\b(?:cad|usd|aud|gbp|eur)\b/gi, (m) => takeCurrency(m));
  const bareDollar = /\$/.test(t);
  t = t.replace(/\$/g, " ").trim();

  let amount: number | null = null;
  if (/^(?:nil|none|-|—)$/i.test(t)) amount = 0;
  else {
    const m = t.match(/^(-?[\d,\s]*\d(?:\.\d+)?)\s*(k|thousand|m|million)?$/i);
    if (m) {
      const n = Number(m[1].replace(/[,\s]/g, ""));
      const unit = (m[2] ?? "").toLowerCase();
      const scaled = n * (unit.startsWith("m") ? 1_000_000 : unit.startsWith("k") || unit === "thousand" ? 1_000 : 1);
      amount = Math.round(scaled * 100) / 100;   // 8.052 million is 8,052,000, not 8,051,999.999…
    }
  }
  if (amount === null || !Number.isFinite(amount)) {
    return { ok: false, message: `"${text.trim()}" is not an amount. Write it as C$353,190 or US$517,116.` };
  }
  if (!currency && (opts.requireCurrency ?? true)) {
    return { ok: false, message: bareDollar
      ? "A bare $ does not say which dollar. Write C$ for Canadian or US$ for US dollars."
      : "Say which currency, e.g. C$353,190 or US$517,116." };
  }
  return { ok: true, value: { amount, currency, fiscal_year: fiscal } satisfies Money };
}

/* ---------------------------------------------------------------- stages */

const STAGE_WORDS: Record<Stage, string> = {
  exploration: "exploration", development: "development",
  production: "production", royalty_streaming: "royalty streaming",
};

export function asStageFlags(v: unknown): Partial<Record<Stage, boolean | null>> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return STAGE_ORDER.some((s) => s in (v as object)) ? v as Partial<Record<Stage, boolean | null>> : null;
}

/** {exploration: true, development: true} -> "exploration + development". */
export function formatStages(flags: Partial<Record<Stage, boolean | null>>): string {
  const on = STAGE_ORDER.filter((s) => flags[s] === true).map((s) => STAGE_WORDS[s]);
  return on.length ? on.join(" + ") : "no stage";
}

/**
 * "exploration + development" -> every stage decided: those named true, the
 * rest false. Anything that is not a stage is refused, never stored as text.
 */
export function parseStages(text: string): Parsed {
  const t = text.trim();
  const usage = "Write stages as: exploration + development + production + royalty streaming.";
  if (!t) return { ok: false, message: `Name at least one stage. ${usage}` };
  if (t.startsWith("{")) {
    try {
      const flags = asStageFlags(JSON.parse(t));
      if (flags && STAGE_ORDER.every((s) => flags[s] === undefined || typeof flags[s] === "boolean" || flags[s] === null)) {
        return { ok: true, value: Object.fromEntries(STAGE_ORDER.map((s) => [s, flags[s] ?? false])) };
      }
    } catch { /* fall through to the refusal */ }
    return { ok: false, message: usage };
  }
  if (/^no stage$/i.test(t)) return { ok: true, value: Object.fromEntries(STAGE_ORDER.map((s) => [s, false])) };
  const out: Record<Stage, boolean> = { exploration: false, development: false, production: false, royalty_streaming: false };
  for (const raw of t.split(/\s*(?:\+|,|&|\/|;|\band\b)\s*/i)) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    if (/^explor/.test(w)) out.exploration = true;
    else if (/^(?:develop|construct)/.test(w)) out.development = true;
    else if (/^produc/.test(w)) out.production = true;
    else if (/^(?:royalt|stream)/.test(w) || /^royalty[ _]?stream/.test(w)) out.royalty_streaming = true;
    else return { ok: false, message: `"${raw.trim()}" is not a stage. ${usage}` };
  }
  return { ok: true, value: out };
}

/* ------------------------------------------------------- everything else */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "12-31" -> "31 December". */
export function formatMonthDay(v: string): string {
  const m = v.match(/^(\d{2})-(\d{2})$/);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : v;
}

function parseMonthDay(text: string): Parsed {
  const t = text.trim();
  let month = 0; let day = 0;
  const numeric = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  const monthOf = (name: string) => MONTHS.findIndex((m) => m.toLowerCase().startsWith(name.toLowerCase().slice(0, 3))) + 1;
  if (numeric) { month = Number(numeric[1]); day = Number(numeric[2]); }
  else {
    const dm = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?$/); const md = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/);
    if (dm) { day = Number(dm[1]); month = monthOf(dm[2]); }
    else if (md) { month = monthOf(md[1]); day = Number(md[2]); }
  }
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) {
    return { ok: false, message: `"${t}" is not a day of the year. Write it as 31 December.` };
  }
  return { ok: true, value: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/** "LATIN AMERICA" reads as a region, not a shout. Short all-caps tokens stay. */
function titleish(region: string): string {
  return region.split(/([ /])/).map((part) =>
    /^[A-Z]{1,3}$/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()).join("");
}

function formatRegions(raw: Record<string, unknown>): string {
  // Only the regions with something in them; eight empty buckets is noise.
  const held = Object.entries(raw)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([region, v]) => `${titleish(region)}: ${(v as string[]).join(", ")}`);
  return held.length ? held.join(" · ") : "No properties recorded";
}

function parseRegions(text: string): Parsed {
  const out: Record<string, string[]> = Object.fromEntries(REGIONS.map((r) => [r, []]));
  const t = text.trim();
  if (/^no properties recorded$/i.test(t)) return { ok: true, value: out };
  for (const part of t.split(/\s*·\s*|\s*;\s*/)) {
    const m = part.match(/^([^:]+):\s*(.*)$/);
    const key = m ? REGIONS.find((r) => r.toLowerCase() === m[1].trim().toLowerCase()) : undefined;
    if (!m || !key) {
      return { ok: false, message: `"${part}" is not a region. Write e.g. Canada: QC, ON · USA: NV. ` +
                                    `Regions: ${REGIONS.map(titleish).join(", ")}.` };
    }
    out[key] = m[2].split(/\s*,\s*/).filter(Boolean);
  }
  return { ok: true, value: out };
}

/** Every value as it should read on a page. */
export function formatFieldValue(fieldKey: string, raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  switch (fieldKey) {
    case "audit_fee": case "tax_fee":
      return formatFee(raw);
    case "market_cap_cad":
      return typeof raw === "number" ? formatMoney(raw, "CAD") : String(raw);
    case "fiscal_year_end":
      return typeof raw === "string" ? formatMonthDay(raw) : String(raw);
    case "auditor_since": case "tier":
      return String(raw);   // a year is not a quantity: 2017, never 2,017
    case "stage_evidence_state": case "property_evidence_state": {
      const flags = asStageFlags(raw);
      if (flags) return formatStages(flags);
      return typeof raw === "string" ? raw.charAt(0).toUpperCase() + raw.slice(1) : String(raw);
    }
  }
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") return formatInteger(raw);
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // The structured researched fields read as sentences, not as the keys that
    // happen to be true -- "registrant" alone drops the form.
    if ("registrant" in o) {
      return o.registrant
        ? `SEC registrant${o.form ? `, files ${o.form}` : ""}${o.cik ? ` (CIK ${o.cik})` : ""}`
        : "Not an SEC registrant";
    }
    if ("changed" in o) {
      return o.changed
        ? `Changed${o.date ? ` ${o.date}` : ""}${o.previous_auditor ? ` from ${o.previous_auditor}` : ""}`
        : "No change in 24 months";
    }
    if (REGIONS.some((r) => r in o)) return formatRegions(o);
    const flags = asStageFlags(o);
    if (flags) return formatStages(flags);
    const on = Object.entries(o).filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, " "));
    return on.length ? on.join(" + ") : JSON.stringify(o);
  }
  return String(raw);
}

/**
 * What a person typed, as the value to store -- or why it cannot be. Every
 * form formatFieldValue produces is accepted back.
 */
export function parseFieldInput(fieldKey: string, text: string): Parsed {
  const t = text.trim();
  switch (fieldKey) {
    case "stage_evidence_state": return parseStages(t);
    case "audit_fee": case "tax_fee": return parseMoney(t);
    case "market_cap_cad": {
      const m = parseMoney(t, { requireCurrency: false });
      if (!m.ok) return m;
      const money = m.value as Money;
      if (money.currency && money.currency !== "CAD") {
        return { ok: false, message: "Market cap is in Canadian dollars. Convert it, then enter it as C$…" };
      }
      return { ok: true, value: money.amount };
    }
    case "fiscal_year_end": return parseMonthDay(t);
    case "auditor_since": {
      const y = Number(t);
      return /^\d{4}$/.test(t) && y >= 1850 && y <= new Date().getUTCFullYear() + 1
        ? { ok: true, value: y }
        : { ok: false, message: `"${t}" is not a year. Write it as 2017.` };
    }
    case "sec_registrant": {
      if (/^(?:no|none|not(?: an)?(?: sec)? registrant|not registered)$/i.test(t)) {
        return { ok: true, value: { registrant: false, form: null, cik: null } };
      }
      const form = t.match(/\b(10-K|10-Q|20-F|40-F|6-K|8-K)\b/i)?.[1]?.toUpperCase() ?? null;
      const cik = t.match(/\bcik\s*:?\s*(\d{1,10})\b/i)?.[1] ?? null;
      if (/registrant|^yes\b/i.test(t) || form || cik) return { ok: true, value: { registrant: true, form, cik } };
      return { ok: false, message: "Write SEC registrant, files 40-F (CIK 1649752) — or: Not an SEC registrant." };
    }
    case "auditor_change": {
      if (/^no(?: change.*)?$/i.test(t)) return { ok: true, value: { changed: false, date: null, previous_auditor: null } };
      const m = t.match(/^changed(?:\s+(\d{4}(?:-\d{2}){0,2}))?(?:\s+from\s+(.+))?$/i);
      if (m) return { ok: true, value: { changed: true, date: m[1] ?? null, previous_auditor: m[2]?.trim() ?? null } };
      return { ok: false, message: "Write No change in 24 months — or: Changed 2025-06 from Grant Thornton." };
    }
    case "property_regions": return parseRegions(t);
    case "commodities": {
      const list = t.split(/\s*,\s*/).filter(Boolean);
      return list.length ? { ok: true, value: list } : { ok: false, message: "Name at least one commodity." };
    }
    case "venture_graduate":
      return /^(?:yes|true)$/i.test(t) ? { ok: true, value: true }
        : /^(?:no|false)$/i.test(t) ? { ok: true, value: false }
        : { ok: false, message: "Yes or No." };
    case "website": {
      if (!t) return { ok: false, message: "Enter the address." };
      const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      try { new URL(url); } catch { return { ok: false, message: `"${t}" is not a web address.` }; }
      return { ok: true, value: url };
    }
  }
  return t ? { ok: true, value: t } : { ok: false, message: "Enter a value." };
}
