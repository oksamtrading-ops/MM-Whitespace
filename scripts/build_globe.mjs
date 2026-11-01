// Builds src/lib/publish/world.ts, the geometry behind the dashboard's globe.
//
//   node scripts/build_globe.mjs <deps-dir>
//
// <deps-dir> is a scratch directory holding, under node_modules, exactly:
//   d3-geo@3.1.1 topojson-client@3.1.0 topojson-server@3.0.1
//   topojson-simplify@3.0.3 world-atlas@2.0.2 us-atlas@3.0.1
// (npm install --prefix <deps-dir> those six). They are build inputs only; the
// app needs d3-geo alone at run time. All six are ISC; world-atlas is Natural
// Earth (public domain) and us-atlas the US Census Bureau's boundaries (public
// domain).
//
// Three sources become one topology, keyed in the vocabulary the snapshot
// already uses, so a published value finds its shape without a lookup table:
//   provinces  "CA:BC" ...  src/lib/publish/canada.ts, the map partners already
//                           know, turned back into longitude and latitude
//   states     "US:NV" ...  us-atlas, the fifty states and DC
//   countries  "Mexico" ... world-atlas 50m, minus Canada and the United States,
//                           under the names mmparser/aliases.py writes
//
// canada.ts was projected by a script that is not in the repo. Its projection
// is recovered here from borders that are exact meridians and parallels (the
// Alberta-Saskatchewan border is 110W; six borders run along 60N), which pins
// the fitted scale and offset to a few thousandths of a degree. The run prints
// the residual and refuses to write if it exceeds 0.01 degrees.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const deps = process.argv[2];
if (!deps) {
  console.error("usage: node scripts/build_globe.mjs <deps-dir>");
  process.exit(2);
}
const repo = join(import.meta.dirname, "..");
const mod = (name, file) => import(pathToFileURL(join(deps, "node_modules", name, file)).href);
const json = (name, file) => JSON.parse(readFileSync(join(deps, "node_modules", name, file), "utf8"));

// The inputs are not in the lockfile, so their versions are checked here: a
// later world-atlas can rename a country, and its companies would quietly
// leave the globe. The header below writes down what actually ran.
const PINS = {
  "d3-geo": "3.1.1", "topojson-client": "3.1.0", "topojson-server": "3.0.1",
  "topojson-simplify": "3.0.3", "world-atlas": "2.0.2", "us-atlas": "3.0.1",
};
for (const [name, want] of Object.entries(PINS)) {
  const got = json(name, "package.json").version;
  if (got !== want) {
    console.error(`${name} is ${got} in ${deps}; this script is pinned to ${want}`);
    process.exit(2);
  }
}

const d3 = await mod("d3-geo", "src/index.js");
const client = await mod("topojson-client", "src/index.js");
const server = await mod("topojson-server", "src/index.js");
const simplify = await mod("topojson-simplify", "src/index.js");

// ---- Canada: inverse-project the province paths --------------------------------
const canadaSrc = readFileSync(join(repo, "src/lib/publish/canada.ts"), "utf8");
const paths = Object.fromEntries([...canadaSrc.matchAll(/"([A-Z]{2})":\s*"(M[^"]+)"/g)].map(([, c, d]) => [c, d]));
const labels = JSON.parse(canadaSrc.match(/CANADA_LABELS[^=]*=\s*(\{[^;]+\});/)[1]);

const screenRings = (d) => d.split(/(?=M)/).map((part) => {
  const nums = part.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ring = [];
  for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i], nums[i + 1]]);
  return ring;
});

const unit = d3.geoConicConformal().parallels([49, 77]).rotate([95, 0]).center([0, 60]).scale(1).translate([0, 0]);
const owners = new Map();
for (const [code, d] of Object.entries(paths)) for (const ring of screenRings(d)) for (const [x, y] of ring) {
  const key = `${x},${y}`;
  if (!owners.has(key)) owners.set(key, new Set());
  owners.get(key).add(code);
}
const sharedBy = (a, b) => [...owners].filter(([, s]) => s.has(a) && s.has(b)).map(([k]) => k.split(",").map(Number));
const constraints = [
  ["AB", "SK", 0, -110], ["BC", "NT", 1, 60], ["AB", "NT", 1, 60], ["SK", "NT", 1, 60],
  ["SK", "NU", 1, 60], ["MB", "NU", 1, 60], ["BC", "YT", 1, 60],
].map(([a, b, axis, value]) => ({ axis, value, points: sharedBy(a, b) }));

