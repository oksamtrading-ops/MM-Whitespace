/**
 * Head-office cities: the point a head office stands on, so the globe can
 * draw one disc per city where the place alone could only shade a province,
 * a state or a country.
 *
 * Research writes the city as the filing gives it -- "Montréal" and
 * "Montreal", "St. John's", at times with its region after a comma,
 * "Vancouver, BC" -- beside a region that `placeOfHeadOffice` folds to a
 * place key. `cityPoint` folds the spellings onto one entry and looks for it
 * in that place only: London is in Ontario and in England, Perth in Ontario
 * and in Western Australia, and Saint John (New Brunswick) is not St. John's
 * (Newfoundland). A city the table does not know, or one filed under a place
 * it is not in, comes back null and is shown in words, never guessed onto a
 * point.
 *
 * Not a geocoder: the cities the published snapshot names, and a modest set of
 * the industry's usual head-office cities. Points are [longitude, latitude] to
 * two decimals, about a kilometre, at the city's downtown; `cities.test.ts`
 * holds each inside its place's shape.
 *
 * Pure: no React, no database. A server component and the client globe both
 * read it.
 */

export type City = {
  /** As the globe writes it: "Montréal", "Val-d'Or", "St. John's". */
  name: string;
  /** The place it stands in, keyed as `globe.ts` keys places: "CA:QC", "US:CO", "Australia". */
  key: string;
  /** [longitude, latitude]. */
  at: [number, number];
};

/**
 * A city's other names. `spelt`: the same city spelt another way ("Genève",
 * "Ulan Bator"), which counts wherever its own name does. `suburbs`: a suburb,
 * town or island a published head office names, drawn as the metro it belongs
 * to rather than as a disc of its own -- West Vancouver as Vancouver, Baar as
 * Zug, Tortola as Road Town. A suburb is listed only once a published value
 * names it, so the list grows from the data and not from a map, and it counts
 * only in its own place: Westminster is Denver's because a Colorado head office
 * gave it, and with no place, or in England, it is no point.
 */
type Also = { spelt?: readonly string[]; suburbs?: readonly string[] };
type Row = readonly [name: string, key: string, at: [number, number], also?: Also];

