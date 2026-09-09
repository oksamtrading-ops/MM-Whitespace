import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import { commitPeriod } from "../db/commit.ts";
import { getNumber, InvalidSetting, putSettings, readSettings, validate } from "./index.ts";

function db() {
  const d = new DatabaseSync(":memory:");
  applySchema(d);
  return d;
}

test("the shipped defaults are the ones the decisions settled on", () => {
  const values = Object.fromEntries(readSettings(db()).map((s) => [s.key, s.value]));
  assert.equal(values.default_threshold_amount, "200000000");
  assert.equal(values.default_threshold_operator, "gte", "decision 9: at or above");
  assert.equal(values.default_proximity_band_pct, "2");
  assert.equal(values.default_run_budget_usd, "25");
});

test("what a person types is accepted; what is meaningless is refused", () => {
  assert.equal(validate("default_threshold_amount", "250,000,000"), "250000000");
  assert.equal(validate("default_run_budget_usd", "$40"), "40");
  assert.equal(validate("default_proximity_band_pct", "2.5%"), "2.5");
  assert.equal(validate("default_threshold_currency", "cad"), "CAD");

  assert.throws(() => validate("default_run_budget_usd", "0"), InvalidSetting,
    "a run cannot be created without a budget");
  assert.throws(() => validate("default_run_budget_usd", "-5"), InvalidSetting);
  assert.throws(() => validate("default_proximity_band_pct", "-1"), InvalidSetting);
  assert.throws(() => validate("default_proximity_band_pct", "80"), InvalidSetting,
    "a band that wide marks most of the market as near the line");
  assert.throws(() => validate("default_threshold_currency", "dollars"), InvalidSetting);
  assert.throws(() => validate("default_threshold_operator", "approximately"), InvalidSetting);
});

test("saving reports what changed, so the audit line names it", () => {
  const d = db();
  const changes = putSettings(d, { default_run_budget_usd: "40" }, null);
  assert.deepEqual(changes, [{ key: "default_run_budget_usd", from: "25", to: "40" }]);
  assert.deepEqual(putSettings(d, { default_run_budget_usd: "40" }, null), [],
    "saving the same value again is not a change");
  assert.equal(getNumber(d, "default_run_budget_usd", 5), 40);
});

/* A setting that changes nothing teaches people the screen is decorative. */

test("a committed period takes the thresholds in force when it was committed", () => {
  const d = db();
  putSettings(d, {
    default_threshold_amount: "300000000", default_threshold_currency: "USD",
    default_threshold_operator: "gt", default_proximity_band_pct: "5",
  }, null);

  commitPeriod(d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });
  const period = d.prepare(
    `select threshold_amount, threshold_operator, threshold_currency, proximity_band_pct
       from periods where label = 'Q4-2026 (2026-08-31)'`).get() as Record<string, unknown>;
  assert.equal(Number(period.threshold_amount), 300_000_000);
  assert.equal(period.threshold_operator, "gt");
  assert.equal(period.threshold_currency, "USD");
  assert.equal(Number(period.proximity_band_pct), 5);
});

test("changing a setting afterwards does not move a period already committed", () => {
  const d = db();
  commitPeriod(d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });
  putSettings(d, { default_threshold_amount: "999000000" }, null);
  // A re-commit of the same period must not rewrite what it was measured against.
  commitPeriod(d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });

  const period = d.prepare(
    "select threshold_amount from periods where label = 'Q4-2026 (2026-08-31)'").get() as
    { threshold_amount: number };
  assert.equal(Number(period.threshold_amount), 200_000_000,
    "the threshold belongs to the period from the moment it was created");
});

test("a database a migration behind still commits, on the fallbacks", () => {
  const d = db();
  d.exec("drop table app_settings");
  assert.equal(getNumber(d, "default_run_budget_usd", 5), 5,
    "a missing settings table reads as 'not set', not as a crash");
  assert.doesNotThrow(() =>
    commitPeriod(d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" }));
  const period = d.prepare(
    "select threshold_amount from periods limit 1").get() as { threshold_amount: number };
  assert.equal(Number(period.threshold_amount), 200_000_000);
});
