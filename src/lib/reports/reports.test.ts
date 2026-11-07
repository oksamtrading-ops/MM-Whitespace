import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import type { Role } from "../auth/session.ts";
import {
  canEdit, canonicalParams, canSee, checkReportName, createReport, deleteReport, getReport, isReportId,
  listReports, REPORT_NAME_MAX, REPORT_PARAMS_MAX, updateReport, type Actor,
} from "./reports.ts";

async function person(db: Sql, email: string, role: Role, first: string, last: string): Promise<Actor> {
  const u = await db.get(
    "insert into app_users (email, role, first_name, last_name) values (?, ?, ?, ?) returning id",
    email, role, first, last) as { id: string };
  return { id: String(u.id), role };
}

async function cast() {
  const db = memorySql();
  return {
    db,
    viewer: await person(db, "viewer@example.invalid", "viewer", "Vera", "Viewer"),
    other: await person(db, "other@example.invalid", "viewer", "Oscar", "Other"),
    analyst: await person(db, "analyst@example.invalid", "analyst", "Ann", "Analyst"),
    admin: await person(db, "admin@example.invalid", "admin", "Ada", "Admin"),
  };
}

async function made(db: Sql, u: Actor, name: string, visibility: string, params = "tier=2"): Promise<string> {
  const got = await createReport(db, u, { name, visibility, params });
  assert.ok(got.ok, got.ok ? "" : got.message);
  return got.id;
}

async function events(db: Sql, event: string) {
  return (await db.all("select actor_id, detail from audit_log where event = ? order by created_at, rowid", event) as
    Array<{ actor_id: string; detail: string }>).map((r) => ({ actor: String(r.actor_id), ...JSON.parse(r.detail) }));
}

test("a Viewer saves a report; it stores the table's own spelling of the filter, and the save is audited", async () => {
  const { db, viewer } = await cast();
  const got = await createReport(db, viewer, {
    name: "  Gold   producers ", visibility: "private",
    params: "?tier=3&tier=2&bogus=1&audit_min=250000&hide=ticker&sort=marketCap&dir=desc",
  });
  assert.ok(got.ok);
  assert.ok(isReportId(got.id));
  const r = await getReport(db, viewer, got.id);
  assert.equal(r?.name, "Gold producers", "spaces folded");
  assert.equal(r?.params, "tier=3&tier=2&audit_min=250000&hide=ticker",
               "unknown keys dropped, default sort omitted: what toRosterParams writes");
  assert.equal(r?.ownerName, "Vera Viewer");
  const [created] = await events(db, "report_created");
  assert.equal(created.actor, viewer.id);
  assert.equal(created.report, got.id);
  assert.equal(created.visibility, "private");
});

test("a name and a visibility are required, and a filter nobody built is refused", async () => {
  const { db, viewer } = await cast();
  for (const name of ["", "   ", "x".repeat(REPORT_NAME_MAX + 1), "bad\u0007bell", "evil\u202Etxt.exe", 42]) {
    const got = await createReport(db, viewer, { name, visibility: "private", params: "" });
    assert.equal(got.ok, false, `accepted ${JSON.stringify(name)}`);
  }
  assert.equal((await createReport(db, viewer, { name: "A", visibility: "everyone", params: "" })).ok, false);
  assert.equal((await createReport(db, viewer, { name: "A", visibility: "public", params: "q=" + "x".repeat(REPORT_PARAMS_MAX) })).ok, false);
  assert.equal((await createReport(db, viewer, { name: "A", visibility: "public", params: null })).ok, true,
               "no filter at all is every company");
  assert.equal(checkReportName("x".repeat(REPORT_NAME_MAX)).ok, true);
});

