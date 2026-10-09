import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_NOTICE, EXCHANGE_NOTICE, INTERNAL_USE, VENDOR_NOTICE } from "./notices.ts";

/* The notices printed on a dashboard must be the ones written into the
   export, so this reads the Python source rather than trusting a copy. */
test("dashboard notices match the export's wording", async () => {
  const py = readFileSync(new URL("../../../mmparser/export.py", import.meta.url), "utf8");
  const collapse = (s: string) => s.replace(/\s+/g, " ");
  const pySource = collapse(py.replace(/"\s*\n\s*"/g, ""));
  for (const notice of [EXCHANGE_NOTICE, VENDOR_NOTICE, INTERNAL_USE, AI_NOTICE]) {
    assert.ok(pySource.includes(notice), `export.py no longer carries: ${notice.slice(0, 40)}…`);
  }
});

/* The AI notice must survive a change of engine, and more than one tool may be
   in use at once, so it names none of them. Checked in both copies: a name
   added to the Python one would reach every exported workbook. */
const TOOL_NAMES = /\b(claude|anthropic|openai|chatgpt|gpt-?\d*|gemini|bard|copilot|cortex|snowflake|llama|mistral|cohere|sonnet|opus|haiku)\b/i;

test("the AI notice names no tool, vendor or model", () => {
  assert.doesNotMatch(AI_NOTICE, TOOL_NAMES);
  const py = readFileSync(new URL("../../../mmparser/export.py", import.meta.url), "utf8");
  const block = py.slice(py.indexOf("AI_NOTICE = ("), py.indexOf(")", py.indexOf("AI_NOTICE = (")));
  assert.ok(block.length > 20, "export.py no longer defines AI_NOTICE");
  assert.doesNotMatch(block, TOOL_NAMES);
});

test("the AI notice still says it is AI, and still points at the source", () => {
  assert.match(AI_NOTICE, /artificial intelligence/);
  assert.match(AI_NOTICE, /source/);
});
