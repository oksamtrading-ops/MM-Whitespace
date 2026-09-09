/**
 * Parse an uploaded workbook, and hold the RESULT rather than the file.
 *
 * The validation report has to precede the commit -- that is the load-bearing
 * property of the quarterly refresh in docs/design/01 -- so the parse and the
 * commit are two requests, and something has to survive between them. What
 * survives is the parsed payload, never the workbook: the upload is written to
 * a quarantine directory, parsed, and DELETED in the same call, so there is no
 * durable store of a licensed extract anywhere in the application.
 *
 * The payload that remains is derived data with a one-hour life, swept by
 * scripts/retention.mjs.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** An hour, matching the retention table's line for raw uploads. */
export const QUARANTINE_TTL_MS = 60 * 60 * 1000;

/** Big enough for the real workbook at 1.01 MB, small enough to refuse a mistake. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function quarantineDir(): string {
  const dir = process.env.MM_QUARANTINE ?? join(tmpdir(), "mm-whitespace-quarantine");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Parse ids are generated here and never taken from a filename, so a path can
 * not be built out of anything a user supplied. Reads verify the shape anyway.
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

/**
 * Write, parse, delete. The parser exits non-zero when it finds a blocking
 * problem, which is a REPORT, not a failure: the payload is written before it
 * exits and the analyst is entitled to read what it found.
 */
export async function parseUpload(bytes: Uint8Array, filename: string): Promise<Parse> {
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

  const dir = quarantineDir();
  const id = randomBytes(16).toString("hex");
  const workbook = join(dir, `${id}.xlsx`);
  const payloadPath = join(dir, `${id}.json`);

  writeFileSync(workbook, bytes, { mode: 0o600 });
  try {
    try {
      await run("python3", ["-m", "mmparser.cli", workbook, "--json", payloadPath],
                { cwd: process.cwd(), timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
      // Exit 1 means blocking findings and a payload that was still written.
      const wrote = safeSize(payloadPath) > 0;
      if (!wrote) {
        const e = err as { stderr?: string; message?: string };
        throw new ParseFailed(
          "That workbook could not be read.",
          lastLine(e.stderr ?? e.message ?? ""));
      }
    }
    const raw = readFileSync(payloadPath, "utf8");
    const parse: Parse = {
      id,
      filename,
      sizeBytes: bytes.byteLength,
      // The sha of the WORKBOOK, which is what a period records as its source.
      sha256: createHash("sha256").update(bytes).digest("hex"),
      parsedAt: new Date().toISOString(),
      payload: JSON.parse(raw) as ParsedPayload,
    };
    writeFileSync(payloadPath, JSON.stringify(parse), { mode: 0o600 });
    return parse;
  } finally {
    // The licensed extract does not outlive the request that carried it.
    rmSync(workbook, { force: true });
  }
}

export function readParse(id: string): Parse | null {
  if (!isParseId(id)) return null;
  const path = join(quarantineDir(), `${id}.json`);
  try {
    const parse = JSON.parse(readFileSync(path, "utf8")) as Parse;
    if (Date.now() - Date.parse(parse.parsedAt) > QUARANTINE_TTL_MS) {
      rmSync(path, { force: true });
      return null;
    }
    return parse;
  } catch {
    return null;
  }
}

export function dropParse(id: string): void {
  if (!isParseId(id)) return;
  rmSync(join(quarantineDir(), `${id}.json`), { force: true });
}

/**
 * Delete anything past its hour. `examined` counts what was over the hour, so
 * a dry run reports the same number it would delete.
 */
export function sweepQuarantine(
  now: number = Date.now(), { dryRun = false }: { dryRun?: boolean } = {},
): { examined: number; deleted: number } {
  const dir = quarantineDir();
  let examined = 0, deleted = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let age: number;
    try { age = now - statSync(path).mtimeMs; } catch { continue; }
    if (age <= QUARANTINE_TTL_MS) continue;
    examined++;
    if (!dryRun) { rmSync(path, { force: true }); deleted++; }
  }
  return { examined, deleted };
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
