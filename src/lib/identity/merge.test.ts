import { test } from "node:test";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import assert from "node:assert/strict";
import { applySchema } from "../db/schema.ts";
import {
  findDuplicateCandidates, mergeCompanies, mergePreview, MergeRefused,
  nameStem, resolveCompanyId,
} from "./merge.ts";
import {
  addAction, addNote, getPursuit, setPriority, startPursuit,
} from "../pursuit/index.ts";

async function seeded() {
  const db = memorySql();
  const period = async (label: string, asOf: string) => {
    await db.run("insert into periods (label, market_cap_as_of) values (?, ?)", label, asOf);
    return (await db.get("select id from periods where label = ?", label) as { id: string }).id;
  };
  const company = async (name: string, normalized: string) => {
    await db.run("insert into companies (canonical_name, name_normalized) values (?, ?)", name, normalized);
    return (await db.get("select id from companies where name_normalized = ?", normalized) as { id: string }).id;
  };
  return { db, period, company };
}

async function fact(db: Sql, periodId: string, companyId: string, key = "company_name") {
  await db.run(`insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
     values (?, ?, ?, 'x', '"x"', 'asserted')`, periodId, companyId, key);
}

test("a corporate suffix is not part of the name", async () => {
  assert.equal(nameStem("northco mining corporation"), "northco mining");
  assert.equal(nameStem("northco mining corp"), "northco mining");
  assert.equal(nameStem("the northco group ltd"), "northco");
});

test("the same identifier on two rows is the strongest signal there is", async () => {
  const { db, company } = await seeded();
  const a = await company("Northco Mining Corp.", "northco mining corp");
  const b = await company("Northco Metals Inc.", "northco metals inc");
  // The same entity id, imported in two periods: an interval each, which is
  // why the index over (scheme, value, valid_from) does not stop it existing.
  await db.run(`insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-02-28', 'extract')`, a);
  await db.run(`insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-05-31', 'extract')`, b);
  const found = await findDuplicateCandidates(db);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "shared_identifier");
  assert.equal(found[0].strength, 1);
  assert.match(found[0].detail, /E-4711/);
});

test("a name that differs only by its suffix is a hunch, and ranks as one", async () => {
  const { db, company } = await seeded();
  await company("Northco Mining Corporation", "northco mining corporation");
  await company("Northco Mining Corp.", "northco mining corp");
  const found = await findDuplicateCandidates(db);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "same_name_stem");
  assert.equal((await found[0]).strength, 3, "weaker than an identifier, and shown as weaker");
});

test("two companies with data in one period are two companies", async () => {
  const { db, period, company } = await seeded();
  const p1 = await period("P1", "2026-05-31");
  const a = await company("Northco Mining Corp.", "northco mining corp");
  const b = await company("Northco Metals Inc.", "northco metals inc");
  await fact(db, p1, a);
  await fact(db, p1, b);

  await assert.rejects(() => mergeCompanies(db, { winnerId: a, loserId: b }),
    (e) => e instanceof MergeRefused && /Both hold data in P1/.test(e.message));
  const loser = await db.get("select status from companies where id = ?", b) as { status: string };
  assert.equal((await loser).status, "active", "a refused merge changes nothing");
});

test("a rename across periods is merged, and the old name is kept", async () => {
  const { db, period, company } = await seeded();
  const p1 = await period("P1", "2026-02-28");
  const p2 = await period("P2", "2026-05-31");
  const oldCo = await company("Northco Mining Corp.", "northco mining corp");
  const newCo = await company("Aurora Metals Inc.", "aurora metals inc");
  await fact(db, p1, oldCo);
  await fact(db, p2, newCo);

  const { moved } = await mergeCompanies(db, { winnerId: newCo, loserId: oldCo, actorId: null });
  assert.ok(moved >= 1);

  const facts = await db.get("select count(*) n from company_period_facts where company_id = ?", newCo) as { n: number };
  assert.equal(facts.n, 2, "both periods now belong to one company");

  const alias = await db.get("select name, alias_type from company_aliases where company_id = ?", newCo) as
    { name: string; alias_type: string };
  assert.equal(alias.name, "Northco Mining Corp.");
  assert.equal(alias.alias_type, "former",
    "losing the old name would defeat the point of merging");

  const audit = await db.get("select count(*) n from audit_log where event = 'companies_merged'") as { n: number };
  assert.equal((await audit).n, 1);
});

test("a merge is a redirect, so a published revision still resolves", async () => {
  const { db, period, company } = await seeded();
  const p1 = await period("P1", "2026-02-28");
  const oldCo = await company("Northco Mining Corp.", "northco mining corp");
  const newCo = await company("Aurora Metals Inc.", "aurora metals inc");
  await db.run("insert into period_publications (period_id, revision) values (?, 1)", p1);
  const pub = await db.get("select id from period_publications") as { id: string };
  await db.run(`insert into published_period_values (publication_id, company_id, field_key, value, source)
     values (?, ?, 'auditor', '"KPMG"', 'extract')`, pub.id, oldCo);

  await mergeCompanies(db, { winnerId: newCo, loserId: oldCo });

  const frozen = await db.get("select company_id from published_period_values where publication_id = ?", pub.id) as
    { company_id: string };
  assert.equal(frozen.company_id, oldCo,
    "a published revision is not edited by anything, a merge included");
  const row = await db.get("select status, merged_into_id from companies where id = ?", oldCo) as
    { status: string; merged_into_id: string };
  assert.equal(row.status, "merged");
  assert.equal(row.merged_into_id, newCo);
  assert.equal(await resolveCompanyId(db, oldCo), newCo,
               "and an old link still lands on the company");
});