const TABLE: readonly Row[] = [
  // Canada, west to east, then the north.
  ["Vancouver", "CA:BC", [-123.12, 49.28], { suburbs: ["West Vancouver"] }],
  ["Calgary", "CA:AB", [-114.07, 51.05]],
  ["Edmonton", "CA:AB", [-113.49, 53.55]],
  ["Saskatoon", "CA:SK", [-106.67, 52.13]],
  ["Regina", "CA:SK", [-104.62, 50.45]],
  ["Winnipeg", "CA:MB", [-97.14, 49.9]],
  ["Toronto", "CA:ON", [-79.38, 43.65], { suburbs: ["Oakville"] }],
  ["London", "CA:ON", [-81.25, 42.98]],
  ["Perth", "CA:ON", [-76.25, 44.9]],
  ["Sudbury", "CA:ON", [-80.99, 46.49], { spelt: ["Greater Sudbury"] }],
  ["Timmins", "CA:ON", [-81.33, 48.48]],
  ["Matheson", "CA:ON", [-80.47, 48.53]],
  ["Montréal", "CA:QC", [-73.57, 45.5], { suburbs: ["Brossard", "Mont-Royal"] }],
  ["Québec City", "CA:QC", [-71.21, 46.81]],
  ["Rouyn-Noranda", "CA:QC", [-79.02, 48.24]],
  ["Val-d'Or", "CA:QC", [-77.78, 48.1]],
  ["Saint-Sauveur", "CA:QC", [-74.16, 45.89]],
  ["Saint-Michel-des-Saints", "CA:QC", [-73.92, 46.68]],
  ["Saint John", "CA:NB", [-66.06, 45.27]],
  ["Halifax", "CA:NS", [-63.57, 44.65], { suburbs: ["Bedford", "Dartmouth"] }],
  ["St. John's", "CA:NL", [-52.71, 47.56]],
  ["St. George's", "CA:NL", [-58.48, 48.43]],
  ["Whitehorse", "CA:YT", [-135.06, 60.72]],
  ["Yellowknife", "CA:NT", [-114.37, 62.45]],
  // The United States.
  ["Anchorage", "US:AK", [-149.9, 61.22]],
  ["Fairbanks", "US:AK", [-147.72, 64.84]],
  ["Spokane", "US:WA", [-117.43, 47.66]],
  ["Boise", "US:ID", [-116.2, 43.62]],
  ["Reno", "US:NV", [-119.81, 39.53]],
  ["Elko", "US:NV", [-115.76, 40.83]],
  ["Salt Lake City", "US:UT", [-111.89, 40.76]],
  ["Phoenix", "US:AZ", [-112.07, 33.45], { suburbs: ["Tempe"] }],
  ["Denver", "US:CO", [-104.99, 39.74], { suburbs: ["Englewood", "Littleton", "Westminster"] }],
  ["Casper", "US:WY", [-106.32, 42.85]],
  ["Dallas", "US:TX", [-96.8, 32.78]],
  ["Houston", "US:TX", [-95.37, 29.76]],
  ["Chicago", "US:IL", [-87.63, 41.88]],
  ["Knoxville", "US:TN", [-83.92, 35.96]],
  ["Miami", "US:FL", [-80.19, 25.76]],
  ["New York", "US:NY", [-74.01, 40.71], { spelt: ["New York City"] }],
  // Latin America and the Caribbean.
  ["Mexico City", "Mexico", [-99.13, 19.43], { spelt: ["Ciudad de México"] }],
  ["Bogotá", "Colombia", [-74.07, 4.71]],
  ["Medellín", "Colombia", [-75.57, 6.25]],
  ["Quito", "Ecuador", [-78.47, -0.18]],
  ["Lima", "Peru", [-77.04, -12.05]],
  ["Santiago", "Chile", [-70.65, -33.45]],
  ["Buenos Aires", "Argentina", [-58.38, -34.6]],
  ["Belo Horizonte", "Brazil", [-43.93, -19.92]],
  ["Rio de Janeiro", "Brazil", [-43.17, -22.91]],
  ["Nassau", "Bahamas", [-77.34, 25.08]],
  ["George Town", "Cayman Islands", [-81.38, 19.3]],
  ["Road Town", "British Virgin Islands", [-64.62, 18.43], { suburbs: ["Tortola"] }],
  // Europe, Africa and the Middle East.
  ["London", "United Kingdom", [-0.13, 51.51], { suburbs: ["Cobham"] }],
  ["Zug", "Switzerland", [8.52, 47.17], { suburbs: ["Baar"] }],
  ["Geneva", "Switzerland", [6.14, 46.2], { spelt: ["Genève"] }],
  ["Johannesburg", "South Africa", [28.05, -26.2]],
  ["Dubai", "United Arab Emirates", [55.27, 25.2]],
  ["Grand Baie", "Mauritius", [57.58, -20.01]],
  // Asia and Australia.
  ["Ulaanbaatar", "Mongolia", [106.92, 47.92], { spelt: ["Ulan Bator"] }],
  ["Hong Kong", "Hong Kong", [114.17, 22.32]],
  ["Singapore", "Singapore", [103.85, 1.29]],
  ["Perth", "Australia", [115.86, -31.95], { suburbs: ["Subiaco"] }],
  ["Brisbane", "Australia", [153.03, -27.47]],
  ["Sydney", "Australia", [151.21, -33.87], { suburbs: ["Rozelle"] }],
  ["Melbourne", "Australia", [144.96, -37.81]],
];

/**
 * A name to the form its spellings share: accents and case gone, "St" and
 * "Ste" read as Saint and Sainte, and hyphens, stops and spaces dropped, so
 * "Val-d'Or", "Val d’Or" and "VAL D'OR" are one city. An apostrophe joins and
 * never splits: "St. John's" folds to "saintjohns" and "Saint John" to
 * "saintjohn", two cities kept two.
 */
function fold(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['‘’ʼ`´]/g, "")
    .split(/[^a-z0-9]+/)
    .map((w) => (w === "st" ? "saint" : w === "ste" ? "sainte" : w))
    .join("");
}

export const CITIES: readonly City[] = TABLE.map(([name, key, at]) => ({ name, key, at }));

/** By place and any name a city goes by there: its own, a spelling, a suburb. */
const IN_PLACE = new Map<string, City>();
/** By a city's own name or spelling alone, for a head office with no place: London and Perth have two each. */
const BY_NAME = new Map<string, Set<City>>();
TABLE.forEach(([name, , , { spelt = [], suburbs = [] } = {}], i) => {
  const city = CITIES[i];
  for (const n of [name, ...spelt]) {
    const f = fold(n);
    BY_NAME.set(f, (BY_NAME.get(f) ?? new Set<City>()).add(city));
  }
  for (const n of [name, ...spelt, ...suburbs]) IN_PLACE.set(`${city.key}|${fold(n)}`, city);
});

/** The point for a head office: its city within its place, or null when the city is not known here. */
export function cityPoint(city: string | null, hq: string | null): City | null {
  // A value sometimes carries its region after the city -- "Vancouver, BC",
  // "Toronto, Ontario, Canada" -- so the city is what comes before the first comma.
  const name = fold((city ?? "").split(",")[0]);
  if (!name) return null;
  if (hq) return IN_PLACE.get(`${hq}|${name}`) ?? null;
  // With no place to look in, a city counts by its own name or a spelling,
  // never a suburb, and only when no other city shares it: "Saskatoon" and
  // "Genève" are points, "London" is not, and "Westminster" never is.
  const found = BY_NAME.get(name);
  return found?.size === 1 ? [...found][0] : null;
}
