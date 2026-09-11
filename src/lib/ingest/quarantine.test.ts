import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { memorySql } from "../db/open.ts";
import { formatStamp } from "../db/stamp.ts";
import {
  dropParse, isParseId, MAX_UPLOAD_BYTES, ParseFailed, parserEndpoint, parseUpload,
  readParse, suggestLabel, sweepQuarantine,
} from "./quarantine.ts";

/* The parser is Python, so the tests that actually run it skip where it is not
   installed -- the library suite runs in CI with no dependencies. */
const hasParser = spawnSync("python3", ["-c", "import openpyxl"]).status === 0;
const FIXTURE = new URL("../../../tests/fixtures/synthetic_whitespace.xlsx", import.meta.url);

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T) {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  try {
    const out = fn();
    if (out instanceof Promise) return out.finally(restore);
    restore();
    return out;
  } catch (err) { restore(); throw err; }
}

const LOCAL = { MM_PARSE_URL: undefined, VERCEL: undefined };

test("a parse id is generated here, never taken from a filename", async () => {
  assert.ok(!isParseId("../../etc/passwd"));
  assert.ok(!isParseId("abc"));
  assert.ok(!isParseId("A".repeat(32)), "upper case is not the generated shape");
  assert.ok(isParseId("0123456789abcdef0123456789abcdef"));
  assert.equal(await readParse(memorySql(), "../../../etc/passwd"), null);
});

test("only .xlsx is read, and only up to the cap", async () => {
  const db = memorySql();
  await assert.rejects(() => parseUpload(db, new Uint8Array([1, 2, 3]), "workbook.xls"),
                       (e) => e instanceof ParseFailed && /Only \.xlsx/.test(e.message));
  await assert.rejects(() => parseUpload(db, new Uint8Array(0), "workbook.xlsx"),
                       (e) => e instanceof ParseFailed && /empty/.test(e.message));
  await assert.rejects(
    () => parseUpload(db, new Uint8Array(MAX_UPLOAD_BYTES + 1), "workbook.xlsx"),
    (e) => e instanceof ParseFailed && /limit is 4 MB/.test(e.message),
    "below Vercel's 4.5 MB, so the refusal is this application's sentence");
});

test("something that is not a workbook is refused with what went wrong",
     { skip: !hasParser }, async () => {
  await withEnv(LOCAL, () => assert.rejects(
    () => parseUpload(memorySql(), new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "notaworkbook.xlsx"),
    (e) => e instanceof ParseFailed && /could not be read/.test(e.message)));
});

test("the parse is held in the database and the workbook is not kept anywhere",
     { skip: !hasParser }, async () => {
  const db = memorySql();
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const before = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("mm-parse-")));
  const parse = await withEnv(LOCAL, () => parseUpload(db, bytes, "synthetic.xlsx"));

  assert.equal(parse.filename, "synthetic.xlsx");
  assert.ok(parse.payload.companies.length > 0, "companies were parsed");
  assert.ok(parse.payload.period, "a market-cap date was resolved");
  assert.equal(parse.sizeBytes, bytes.byteLength);

  const after = readdirSync(tmpdir()).filter((f) => f.startsWith("mm-parse-") && !before.has(f));
  assert.deepEqual(after, [], "the licensed extract does not outlive the request that carried it");

  // Readable back from ANOTHER call -- which is what a second request is --
  // and gone once committed.
  const back = await readParse(db, parse.id);
  assert.equal(back?.sha256, parse.sha256);
  assert.deepEqual(back?.payload, parse.payload);
  await dropParse(db, parse.id);
  assert.equal(await readParse(db, parse.id), null);
});

test("a parse older than its hour is not returned, and is swept", async () => {
  const db = memorySql();
  const id = "0123456789abcdef0123456789abcdef";
  await db.run(
    `insert into upload_quarantine (id, filename, size_bytes, sha256, payload, expires_at)
     values (?, 'w.xlsx', 1, 'sha', '{}', ?)`, id, formatStamp(Date.now() - 60_000));

  assert.equal(await readParse(db, id), null, "an expired parse reads as absent");
  assert.deepEqual(await sweepQuarantine(db, Date.now(), { dryRun: true }),
                   { examined: 1, deleted: 0 },
                   "a dry run reports what it would delete and deletes nothing");
  assert.deepEqual(await sweepQuarantine(db), { examined: 1, deleted: 1 });
  assert.equal((await db.all("select id from upload_quarantine")).length, 0);
});

/* ------------------------------------------------------------ on Vercel */

