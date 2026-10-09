/**
 * Write the workbook's head office into the committed, published period.
 *
 * The parser used to read past the head-office columns, so the published
 * Q3-2026 holds a head office only where research found one. This parses the
 * workbook with the current parser and hands the result to backfillHeadOffice
 * (src/lib/db/backfill.ts), which says what it would write and, with --apply,
 * writes it in one transaction. It never writes over research or a decision.
 *
 *   node scripts/backfill_head_office.mjs <workbook.xlsx> [period.db] --expect-revision 8 [--apply]
 *
 * With no database path, MM_DATABASE_URL is used -- in production that is
 * Samuel's own shell, because the URL cannot be read back from Vercel. The
 * head office values are derived here, at run time, from the licensed
 * workbook; they are never written to a file in the repository.
 *
 * Afterwards, publish a new revision for anyone to see them.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { databaseUrl, openSql } from "../src/lib/db/open.ts";
import { backfillHeadOffice, BackfillRefused } from "../src/lib/db/backfill.ts";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--expect"));
const [workbook, dbPath] = positional;
const expectRevision = Number(flag("--expect-revision"));
const apply = args.includes("--apply");

if (!workbook || !Number.isInteger(expectRevision)) {
  console.error("usage: node scripts/backfill_head_office.mjs <workbook.xlsx> [period.db] " +
                "--expect-revision <n> [--apply]");
  process.exit(2);
}

const sha256 = createHash("sha256").update(readFileSync(workbook)).digest("hex");
const dir = mkdtempSync(join(tmpdir(), "mm-backfill-"));
let payload;
try {
  execFileSync("python3", ["-m", "mmparser.cli", workbook, "--json", join(dir, "period.json")], { stdio: ["ignore", "ignore", "inherit"] });
  payload = JSON.parse(readFileSync(join(dir, "period.json"), "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let db;
if (dbPath) {
  const handle = new DatabaseSync(dbPath);
  handle.exec("pragma foreign_keys = on");
  db = new SqliteSql(handle);
} else if (databaseUrl()) {
  db = openSql();
} else {
  console.error("no database: pass a period.db path or set MM_DATABASE_URL");
  process.exit(2);
}

try {
  const r = await backfillHeadOffice(db, payload, { apply, expectRevision, sha256 });
  console.log(`database: ${db.dialect}`);
  console.log(`period: ${r.period}, revision ${r.revision}`);
  console.log(`workbook: ${sha256.slice(0, 12)}...  ${r.parsed} companies, ${r.readable} with a head office`);
  console.log(`${apply ? "wrote" : "would write"}: ${r.facts} facts, ${r.values} values`);
  console.log(`left alone: ${r.standing} head offices already standing from research or review`);
  if (r.unmatched.length) console.log(`not in the period: ${r.unmatched.join(", ")}`);
  if (!apply) console.log("\nnothing written. Run again with --apply to write it, then publish a new revision.");
  else console.log("\nwritten. Publish a new revision for it to reach the dashboards and the companies table.");
} catch (err) {
  if (err instanceof BackfillRefused) { console.error(`refused: ${err.message}`); process.exit(1); }
  throw err;
} finally {
  await db.close?.();
}