function residual([k, tx, ty]) {
  let sum = 0, n = 0;
  for (const c of constraints) for (const [x, y] of c.points) {
    sum += (unit.invert([(x - tx) / k, (y - ty) / k])[c.axis] - c.value) ** 2;
    n++;
  }
  return Math.sqrt(sum / n);
}
function nelderMead(f, start, step, iterations = 4000) {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + step[j] : v)))].map((p) => ({ p, v: f(p) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.v - b.v);
    const best = simplex[0], worst = simplex[n];
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i].p[j] / n;
    const reflect = c.map((v, j) => v + (v - worst.p[j]));
    const fr = f(reflect);
    if (fr < best.v) {
      const expand = c.map((v, j) => v + 2 * (v - worst.p[j]));
      const fe = f(expand);
      simplex[n] = fe < fr ? { p: expand, v: fe } : { p: reflect, v: fr };
    } else if (fr < simplex[n - 1].v) {
      simplex[n] = { p: reflect, v: fr };
    } else {
      const contract = c.map((v, j) => v + 0.5 * (worst.p[j] - v));
      const fc = f(contract);
      if (fc < worst.v) simplex[n] = { p: contract, v: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : { p: s.p.map((v, j) => best.p[j] + 0.5 * (v - best.p[j])) })).map((s) => ({ p: s.p, v: f(s.p) }));
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  return simplex[0];
}

const world = json("world-atlas", "countries-50m.json");
const worldFeatures = client.feature(world, world.objects.countries).features;
const canadaShape = worldFeatures.find((f) => f.properties.name === "Canada");
const [[bx0, by0], [bx1]] = d3.geoPath(unit).bounds(canadaShape);
const guessK = 1000 / (bx1 - bx0);
const fit = nelderMead(residual, [guessK, -bx0 * guessK, -by0 * guessK], [guessK * 0.01, 5, 5]);
const [k, tx, ty] = fit.p;
console.log(`canada.ts projection: scale ${k.toFixed(3)}, offset ${tx.toFixed(3)}, ${ty.toFixed(3)}; residual ${fit.v.toFixed(5)} degrees`);
if (!(fit.v < 0.01)) throw new Error("could not recover the projection behind canada.ts");
const toLonLat = ([x, y]) => unit.invert([(x - tx) / k, (y - ty) / k]);

// d3 reads a ring's winding to decide which side is inside; a ring wound the
// wrong way covers the rest of the sphere. Area above a hemisphere means flip.
function oriented(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const fixed = polygons.map((rings) => rings.map((ring, i) => {
    const area = d3.geoArea({ type: "Polygon", coordinates: [ring] });
    const exterior = i === 0;
    return (exterior ? area > 2 * Math.PI : area < 2 * Math.PI) ? [...ring].reverse() : ring;
  }));
  return geometry.type === "Polygon" ? { type: "Polygon", coordinates: fixed[0] } : { type: "MultiPolygon", coordinates: fixed };
}

const provinces = Object.entries(paths).map(([code, d]) => {
  const polygons = screenRings(d).map((ring) => {
    const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring : [...ring, ring[0]];
    return [closed.map(toLonLat)];
  });
  const geometry = oriented({ type: "MultiPolygon", coordinates: polygons });
  return { type: "Feature", id: `CA:${code}`, properties: { anchor: toLonLat(labels[code]) }, geometry };
});

// ---- United States: the fifty states and DC -----------------------------------------
const stateCodes = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
  Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
  Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
};
const us = json("us-atlas", "states-10m.json");
const states = client.feature(us, us.objects.states).features
  .filter((f) => stateCodes[f.properties.name])
  .map((f) => ({ type: "Feature", id: `US:${stateCodes[f.properties.name]}`, properties: {}, geometry: f.geometry }));
