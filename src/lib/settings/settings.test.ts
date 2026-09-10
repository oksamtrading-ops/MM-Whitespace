import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import { commitPeriod } from "../db/commit.ts";
import { getNumber, InvalidSetting, putSettings, readSettings, validate } from "./index.ts";

function db(): Sql {
  return memorySql();
}

test("the shipped defaults are the ones the decisions settled on", async () => {
  const values = Object.fromEntries((await readSettings(await db())).map((s) => [s.key, s.value]));
  assert.equal(values.default_threshold_amount, "200000000");
  assert.equal(values.default_threshold_operator, "gte", "decision 9: at or above");
  assert.equal(values.default_proximity_band_pct, "2");
  assert.equal(values.default_run_budget_usd, "25");
});

test("what a person types is accepted; what is meaningless is refused", async () => {
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

test("saving reports what changed, so the audit line names it", async () => {
  const d = await db();
  const changes = await putSettings(await d, { default_run_budget_usd: "40" }, null);
  assert.deepEqual(changes, [{ key: "default_run_budget_usd", from: "25", to: "40" }]);
  assert.deepEqual(await putSettings(await d, { default_run_budget_usd: "40" }, null), [],
    "saving the same value again is not a change");
  assert.equal(await getNumber(await d, "default_run_budget_usd", 5), 40);
});

/* A setting that changes nothing teaches people the screen is decorative. */

test("a committed period takes the thresholds in force when it was committed", async () => {
  const d = db();
  await putSettings(await d, {
    default_threshold_amount: "300000000", default_threshold_currency: "USD",
    default_threshold_operator: "gt", default_proximity_band_pct: "5",
  }, null);

  await commitPeriod(await d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });
  const period = await d.get(`select threshold_amount, threshold_operator, threshold_currency, proximity_band_pct
       from periods where label = 'Q4-2026 (2026-08-31)'`) as Record<string, unknown>;
  assert.equal(Number(period.threshold_amount), 300_000_000);
  assert.equal(period.threshold_operator, "gt");
  assert.equal(period.threshold_currency, "USD");
  assert.equal(Number(period.proximity_band_pct), 5);
});

test("changing a setting afterwards does not move a period already committed", async () => {
  const d = db();
  await commitPeriod(await d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });
  await putSettings(await d, { default_threshold_amount: "999000000" }, null);
  // A re-commit of the same period must not rewrite what it was measured against.
  await commitPeriod(await d, { period: "2026-08-31", companies: [] }, { label: "Q4-2026 (2026-08-31)" });

  const period = await d.get("select threshold_amount from periods where label = 'Q4-2026 (2026-08-31)'") as
    { threshold_amount: number };
  assert.equal(Number(period.threshold_amount), 200_000_000,
    "the threshold belongs to the period from the moment it was created");
});

test("a database a migration behind still commits, on the fallbacks", async () => {
  const d = db();
  await d.exec("drop table app_settings");
  assert.equal(await getNumber(d, "default_run_budget_usd", 5), 5,
    "a missing settings table reads as 'not set', not as a crash");
  await commitPeriod(d, { period: "2026-08-31", companies: [] },
                     { label: "Q4-2026 (2026-08-31)" });
  const period = await d.get(
    "select threshold_amount from periods limit 1") as { threshold_amount: number };
  assert.equal(Number(period.threshold_amount), 200_000_000);
});
