/**
 * The footprint map's tier switch, as plain data: which companies the map
 * shows, how a province's companies split across the tiers, and where "See
 * them" goes. Pure, so the client map and its tests read the same rules.
 *
 * The four reasons a company has no tier are one choice on the map,
 * "Unclassified": on a map they are one fact (no tier) and four chips would
 * crowd out the tiers. The companies table keeps them apart, and the link
 * carries all four so the table shows exactly the companies the map counted.
 */
import type { TierProvinces } from "./crosstabs.ts";

export type MapTierGroup = { key: string; label: string; tokens: readonly string[] };

export const MAP_TIER_GROUPS: readonly MapTierGroup[] = [
  ...["1", "2", "3", "4", "5", "6"].map((t) => ({ key: t, label: `Tier ${t}`, tokens: [t] })),
  { key: "unclassified", label: "Unclassified",
    tokens: ["no_stage", "no_property", "conflicting", "unclassified"] },
];

/** One group's companies by province, most first, and how many hold Canadian ground at all. */
export function groupRows(
  tiers: readonly TierProvinces[], group: MapTierGroup,
): { companies: number; rows: Array<{ code: string; n: number }> } {
  let companies = 0;
  const counts = new Map<string, number>();
  for (const t of tiers) {
    if (!group.tokens.includes(t.token)) continue;
    companies += t.companies;
    for (const r of t.rows) counts.set(r.code, (counts.get(r.code) ?? 0) + r.n);
  }
  return { companies, rows: [...counts].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n) };
}

/** How one province's companies split across the groups, leaving out the empty ones. */
export function provinceMix(
  tiers: readonly TierProvinces[], code: string,
): Array<{ label: string; n: number }> {
  return MAP_TIER_GROUPS
    .map((g) => ({ label: g.label, n: groupRows(tiers, g).rows.find((r) => r.code === code)?.n ?? 0 }))
    .filter((m) => m.n > 0);
}

/** "3 Tier 2 companies", "1 unclassified company": the count and its noun, for a sentence. */
export function companiesOf(group: MapTierGroup, n: number): string {
  const word = group.key === "unclassified" ? "unclassified" : group.label;
  return `${n} ${word} ${n === 1 ? "company" : "companies"}`;
}

/**
 * The companies table, narrowed to what the map is showing for a province.
 * All companies keeps the map's original link (?province=), which the table
 * still reads; a tier adds the same tokens the table's Tier filter uses.
 */
export function companiesHref(code: string, group: MapTierGroup | null): string {
  if (!group) return `/companies?province=${encodeURIComponent(code)}`;
  const q = new URLSearchParams([["prop", `CANADA:${code}`], ...group.tokens.map((t) => ["tier", t] as [string, string])]);
  return `/companies?${q.toString()}`;
}
