import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE } from "./notices.ts";

/* The notices printed on a dashboard must be the ones written into the
   export, so this reads the Python source rather than trusting a copy. */
test("dashboard notices match the export's wording", async () => {
  const py = readFileSync(new URL("../../../mmparser/export.py", import.meta.url), "utf8");
  const collapse = (s: string) => s.replace(/\s+/g, " ");
  const pySource = collapse(py.replace(/"\s*\n\s*"/g, ""));
  for (const notice of [EXCHANGE_NOTICE, VENDOR_NOTICE, INTERNAL_USE]) {
    assert.ok(pySource.includes(notice), `export.py no longer carries: ${notice.slice(0, 40)}…`);
  }
});
