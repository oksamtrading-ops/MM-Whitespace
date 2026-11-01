import { test } from "node:test";
import assert from "node:assert/strict";
import { geoCircle, geoContains, geoDistance } from "d3-geo";
import { CITIES, cityPoint } from "./cities.ts";
import { decodePlaces } from "./globe.ts";
import { WORLD } from "./world.ts";

const places = decodePlaces(WORLD);
const byKey = new Map(places.map((p) => [p.key, p]));
/** Kilometres in a radian of the globe's sphere. */
const EARTH_KM = 6371;

test("every city stands in the place it is filed under, and in no other", () => {
  for (const c of CITIES) {
    for (const x of c.at) assert.equal(Number(x.toFixed(2)), x, `${c.name}: ${x} is not to two decimals`);
    const place = byKey.get(c.key);
    assert.ok(place, `${c.name}: ${c.key} is not a place`);
    const shape = place.geometry;
    if (shape) {
      // The coastline is simplified, so a harbour city can fall just offshore
      // (Lima, Sydney): one within 0.35° of its shape still stands in it.
      const ring = geoCircle().center(c.at).radius(0.35).precision(45)().coordinates[0];
      assert.ok(geoContains(shape, c.at) || ring.some(([x, y]) => geoContains(shape, [x, y])),
        `${c.name} [${c.at}] is not in ${c.key}`);
    } else {
      // Too small to keep a ring at the globe's detail: near its anchor instead.
      // An archipelago's anchor is its largest island, and Nassau is 80 km from Andros.
      const km = geoDistance(c.at, place.anchor) * EARTH_KM;
      assert.ok(km < 150, `${c.name} is ${km.toFixed(0)} km from ${c.key}`);
    }
    const other = places.find((p) => p !== place && p.geometry && geoContains(p.geometry, c.at));
    assert.equal(other, undefined, `${c.name} [${c.at}] is in ${other?.key}, not ${c.key}`);
  }
});

test("every city is found by its own name in its place, and with no place when no other city shares it", () => {
  for (const c of CITIES) {
    assert.equal(cityPoint(c.name, c.key), c, `${c.name} in ${c.key}`);
    const shared = CITIES.some((d) => d !== c && d.name === c.name);
    assert.equal(cityPoint(c.name, null), shared ? null : c, `${c.name} with no place`);
  }
});

/* Every head-office city the newest publication names (Q4-2026, revision 6,
   1 November 2026): the place its region folds to, the city as research wrote
   it, and the city it is drawn as. A head office with no city is drawn by its
   place alone and is not here; nor are the three whose city is not in their
   region, which the last test holds to null. */
const PUBLISHED: Array<[hq: string, city: string, drawn: string]> = [
  ["CA:BC", "Vancouver", "Vancouver"], ["CA:BC", "West Vancouver", "Vancouver"], ["CA:SK", "Saskatoon", "Saskatoon"],
  ["CA:ON", "Toronto", "Toronto"], ["CA:ON", "Oakville", "Toronto"], ["CA:ON", "Sudbury", "Sudbury"],
  ["CA:ON", "Matheson", "Matheson"],
  ["CA:QC", "Montreal", "Montréal"], ["CA:QC", "Montréal", "Montréal"], ["CA:QC", "Brossard", "Montréal"],
  ["CA:QC", "Mont-Royal", "Montréal"], ["CA:QC", "Rouyn-Noranda", "Rouyn-Noranda"],
  ["CA:QC", "Saint-Sauveur", "Saint-Sauveur"], ["CA:QC", "Saint-Michel-des-Saints", "Saint-Michel-des-Saints"],
  ["CA:NS", "Halifax", "Halifax"], ["CA:NS", "Bedford", "Halifax"], ["CA:NS", "Dartmouth", "Halifax"],
  ["CA:NL", "St. John's", "St. John's"], ["CA:NL", "St. George's", "St. George's"],
  ["US:AK", "Fairbanks", "Fairbanks"], ["US:WA", "Spokane", "Spokane"], ["US:ID", "Boise", "Boise"],
  ["US:NV", "Reno", "Reno"], ["US:UT", "Salt Lake City", "Salt Lake City"],
  ["US:AZ", "Phoenix", "Phoenix"], ["US:AZ", "Tempe", "Phoenix"],
  ["US:CO", "Denver", "Denver"], ["US:CO", "Englewood", "Denver"], ["US:CO", "Littleton", "Denver"],
  ["US:CO", "Westminster", "Denver"], ["US:WY", "Casper", "Casper"],
  ["US:TX", "Dallas", "Dallas"], ["US:TX", "Houston", "Houston"], ["US:IL", "Chicago", "Chicago"],
  ["US:TN", "Knoxville", "Knoxville"], ["US:FL", "Miami", "Miami"],
  ["Colombia", "Medellín", "Medellín"], ["Brazil", "Rio de Janeiro", "Rio de Janeiro"],
  ["Argentina", "Buenos Aires", "Buenos Aires"],
  ["British Virgin Islands", "Road Town", "Road Town"], ["British Virgin Islands", "Tortola", "Road Town"],
  ["United Kingdom", "London", "London"], ["United Kingdom", "Cobham", "London"],
  ["Switzerland", "Zug", "Zug"], ["Switzerland", "Baar", "Zug"], ["Mauritius", "Grand Baie", "Grand Baie"],
  ["Australia", "Perth", "Perth"], ["Australia", "Subiaco", "Perth"], ["Australia", "Rozelle", "Sydney"],
];

