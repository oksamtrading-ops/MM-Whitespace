import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import {
  addAction, addNote, getPursuit, listPursuits, PursuitRefused, setActionStatus,
  setOwner, setPriority, startPursuit, vocabulary,
} from "./index.ts";
import { validate, InvalidSetting, putSettings } from "../settings/index.ts";
import { publicRow } from "../enrich/worker.ts";
import { buildPrompt, egressScan, EgressViolation, restrictionsFromCatalog } from "../enrich/prompt.ts";

async function seeded() {
  const db = memorySql();
  await db.run("insert into companies (canonical_name, name_normalized) values ('Northco Mining Corp.','northco')");
  await db.run("insert into companies (canonical_name, name_normalized) values ('Southco Resources Ltd.','southco')");
  const [a, b] = await db.all("select id from companies order by canonical_name") as Array<{ id: string }>;
  const user = await db.get(
    "insert into app_users (email, role) values ('analyst@example.invalid','analyst') returning id") as { id: string };
  return { db, northco: a.id, southco: b.id, actor: user.id };
}

test("the vocabularies come from settings, and migration 0020 seeds them", async () => {
  const { db } = await seeded();
  const v = await vocabulary(db);
  assert.deepEqual(v.priorities, ["High", "Medium", "Low"]);
  assert.deepEqual(v.statuses, ["Open", "Done"]);
});

test("a changed vocabulary changes the screen, with no deployment", async () => {
  const { db, actor } = await seeded();
  await putSettings(db, { pursuit_action_statuses: "To do, Doing, Done" }, actor);
  assert.deepEqual((await vocabulary(db)).statuses, ["To do", "Doing", "Done"]);
});

test("a vocabulary that is not a choice is refused", async () => {
  assert.throws(() => validate("pursuit_priorities", "Only"), InvalidSetting);
  assert.throws(() => validate("pursuit_priorities", "High, high"), /same term/);
  assert.throws(() => validate("pursuit_action_statuses", "a,b,c,d,e,f,g,h,i"), /eight/);
  assert.equal(validate("pursuit_priorities", " High ,Medium,  Low "), "High, Medium, Low");
});

test("starting a pursuit twice for one company returns the same pursuit", async () => {
  // Two live pursuits for one company is a reporting bug, not a workflow.
  const { db, northco, actor } = await seeded();
  const first = await startPursuit(db, northco, actor);
  const second = await startPursuit(db, northco, actor);
  assert.equal(first, second);
  assert.equal((await listPursuits(db)).length, 1);
});

test("a pursuit for a company that does not exist is refused", async () => {
  const { db, actor } = await seeded();
  await assert.rejects(() => startPursuit(db, "no-such-company", actor), PursuitRefused);
});

test("a priority off the list is refused, because the list is the point of having one", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await assert.rejects(() => setPriority(db, id, "Urgent", actor), /not one of the priorities/);
  await setPriority(db, id, "High", actor);
  assert.equal((await listPursuits(db))[0].priority, "High");
});

test("a priority retired from the vocabulary is SHOWN, never rewritten", async () => {
  // Rewriting somebody's judgement to fit a new list is not a settings change.
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await setPriority(db, id, "Medium", actor);
  await putSettings(db, { pursuit_priorities: "High, Low" }, actor);

  const [row] = await listPursuits(db);
  assert.equal(row.priority, "Medium", "the judgement stands");
  assert.equal(row.priorityRetired, true, "and the screen can say it is no longer offered");
  assert.equal((await getPursuit(db, id))!.pursuit.priorityRetired, true);
});

test("the list ranks by the vocabulary's own order, not alphabetically", async () => {
  // "High" below "Low" is what sorting by name gives, and it is exactly wrong.
  const { db, northco, southco, actor } = await seeded();
  const a = await startPursuit(db, northco, actor);
  const b = await startPursuit(db, southco, actor);
  await setPriority(db, a, "Low", actor);
  await setPriority(db, b, "High", actor);
  assert.deepEqual((await listPursuits(db)).map((p) => p.priority), ["High", "Low"]);
});

test("an unprioritised pursuit sorts LAST, not first", async () => {
  // It is the one nobody has judged; it must not sit above one called urgent.
  const { db, northco, southco, actor } = await seeded();
  const judged = await startPursuit(db, northco, actor);
  await startPursuit(db, southco, actor);
  await setPriority(db, judged, "Low", actor);
  assert.deepEqual((await listPursuits(db)).map((p) => p.priority), ["Low", null]);
});

test("notes and actions are counted, and the newest activity is what ranks a pursuit", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addNote(db, id, "Partner met the CFO in March.", actor);
  await addAction(db, id, { description: "Send the fee benchmark" }, actor);
  const [row] = await listPursuits(db);
  assert.equal(row.notes, 1);
  assert.equal(row.totalActions, 1);
  assert.equal(row.openActions, 1, "a new action starts in the first status");
  assert.ok(row.lastActivityAt >= row.createdAt, "activity is never older than the pursuit");
});

