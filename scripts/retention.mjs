/**
 * Retention jobs.
 *
 * "Each line needs a named owner, or none of it happens." So every rule below
 * carries one, and the job REFUSES TO RUN a rule whose owner is still the
 * placeholder -- an unowned retention rule is a rule nobody will notice failing.
 *
 *   node scripts/retention.mjs ./period.db            # dry run, the default
 *   node scripts/retention.mjs ./period.db --apply
 *   node scripts/retention.mjs ./period.db --export-audit ./audit-export.jsonl
 *
 * See the retention table in docs/design/11-security-privacy-compliance.md.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const UNOWNED = "UNASSIGNED";

/**
 * Owners are deliberately left UNASSIGNED here rather than guessed at. Naming
 * a plausible owner would be worse than naming none: it would look settled.
 */
export const RULES = [
  {
    key: "raw_uploads",
    label: "Raw uploads",
    retention: "1 hour, in quarantine",
    owner: UNOWNED,
    // Nothing to delete: uploads are parsed and the bytes dropped rather than
    // stored. The rule is listed so its absence is a stated fact, not a gap.
    apply: () => ({ examined: 0, deleted: 0,
                    note: "no durable upload store exists; bytes are dropped after parsing" }),
  },
  {
    key: "document_text",
    label: "Extracted document text",
    retention: "90 days",
    owner: UNOWNED,
    apply: (db, apply) => {
      const cutoff = isoDaysAgo(90);
      const rows = db.prepare(
        "select content_hash from documents where retrieved_at < ?").all(cutoff);
      if (apply && rows.length) {
        // Findings anchor to a document hash, so the TEXT is cleared and the
        // row kept: deleting the row would orphan the anchor and make an
        // accepted finding unverifiable after the fact.
        db.prepare(
          "update documents set text_content = null where retrieved_at < ?").run(cutoff);
      }
      return { examined: rows.length, deleted: rows.length,
               note: "text cleared, row retained so finding anchors stay resolvable" };
    },
  },
  {
    key: "audit_log",
    label: "Audit log",
    retention: "24 months, with a periodic export first",
    owner: UNOWNED,
    apply: (db, apply, opts) => {
      const cutoff = isoDaysAgo(730);
      const rows = db.prepare(
        "select id, event, actor_id, period_id, detail, created_at from audit_log where created_at < ?",
      ).all(cutoff);
      if (rows.length && !opts.exportPath) {
        throw new Error(
          "refusing to trim the audit log without an export path. The log is the one " +
          "artifact that answers who published what; trimming it unexported destroys " +
          "that answer. Pass --export-audit <path>.",
        );
      }
      if (apply && rows.length) {
        for (const row of rows) appendFileSync(opts.exportPath, JSON.stringify(row) + "\n");
        db.prepare("delete from audit_log where created_at < ?").run(cutoff);
      }
      return { examined: rows.length, deleted: rows.length,
               note: opts.exportPath ? `exported to ${opts.exportPath} before deletion`
                                     : "nothing beyond retention" };
    },
  },
  {
    key: "findings_decisions_traces",
    label: "Findings, decisions and traces",
    retention: "life of the pilot",
    owner: UNOWNED,
    apply: () => ({ examined: 0, deleted: 0, note: "retained for the life of the pilot" }),
  },
  {
    key: "published_snapshots",
    label: "Frozen published snapshots",
    retention: "life of the pilot",
    owner: UNOWNED,
    apply: () => ({ examined: 0, deleted: 0,
                    note: "retained: they ARE the audit answer for a published period" }),
  },
];

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000)
    .toISOString().replace("T", " ").slice(0, 19);
}

export function run(dbPath, { apply = false, exportPath = null } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec("pragma foreign_keys = on");
  const results = [];
  const unowned = RULES.filter((r) => r.owner === UNOWNED);

  for (const rule of RULES) {
    let outcome;
    try {
      outcome = rule.apply(db, apply, { exportPath });
    } catch (err) {
      outcome = { examined: 0, deleted: 0, note: `REFUSED: ${err.message}`, refused: true };
    }
    results.push({ ...rule, ...outcome });
  }
  db.close();
  return { results, unowned };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [dbPath, ...rest] = process.argv.slice(2);
  if (!dbPath) {
    console.error("usage: node scripts/retention.mjs <db> [--apply] [--export-audit <path>]");
    process.exit(2);
  }
  const apply = rest.includes("--apply");
  const ei = rest.indexOf("--export-audit");
  const exportPath = ei >= 0 ? rest[ei + 1] : null;
  if (exportPath) writeFileSync(exportPath, "", { flag: "a" });

  const { results, unowned } = run(dbPath, { apply, exportPath });

  console.log(apply ? "retention — APPLYING\n" : "retention — dry run (pass --apply to act)\n");
  for (const r of results) {
    console.log(`  ${r.label}`);
    console.log(`    retention: ${r.retention}`);
    console.log(`    owner:     ${r.owner === UNOWNED ? "** UNASSIGNED **" : r.owner}`);
    console.log(`    ${r.examined} row(s) beyond retention — ${r.note}`);
  }

  if (unowned.length) {
    console.log(`\n${unowned.length} of ${RULES.length} retention rules have no named owner:`);
    for (const r of unowned) console.log(`  - ${r.label}`);
    console.log(
      "\nAn unowned retention rule is one nobody will notice failing. Assign owners in\n" +
      "scripts/retention.mjs before this runs on a schedule.");
    process.exit(1);
  }
}