if (states.length !== 51) throw new Error(`expected 51 states and DC, found ${states.length}`);

// ---- Everything else, under the names the parser writes ----------------------------
// world-atlas abbreviates; mmparser/aliases.py writes the full short name.
const RENAME = {
  "Dem. Rep. Congo": "Democratic Republic of the Congo", Congo: "Republic of the Congo", Turkey: "Türkiye",
  "Dominican Rep.": "Dominican Republic", "Central African Rep.": "Central African Republic",
  "Bosnia and Herz.": "Bosnia and Herzegovina", "Eq. Guinea": "Equatorial Guinea", "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands", "British Virgin Is.": "British Virgin Islands", "Cayman Is.": "Cayman Islands",
  "Falkland Is.": "Falkland Islands", "Faeroe Is.": "Faroe Islands", "Cook Is.": "Cook Islands",
  "Marshall Is.": "Marshall Islands", "N. Mariana Is.": "Northern Mariana Islands",
  "Turks and Caicos Is.": "Turks and Caicos Islands", "U.S. Virgin Is.": "U.S. Virgin Islands",
  "Wallis and Futuna Is.": "Wallis and Futuna", "Pitcairn Is.": "Pitcairn Islands", "Antigua and Barb.": "Antigua and Barbuda",
  "St. Kitts and Nevis": "Saint Kitts and Nevis", "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  "St. Pierre and Miquelon": "Saint Pierre and Miquelon", "S. Geo. and the Is.": "South Georgia and the South Sandwich Islands",
  "Fr. S. Antarctic Lands": "French Southern and Antarctic Lands", "Fr. Polynesia": "French Polynesia",
  "Br. Indian Ocean Ter.": "British Indian Ocean Territory", "Heard I. and McDonald Is.": "Heard Island and McDonald Islands",
  "Ashmore and Cartier Is.": "Ashmore and Cartier Islands", "W. Sahara": "Western Sahara", eSwatini: "Eswatini",
  Macedonia: "North Macedonia", "São Tomé and Principe": "São Tomé and Príncipe", "N. Cyprus": "Northern Cyprus",
  "Indian Ocean Ter.": "Australian Indian Ocean Territories", "St-Barthélemy": "Saint Barthélemy", "St-Martin": "Saint Martin",
};
const countries = worldFeatures
  .filter((f) => f.properties.name !== "Canada" && f.properties.name !== "United States of America")
  .map((f) => ({ type: "Feature", id: RENAME[f.properties.name] ?? f.properties.name, properties: {}, geometry: f.geometry }));
const ids = countries.map((f) => f.id);
if (new Set(ids).size !== ids.length) throw new Error("two countries share a name");

// ---- One topology, simplified on the sphere -----------------------------------------
let topo = server.topology({ provinces: { type: "FeatureCollection", features: provinces },
  states: { type: "FeatureCollection", features: states },
  countries: { type: "FeatureCollection", features: countries } }, 1e6);
