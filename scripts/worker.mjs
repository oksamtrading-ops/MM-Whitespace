/**
 * A long-lived local worker: drain the ledger, sleep, repeat.
 *
 *   MM_ENRICH_MODE=replay node scripts/worker.mjs ./period.db
 *   MM_ENRICH_MODE=replay node scripts/worker.mjs ./period.db --once
 *
 * The same drain function that runs inside a platform invocation, run as a
 * plain process -- which is the portability claim in docs/design/03 made
 * checkable. Replay mode sends nothing anywhere.
 */
import { DatabaseSync } from "node:sqlite";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { drain } from "../src/lib/enrich/drain.ts";
import { enrichmentMode } from "../src/lib/enrich/worker.ts";

const [dbPath, ...flags] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: MM_ENRICH_MODE=replay node scripts/worker.mjs <period.db> [--once]");
  process.exit(2);
}
const once = flags.includes("--once");
const mode = enrichmentMode();
if (mode.mode === null) {
  console.error(mode.reason);
  process.exit(2);
}

const handle = new DatabaseSync(dbPath);
handle.exec("pragma foreign_keys = on");
const db = new SqliteSql(handle);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (;;) {
  const out = await drain(db, { deadlineSeconds: 240, mode: mode.mode, host: "local" });
  console.log(`${new Date().toISOString()}  ${out.reason.padEnd(9)} ` +
              `completed ${out.jobsCompleted}  failed ${out.jobsFailed}  ${out.seconds}s` +
              `${out.lastError ? `  last error: ${out.lastError}` : ""}`);
  if (once) break;
  // Work left means go straight back in; an empty ledger means wait a while.
  if (!out.workRemains) await sleep(15_000);
}
await db.close();
