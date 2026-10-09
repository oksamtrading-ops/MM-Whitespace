/**
 * The controlled vocabulary for Canadian jurisdictions, mirrored from
 * mmparser/aliases.py so the map, the bars and the companies table fold the
 * same spellings the same way. `jurisdictions.test.ts` reads the Python file
 * and fails if the two drift.
 *
 * Nothing here is a list of what to draw: the axis is still derived from the
 * snapshot's buckets. This only says what a bucket key means and which keys
 * are the same place.
 */
export const CANADA_SUBDIVISIONS: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba",
  NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut",
  ON: "Ontario", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
  PE: "Prince Edward Island",
};

export const CANADA_ALIASES: Record<string, string> = { nwt: "NT", yk: "YT", que: "QC", pei: "PE" };

/** "NWT" -> "NT", "bc" -> "BC"; an unknown key comes back unchanged and upper-cased. */
export function provinceCode(raw: string): string {
  const k = raw.trim();
  const alias = CANADA_ALIASES[k.toLowerCase()];
  if (alias) return alias;
  const up = k.toUpperCase();
  return up in CANADA_SUBDIVISIONS ? up : up;
}

export function provinceName(code: string): string {
  return CANADA_SUBDIVISIONS[code] ?? code;
}

/**
 * Fold bucket rows onto canonical codes. Two spellings of one territory in
 * the snapshot become one number here, and the same number everywhere.
 */
export function foldProvinces(rows: Array<{ bucket: string; n: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const code = provinceCode(r.bucket);
    out.set(code, (out.get(code) ?? 0) + r.n);
  }
  return out;
}

/**
 * US states by code. The one copy: EDGAR's head-office reading (edgar.ts)
 * imports it from here, so a head office it records and a head office the
 * companies table reads back can never spell a state two ways. It lives in
 * this module rather than edgar.ts because a client component reads it, and
 * edgar.ts reaches the network stack.
 */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export type HqGroup = "Canada" | "United States" | "Other countries";

/**
 * A head office as the table shows it and filters on it.
 *
 * Stored long, as research and the workbook both write it: "Ontario, Canada",
 * "Colorado, United States", or a country alone ("Chile"). Shown short, the
 * way the source workbook's Head Office column reads -- "ON", "CO", "Chile" --
 * with the city in front where research found one. The key is what a filter
 * matches: "CA:ON", "US:CO", or the country.
 */
export function hqJurisdiction(region: string | null | undefined): {
  key: string; short: string; label: string; group: HqGroup;
} | null {
  const text = (region ?? "").trim();
  if (!text) return null;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const country = parts[parts.length - 1];
  const sub = parts.length > 1 ? parts.slice(0, -1).join(", ") : null;
  const codeOf = (map: Record<string, string>, name: string | null) => {
    if (!name) return null;
    const up = name.toUpperCase();
    if (up in map) return up;
    return Object.entries(map).find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0] ?? null;
  };
  if (/^canada$/i.test(country)) {
    const code = codeOf(CANADA_SUBDIVISIONS, sub);
    return code
      ? { key: `CA:${code}`, short: code, label: CANADA_SUBDIVISIONS[code], group: "Canada" }
      : { key: "Canada", short: "Canada", label: "Canada", group: "Canada" };
  }
  if (/^(?:united states|usa|us|united states of america)$/i.test(country)) {
    const code = codeOf(US_STATES, sub);
    return code
      ? { key: `US:${code}`, short: code, label: US_STATES[code], group: "United States" }
      : { key: "United States", short: "USA", label: "United States", group: "United States" };
  }
  return { key: country, short: country, label: country, group: "Other countries" };
}