topo = simplify.presimplify(topo, simplify.sphericalTriangleArea);
const MIN_WEIGHT = Number(process.env.GLOBE_MIN_WEIGHT ?? 2e-5);
const QUANTIZE = Number(process.env.GLOBE_QUANTIZE ?? 2e4);
const anchors = new Map();
const kindOf = (id) => (id.startsWith("CA:") ? "provinces" : id.startsWith("US:") ? "states" : "countries");
// Anchors come from the unsimplified shapes: a label point for a province, the
// centroid of the largest part elsewhere. A place too small to keep a ring
// after simplification still has a point to mark and to turn the globe to.
for (const name of ["provinces", "states", "countries"]) {
  for (const f of client.feature(topo, topo.objects[name]).features) {
    if (f.properties?.anchor) { anchors.set(f.id, f.properties.anchor); continue; }
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const largest = polygons.map((p) => ({ p, a: d3.geoArea({ type: "Polygon", coordinates: p }) })).sort((a, b) => b.a - a.a)[0].p;
    anchors.set(f.id, d3.geoCentroid({ type: "Polygon", coordinates: largest }));
  }
}
// canada.ts is already simplified, and it is the map partners know: its
// points are all kept.
const provinceArcs = new Set();
const collect = (a) => (Array.isArray(a) ? a.forEach(collect) : provinceArcs.add(a < 0 ? ~a : a));
for (const g of topo.objects.provinces.geometries) collect(g.arcs);
for (const i of provinceArcs) for (const point of topo.arcs[i]) point[2] = Infinity;
topo = simplify.simplify(topo, MIN_WEIGHT);
topo = simplify.filter(topo, simplify.filterWeight(topo, MIN_WEIGHT * 4, simplify.sphericalRingArea));
topo = client.quantize(topo, QUANTIZE);
// The filter drops a shape whose every ring fell under the weight; put it back
// with no rings, so the place keeps its anchor.
for (const name of ["provinces", "states", "countries"]) {
  const kept = new Set(topo.objects[name].geometries.map((g) => g.id));
  for (const id of [...anchors.keys()].filter((id) => !kept.has(id) && kindOf(id) === name)) {
    topo.objects[name].geometries.push({ type: null, id });
  }
}

// Strip what the app does not read, and stamp each shape with its anchor.
const round = (v) => Math.round(v * 100) / 100;
for (const name of ["provinces", "states", "countries"]) {
  for (const g of topo.objects[name].geometries) {
    g.properties = { anchor: anchors.get(g.id).map(round) };
  }
}
delete topo.bbox;

const body = JSON.stringify(topo);
const header = `/**
 * The globe's geometry: Canada's provinces and territories, the US states and
 * every other country, as one TopoJSON topology keyed in the snapshot's own
 * vocabulary ("CA:BC", "US:NV", "Mexico").
 *
 * Sources: src/lib/publish/canada.ts (Natural Earth via click_that_hood, MIT),
 * turned back into longitude and latitude; us-atlas ${PINS["us-atlas"]} (US Census Bureau,
 * public domain; ISC); world-atlas ${PINS["world-atlas"]} at 1:50m (Natural Earth, public
 * domain; ISC). Built with d3-geo ${PINS["d3-geo"]}, topojson-server ${PINS["topojson-server"]},
 * topojson-simplify ${PINS["topojson-simplify"]} and topojson-client ${PINS["topojson-client"]}.
 * Simplified on the sphere to a minimum weight of ${MIN_WEIGHT} steradians, and
 * quantised to ${QUANTIZE} positions on each axis.
 * Each shape carries an anchor: a province's label point, else the centroid of
 * its largest part. Generated by scripts/build_globe.mjs; do not hand-edit.
 *
 * Nothing here is data. Every fill and mark comes from the published snapshot.
 */
import type { Topology } from "./globe.ts";

export const WORLD: Topology = `;
writeFileSync(join(repo, "src/lib/publish/world.ts"), `${header}${body};\n`);
const counts = Object.fromEntries(Object.entries(topo.objects).map(([n, o]) => [n, o.geometries.length]));
const empty = Object.values(topo.objects).flatMap((o) => o.geometries).filter((g) => g.type === null || !g.arcs?.length).map((g) => g.id);
const points = topo.arcs.reduce((n, a) => n + a.length, 0);
const arcBytes = (name) => {
  const used = new Set();
  const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : used.add(a < 0 ? ~a : a));
  for (const g of topo.objects[name].geometries) if (g.arcs) walk(g.arcs);
  return [...used].reduce((n, i) => n + JSON.stringify(topo.arcs[i]).length, 0);
};
console.log({ points, provinces: arcBytes("provinces"), states: arcBytes("states"), countries: arcBytes("countries") });
console.log("wrote src/lib/publish/world.ts", { bytes: body.length, arcs: topo.arcs.length, ...counts });
console.log(`${empty.length} shapes too small to keep a ring (marked by their anchor):`, empty.join(", "));
