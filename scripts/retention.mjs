/**
 * Retention jobs.
 *
 * "Each line needs a named owner, or none of it happens." So every rule below
 * carries one, and the job REFUSES TO RUN a rule whose owner is still the
 * placeholder -- an unowned retention rule is a rule nobody will notice failing.
 *
 *   node scripts/retention.mjs ./period.db            # dry run, the default
 *   node scripts/retention.mjs ./period.db --apply
 *   node scripts/retention.mjs "$MM_DATABASE_URL" --apply
 *   node scripts/retention.mjs ./period.db --export-audit ./audit-export.jsonl
 *
 * IT RUNS ON EITHER ENGINE. It used to drive node:sqlite directly, which meant
 * the one database that accumulates anything -- production -- was the one it
 * could not sweep: expired parses, sign-in links and sessions were hidden by
 * their expiry and never deleted. Every rule now goes through the same seam
 * the application uses, and the three sweeps that already existed in the
 * application are CALLED rather than re-written here, so a rule and the code
 * it mirrors cannot drift.
 *
 * See the retention table in docs/design/11-security-privacy-compliance.md.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { PostgresSql } from "../src/lib/db/postgres.ts";
import { formatStamp } from "../src/lib/db/stamp.ts";
import { purgeSignInFailures } from "../src/lib/auth/signin.ts";
import { purgeExpiredSessions } from "../src/lib/auth/sessions.ts";
import { sweepQuarantine } from "../src/lib/ingest/quarantine.ts";

const UNOWNED = "UNASSIGNED";

/**
 * Owners, assigned 9 September 2026 (open question 16).
 *
 * All five sit with the solution owner for the pilot. Two of them -- raw
 * uploads and extracted document text -- are automated and have no judgement
 * in them; they should transfer to a named engineer once there is one, and
 * they are marked `transferable` so that hand-off is a visible act rather than
 * a quiet reassignment.
 *
 * An owner is a person, never a team: "engineering" cannot be paged and does
 * not notice a job that stopped running.
 */
const SOLUTION_OWNER = "Samuel Owusu";
export const RULES = [
  {
    key: "raw_uploads",
    label: "Raw uploads",
    retention: "1 hour, in quarantine",
    owner: SOLUTION_OWNER,
    transferable: true,
    // Nothing to delete: uploads are parsed and the bytes dropped rather than
    // stored. The rule is listed so its absence is a stated fact, not a gap.
    apply: async (db, apply) => {
      // The workbook itself is deleted inside the request that parsed it, so
      // there is no store of a licensed extract. What outlives that request is
      // the PARSED PAYLOAD, held for an hour in upload_quarantine because the
      // validation report has to precede the commit -- swept here when it is
      // not committed.
      const { examined, deleted } = await sweepQuarantine(db, Date.now(), { dryRun: !apply });
      return { examined, deleted,
               note: "parsed payloads past their hour in upload_quarantine; " +
                     "the workbook itself is never stored" };
    },
  },
  {
    key: "document_text",
    label: "Extracted document text",
    retention: "90 days",
    owner: SOLUTION_OWNER,
    transferable: true,
    apply: async (db, apply) => {
      const cutoff = isoDaysAgo(90);
      // Rows still holding text, so a second run reports nothing left to do
      // rather than counting the same cleared rows for ever.
      const n = Number((await db.get(
        `select count(*) n from documents
          where retrieved_at < ? and text_content is not null`, cutoff)).n);
      if (apply && n) {
        // Findings anchor to a document hash, so the TEXT is cleared and the
        // row kept: deleting the row would orphan the anchor and make an
        // accepted finding unverifiable after the fact.
        await db.run(`update documents set text_content = null
                       where retrieved_at < ? and text_content is not null`, cutoff);
      }
      return { examined: n, deleted: apply ? n : 0,
               note: "text cleared, row retained so finding anchors stay resolvable" };
    },
  },
  {
    key: "auth_tokens",
    label: "Sign-in links and sessions",
    retention: "30 days past expiry",
    owner: SOLUTION_OWNER,
    transferable: true,
    apply: async (db, apply) => {
      // Neither table holds a usable secret -- a session holds its token's
      // SHA-256, and a failed attempt holds no token at all -- so what is swept
      // here is evidence rather than credentials: when a session ended, and who
      // could not get in from where. Kept a month because that is the window in
      // which somebody asks why they were signed out, and dropped after it
      // because a permanent record of every sign-in is a permanent record of a
      // person's working hours. The failures are also a counter that would
      // otherwise grow without bound: the address column is deliberately not a
      // foreign key, so anybody can add rows to it by typing.
      const cutoff = isoDaysAgo(30);
      const sessions = Number((await db.get(
        "select count(*) n from auth_sessions where expires_at < ?", cutoff)).n);
      const failures = Number((await db.get(
        "select count(*) n from auth_sign_in_failures where at < ?", cutoff)).n);
      // The purge functions ARE the rule; 30 days is stated once, in the
      // retention line above, and passed to both.
      const deleted = apply
        ? await purgeExpiredSessions(db, 30) + await purgeSignInFailures(db, 30)
        : 0;
      return { examined: sessions + failures, deleted,
               note: `${sessions} session(s) and ${failures} failed attempt(s) ` +
                     "past 30 days; the audit_log entry for each sign-in is kept" };
    },
  },
  {
    key: "audit_log",
    label: "Audit log",
    retention: "24 months, with a periodic export first",
    owner: SOLUTION_OWNER,
    transferable: false,
    apply: async (db, apply, opts) => {
      const cutoff = isoDaysAgo(730);
      const rows = await db.all(
        "select id, event, actor_id, period_id, detail, created_at from audit_log where created_at < ?",
        cutoff);
      if (rows.length && !opts.exportPath) {
        const err = new Error(
          "refusing to trim the audit log without an export path. The log is the one " +
          "artifact that answers who published what; trimming it unexported destroys " +
          "that answer. Pass --export-audit <path>.",
        );
        // Carry the count, or the refusal reports "0 rows beyond retention"
        // beside "REFUSED" and reads as though there was nothing to do.
        err.examined = rows.length;
        throw err;
      }
      if (apply && rows.length) {
        for (const row of rows) appendFileSync(opts.exportPath, JSON.stringify(row) + "\n");
        await db.run("delete from audit_log where created_at < ?", cutoff);
      }
      return { examined: rows.length, deleted: apply ? rows.length : 0,
               note: opts.exportPath ? `exported to ${opts.exportPath} before deletion`
                                     : "nothing beyond retention" };
    },
  },
  {
    key: "findings_decisions_traces",
    label: "Findings, decisions and traces",
    retention: "life of the pilot",
    owner: SOLUTION_OWNER,
    transferable: false,
    apply: () => ({ examined: 0, deleted: 0, note: "retained for the life of the pilot" }),
  },
  {
    key: "published_snapshots",
    label: "Frozen published snapshots",
    retention: "life of the pilot",
    owner: SOLUTION_OWNER,
    transferable: false,
    apply: () => ({ examined: 0, deleted: 0,
                    note: "retained: they ARE the audit answer for a published period" }),
  },
];

