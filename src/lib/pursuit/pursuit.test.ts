import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import {
  addAction, addNote, closedStatuses, getPursuit, listPursuits, parseStatuses,
  parseDueDate, PursuitRefused, setActionDueDate, setActionOwner, setActionStatus, setOwner,
  setPriority, startPursuit, statusNames,
  strandedTerms, sweepTerm, vocabulary,
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
  assert.deepEqual(v.statuses, [{ name: "Open", closed: false }, { name: "Done", closed: true }]);
});

test("a changed vocabulary changes the screen, with no deployment", async () => {
  const { db, actor } = await seeded();
  await putSettings(db, { pursuit_action_statuses: "To do, Doing, Done*" }, actor);
  assert.deepEqual(statusNames(await vocabulary(db)), ["To do", "Doing", "Done"]);
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


/* --------------------------------- finished is not the same as abandoned */

test("a star marks a status that CLOSES an action, and more than one may", async () => {
  // "Closed" used to be position -- the last status in the list -- so exactly
  // one status could end an action. Finished and abandoned shared a word, and a
  // count of completed work silently included the work nobody did.
  const { db, northco, actor } = await seeded();
  await putSettings(db, { pursuit_action_statuses: "Open, Done*, Superseded*" }, actor);
  const v = await vocabulary(db);
  assert.deepEqual(statusNames(v), ["Open", "Done", "Superseded"]);
  assert.deepEqual(closedStatuses(v), ["Done", "Superseded"]);

  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "finished this one" }, actor);
  await addAction(db, id, { description: "gave up on this one" }, actor);
  const [done, dropped] = (await getPursuit(db, id))!.actions;
  assert.equal(done.status, "Open", "a new action starts in the first status, which never closes");

  await setActionStatus(db, done.id, "Done", actor);
  assert.equal((await listPursuits(db))[0].openActions, 1);
  await setActionStatus(db, dropped.id, "Superseded", actor);
  assert.equal((await listPursuits(db))[0].openActions, 0,
               "abandoned stops counting as open, without claiming to be done");

  // And the two are still distinguishable on the record, which is the point.
  const after = (await getPursuit(db, id))!.actions.map((a) => a.status);
  assert.deepEqual(after, ["Done", "Superseded"]);
});

test("a status list that closes nothing, or everything, is refused", async () => {
  assert.throws(() => validate("pursuit_action_statuses", "Open, Doing"),
                /no action can ever be closed/);
  assert.throws(() => validate("pursuit_action_statuses", "Open*, Done*"),
                /closed the moment it is made/);
  assert.throws(() => validate("pursuit_action_statuses", "Open*, Done"),
                /first status is where a new action starts/);
  assert.equal(validate("pursuit_action_statuses", " Open , Done* "), "Open, Done*");
  // A star closes an action. A priority closes nothing.
  assert.throws(() => validate("pursuit_priorities", "High*, Low"), /does not close anything/);
});

test("a value written before the star existed still closes on its last term", async () => {
  // Otherwise every action in the database becomes open again the day this
  // ships, which is a migration that silently reopens finished work.
  assert.deepEqual(parseStatuses(["Open", "Done"]),
                   [{ name: "Open", closed: false }, { name: "Done", closed: true }]);
});

test("a status the vocabulary no longer knows counts as OPEN", async () => {
  // The safe direction: work stays visible rather than vanishing from the list
  // because somebody renamed a term.
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "x" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  await setActionStatus(db, action.id, "Done", actor);
  assert.equal((await listPursuits(db))[0].openActions, 0);

  await putSettings(db, { pursuit_action_statuses: "Open, Finished*" }, actor);
  assert.equal((await listPursuits(db))[0].openActions, 1,
               "“Done” no longer closes anything, so the action is open again and visible");
  assert.equal((await getPursuit(db, id))!.actions[0].statusRetired, true);
});


/* ------------------------------------------- moving what a rename left behind */

async function withStranded() {
  const { db, northco, southco, actor } = await seeded();
  await putSettings(db, { pursuit_action_statuses: "Open, Done*, Superseded*" }, actor);
  const a = await startPursuit(db, northco, actor);
  const b = await startPursuit(db, southco, actor);
  for (const [p, n] of [[a, 2], [b, 1]] as const) {
    for (let i = 0; i < n; i++) {
      await addAction(db, p, { description: `gave up ${i}` }, actor);
    }
  }
  for (const p of [a, b]) {
    for (const action of (await getPursuit(db, p))!.actions) {
      await setActionStatus(db, action.id, "Superseded", actor);
    }
  }
  // The rename. It does not rewrite anybody's record, which is the point.
  await putSettings(db, { pursuit_action_statuses: "Open, Done*, Dropped*" }, actor);
  return { db, actor, a, b };
}

