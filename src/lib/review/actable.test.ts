import { test } from "node:test";
import assert from "node:assert/strict";
import { canAct, canOverride } from "./actable.ts";

const row = (decision: string | null, newerThanDecision = false) =>
  ({ decided: decision !== null, decision, newerThanDecision });

test("an undecided row offers every decision", () => {
  assert.equal(canAct(row(null)), true);
  assert.equal(canOverride(row(null)), true);
});

test("an accepted or overridden row offers none; Undo walks it back", () => {
  for (const decision of ["accept", "override"]) {
    assert.equal(canAct(row(decision)), false, decision);
    assert.equal(canOverride(row(decision)), false, decision);
  }
});

test("a row research has overtaken offers every decision again", () => {
  for (const decision of ["accept", "flag"]) {
    assert.equal(canAct(row(decision, true)), true, decision);
    assert.equal(canOverride(row(decision, true)), true, decision);
  }
});

test("a FLAGGED row can be overridden, and nothing else", () => {
  // Mkango's auditor, 31 October 2026: flagged as PKF Littlejohn, found to be
  // MNP, and with no control that could store it.
  assert.equal(canOverride(row("flag")), true);
  assert.equal(canAct(row("flag")), false, "accepting the flagged proposal, or flagging it again, stays withheld");
});

test("with no row selected, nothing is offered", () => {
  assert.equal(canAct(null), false);
  assert.equal(canOverride(undefined), false);
});