test("private is its owner's alone -- an Admin included -- and public is everybody's", async () => {
  const { db, viewer, other, analyst, admin } = await cast();
  const mine = await made(db, viewer, "Mine only", "private");
  const shared = await made(db, viewer, "For everyone", "public");

  for (const u of [other, analyst, admin]) {
    assert.equal(await getReport(db, u, mine), null, `${u.role} saw a private report`);
    assert.equal((await getReport(db, u, shared))?.name, "For everyone");
    assert.deepEqual((await listReports(db, u)).map((r) => r.name), ["For everyone"]);
  }
  assert.deepEqual((await listReports(db, viewer)).map((r) => r.name), ["For everyone", "Mine only"],
                   "the owner sees both, by name");
});

test("a list puts your own first, then everybody else's public ones", async () => {
  const { db, viewer, other } = await cast();
  await made(db, other, "Alpha (theirs)", "public");
  await made(db, viewer, "Zulu (mine)", "private");
  await made(db, other, "Hidden (theirs)", "private");
  assert.deepEqual((await listReports(db, viewer)).map((r) => r.name), ["Zulu (mine)", "Alpha (theirs)"]);
});

test("the owner renames it, changes who sees it, and updates its filters; each change is audited", async () => {
  const { db, viewer, other } = await cast();
  const id = await made(db, viewer, "Draft name", "private", "tier=2");

  assert.deepEqual(await updateReport(db, viewer, id, { name: "Final name" }), { ok: true });
  assert.deepEqual(await updateReport(db, viewer, id, { params: "tier=4&tax_has=value" }), { ok: true });
  assert.deepEqual(await updateReport(db, viewer, id, { visibility: "public" }), { ok: true });

  const r = await getReport(db, other, id);
  assert.equal(r?.name, "Final name");
  assert.equal(r?.params, "tier=4&tax_has=value");
  assert.equal(r?.visibility, "public", "and now somebody else can see it");

  const updates = await events(db, "report_updated");
  assert.deepEqual(updates.map((u) => u.changed), [["name"], ["params"], ["visibility"]]);
  assert.deepEqual(updates[0].from, { name: "Draft name" });
  assert.deepEqual(updates[0].to, { name: "Final name" });
  assert.equal(updates.every((u) => u.actor === viewer.id), true);

  assert.deepEqual(await updateReport(db, viewer, id, { name: "Final name" }), { ok: true });
  assert.equal((await events(db, "report_updated")).length, 3, "a change to nothing writes nothing");
  assert.equal((await updateReport(db, viewer, id, { name: "" })).ok, false);
  assert.equal((await updateReport(db, viewer, id, { visibility: "team" })).ok, false);
});

test("somebody else may open a public report but not rename, update or delete it", async () => {
  const { db, viewer, other, analyst } = await cast();
  const id = await made(db, viewer, "Viewer's public", "public", "tier=2");
  for (const u of [other, analyst]) {
    const rename = await updateReport(db, u, id, { name: "Hijacked" });
    assert.equal(rename.ok, false);
    assert.match(rename.ok ? "" : rename.message, /Only the person who saved this report, or an Admin/);
    assert.equal((await updateReport(db, u, id, { params: "tier=6" })).ok, false);
    assert.equal((await updateReport(db, u, id, { visibility: "private" })).ok, false);
    assert.equal((await deleteReport(db, u, id)).ok, false);
  }
  const r = await getReport(db, viewer, id);
  assert.equal(r?.name, "Viewer's public");
  assert.equal(r?.params, "tier=2");
  assert.equal((await events(db, "report_updated")).length + (await events(db, "report_deleted")).length, 0);
});

test("an Admin may rename, update and delete anybody's public report, and never a private one", async () => {
  const { db, viewer, admin } = await cast();
  const pub = await made(db, viewer, "Public one", "public");
  const priv = await made(db, viewer, "Private one", "private");

  assert.deepEqual(await updateReport(db, admin, pub, { name: "Renamed by Admin", params: "tier=1" }), { ok: true });
  const r = await getReport(db, viewer, pub);
  assert.equal(r?.name, "Renamed by Admin");
  assert.equal(r?.ownerId, viewer.id, "it stays the owner's report");
  const [update] = await events(db, "report_updated");
  assert.equal(update.actor, admin.id);
  assert.equal(update.owner, viewer.id);

  const refused = await updateReport(db, admin, priv, { name: "Peeked" });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.message, /No such report/, "the same answer as a report that does not exist");
  assert.equal((await deleteReport(db, admin, priv)).ok, false);

  assert.deepEqual(await deleteReport(db, admin, pub), { ok: true });
  assert.equal(await getReport(db, viewer, pub), null);
  const [deleted] = await events(db, "report_deleted");
  assert.equal(deleted.actor, admin.id);
  assert.equal(deleted.name, "Renamed by Admin", "the log keeps what was deleted");
  assert.equal(deleted.params, "tier=1");
});