test("a company already merged away cannot be merged again", async () => {
  const { db, company } = await seeded();
  const a = await company("A Corp", "a corp");
  const b = await company("B Corp", "b corp");
  const c = await company("C Corp", "c corp");
  await mergeCompanies(db, { winnerId: a, loserId: b });
  await assert.rejects(() => mergeCompanies(db, { winnerId: c, loserId: b }),
    (e) => e instanceof MergeRefused && /already been merged/.test(e.message));
  await assert.rejects(() => mergePreview(db, a, a),
    (e) => e instanceof MergeRefused && /into itself/.test((e as Error).message));
});

test("both intervals of a shared identifier follow the company", async () => {
  const { db, period, company } = await seeded();
  const p1 = await period("P1", "2026-02-28");
  const p2 = await period("P2", "2026-05-31");
  const oldCo = await company("Northco Mining Corp.", "northco mining corp");
  const newCo = await company("Aurora Metals Inc.", "aurora metals inc");
  await fact(db, p1, oldCo);
  await fact(db, p2, newCo);
  await db.run(`insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-02-28', 'extract')`, oldCo);
  await db.run(`insert into company_identifiers (company_id, scheme, value, valid_from, source)
     values (?, 'sp_entity_id', 'E-4711', '2026-05-31', 'extract')`, newCo);

  await mergeCompanies(db, { winnerId: newCo, loserId: oldCo });
  const ids = await db.get("select count(*) n from company_identifiers where company_id = ?", newCo) as { n: number };
  assert.equal((await ids).n, 2, "an identifier is an interval, so both intervals belong to it now");
});

test("an alias both companies already carry is discarded, not moved twice", async () => {
  const { db, company } = await seeded();
  const a = await company("Aurora Metals Inc.", "aurora metals inc");
  const b = await company("Northco Mining Corp.", "northco mining corp");
  for (const id of [a, b]) {(await 
    await db).run(`insert into company_aliases (company_id, name, name_normalized, alias_type, source)
       values (?, 'Northco', 'northco', 'source_variant', 'extract')`, id);
  }
  const { discarded } = await mergeCompanies(db, { winnerId: a, loserId: b });
  assert.equal(discarded, 1, "the winner already records that name");
  const aliases = await db.get("select count(*) n from company_aliases where company_id = ?", a) as { n: number };
  assert.equal((await aliases).n, 2, "the shared variant, and the loser's own name as a former name");
});

test("the preview counts what will move and what will not", async () => {
  const { db, period, company } = await seeded();
  const p1 = await period("P1", "2026-02-28");
  const a = await company("A Corp", "a corp");
  const b = await company("B Corp", "b corp");
  await fact(db, p1, b, "company_name");
  await fact(db, p1, b, "auditor");

  const preview = await mergePreview(db, a, b);
  assert.deepEqual((await preview).moves, [{ table: "company_period_facts", rows: 2 }]);
  assert.deepEqual((await preview).overlappingPeriods, []);
  assert.equal((await preview).frozenRevisions, 0);
});


test("a merge takes the pursuit with it, and both survive when both had one", async () => {
  // pursuits was not in MOVES when the table was added, so the loser's pursuit
  // went on pointing at a company that no longer exists: it showed under the
  // old name, and startPursuit on the winner made a SECOND one because it
  // could not see the first.
  const { db, company } = await seeded();
  const oldCo = await company("Northco Mining Corp.", "northco mining corp");
  const newCo = await company("Northco Metals Inc.", "northco metals inc");
  const actor = await db.get(
    "insert into app_users (email, role) values ('a@example.invalid','analyst') returning id") as { id: string };

  const loserPursuit = await startPursuit(db, oldCo, actor.id);
  await setPriority(db, loserPursuit, "High", actor.id);
  await addNote(db, loserPursuit, "The partner already met them.", actor.id);
  await addAction(db, loserPursuit, { description: "Send the benchmark" }, actor.id);
  const winnerPursuit = await startPursuit(db, newCo, actor.id);
  await addNote(db, winnerPursuit, "Separate team, same company as it turns out.", actor.id);

  await mergeCompanies(db, { winnerId: newCo, loserId: oldCo, actorId: actor.id });

  const rows = await db.all("select id, company_id from pursuits") as
    Array<{ id: string; company_id: string }>;
  assert.equal(rows.length, 2, "neither pursuit was discarded to keep the merge tidy");
  assert.ok(rows.every((r) => r.company_id === newCo),
            "both now point at the surviving company");

  // And what each carried came with it.
  const kept = await getPursuit(db, loserPursuit);
  assert.equal(kept!.pursuit.priority, "High");
  assert.equal(kept!.notes.length, 1);
  assert.equal(kept!.actions.length, 1);
  assert.equal(kept!.pursuit.companyName, (await db.get(
    "select canonical_name from companies where id = ?", newCo) as { canonical_name: string }).canonical_name);

  // Starting one again returns the earliest rather than making a third.
  assert.equal(await startPursuit(db, newCo, actor.id), loserPursuit);
  assert.equal((await db.get("select count(*) n from pursuits") as { n: number }).n, 2);
});
