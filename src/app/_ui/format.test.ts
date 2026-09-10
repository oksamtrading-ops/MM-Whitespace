import { test } from "node:test";
import assert from "node:assert/strict";
import { agoLabel, daysSince, fmtCompact, fmtMoney, parseStamp, periodName } from "./format.ts";

/* A stored stamp is a UTC instant with no zone written on it. Read as local
   time it lands in the future anywhere west of Greenwich, which is how the
   access review came to report "-1d ago" for someone who had just signed in. */
test("a stored stamp is read as UTC, not as local time", async () => {
  assert.equal(parseStamp("2026-09-09 13:14:35").toISOString(), "2026-09-09T13:14:35.000Z");
  assert.equal(parseStamp("2026-09-09T13:14:35Z").toISOString(), "2026-09-09T13:14:35.000Z");
  assert.equal(parseStamp("2026-09-09T13:14:35+00:00").toISOString(), "2026-09-09T13:14:35.000Z");
});

test("a bare date is a calendar date, so it keeps its own day", async () => {
  const d = parseStamp("2026-05-31");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 31);
});

test("days since is never negative", async () => {
  const now = Date.parse("2026-09-09T13:00:00Z");
  assert.equal(daysSince("2026-09-09 13:14:35", now), 0, "a stamp minutes ahead is not -1 day");
  assert.equal(daysSince("2026-09-08 12:00:00", now), 1);
  assert.equal(daysSince("2026-06-11 12:00:00", now), 90);
});

test("recent sign-ins are worded, older ones counted", async () => {
  assert.equal(agoLabel(0), "today");
  assert.equal(agoLabel(1), "yesterday");
  assert.equal(agoLabel(97), "97d ago");
});

test("period labels and thresholds are shortened for display", async () => {
  assert.deepEqual(periodName("Q3-2026 (2026-05-31)"), { name: "Q3 2026", asOf: "2026-05-31" });
  assert.deepEqual(periodName("FY2026"), { name: "FY2026", asOf: null });
  assert.equal(fmtCompact(200_000_000), "200M");
  assert.equal(fmtCompact(1_500_000), "1.5M");
  assert.equal(fmtCompact(950_000), "950K");
  assert.equal(fmtCompact(750), "750");
});

test("money is one string, not a symbol beside a number", async () => {
  // React splits {"$"}{n} into two text nodes with a comment marker between
  // them, so the markup reads "$<!-- -->21.40" and nothing can match on it.
  assert.equal(fmtMoney(21.4), "$21.40");
  assert.equal(fmtMoney(25), "$25.00");
  assert.equal(fmtMoney(0), "$0.00");
  assert.equal(fmtMoney(1234.5), "$1,234.50");
});