test("an action reaching the last status stops counting as open", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "Send the fee benchmark" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  assert.equal(action.status, "Open");

  await setActionStatus(db, action.id, "Done", actor);
  assert.equal((await listPursuits(db))[0].openActions, 0);
  assert.equal((await listPursuits(db))[0].totalActions, 1, "and it is still on the record");
});

test("what a person typed is accepted; what is meaningless is refused", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await assert.rejects(() => addNote(db, id, "   ", actor), /needs something in it/);
  await assert.rejects(() => addNote(db, id, "x".repeat(4001), actor), /belongs in a document/);
  await assert.rejects(() => addAction(db, id, { description: "" }, actor), /needs a description/);
  await assert.rejects(() => addAction(db, id, { description: "ok", dueDate: "next Tuesday" }, actor),
                       /YYYY-MM-DD/);
  await addAction(db, id, { description: "ok", dueDate: "2026-10-01" }, actor);
  assert.equal((await getPursuit(db, id))!.actions[0].dueDate, "2026-10-01");
});

test("an owner who cannot sign in is not an owner", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  const gone = await db.get(
    "insert into app_users (email, role, is_active) values ('gone@example.invalid','analyst',false) returning id") as { id: string };
  await assert.rejects(() => setOwner(db, id, gone.id, actor), /not an active user/);
  await setOwner(db, id, actor, actor);
  assert.equal((await listPursuits(db))[0].ownerEmail, "analyst@example.invalid");
  await setOwner(db, id, null, actor);
  assert.equal((await listPursuits(db))[0].ownerEmail, null, "unassigning is allowed");
});

test("writing to a pursuit that does not exist is refused, not silently dropped", async () => {
  const { db, actor } = await seeded();
  await assert.rejects(() => addNote(db, "nope", "text", actor), /no such pursuit/);
  await assert.rejects(() => addAction(db, "nope", { description: "x" }, actor), /no such pursuit/);
  await assert.rejects(() => setPriority(db, "nope", "High", actor), /no such pursuit/);
  await assert.rejects(() => setActionStatus(db, "nope", "Done", actor), /no such action/);
});

test("every write leaves an audit line naming who did it", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await setPriority(db, id, "High", actor);
  await setOwner(db, id, actor, actor);
  await addAction(db, id, { description: "Send it" }, actor);
  await setActionStatus(db, (await getPursuit(db, id))!.actions[0].id, "Done", actor);

  const events = (await db.all(
    "select event, actor_id from audit_log where event like 'pursuit%'") as
    Array<{ event: string; actor_id: string }>);
  // Sorted, not in insertion order: audit_log's id is a uuid and its created_at
  // is the transaction's start time on Postgres, so the table cannot order
  // itself. What matters here is that each write left exactly one line.
  assert.deepEqual(events.map((e) => e.event).sort(),
    ["pursuit_action_moved", "pursuit_owner_set", "pursuit_prioritised", "pursuit_started"]);
  assert.ok(events.every((e) => e.actor_id === actor), "each names the person");
});

test("a pursuit that does not exist reads as null, not as an empty pursuit", async () => {
  const { db } = await seeded();
  assert.equal(await getPursuit(db, "nope"), null);
});

/* ------------------------------------- the boundary that matters most */

test("NOTHING a pursuit holds can reach a prompt", async () => {
  // docs/design/06: "Never passed into a prompt, mechanically: the Deloitte
  // tax-client flag, the Deloitte market, comments, and every pursuit field."
  // A pursuit is the firm's own intentions. A model reading them would be
  // reading Deloitte's strategy back to itself, and it would leave the estate
  // to do it. The guarantee is structural -- the pipeline reads
  // company_period_field_values and never these tables -- and this is what
  // keeps it structural.
  const { db, northco, actor } = await seeded();
  await db.run(`insert into company_identifiers (company_id, scheme, value, exchange, valid_from, source)
                values (?, 'root_ticker', 'NRTH', 'TSX', '2026-05-31', 'extract')`, northco);

  const SECRET = "zzq-pursuit-canary-do-not-send";
  const id = await startPursuit(db, northco, actor);
  await setPriority(db, id, "High", actor);
  await addNote(db, id, `Partner strategy: ${SECRET}`, actor);
  await addAction(db, id, { description: `Approach via ${SECRET}` }, actor);

  const row = await publicRow(db, northco, "2026-05-31");
  const prompt = buildPrompt("discovery", row);
  const serialised = JSON.stringify({ row, prompt });
  assert.ok(!serialised.includes(SECRET),
    "a pursuit's own words reached the prompt builder");
  assert.ok(!/priority|pursuit/i.test(JSON.stringify(row)),
    `the row carries a pursuit concept: ${JSON.stringify(row)}`);
});

test("and if one ever did, the egress scan is the second line", async () => {
  // Defence in depth: the field catalogue drives the restricted-term list, so
  // a pursuit field added to it is refused at the door rather than relied on
  // to be absent. This proves the mechanism, not the absence.
  const restrictions = restrictionsFromCatalog([
    { key: "pursuit_priority", label: "Pursuit priority", classification: "deloitte_internal" },
  ]);
  assert.throws(
    () => egressScan({ content: "the Pursuit priority is High" }, restrictions),
    EgressViolation);
});