test("every head-office city the snapshot names is drawn, in its own place", () => {
  for (const [hq, city, drawn] of PUBLISHED) {
    const found = cityPoint(city, hq);
    assert.ok(found, `${city} (${hq}) has no point`);
    assert.equal(found.name, drawn, `${city} (${hq})`);
    assert.equal(found.key, hq, `${city} (${hq})`);
  }
});

test("a city's spellings fold onto it", () => {
  const name = (city: string, hq: string) => cityPoint(city, hq)?.name ?? null;
  // The region after a comma is dropped, and so is the space around the city.
  assert.equal(name("Vancouver, BC", "CA:BC"), "Vancouver");
  assert.equal(name("Toronto, Ontario, Canada", "CA:ON"), "Toronto");
  assert.equal(name("  Perth, WA ", "Australia"), "Perth");
  // Accents and case.
  for (const s of ["Montreal", "Montréal", "MONTRÉAL", "montreal"]) assert.equal(name(s, "CA:QC"), "Montréal", s);
  assert.equal(name("Quebec City", "CA:QC"), "Québec City");
  assert.equal(name("Medellin", "Colombia"), "Medellín");
  // Saint, St. and St, and two cities that differ by an apostrophe kept two.
  for (const s of ["St. John's", "St John's", "Saint John's", "ST. JOHN’S"]) assert.equal(name(s, "CA:NL"), "St. John's", s);
  for (const s of ["Saint John", "St. John", "St John"]) assert.equal(name(s, "CA:NB"), "Saint John", s);
  assert.equal(name("Saint John", "CA:NL"), null, "Saint John is New Brunswick's");
  assert.equal(name("St. John's", "CA:NB"), null, "St. John's is Newfoundland's");
  assert.equal(name("St-Sauveur", "CA:QC"), "Saint-Sauveur");
  assert.equal(name("St. Michel des Saints", "CA:QC"), "Saint-Michel-des-Saints");
  // Hyphens, spaces and apostrophes.
  for (const s of ["Val-d'Or", "Val d'Or", "Val-d’Or", "Val D'Or", "VAL-D-OR"]) assert.equal(name(s, "CA:QC"), "Val-d'Or", s);
  for (const s of ["Rouyn-Noranda", "Rouyn Noranda", "Rouyn–Noranda"]) assert.equal(name(s, "CA:QC"), "Rouyn-Noranda", s);
  // Another spelling of the same city.
  assert.equal(name("Genève", "Switzerland"), "Geneva");
  assert.equal(name("Ulan Bator", "Mongolia"), "Ulaanbaatar");
  assert.equal(name("Greater Sudbury", "CA:ON"), "Sudbury");
  assert.equal(name("New York City", "US:NY"), "New York");
  assert.equal(name("Ciudad de Mexico", "Mexico"), "Mexico City");
});

test("a name two places share is told apart by the head office's place", () => {
  assert.equal(cityPoint("London", "CA:ON")?.key, "CA:ON");
  assert.equal(cityPoint("London", "United Kingdom")?.key, "United Kingdom");
  assert.equal(cityPoint("Perth", "Australia")?.key, "Australia");
  assert.equal(cityPoint("Perth, Ontario", "CA:ON")?.key, "CA:ON");
  assert.notDeepEqual(cityPoint("Perth", "Australia")?.at, cityPoint("Perth", "CA:ON")?.at);
  // With no place, a shared name is no point; a name one city has still is.
  assert.equal(cityPoint("London", null), null);
  assert.equal(cityPoint("Perth", null), null);
  assert.equal(cityPoint("Saskatoon", null)?.key, "CA:SK");
  assert.equal(cityPoint("Genève", null)?.name, "Geneva", "a spelling is still the city");
  assert.equal(cityPoint("Westminster", null), null, "a suburb counts in its own place only");
  assert.equal(cityPoint("Westminster", "United Kingdom"), null);
  // A city filed under a place it is not in is not moved: one of the two
  // values is wrong, and the globe does not pick. The snapshot has three.
  assert.equal(cityPoint("Toronto", "CA:BC"), null);
  assert.equal(cityPoint("Quito", "CA:BC"), null);
  assert.equal(cityPoint("London", "CA:AB"), null);
});

test("what is not a known city is no point", () => {
  for (const city of [null, "", "   ", ", BC", "N/A", "Unknown", "Atlantis", "123 Main Street, Vancouver"]) {
    assert.equal(cityPoint(city, "CA:BC"), null, `${city}`);
    assert.equal(cityPoint(city, null), null, `${city}`);
  }
  assert.equal(cityPoint("Vancouver", "Atlantis"), null, "a place the globe does not know");
});