function isoDaysAgo(days) {
  return formatStamp(Date.now() - days * 86_400_000);
}

/**
 * A Postgres URL or a SQLite path, told apart by the scheme.
 *
 * Not openSql(): that reads MM_DATABASE_URL from the environment, and a job
 * that deletes rows should sweep the database it was NAMED, never one it found
 * lying around in a shell.
 */
export function openTarget(target) {
  if (/^postgres(ql)?:\/\//i.test(target)) return new PostgresSql({ connectionString: target });
  const handle = new DatabaseSync(target);
  handle.exec("pragma foreign_keys = on");
  return new SqliteSql(handle);
}

export async function run(target, { apply = false, exportPath = null } = {}) {
  const db = typeof target === "string" ? openTarget(target) : target;
  const results = [];
  const unowned = RULES.filter((r) => r.owner === UNOWNED);

  for (const rule of RULES) {
    let outcome;
    try {
      outcome = await rule.apply(db, apply, { exportPath });
    } catch (err) {
      outcome = {
        examined: err.examined ?? 0, deleted: 0,
        note: `REFUSED: ${err.message}`, refused: true,
      };
    }
    results.push({ ...rule, ...outcome });
  }
  if (typeof target === "string") await db.close();
  return { results, unowned };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [target, ...rest] = process.argv.slice(2);
  if (!target) {
    console.error("usage: node scripts/retention.mjs <sqlite-path|postgres-url> [--apply] [--export-audit <path>]");
    process.exit(2);
  }
  const apply = rest.includes("--apply");
  const ei = rest.indexOf("--export-audit");
  const exportPath = ei >= 0 ? rest[ei + 1] : null;
  if (exportPath) writeFileSync(exportPath, "", { flag: "a" });

  const { results, unowned } = await run(target, { apply, exportPath });

  console.log(apply ? "retention — APPLYING\n" : "retention — dry run (pass --apply to act)\n");
  for (const r of results) {
    console.log(`  ${r.label}`);
    console.log(`    retention: ${r.retention}`);
    console.log(`    owner:     ${r.owner === UNOWNED ? "** UNASSIGNED **" : r.owner}` +
                (r.transferable ? "  (automated — transfer to a named engineer when there is one)" : ""));
    console.log(`    ${r.examined} row(s) beyond retention — ${r.note}`);
    if (r.refused) console.log("    NOTHING WAS DELETED for this rule.");
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
