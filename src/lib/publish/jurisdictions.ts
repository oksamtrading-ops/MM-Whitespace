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