test("the owner deletes their own report", async () => {
  const { db, viewer } = await cast();
  const id = await made(db, viewer, "Short-lived", "private");
  assert.deepEqual(await deleteReport(db, viewer, id), { ok: true });
  assert.equal(await getReport(db, viewer, id), null);
  assert.equal((await deleteReport(db, viewer, id)).ok, false, "twice is not found");
});

test("an id that is not a report id never reaches a query", async () => {
  const { db, viewer } = await cast();
  for (const id of ["", "1", "../etc", "' or 1=1 --", null, 7, "f".repeat(32)]) {
    assert.equal(await getReport(db, viewer, id), null);
    assert.equal((await updateReport(db, viewer, id, { name: "x" })).ok, false);
    assert.equal((await deleteReport(db, viewer, id)).ok, false);
  }
});

test("the rules, on their own", () => {
  const owner = { id: "o", role: "viewer" as const };
  const admin = { id: "a", role: "admin" as const };
  const analyst = { id: "n", role: "analyst" as const };
  const priv = { ownerId: "o", visibility: "private" as const };
  const pub = { ownerId: "o", visibility: "public" as const };
  assert.deepEqual([canSee(priv, owner), canSee(priv, admin), canSee(priv, analyst)], [true, false, false]);
  assert.deepEqual([canSee(pub, owner), canSee(pub, admin), canSee(pub, analyst)], [true, true, true]);
  assert.deepEqual([canEdit(priv, owner), canEdit(priv, admin), canEdit(priv, analyst)], [true, false, false]);
  assert.deepEqual([canEdit(pub, owner), canEdit(pub, admin), canEdit(pub, analyst)], [true, true, false]);
  assert.equal(canonicalParams("?hide=ticker&hide=marketCap"), "hide=marketCap&hide=ticker", "in the table's order");
  assert.equal(canonicalParams(5), null);
});

test("a change that lost its permission between the read and the write is refused, not applied", async () => {
  const { db, viewer, admin } = await cast();
  const id = await made(db, viewer, "Racing", "public");
  // The owner makes it private after the Admin's request read it as public.
  await db.run("update saved_reports set visibility = 'private' where id = ?", id);
  const stale = await updateReport(db, admin, id, { name: "Admin rename" });
  assert.equal(stale.ok, false, "the Admin can no longer see it, so cannot write it");
  const r = await getReport(db, viewer, id);
  assert.equal(r?.visibility, "private", "and it stays private");
  assert.equal(r?.name, "Racing");
});

test("an update writes only what it changes, so two changes to one report both land", async () => {
  const { db, viewer, admin } = await cast();
  const id = await made(db, viewer, "Two hands", "public", "tier=2");
  assert.deepEqual(await updateReport(db, admin, id, { name: "Renamed" }), { ok: true });
  assert.deepEqual(await updateReport(db, viewer, id, { params: "tier=3" }), { ok: true });
  const r = await getReport(db, viewer, id);
  assert.deepEqual([r?.name, r?.params, r?.visibility], ["Renamed", "tier=3", "public"]);
});

test("malformed input is a refusal, not a crash", async () => {
  const { db, viewer } = await cast();
  const id = await made(db, viewer, "Sturdy", "private");
  assert.equal((await createReport(db, viewer, null)).ok, false);
  assert.deepEqual(await updateReport(db, viewer, id, null), { ok: true }, "nothing to change");
});
