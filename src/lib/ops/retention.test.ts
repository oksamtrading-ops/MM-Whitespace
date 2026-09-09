import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES, run } from "../../../scripts/retention.mjs";
import { applySchema } from "../db/schema.ts";

type Rule = {
  key: string; label: string; retention: string;
  owner: string; transferable?: boolean;
};

test("EVERY retention rule has a named owner", () => {
  // "Each line needs a named owner, or none of it happens." A rule added later
  // without one fails the build here, rather than only at runtime on a
  // schedule nobody is watching.
  for (const rule of RULES as Rule[]) {
    assert.notEqual(rule.owner, "UNASSIGNED", `${rule.label} has no owner`);
    assert.ok(rule.owner && rule.owner.trim().length > 0, `${rule.label} has an empty owner`);
  }
});

test("an owner is a person, not a team", () => {
  // A team cannot be paged and does not notice a job that stopped running.
  const TEAMS = /^(engineering|ops|platform|the team|tbd|n\/?a)$/i;
  for (const rule of RULES as Rule[]) {
    assert.ok(!TEAMS.test(rule.owner.trim()),
      `${rule.label} is owned by "${rule.owner}", which is a team rather than a person`);
  }
});

test("the retention schedule matches the design's table", () => {
  const byKey = Object.fromEntries((RULES as Rule[]).map((r) => [r.key, r]));
  assert.match(byKey.raw_uploads.retention, /1 hour/);
  assert.match(byKey.document_text.retention, /90 days/);
  assert.match(byKey.audit_log.retention, /24 months/);
  assert.match(byKey.findings_decisions_traces.retention, /life of the pilot/);
  assert.match(byKey.published_snapshots.retention, /life of the pilot/);
});

test("the audit log is not trimmed without an export path", () => {
  // It is the one artifact that answers who published what; trimming it
  // unexported destroys that answer.
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  db.prepare(
    "insert into audit_log (event, detail, created_at) values ('old', '{}', '2000-01-01 00:00:00')",
  ).run();
  db.close();

  // run() opens the path itself, so use a file-backed database.
  const dir = mkdtempSync(join(tmpdir(), "mm-ret-"));
  try {
    const path = join(dir, "r.db");
    const file = new DatabaseSync(path);
    applySchema(file);
    file.prepare(
      "insert into audit_log (event, detail, created_at) values ('old','{}','2000-01-01 00:00:00')",
    ).run();
    file.close();

    const { results } = run(path, { apply: true, exportPath: null }) as
      { results: Array<{ key: string; note: string; examined: number; deleted: number }> };
    const audit = results.find((r) => r.key === "audit_log")! as
      { key: string; note: string; examined: number; deleted: number };
    assert.match(audit.note, /REFUSED/);
    assert.match(audit.note, /export path/);
    // A refusal must report the REAL count. Reporting 0 beside "REFUSED" reads
    // as though there was nothing to do, which is the opposite of the truth.
    assert.equal(audit.examined, 1, "the refusal states how many rows it declined to touch");
    assert.equal(audit.deleted, 0);

    const after = new DatabaseSync(path);
    const n = after.prepare("select count(*) n from audit_log").get() as { n: number };
    assert.equal(n.n, 1, "the row must survive a refused trim");
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired document text is cleared but the row is kept", () => {
  // Deleting the row would orphan a finding's anchor and make an accepted
  // value unverifiable after the fact.
  const dir = mkdtempSync(join(tmpdir(), "mm-ret-"));
  try {
    const path = join(dir, "d.db");
    const db = new DatabaseSync(path);
    applySchema(db);
    db.prepare(
      `insert into documents (content_hash, url, retrieved_at, extractor, extractor_version,
                              normalization_version, text_content, source_tier)
       values ('sha256:old', 'https://x.invalid', '2000-01-01 00:00:00', 'f', '1', '1',
               'the filing text', 1)`).run();
    db.close();

    run(path, { apply: true, exportPath: null });

    const after = new DatabaseSync(path);
    const row = after.prepare(
      "select content_hash, text_content from documents where content_hash = 'sha256:old'",
    ).get() as { content_hash: string; text_content: string | null };
    assert.equal(row.content_hash, "sha256:old", "the row survives, so anchors resolve");
    assert.equal(row.text_content, null, "the text is gone");
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
