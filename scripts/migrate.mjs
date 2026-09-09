/**
 * Bring an existing database up to the current schema.
 *
 * A migration added later reaches new databases only: commit_period applies
 * the schema when it creates one and never again. This applies what is
 * missing, and records what it applied.
 *
 *   node scripts/migrate.mjs ./period.db
 */
import { DatabaseSync } from "node:sqlite";
import { applySchema, migrationFiles } from "../src/lib/db/schema.ts";

const [dbPath] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/migrate.mjs <db>");
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
const result = applySchema(db);

console.log(`${migrationFiles().length} migrations on disk`);
console.log(result.applied.length === 0
  ? "  nothing to apply — already current"
  : `  applied: ${result.applied.join(", ")}`);
if (result.skipped.length) console.log(`  skipped (Postgres-only): ${result.skipped.join(", ")}`);
db.close();
