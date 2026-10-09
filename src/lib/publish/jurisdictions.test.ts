import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANADA_ALIASES, CANADA_SUBDIVISIONS, foldProvinces, hqJurisdiction, provinceCode, US_STATES } from "./jurisdictions.ts";

const PY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "mmparser", "aliases.py");

test("the TypeScript vocabulary is the Python vocabulary", () => {
  const py = readFileSync(PY, "utf8");
  const subs = py.slice(py.indexOf("CANADA_SUBDIVISIONS = {"), py.indexOf("}", py.indexOf("CANADA_SUBDIVISIONS = {")));
  for (const [, code, name] of subs.matchAll(/"([A-Z]{2})":\s*"([^"]+)"/g)) {
    assert.equal(CANADA_SUBDIVISIONS[code], name, `${code} differs from aliases.py`);
  }
  assert.equal(Object.keys(CANADA_SUBDIVISIONS).length, [...subs.matchAll(/"[A-Z]{2}":/g)].length);
  const aliases = py.match(/CANADA_ALIASES = \{([^}]*)\}/)?.[1] ?? "";
  for (const [, k, v] of aliases.matchAll(/"([a-z]+)":\s*"([A-Z]{2})"/g)) {
    assert.equal(CANADA_ALIASES[k], v, `alias ${k} differs from aliases.py`);
  }
});

test("two spellings of one territory become one number", () => {
  assert.equal(provinceCode("NWT"), "NT");
  assert.equal(provinceCode("nt"), "NT");
  const folded = foldProvinces([{ bucket: "NT", n: 6 }, { bucket: "NWT", n: 1 }, { bucket: "BC", n: 27 }]);
  assert.equal(folded.get("NT"), 7);
  assert.equal(folded.get("BC"), 27);
  assert.equal(folded.size, 2);
});

/* A head office the workbook spells one way and research another reads as a
   conflict in review on every US company. The table both use is here; the
   parser's is in aliases.py; this holds them to one spelling. */
test("US states are spelled the same by the parser, EDGAR and the table", () => {
  const py = readFileSync(PY, "utf8");
  const block = py.slice(py.indexOf("US_STATE_NAMES = {"), py.indexOf("}", py.indexOf("US_STATE_NAMES = {")));
  const pairs = [...block.matchAll(/"([A-Z]{2})":\s*"([^"]+)"/g)];
  assert.ok(pairs.length >= 50, "aliases.py no longer defines US_STATE_NAMES");
  for (const [, code, name] of pairs) assert.equal(US_STATES[code], name, `${code} differs from aliases.py`);
  assert.equal(Object.keys(US_STATES).length, pairs.length);
});

test("a head office reads short, filters by jurisdiction, and groups by country", () => {
  assert.deepEqual(hqJurisdiction("Ontario, Canada"), { key: "CA:ON", short: "ON", label: "Ontario", group: "Canada" });
  assert.deepEqual(hqJurisdiction("Colorado, United States"), { key: "US:CO", short: "CO", label: "Colorado", group: "United States" });
  assert.deepEqual(hqJurisdiction("Chile"), { key: "Chile", short: "Chile", label: "Chile", group: "Other countries" });
  assert.equal(hqJurisdiction("Western Australia, Australia")?.key, "Australia", "abroad, the country is the jurisdiction");
  assert.equal(hqJurisdiction(""), null);
});
