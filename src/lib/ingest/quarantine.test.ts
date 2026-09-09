import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isParseId, parseUpload, quarantineDir, readParse, dropParse, sweepQuarantine,
  suggestLabel, MAX_UPLOAD_BYTES, ParseFailed,
} from "./quarantine.ts";

/* The parser is Python, so the tests that actually run it skip where it is not
   installed -- the library suite runs in CI with no dependencies. */
const hasParser = spawnSync("python3", ["-c", "import openpyxl"]).status === 0;
const FIXTURE = new URL("../../../tests/fixtures/synthetic_whitespace.xlsx", import.meta.url);

function isolate() {
  process.env.MM_QUARANTINE = mkdtempSync(join(tmpdir(), "mm-q-"));
  return process.env.MM_QUARANTINE;
}

test("a parse id is generated here, never taken from a filename", () => {
  assert.ok(!isParseId("../../etc/passwd"));
  assert.ok(!isParseId("abc"));
  assert.ok(!isParseId("A".repeat(32)), "upper case is not the generated shape");
  assert.ok(isParseId("0123456789abcdef0123456789abcdef"));
  // A traversal attempt reads as nothing rather than as a path.
  isolate();
  assert.equal(readParse("../../../etc/passwd"), null);
});

test("only .xlsx is read, and only up to the cap", async () => {
  isolate();
  await assert.rejects(() => parseUpload(new Uint8Array([1, 2, 3]), "workbook.xls"),
                       (e) => e instanceof ParseFailed && /Only \.xlsx/.test(e.message));
  await assert.rejects(() => parseUpload(new Uint8Array(0), "workbook.xlsx"),
                       (e) => e instanceof ParseFailed && /empty/.test(e.message));
  await assert.rejects(
    () => parseUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), "workbook.xlsx"),
    (e) => e instanceof ParseFailed && /limit is 25 MB/.test(e.message));
});

test("something that is not a workbook is refused with what went wrong", { skip: !hasParser }, async () => {
  isolate();
  await assert.rejects(
    () => parseUpload(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "notaworkbook.xlsx"),
    (e) => e instanceof ParseFailed && /could not be read/.test(e.message));
});

test("the workbook is parsed and then deleted; only the payload remains",
     { skip: !hasParser }, async () => {
  const dir = isolate();
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const parse = await parseUpload(bytes, "synthetic.xlsx");

  assert.equal(parse.filename, "synthetic.xlsx");
  assert.ok(parse.payload.companies.length > 0, "companies were parsed");
  assert.ok(parse.payload.period, "a market-cap date was resolved");
  assert.equal(parse.sizeBytes, bytes.byteLength);

  const left = readdirSync(dir);
  assert.deepEqual(left, [`${parse.id}.json`],
                   "the licensed extract does not outlive the request that carried it");
  assert.ok(!existsSync(join(dir, `${parse.id}.xlsx`)));

  // Readable back, and gone once committed.
  assert.equal(readParse(parse.id)?.sha256, parse.sha256);
  dropParse(parse.id);
  assert.equal(readParse(parse.id), null);
});

test("a parse older than its hour is not returned, and is swept", () => {
  const dir = isolate();
  const id = "0123456789abcdef0123456789abcdef";
  const stale = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, parsedAt: stale }));

  assert.equal(readParse(id), null, "an expired parse reads as absent");
  assert.ok(!existsSync(join(dir, `${id}.json`)), "and reading it removes it");

  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, parsedAt: stale }));
  const later = Date.now() + 2 * 60 * 60 * 1000;
  assert.deepEqual(sweepQuarantine(later, { dryRun: true }), { examined: 1, deleted: 0 },
                   "a dry run reports what it would delete and deletes nothing");
  assert.deepEqual(sweepQuarantine(later), { examined: 1, deleted: 1 });
  assert.deepEqual(readdirSync(quarantineDir()), []);
});

test("the label is suggested from the previous period, never derived from the date", () => {
  // The workbook carries a market-cap date; the quarter is not in it at all.
  assert.equal(suggestLabel("Q3-2026 (2026-05-31)", "2026-08-31"), "Q4-2026 (2026-08-31)");
  assert.equal(suggestLabel("Q4-2026 (2026-08-31)", "2026-11-30"), "Q1-2027 (2026-11-30)");
  assert.equal(suggestLabel(null, "2026-05-31"), "2026-05-31",
               "with nothing to advance, the date stands in and the Analyst names it");
  assert.equal(suggestLabel("FY2026", "2026-05-31"), "2026-05-31");
});
