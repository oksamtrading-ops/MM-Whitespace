/**
 * Put the findings already called unsupported through the gate again, so a
 * quote that is in its document -- but not exactly as quoted -- is held for a
 * person instead of counted as a fabrication (src/lib/enrich/recheck.ts says
 * why it matters).
 *
 *   node scripts/recheck_unsupported.mjs "$MM_DATABASE_URL" --dry-run
 *   node scripts/recheck_unsupported.mjs "$MM_DATABASE_URL"
 *   node scripts/recheck_unsupported.mjs ./period.db
 *
 * --dry-run lists what would move and writes nothing. Without it, each move is
 * one transaction with its audit-log row. Running it again moves nothing new.
 */
import { DatabaseSync } from "node:sqlite";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { PostgresSql } from "../src/lib/db/postgres.ts";
import { recheckUnsupported } from "../src/lib/enrich/recheck.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [target] = args.filter((a) => a !== "--dry-run");
if (!target) {
  console.error("usage: node scripts/recheck_unsupported.mjs <period.db | postgres url> [--dry-run]");
  process.exit(2);
}

const db = /^postgres(ql)?:\/\//.test(target)
  ? new PostgresSql({ connectionString: target })
  : new SqliteSql(new DatabaseSync(target));
try {
  const { checked, held } = await recheckUnsupported(db, { dryRun });
  const tally = (key) => Object.entries(Object.groupBy(held, key))
    .map(([k, v]) => `${k} ${v.length}`).sort().join(", ");
  console.log(`${checked} unsupported finding${checked === 1 ? "" : "s"} checked; ` +
              `${held.length} ${dryRun ? "would be" : "now"} held for a person, ` +
              `${checked - held.length} still unsupported`);
  if (held.length > 0) {
    console.log(`  how found: ${tally((c) => c.inexact ?? c.anchorMode)}`);
    console.log(`  by field:  ${tally((c) => c.fieldKey)}`);
  }
} finally {
  await db.close();
}
