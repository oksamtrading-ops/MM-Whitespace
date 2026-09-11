/**
 * Parse an uploaded workbook, and hold the RESULT rather than the file.
 *
 * The validation report has to precede the commit -- the load-bearing property
 * of the quarterly refresh in docs/design/01 -- so parse and commit are two
 * requests, and something has to survive between them. What survives is the
 * parsed payload, in `upload_quarantine`, for an hour. Never the workbook: it
 * is parsed and discarded inside the request that carried it, so there is no
 * durable store of a licensed extract anywhere in the application.
 *
 * WHERE THE PARSER RUNS. Locally, as a `python3` subprocess. On Vercel, whose
 * Node functions have no Python, as the Python function in api/parse.py -- the
 * same parser, reached over HTTP with a shared secret. Both return the same
 * payload, byte for byte; tests/test_parse_service.py holds them to it.
 *
 * WHY THE DATABASE, NOT A DIRECTORY. The parse used to wait in the server's
 * temporary directory. On a platform where consecutive requests land on
 * different instances, the commit could not find the parse its own validation
 * report had just shown.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";

const run = promisify(execFile);

/** An hour, matching the retention table's line for raw uploads. */
export const QUARANTINE_TTL_MS = 60 * 60 * 1000;

/**
 * Below Vercel's 4.5 MB request limit, so an oversized file is refused with this
 * application's own sentence rather than the platform's. The real workbook is
 * about 1 MB. Matches MAX_BYTES in mmparser/service.py.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Parse ids are generated here and never taken from a filename. Reads verify
 * the shape anyway, so a crafted id is refused before it reaches a query.
 */
export function isParseId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

export type ParseFinding = { kind: string; code: string; detail: string };

export type ParsedPayload = {
  period: string | null;
  companies: unknown[];
  report: {
    blocking: ParseFinding[];
    warnings: ParseFinding[];
    info: ParseFinding[];
    proofs: Record<string, unknown>;
    totals: Record<string, [number, number]>;
  };
};

export type Parse = {
  id: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  parsedAt: string;
  payload: ParsedPayload;
};

export class ParseFailed extends Error {
  detail: string;
  constructor(message: string, detail = "") {
    super(message);
    this.name = "ParseFailed";
    this.detail = detail;
  }
}

/** Where the Python parser answers on Vercel, or null to run it locally. */
export function parserEndpoint(
  env: Record<string, string | undefined> = process.env,
): { url: string; headers: Record<string, string> } | null {
  const bypass: Record<string, string> = env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET }
    : {};
  if (env.MM_PARSE_URL) return { url: env.MM_PARSE_URL, headers: bypass };
  if (!env.VERCEL) return null;
  // The production domain, not the deployment's own URL: deployment URLs sit
  // behind Vercel's login under Standard Protection, and this request comes
  // from a server that has no browser session to present.
  const host = env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL
    ? env.VERCEL_PROJECT_PRODUCTION_URL
    : env.VERCEL_URL;
  if (!host) {
    throw new ParseFailed("The upload parser is not configured on this deployment.");
  }
  return { url: `https://${host}/api/parse`, headers: bypass };
}

/**
 * Validate, parse, hold. The parser reports blocking findings in the payload
 * rather than failing: the Analyst is entitled to read what it found.
 */
