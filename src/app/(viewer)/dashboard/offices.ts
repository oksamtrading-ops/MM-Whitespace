import { cityPoint } from "../../../lib/publish/cities.ts";
import { DELOITTE, type AtlasCompany } from "../../../lib/publish/lens.ts";
import { anchorOf } from "../../_ui/Globe.tsx";
import { nameOf } from "./words.ts";

/**
 * Head offices as the globe draws them: one disc per city the gazetteer can
 * place, and one dashed disc per region for the head offices whose city it
 * cannot, so the discs always add up to every head office placed.
 */
export type Office = { key: string; place: string; label: string; at: [number, number]; n: number; ours: number; dashed: boolean };

export function officesOf(cs: readonly AtlasCompany[]): Office[] {
  const out = new Map<string, Office>();
  for (const c of cs) {
    if (!c.hq) continue;
    const city = cityPoint(c.hqCity, c.hq);
    const key = city ? `city:${c.hq}:${city.name}` : `rest:${c.hq}`;
    const at = city?.at ?? anchorOf(c.hq);
    if (!at) continue;
    const o = out.get(key) ?? { key, place: c.hq, label: city ? city.name : nameOf(c.hq), at, n: 0, ours: 0, dashed: !city };
    o.n++;
    if (c.auditor === DELOITTE) o.ours++;
    out.set(key, o);
  }
  return [...out.values()].sort((a, b) => b.n - a.n || Number(a.dashed) - Number(b.dashed) || a.label.localeCompare(b.label));
}