test("locally the parser runs as a subprocess; on Vercel it is the Python function", () => {
  assert.equal(parserEndpoint({}), null);
  assert.deepEqual(
    parserEndpoint({ VERCEL: "1", VERCEL_ENV: "production",
                     VERCEL_PROJECT_PRODUCTION_URL: "mm.example", VERCEL_URL: "mm-abc.example" }),
    { url: "https://mm.example/api/parse", headers: {} },
    "production calls the production domain, which is not behind the deployment login");
  assert.deepEqual(
    parserEndpoint({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "mm-abc.example",
                     VERCEL_AUTOMATION_BYPASS_SECRET: "bypass" }),
    { url: "https://mm-abc.example/api/parse",
      headers: { "x-vercel-protection-bypass": "bypass" } },
    "a preview calls itself, past its own protection");
  assert.equal(parserEndpoint({ MM_PARSE_URL: "http://p.example/api/parse" })?.url,
               "http://p.example/api/parse", "an explicit address wins");
  assert.throws(() => parserEndpoint({ VERCEL: "1" }), ParseFailed,
                "on Vercel with no address it refuses, rather than try Python that is not there");
});

async function fakeParser(respond: (secret: string | undefined) => [number, unknown]) {
  const seen: Array<{ secret?: string; bytes: number }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const secret = req.headers["x-mm-parse-secret"] as string | undefined;
      seen.push({ secret, bytes: Buffer.concat(chunks).length });
      const [status, body] = respond(secret);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/api/parse`, seen, close: () => server.close() };
}

const PAYLOAD = {
  period: "2026-05-31", companies: [{ name: "Northco" }],
  report: { blocking: [], warnings: [], info: [], proofs: {}, totals: {} },
};

test("over the network: the bytes and the secret go, the payload comes back and is held",
     async () => {
  const p = await fakeParser((s) => (s === "sekret" ? [200, PAYLOAD] : [401, { error: "unauthorized" }]));
  try {
    const db = memorySql();
    const bytes = new Uint8Array([0x50, 0x4b, 1, 2, 3]);
    const parse = await withEnv({ MM_PARSE_URL: p.url, MM_PARSE_SECRET: "sekret" },
      () => parseUpload(db, bytes, "w.xlsx"));
    assert.deepEqual(p.seen, [{ secret: "sekret", bytes: 5 }]);
    assert.deepEqual(parse.payload, PAYLOAD);
    assert.deepEqual((await readParse(db, parse.id))?.payload, PAYLOAD);
  } finally { p.close(); }
});

test("a refused secret is reported as configuration, not as the Analyst's fault", async () => {
  const p = await fakeParser(() => [401, { error: "unauthorized" }]);
  try {
    await withEnv({ MM_PARSE_URL: p.url, MM_PARSE_SECRET: "wrong" }, () => assert.rejects(
      () => parseUpload(memorySql(), new Uint8Array([0x50, 0x4b]), "w.xlsx"),
      (e) => e instanceof ParseFailed && /MM_PARSE_SECRET/.test(e.message)));
  } finally { p.close(); }
});

test("the parser's own refusal is passed through in its words", async () => {
  const p = await fakeParser(() => [422, { error: "That workbook could not be read: bad zip" }]);
  try {
    await withEnv({ MM_PARSE_URL: p.url, MM_PARSE_SECRET: "s" }, () => assert.rejects(
      () => parseUpload(memorySql(), new Uint8Array([0x50, 0x4b]), "w.xlsx"),
      (e) => e instanceof ParseFailed && /bad zip/.test(e.message)));
  } finally { p.close(); }
});

test("with no secret configured it refuses before sending anything", async () => {
  const p = await fakeParser(() => [200, PAYLOAD]);
  try {
    await withEnv({ MM_PARSE_URL: p.url, MM_PARSE_SECRET: undefined }, () => assert.rejects(
      () => parseUpload(memorySql(), new Uint8Array([0x50, 0x4b]), "w.xlsx"),
      (e) => e instanceof ParseFailed && /not configured/.test(e.message)));
    assert.equal(p.seen.length, 0, "no workbook leaves the server without a secret to send");
  } finally { p.close(); }
});

test("the label is suggested from the previous period, never derived from the date", async () => {
  // The workbook carries a market-cap date; the quarter is not in it at all.
  assert.equal(suggestLabel("Q3-2026 (2026-05-31)", "2026-08-31"), "Q4-2026 (2026-08-31)");
  assert.equal(suggestLabel("Q4-2026 (2026-08-31)", "2026-11-30"), "Q1-2027 (2026-11-30)");
  assert.equal(suggestLabel(null, "2026-05-31"), "2026-05-31",
               "with nothing to advance, the date stands in and the Analyst names it");
  assert.equal(suggestLabel("FY2026", "2026-05-31"), "2026-05-31");
});