export async function parseUpload(
  db: Sql, bytes: Uint8Array, filename: string,
  opts: { uploadedBy?: string | null } = {},
): Promise<Parse> {
  if (bytes.byteLength === 0) throw new ParseFailed("That file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ParseFailed(
      `That file is ${(bytes.byteLength / 1048576).toFixed(1)} MB. The limit is ` +
      `${MAX_UPLOAD_BYTES / 1048576} MB.`);
  }
  if (!/\.xlsx$/i.test(filename)) {
    throw new ParseFailed("Only .xlsx workbooks are read.",
                          `Received ${filename || "a file with no name"}.`);
  }

  const endpoint = parserEndpoint();
  const payload = endpoint ? await parseRemotely(endpoint, bytes) : await parseLocally(bytes);

  const parse: Parse = {
    id: randomBytes(16).toString("hex"),
    filename,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    parsedAt: new Date().toISOString(),
    payload,
  };
  await db.run(
    `insert into upload_quarantine
       (id, filename, size_bytes, sha256, payload, uploaded_by, parsed_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    parse.id, parse.filename, parse.sizeBytes, parse.sha256, JSON.stringify(parse.payload),
    opts.uploadedBy ?? null, formatStamp(), formatStamp(Date.now() + QUARANTINE_TTL_MS));
  return parse;
}

async function parseRemotely(
  endpoint: { url: string; headers: Record<string, string> }, bytes: Uint8Array,
): Promise<ParsedPayload> {
  const secret = process.env.MM_PARSE_SECRET;
  if (!secret) throw new ParseFailed("The upload parser is not configured on this deployment.");
  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        ...endpoint.headers,
        "content-type": "application/octet-stream",
        "x-mm-parse-secret": secret,
      },
      // A Blob, because the fetch types will not take a Uint8Array whose buffer
      // might be shared; the bytes are the same.
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    });
  } catch (err) {
    throw new ParseFailed("The upload parser could not be reached. Try again in a minute.",
                          (err as Error).message);
  }
  const body = await res.json().catch(() => ({})) as ParsedPayload & { error?: string };
  if (res.status === 401) {
    // A configuration fault between two parts of this application, not
    // anything the Analyst did or can fix.
    throw new ParseFailed("The upload parser refused this server. An Admin needs to check MM_PARSE_SECRET.");
  }
  if (!res.ok) throw new ParseFailed(body.error ?? "That workbook could not be read.");
  return body;
}

/** The command-line path, for local work and the test suite. */
async function parseLocally(bytes: Uint8Array): Promise<ParsedPayload> {
  const dir = mkdtempSync(join(tmpdir(), "mm-parse-"));
  const workbook = join(dir, "upload.xlsx");
  const payloadPath = join(dir, "payload.json");
  writeFileSync(workbook, bytes, { mode: 0o600 });
  try {
    try {
      await run("python3", ["-m", "mmparser.cli", workbook, "--json", payloadPath],
                { cwd: process.cwd(), timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
      // Exit 1 means blocking findings and a payload that was still written.
      if (safeSize(payloadPath) === 0) {
        const e = err as { stderr?: string; message?: string };
        throw new ParseFailed("That workbook could not be read.",
                              lastLine(e.stderr ?? e.message ?? ""));
      }
    }
    return JSON.parse(readFileSync(payloadPath, "utf8")) as ParsedPayload;
  } finally {
    // The licensed extract does not outlive the request that carried it.
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function readParse(db: Sql, id: string): Promise<Parse | null> {
  if (!isParseId(id)) return null;
  const row = await db.get(
    `select id, filename, size_bytes, sha256, payload, parsed_at
       from upload_quarantine where id = ? and expires_at > ?`,
    id, formatStamp()) as {
      id: string; filename: string; size_bytes: number; sha256: string;
      payload: string; parsed_at: string;
    } | undefined;
  if (!row) return null;
  return {
    id: row.id, filename: row.filename, sizeBytes: Number(row.size_bytes),
    sha256: row.sha256, parsedAt: String(row.parsed_at),
    payload: JSON.parse(row.payload) as ParsedPayload,
  };
}

export async function dropParse(db: Sql, id: string): Promise<void> {
  if (!isParseId(id)) return;
  await db.run("delete from upload_quarantine where id = ?", id);
}

/**
 * Delete anything past its hour. `examined` counts what was over the hour, so
 * a dry run reports the same number it would delete.
 */
export async function sweepQuarantine(
  db: Sql, now: number = Date.now(), { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ examined: number; deleted: number }> {
  const cutoff = formatStamp(now);
  const n = Number((await db.get(
    "select count(*) n from upload_quarantine where expires_at <= ?", cutoff) as { n: number }).n);
  if (dryRun || n === 0) return { examined: n, deleted: 0 };
  const r = await db.run("delete from upload_quarantine where expires_at <= ?", cutoff);
  return { examined: n, deleted: r.changes };
}

/**
 * The quarter is not in the workbook -- only the market-cap date is -- so a
 * label can be suggested but never derived. Advancing the previous label is a
 * guess the Analyst confirms, and a wrong one names the period permanently.
 */
export function suggestLabel(previousLabel: string | null, asOf: string): string {
  const m = previousLabel?.match(/^Q([1-4])-(\d{4})/);
  if (!m) return asOf;
  const q = Number(m[1]), year = Number(m[2]);
  const nextQ = q === 4 ? 1 : q + 1;
  const nextYear = q === 4 ? year + 1 : year;
  return `Q${nextQ}-${nextYear} (${asOf})`;
}

function safeSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines[lines.length - 1]?.slice(0, 300) ?? "";
}
