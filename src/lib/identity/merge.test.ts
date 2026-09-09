import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import {
  findDuplicateCandidates, mergeCompanies, mergePreview, MergeRefused,
  nameStem, resolveCompanyId,
} from "./merge.ts";

function seeded() {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const period = (label: string, asOf: string) => {
    db.prepare("insert into periods (label, market_cap_as_of) values (?, ?)").run(label, asOf);
    return (db.prepare("select id from periods where label = ?").get(label) as { id: string }).id;
  };
  const company = (name: string, normalized: string) => {
    db.prepare("insert into companies (canonical_name, name_normalized) values (?, ?)")
      .run(name, normalized);
    return (db.prepare("select id from companies where name_normalized = ?")
      .get(normalized) as { id: string }).id;
  };
  return { db, period, company };
}

function fact(db: DatabaseSync, periodId: string, companyId: string, key = "company_name") {
  db.prepare(
    `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, ?, 'x', '"x"', 'asserted')`).run(periodId, companyId, key);
}

test("a corporate suffix is not part of the name", () => {
  assert.equal(nameStem("northco mining corporation"), "northco mining");
  assert.equal(nameStem("northco mining corp"), "northco mining");
  assert.equal(nameStem("the northco group ltd"), "northco");
});

test("the same identifier on two rows is the strongest signal there is", () => {
  const { db, company } = seeded();
  const a = company("Northco Mining Corp.", "northco mining corp");
  const b = company("Northco Metals Inc.", "northco metals inc");
  // The same entity id, imported in two periods: an interval each, which is
  // why the index over (scheme, value, valid_from) does not stop it existing.
  db.prepare(
    `insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-02-28', 'extract')`).run(a);
  db.prepare(
    `insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-05-31', 'extract')`).run(b);
  const found = findDuplicateCandidates(db);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "shared_identifier");
  assert.equal(found[0].strength, 1);
  assert.match(found[0].detail, /E-4711/);
});

test("a name that differs only by its suffix is a hunch, and ranks as one", () => {
  const { db, company } = seeded();
  company("Northco Mining Corporation", "northco mining corporation");
  company("Northco Mining Corp.", "northco mining corp");
  const found = findDuplicateCandidates(db);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "same_name_stem");
  assert.equal(found[0].strength, 3, "weaker than an identifier, and shown as weaker");
});

test("two companies with data in one period are two companies", () => {
  const { db, period, company } = seeded();
  const p1 = period("P1", "2026-05-31");
  const a = company("Northco Mining Corp.", "northco mining corp");
  const b = company("Northco Metals Inc.", "northco metals inc");
  fact(db, p1, a);
  fact(db, p1, b);

  assert.throws(() => mergeCompanies(db, { winnerId: a, loserId: b }),
    (e) => e instanceof MergeRefused && /Both hold data in P1/.test(e.message));
  const loser = db.prepare("select status from companies where id = ?").get(b) as { status: string };
  assert.equal(loser.status, "active", "a refused merge changes nothing");
});

test("a rename across periods is merged, and the old name is kept", () => {
  const { db, period, company } = seeded();
  const p1 = period("P1", "2026-02-28");
  const p2 = period("P2", "2026-05-31");
  const oldCo = company("Northco Mining Corp.", "northco mining corp");
  const newCo = company("Aurora Metals Inc.", "aurora metals inc");
  fact(db, p1, oldCo);
  fact(db, p2, newCo);

  const { moved } = mergeCompanies(db, { winnerId: newCo, loserId: oldCo, actorId: null });
  assert.ok(moved >= 1);

  const facts = db.prepare(
    "select count(*) n from company_period_facts where company_id = ?").get(newCo) as { n: number };
  assert.equal(facts.n, 2, "both periods now belong to one company");

  const alias = db.prepare(
    "select name, alias_type from company_aliases where company_id = ?").get(newCo) as
    { name: string; alias_type: string };
  assert.equal(alias.name, "Northco Mining Corp.");
  assert.equal(alias.alias_type, "former",
    "losing the old name would defeat the point of merging");

  const audit = db.prepare(
    "select count(*) n from audit_log where event = 'companies_merged'").get() as { n: number };
  assert.equal(audit.n, 1);
});