test("a renamed status strands its actions, and they are counted where they can be seen", async () => {
  const { db } = await withStranded();
  assert.deepEqual(await strandedTerms(db), [{ kind: "status", value: "Superseded", count: 3 }]);
  // Sorted: the list ranks by last activity, which is not what this is about.
  assert.deepEqual((await listPursuits(db)).map((p) => p.openActions).sort(), [1, 2],
                   "stranded actions count as open, because nothing says they close");
});

test("one sweep moves every stranded action, across every pursuit", async () => {
  const { db, actor } = await withStranded();
  assert.equal(await sweepTerm(db, "status", "Superseded", "Dropped", actor), 3);
  assert.deepEqual(await strandedTerms(db), [], "nothing is left behind");
  assert.deepEqual((await listPursuits(db)).map((p) => p.openActions), [0, 0]);
  const statuses = (await getPursuit(db, (await listPursuits(db))[0].id))!
    .actions.map((x) => x.status);
  assert.ok(statuses.every((x) => x === "Dropped"));
});

test("a sweep leaves ONE audit line, with its count", async () => {
  // A bulk change nobody can see afterwards is why bulk changes are frightening.
  const { db, actor } = await withStranded();
  await sweepTerm(db, "status", "Superseded", "Dropped", actor);
  const rows = await db.all(
    "select detail from audit_log where event = 'pursuit_terms_swept'") as Array<{ detail: string }>;
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].detail),
                   { kind: "status", from: "Superseded", to: "Dropped", count: 3 });
});

test("a sweep will not strand them again, and will not move nothing", async () => {
  const { db, actor } = await withStranded();
  await assert.rejects(() => sweepTerm(db, "status", "Superseded", "Abandoned", actor),
                       /not one of the statuses in use/);
  await assert.rejects(() => sweepTerm(db, "status", "Nowhere", "Dropped", actor),
                       /No action carries "Nowhere"/);
  await assert.rejects(() => sweepTerm(db, "status", "Dropped", "Dropped", actor),
                       /already carry/);
  assert.deepEqual(await strandedTerms(db), [{ kind: "status", value: "Superseded", count: 3 }],
                   "a refused sweep changes nothing");
});

test("a status still in use is never called stranded", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "live one" }, actor);
  assert.deepEqual(await strandedTerms(db), []);
});


test("a renamed PRIORITY strands its pursuits, and one sweep moves them too", async () => {
  // The same problem and so the same mechanism. A stranded priority does not
  // corrupt a count the way a stranded status does -- it sorts last, among the
  // pursuits nobody has judged -- but it is just as permanent without this.
  const { db, northco, southco, actor } = await seeded();
  const a = await startPursuit(db, northco, actor);
  const b = await startPursuit(db, southco, actor);
  await setPriority(db, a, "Medium", actor);
  await setPriority(db, b, "Medium", actor);
  await putSettings(db, { pursuit_priorities: "Urgent, Normal" }, actor);

  assert.deepEqual(await strandedTerms(db), [{ kind: "priority", value: "Medium", count: 2 }]);
  assert.ok((await listPursuits(db)).every((p) => p.priorityRetired), "and each says so");

  assert.equal(await sweepTerm(db, "priority", "Medium", "Normal", actor), 2);
  assert.deepEqual(await strandedTerms(db), []);
  const after = await listPursuits(db);
  assert.ok(after.every((p) => p.priority === "Normal" && !p.priorityRetired));
});

test("a sweep cannot put a priority into a status, or the other way round", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await setPriority(db, id, "High", actor);
  await putSettings(db, { pursuit_priorities: "Urgent, Normal" }, actor);
  // "Done" is a status. It is not somewhere a pursuit's priority can land.
  await assert.rejects(() => sweepTerm(db, "priority", "High", "Done", actor),
                       /not one of the priorities in use/);
  await assert.rejects(() => sweepTerm(db, "status", "High", "Normal", actor),
                       /not one of the statuses in use/);
});

