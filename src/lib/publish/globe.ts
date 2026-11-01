/**
 * The globe's places: shapes decoded from `world.ts`, and the one function
 * that says which shape a published value names.
 *
 * The snapshot already writes places in three vocabularies -- a province code
 * under CANADA, a state code under USA, a country name everywhere else -- and
 * a head office as "Ontario, Canada", "Colorado, United States" or a country.
 * `placeOfProperty` and `placeOfHeadOffice` fold both onto the topology's keys
 * ("CA:ON", "US:NV", "Mexico"), so the globe, its bars and the roster link
 * agree on what a place is. A name the geometry does not know comes back as
 * null and is shown in words, never dropped and never guessed onto a shape.
 *
 * Pure: no React, no database. A server component and the client globe both
 * read it.
 */
import { hqJurisdiction, provinceCode } from "./jurisdictions.ts";

export type Topology = {
  type: "Topology";
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: Array<Array<[number, number]>>;
  objects: Record<"provinces" | "states" | "countries", {
    type: "GeometryCollection";
    geometries: Array<{
      type: "Polygon" | "MultiPolygon" | null;
      id: string;
      arcs?: number[][] | number[][][];
      properties?: { anchor: [number, number] };
    }>;
  }>;
};

export type PlaceKind = "province" | "state" | "country";
export type Ring = Array<[number, number]>;
export type PlaceGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

export type Place = {
  key: string;
  kind: PlaceKind;
  /** null for a place too small to keep a ring at the globe's detail. */
  geometry: PlaceGeometry | null;
  /** [longitude, latitude]: a province's label point, else its largest part's centroid. */
  anchor: [number, number];
};

const KIND: Record<keyof Topology["objects"], PlaceKind> = { provinces: "province", states: "state", countries: "country" };

/** TopoJSON to places: delta-decoded arcs, stitched into rings. */
export function decodePlaces(topology: Topology): Place[] {
  const { scale: [sx, sy], translate: [tx, ty] } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
  const ring = (indexes: number[]): Ring => {
    const points: Ring = [];
    for (const i of indexes) {
      const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
      // Consecutive arcs share an end point; keep it once.
      points.push(...(points.length ? arc.slice(1) : arc));
    }
    while (points.length < 4) points.push(points[0]);
    return points;
  };
  const places: Place[] = [];
  for (const name of Object.keys(KIND) as Array<keyof Topology["objects"]>) {
    for (const g of topology.objects[name].geometries) {
      const anchor = g.properties?.anchor ?? [0, 0];
      let geometry: PlaceGeometry | null = null;
      if (g.type === "Polygon") geometry = { type: "Polygon", coordinates: (g.arcs as number[][]).map(ring) };
      if (g.type === "MultiPolygon") geometry = { type: "MultiPolygon", coordinates: (g.arcs as number[][][]).map((p) => p.map(ring)) };
      places.push({ key: g.id, kind: KIND[name], geometry, anchor });
    }
  }
  return places;
}

/** Names a filing or a person might write for a country the geometry spells otherwise. */
const COUNTRY_ALIASES: Record<string, string> = {
  "drc": "Democratic Republic of the Congo",
  "dr congo": "Democratic Republic of the Congo",
  "congo kinshasa": "Democratic Republic of the Congo",
  "congo brazzaville": "Republic of the Congo",
  "congo": "Republic of the Congo",
  "turkey": "Türkiye",
  "ivory coast": "Côte d'Ivoire",
  "uk": "United Kingdom",
  "great britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "png": "Papua New Guinea",
  "czech republic": "Czechia",
  "burma": "Myanmar",
  "swaziland": "Eswatini",
  "east timor": "Timor-Leste",
  "south korea": "South Korea",
  "republic of korea": "South Korea",
  "russian federation": "Russia",
  "macedonia": "North Macedonia",
  "cape verde": "Cabo Verde",
  "bvi": "British Virgin Islands",
  "the bahamas": "Bahamas",
  "uae": "United Arab Emirates",
  "kyrgyz republic": "Kyrgyzstan",
  "lao pdr": "Laos",
  "viet nam": "Vietnam",
  "columbia": "Colombia",
};

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Country name, in any of the spellings above, to the geometry's key; null when unknown. */
export function countryKey(name: string, known: ReadonlySet<string>): string | null {
  const text = name.trim();
  if (!text) return null;
  if (known.has(text)) return text;
  const f = fold(text);
  const alias = COUNTRY_ALIASES[f];
  if (alias && known.has(alias)) return alias;
  for (const k of known) if (!k.includes(":") && fold(k) === f) return k;
  return null;
}

/** A `property_regions` entry under its group to a place key. */
export function placeOfProperty(group: string, entry: string, known: ReadonlySet<string>): string | null {
  const g = group.trim().toUpperCase();
  if (g === "CANADA") {
    const key = `CA:${provinceCode(entry)}`;
    return known.has(key) ? key : null;
  }
  if (g === "USA") {
    const key = `US:${entry.trim().toUpperCase()}`;
    return known.has(key) ? key : null;
  }
  return countryKey(entry, known);
}

/**
 * A head office region to a place key. A country alone ("Canada", "United
 * States") has no province or state to stand on, so it comes back null: the
 * globe says it in words rather than plant it in the middle of the country.
 */
export function placeOfHeadOffice(region: string | null | undefined, known: ReadonlySet<string>): string | null {
  const j = hqJurisdiction(region);
  if (!j) return null;
  if (j.key.startsWith("CA:") || j.key.startsWith("US:")) return known.has(j.key) ? j.key : null;
  if (j.group !== "Other countries") return null;
  return countryKey(j.key, known);
}

/** What the globe calls a place in words. */
export function placeName(key: string, names: { province: (code: string) => string; state: (code: string) => string }): string {
  if (key.startsWith("CA:")) return names.province(key.slice(3));
  if (key.startsWith("US:")) return names.state(key.slice(3));
  return key;
}