test("a merge is a redirect, so a published revision still resolves", () => {
  const { db, period, company } = seeded();
  const p1 = period("P1", "2026-02-28");
  const oldCo = company("Northco Mining Corp.", "northco mining corp");
  const newCo = company("Aurora Metals Inc.", "aurora metals inc");
  db.prepare(
    "insert into period_publications (period_id, revision) values (?, 1)").run(p1);
  const pub = db.prepare("select id from period_publications").get() as { id: string };
  db.prepare(
    `insert into published_period_values (publication_id, company_id, field_key, value, source)
     values (?, ?, 'auditor', '"KPMG"', 'extract')`).run(pub.id, oldCo);

  mergeCompanies(db, { winnerId: newCo, loserId: oldCo });

  const frozen = db.prepare(
    "select company_id from published_period_values where publication_id = ?").get(pub.id) as
    { company_id: string };
  assert.equal(frozen.company_id, oldCo,
    "a published revision is not edited by anything, a merge included");
  const row = db.prepare("select status, merged_into_id from companies where id = ?").get(oldCo) as
    { status: string; merged_into_id: string };
  assert.equal(row.status, "merged");
  assert.equal(row.merged_into_id, newCo);
  assert.equal(resolveCompanyId(db, oldCo), newCo, "and an old link still lands on the company");
});

test("a company already merged away cannot be merged again", () => {
  const { db, company } = seeded();
  const a = company("A Corp", "a corp");
  const b = company("B Corp", "b corp");
  const c = company("C Corp", "c corp");
  mergeCompanies(db, { winnerId: a, loserId: b });
  assert.throws(() => mergeCompanies(db, { winnerId: c, loserId: b }),
    (e) => e instanceof MergeRefused && /already been merged/.test(e.message));
  assert.throws(() => mergePreview(db, a, a),
    (e) => e instanceof MergeRefused && /into itself/.test(e.message));
});

test("both intervals of a shared identifier follow the company", () => {
  const { db, period, company } = seeded();
  const p1 = period("P1", "2026-02-28");
  const p2 = period("P2", "2026-05-31");
  const oldCo = company("Northco Mining Corp.", "northco mining corp");
  const newCo = company("Aurora Metals Inc.", "aurora metals inc");
  fact(db, p1, oldCo);
  fact(db, p2, newCo);
  db.prepare(
    `insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-02-28', 'extract')`).run(oldCo);
  db.prepare(
    `insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-05-31', 'extract')`).run(newCo);

  mergeCompanies(db, { winnerId: newCo, loserId: oldCo });
  const ids = db.prepare(
    "select count(*) n from company_identifiers where company_id = ?").get(newCo) as { n: number };
  assert.equal(ids.n, 2, "an identifier is an interval, so both intervals belong to it now");
});

test("an alias both companies already carry is discarded, not moved twice", () => {
  const { db, company } = seeded();
  const a = company("Aurora Metals Inc.", "aurora metals inc");
  const b = company("Northco Mining Corp.", "northco mining corp");
  for (const id of [a, b]) {
    db.prepare(
      `insert into company_aliases (company_id, name, name_normalized, alias_type, source)
       values (?, 'Northco', 'northco', 'source_variant', 'extract')`).run(id);
  }
  const { discarded } = mergeCompanies(db, { winnerId: a, loserId: b });
  assert.equal(discarded, 1, "the winner already records that name");
  const aliases = db.prepare(
    "select count(*) n from company_aliases where company_id = ?").get(a) as { n: number };
  assert.equal(aliases.n, 2, "the shared variant, and the loser's own name as a former name");
});

test("the preview counts what will move and what will not", () => {
  const { db, period, company } = seeded();
  const p1 = period("P1", "2026-02-28");
  const a = company("A Corp", "a corp");
  const b = company("B Corp", "b corp");
  fact(db, p1, b, "company_name");
  fact(db, p1, b, "auditor");

  const preview = mergePreview(db, a, b);
  assert.deepEqual(preview.moves, [{ table: "company_period_facts", rows: 2 }]);
  assert.deepEqual(preview.overlappingPeriods, []);
  assert.equal(preview.frozenRevisions, 0);
});
