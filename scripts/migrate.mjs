/**
 * Bring an existing database up to the current schema.
 *
 * A migration added later reaches new databases only: commit_period applies
 * the schema when it creates one and never again. This applies what is
 * missing, and records what it applied.
 *
 *   node scripts/migrate.mjs ./period.db          # SQLite, translated
 *   node scripts/migrate.mjs "$MM_DATABASE_URL"   # Postgres, verbatim
 *
 * The Postgres path applies the role and policy migrations too, which the
 * SQLite path skips because SQLite has neither.
 */
import { DatabaseSync } from "node:sqlite";
import { applySchema, migrationFiles } from "../src/lib/db/schema.ts";
import { applySchemaPg } from "../src/lib/db/schema_pg.ts";
import { PostgresSql } from "../src/lib/db/postgres.ts";

const [target] = process.argv.slice(2);
if (!target) {
  console.error("usage: node scripts/migrate.mjs <period.db | postgres url>");
  process.exit(2);
}

const isUrl = /^postgres(ql)?:\/\//.test(target);
let result;
if (isUrl) {
  const db = new PostgresSql({ connectionString: target });
  try { result = await applySchemaPg(db); } finally { await db.close(); }
} else {
  const db = new DatabaseSync(target);
  result = applySchema(db);
  db.close();
}

console.log(`${migrationFiles().length} migrations on disk`);
console.log(result.applied.length === 0
  ? "  nothing to apply — already current"
  : `  applied: ${result.applied.join(", ")}`);
if (result.skipped.length) console.log(`  skipped (Postgres-only): ${result.skipped.join(", ")}`);
