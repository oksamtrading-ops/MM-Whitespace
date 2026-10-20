/**
 * Read the fiscal year each stored document reports on, for documents stored
 * before migration 0035 (src/lib/enrich/reportson.ts says why it matters).
 *
 *   node scripts/backfill_reports_on.mjs ./period.db
 *   node scripts/backfill_reports_on.mjs "$MM_DATABASE_URL"
 *
 * Run it after applying 0035. Until it runs, those documents count as
 * unknown, and review demotes nothing on their account. Running it again
 * reads nothing; after REPORTS_ON_VERSION is bumped it reads every document.
 */
import { DatabaseSync } from "node:sqlite";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { PostgresSql } from "../src/lib/db/postgres.ts";
import { backfillReportsOn, REPORTS_ON_VERSION } from "../src/lib/enrich/reportson.ts";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("usage: node scripts/backfill_reports_on.mjs <period.db | postgres url>");
  process.exit(2);
}

const db = /^postgres(ql)?:\/\//.test(target)
  ? new PostgresSql({ connectionString: target })
  : new SqliteSql(new DatabaseSync(target));
try {
  const { read, dated } = await backfillReportsOn(db);
  console.log(read === 0
    ? `every document is already read at version ${REPORTS_ON_VERSION}`
    : `read ${read} document${read === 1 ? "" : "s"}: ${dated} say which year they report on, ` +
      `${read - dated} do not (version ${REPORTS_ON_VERSION})`);
} finally {
  await db.close();
}
