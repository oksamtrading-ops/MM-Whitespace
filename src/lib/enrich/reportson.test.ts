import { test } from "node:test";
import assert from "node:assert/strict";
import { reportsOn } from "./reportson.ts";

test("CHINA GOLD: the 2022 circular reports on 2021, the 2026 one on 2025", () => {
  // The two documents behind decisions 326 and 327 on 18 October 2026, as
  // their stored text reads (abridged). The older one was fetched second.
  const stale = "Annual General Meeting ... The annual report for the year ended December 31, 2021 is " +
    "also filed on www.sedar.com. Appointment of Auditors. Deloitte Touche Tohmatsu was first " +
    "appointed as auditors of the Company on April 1, 2010.";
  const current = "NOTICE AND INFORMATION CIRCULAR 2026 ... On June 26, 2025, Deloitte Touche Tohmatsu " +
    "retired as auditor of the Company ... BDO was appointed following the completion of the audit " +
    "of the Company's financial statements for the year ended December 31, 2025.";
  assert.equal(reportsOn(stale, "2026-10-13T10:00:00Z"), 2021);
  assert.equal(reportsOn(current, "2026-09-13T10:00:00Z"), 2025);
});

test("the latest period ended is the one a document reports on, comparatives included", () => {
  assert.equal(reportsOn("For the years ended December 31, 2025 and December 31, 2024"), 2025);
  assert.equal(reportsOn("the three months ended September 30, 2025 and the year ended December 31, 2024"), 2025);
  assert.equal(reportsOn("Nine-months ended September 30th 2025"), 2025);
  assert.equal(reportsOn("for the fiscal year ended December 31, 2025, filed under Form 40-F"), 2025);
});

test("day-first dates and French filings say it their own way", () => {
  assert.equal(reportsOn("Annual report for the year ended 30 June 2025"), 2025);
  assert.equal(reportsOn("Financial statements for the year ended 31st December 2024"), 2024);
  assert.equal(reportsOn("les états financiers de l'exercice clos le 31 décembre 2025"), 2025);
  assert.equal(reportsOn("pour les exercices terminés le 31 mars 2024 et 2023"), 2024);
});

test("a forward-looking date is not a period the document reports on", () => {
  // "ending" and "by" are the future; only a period that ENDED counts.
  assert.equal(reportsOn("guidance for the year ending December 31, 2027; first gold by June 30, 2028. " +
                         "Results for the year ended December 31, 2024."), 2024);
});

test("a period that had not ended when the document was read is not one it reports on", () => {
  assert.equal(reportsOn("year ended December 31, 2029 (a typo) and year ended December 31, 2025",
                         "2026-10-13 09:00:00"), 2025);
  // The day matters, not just the year: on 13 October 2026, the year 2026 has
  // not ended, and its third quarter has.
  assert.equal(reportsOn("the year ended December 31, 2026 and the year ended December 31, 2025",
                         "2026-10-13 09:00:00"), 2025);
  assert.equal(reportsOn("three months ended September 30, 2026", "2026-10-13 09:00:00"), 2026);
  // Both engines' shapes of the same moment, and a Date.
  for (const at of ["2026-10-13 09:00:00", "2026-10-13 09:00:00.54+00", new Date("2026-10-13T09:00:00Z")]) {
    assert.equal(reportsOn("year ended December 31, 2026; year ended December 31, 2025", at), 2025, String(at));
  }
});

test("a document that never says what it covers reports on nothing anyone knows", () => {
  assert.equal(reportsOn('{"cik":"0002086771","addresses":{"business":{"city":"VANCOUVER"}}}'), null);
  assert.equal(reportsOn(""), null);
  assert.equal(reportsOn(null), null);
  assert.equal(reportsOn("As at December 31, 2025 the Company held cash of $12 million."), null);
});