test("both kinds strand at once, and each is listed with its own noun", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await setPriority(db, id, "Low", actor);
  await addAction(db, id, { description: "x" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  await setActionStatus(db, action.id, "Done", actor);

  await putSettings(db, { pursuit_priorities: "Urgent, Normal",
                          pursuit_action_statuses: "Open, Closed*" }, actor);
  assert.deepEqual(await strandedTerms(db), [
    { kind: "status", value: "Done", count: 1 },
    { kind: "priority", value: "Low", count: 1 },
  ]);
});


test("an action can be handed to somebody after it was made", async () => {
  // It could only be given an owner at creation, so the only way to hand one
  // over was to make a second action and close the first -- which would have
  // read, permanently, as though the work had been abandoned.
  const { db, northco, actor } = await seeded();
  const other = await db.get(
    "insert into app_users (email, role) values ('kay@example.invalid','analyst') returning id") as { id: string };
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "Confirm the currency" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  assert.equal(action.ownerEmail, null, "it starts unassigned");

  await setActionOwner(db, action.id, other.id, actor);
  assert.equal((await getPursuit(db, id))!.actions[0].ownerEmail, "kay@example.invalid");

  // Taking it back is allowed, and is not the same as closing it.
  await setActionOwner(db, action.id, null, actor);
  assert.equal((await getPursuit(db, id))!.actions[0].ownerEmail, null);
  assert.equal((await listPursuits(db))[0].openActions, 1, "and it is still open");
});

test("an action cannot be handed to somebody who cannot sign in", async () => {
  const { db, northco, actor } = await seeded();
  const gone = await db.get(
    "insert into app_users (email, role, is_active) values ('gone2@example.invalid','analyst',false) returning id") as { id: string };
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "x" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  await assert.rejects(() => setActionOwner(db, action.id, gone.id, actor), /not an active user/);
  await assert.rejects(() => setActionOwner(db, "nope", actor, actor), /no such action/);
  assert.equal((await getPursuit(db, id))!.actions[0].ownerEmail, null, "a refusal changes nothing");
});

test("assigning an action names who did it, and who it went to", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "x" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  await setActionOwner(db, action.id, actor, actor);
  const [row] = await db.all(
    "select actor_id, detail from audit_log where event = 'pursuit_action_assigned'") as
    Array<{ actor_id: string; detail: string }>;
  assert.equal(row.actor_id, actor);
  assert.deepEqual(JSON.parse(row.detail), { actionId: action.id, ownerId: actor });
});


test("a due date can be put on an action after it is made, and taken off", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "Confirm the currency" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  assert.equal(action.dueDate, null);

  await setActionDueDate(db, action.id, "2026-10-31", actor);
  assert.equal((await getPursuit(db, id))!.actions[0].dueDate, "2026-10-31");
  await setActionDueDate(db, action.id, null, actor);
  assert.equal((await getPursuit(db, id))!.actions[0].dueDate, null,
               "a date nobody chose is not a date");
});

test("a date that does not exist is refused, not stored", async () => {
  // The shape rule alone accepts 2026-02-31 and 2026-13-01, and SQLite stores
  // whatever it is given.
  assert.equal(parseDueDate("2026-10-31"), "2026-10-31");
  assert.equal(parseDueDate("  "), null);
  assert.throws(() => parseDueDate("31/10/2026"), /YYYY-MM-DD/);
  assert.throws(() => parseDueDate("2026-02-31"), /no such date as 2026-02-31/);
  assert.throws(() => parseDueDate("2026-13-01"), /no such date as 2026-13-01/);

  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await assert.rejects(() => addAction(db, id, { description: "x", dueDate: "2026-02-31" }, actor),
                       /no such date/);
  assert.deepEqual((await getPursuit(db, id))!.actions, [], "and nothing was written");
});

test("dating an action names who did it", async () => {
  const { db, northco, actor } = await seeded();
  const id = await startPursuit(db, northco, actor);
  await addAction(db, id, { description: "x" }, actor);
  const action = (await getPursuit(db, id))!.actions[0];
  await setActionDueDate(db, action.id, "2026-10-31", actor);
  const [row] = await db.all(
    "select actor_id, detail from audit_log where event = 'pursuit_action_dated'") as
    Array<{ actor_id: string; detail: string }>;
  assert.equal(row.actor_id, actor);
  assert.deepEqual(JSON.parse(row.detail), { actionId: action.id, dueDate: "2026-10-31" });
  await assert.rejects(() => setActionDueDate(db, "nope", "2026-10-31", actor), /no such action/);
});
