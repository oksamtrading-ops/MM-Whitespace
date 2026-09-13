import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANADA_ALIASES, CANADA_SUBDIVISIONS, foldProvinces, provinceCode } from "./jurisdictions.ts";

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
