import { test } from "node:test";
import assert from "node:assert/strict";
import { geoArea, geoContains, geoDistance } from "d3-geo";
import { countryKey, decodePlaces, placeOfHeadOffice, placeOfProperty } from "./globe.ts";
import { WORLD } from "./world.ts";

const places = decodePlaces(WORLD);
const byKey = new Map(places.map((p) => [p.key, p]));
const known = new Set(byKey.keys());

test("the topology decodes to Canada's thirteen, the fifty states and DC, and the world", () => {
  assert.equal(places.filter((p) => p.kind === "province").length, 13);
  assert.equal(places.filter((p) => p.kind === "state").length, 51);
  assert.ok(places.filter((p) => p.kind === "country").length > 200);
  assert.equal(known.size, places.length, "every key is one place");
  assert.ok(!known.has("Canada") && !known.has("United States of America"), "the two federations are drawn by their parts");
});

test("every ring is wound so its inside is the small side", () => {
  // A ring wound backwards covers the rest of the sphere and floods the globe.
  for (const p of places) {
    if (!p.geometry) continue;
    const area = geoArea(p.geometry);
    assert.ok(area < 2 * Math.PI, `${p.key} covers ${area.toFixed(2)} sr`);
    assert.ok(area > 0, `${p.key} has no area`);
  }
});

test("places sit where they are: cities fall inside their shapes", () => {
  const checks: Array<[string, [number, number]]> = [
    ["CA:BC", [-123.12, 49.28]], ["CA:AB", [-114.07, 51.05]], ["CA:SK", [-106.67, 52.13]],
    ["CA:MB", [-97.14, 49.9]], ["CA:ON", [-79.38, 43.65]], ["CA:ON", [-81.33, 48.48]],
    ["CA:QC", [-73.57, 45.5]], ["CA:QC", [-79.02, 48.24]], ["CA:NS", [-63.57, 44.65]],
    ["CA:NL", [-52.71, 47.56]], ["CA:YT", [-135.06, 60.72]], ["CA:NT", [-114.37, 62.45]],
    ["CA:NU", [-68.52, 63.75]], ["CA:NB", [-66.64, 45.96]],
    ["US:NV", [-119.81, 39.53]], ["US:AZ", [-112.07, 33.45]], ["US:CO", [-104.99, 39.74]],
    ["US:AK", [-147.72, 64.84]], ["US:ID", [-116.2, 43.62]], ["US:UT", [-111.89, 40.76]],
    ["Mexico", [-99.13, 19.43]], ["Peru", [-71.97, -13.53]], ["Chile", [-70.65, -33.45]],
    ["Brazil", [-47.88, -15.79]], ["Argentina", [-64.18, -31.42]], ["Colombia", [-74.07, 4.71]],
    ["Ecuador", [-78.47, -0.18]], ["Bolivia", [-68.15, -16.5]], ["Guyana", [-58.6, 5.8]],
    ["Ghana", [-1.62, 6.69]], ["Burkina Faso", [-1.52, 12.37]], ["Côte d'Ivoire", [-5.28, 6.82]],
    ["Mali", [-8.0, 12.65]], ["Democratic Republic of the Congo", [27.48, -11.66]],
    ["Mongolia", [106.92, 47.92]], ["Türkiye", [32.86, 39.93]], ["Sweden", [17.64, 59.86]],
    ["Australia", [121.47, -30.75]], ["Finland", [25.47, 65.01]],
  ];
  for (const [key, point] of checks) {
    const place = byKey.get(key);
    assert.ok(place?.geometry, `${key} has no shape`);
    assert.ok(geoContains(place.geometry, point), `${point} is not inside ${key}`);
  }
});

test("a place too small to keep a ring still has an anchor near it", () => {
  const hk = byKey.get("Hong Kong");
  assert.ok(hk, "Hong Kong is a place");
  assert.ok(geoDistance(hk.anchor, [114.17, 22.32]) < 0.01, "within about 60 km");
  for (const p of places) assert.ok(Number.isFinite(p.anchor[0]) && Number.isFinite(p.anchor[1]), `${p.key} has an anchor`);
});

/* The names below are every foreign jurisdiction and head-office region the
   Q4 2026 snapshot holds, by group, as the parser normalises them. A new name
   the geometry cannot place is shown in words; this keeps today's all placed. */
test("every place the snapshot names finds its shape", () => {
  const properties: Array<[string, string]> = [
    ["CANADA", "BC"], ["CANADA", "NWT"], ["CANADA", "nt"], ["USA", "NV"], ["USA", "CA"], ["USA", "AK"],
    ...["Mexico", "Peru", "Brazil", "Argentina", "Chile", "Colombia", "Bolivia", "Ecuador", "Guyana", "Nicaragua",
      "Dominican Republic", "Suriname", "Cuba", "Guatemala", "Panama", "Venezuela"].map((c) => ["LATIN AMERICA", c] as [string, string]),
    ...["Côte d'Ivoire", "Burkina Faso", "Mali", "Ghana", "Namibia", "Zambia", "Democratic Republic of the Congo", "Guinea",
      "South Africa", "Tanzania", "Botswana", "Ethiopia", "Mauritania", "Nigeria", "Senegal", "Gabon", "Guinea-Bissau",
      "Malawi", "Morocco", "Niger", "Sudan"].map((c) => ["AFRICA", c] as [string, string]),
    ...["Mongolia", "China", "Philippines", "Kazakhstan", "Malaysia"].map((c) => ["ASIA", c] as [string, string]),
    ...["Australia", "Papua New Guinea", "New Zealand"].map((c) => ["AUS/NZ/PNG", c] as [string, string]),
    ...["Türkiye", "Sweden", "Finland", "Ireland", "Spain", "Bulgaria", "Germany", "Greece", "Greenland", "Netherlands",
      "Poland", "Portugal", "Serbia"].map((c) => ["UK/EUROPE", c] as [string, string]),
    ["OTHER", "Saudi Arabia"],
  ];
  for (const [group, entry] of properties) {
    assert.ok(placeOfProperty(group, entry, known), `${group}: ${entry} has no place`);
  }
  assert.equal(placeOfProperty("CANADA", "NWT", known), "CA:NT");
  assert.equal(placeOfProperty("USA", "CA", known), "US:CA", "CA under USA is California");
  assert.equal(placeOfProperty("LATIN AMERICA", "Atlantis", known), null, "an unknown name is not guessed");

  for (const region of ["British Columbia, Canada", "Ontario, Canada", "Québec, Canada", "Australia", "Colorado, United States",
    "Colorado, United States of America", "United Kingdom", "Brazil", "British Virgin Islands", "Switzerland", "Bahamas",
    "Hong Kong", "Mauritius", "United Arab Emirates", "Chile", "Argentina", "Colombia"]) {
    assert.ok(placeOfHeadOffice(region, known), `${region} has no place`);
  }
  assert.equal(placeOfHeadOffice("Canada", known), null, "a country alone has no point to stand on");
  assert.equal(placeOfHeadOffice("", known), null);
});

test("a country's other spellings fold onto its shape", () => {
  assert.equal(countryKey("Turkey", known), "Türkiye");
  assert.equal(countryKey("DRC", known), "Democratic Republic of the Congo");
  assert.equal(countryKey("Cote d'Ivoire", known), "Côte d'Ivoire");
  assert.equal(countryKey("UK", known), "United Kingdom");
  assert.equal(countryKey("  mexico ", known), "Mexico");
});
