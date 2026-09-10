import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionStamp } from "./stamp.ts";

test("two stamps in the same millisecond still order", () => {
  const a = decisionStamp(1_800_000_000_000);
  const b = decisionStamp(1_800_000_000_000);
  const c = decisionStamp(1_800_000_000_000);
  assert.ok(a < b, `${a} < ${b}`);
  assert.ok(b < c, `${b} < ${c}`);
});

test("a later clock reading always sorts after an earlier one", () => {
  const a = decisionStamp(1_800_000_000_000);
  const b = decisionStamp(1_800_000_000_001);
  assert.ok(a < b, `${a} < ${b}`);
});

test("the format is fixed width, so text and timestamptz sort alike", () => {
  const s = decisionStamp(1_800_000_000_000);
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/);
  assert.equal(s.length, 26);
});
