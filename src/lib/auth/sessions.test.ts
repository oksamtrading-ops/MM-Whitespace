import { test } from "node:test";
import assert from "node:assert/strict";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import {
  createSession, hashToken, IDLE_HOURS, liveSessionsForUser, purgeExpiredSessions,
  revokeAllForUser, revokeSession, SESSION_HOURS, userForSession,
} from "./sessions.ts";

async function seeded(): Promise<{ db: Sql; userId: string }> {
  const db = memorySql();
  const u = await db.get(
    "insert into app_users (email, role) values (?, ?) returning id",
    "analyst@example.invalid", "analyst") as { id: string };
  return { db, userId: u.id };
}

test("the database never holds a usable session token", async () => {
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  const rows = await db.all("select * from auth_sessions");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, hashToken(token));
  assert.ok(!JSON.stringify(rows).includes(token), "the token appears in the row");
});

test("a session resolves to its user", async () => {
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  const user = await userForSession(db, token);
  assert.equal(user?.email, "analyst@example.invalid");
  assert.equal(user?.role, "analyst");
  assert.equal(user?.id, userId);
});

test("no cookie, an unknown token and a junk token are all nobody", async () => {
  const { db } = await seeded();
  assert.equal(await userForSession(db, null), null);
  assert.equal(await userForSession(db, ""), null);
  assert.equal(await userForSession(db, "not-a-session"), null);
});

test("DEACTIVATION ENDS SESSIONS THAT ARE ALREADY RUNNING", async () => {
  // The access review screen promises offboarding. A deactivation that only
  // stops the next sign-in leaves the partner who rolled off reading the
  // roster until their session lapses on its own.
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  assert.ok(await userForSession(db, token));

  await db.run("update app_users set is_active = ? where id = ?", false, userId);
  assert.equal(await userForSession(db, token), null,
    "a deactivated account's live session must stop resolving");
});

test("revoking one session leaves the others alone", async () => {
  const { db, userId } = await seeded();
  const a = await createSession(db, userId);
  const b = await createSession(db, userId);
  assert.equal(await revokeSession(db, a.token), 1);
  assert.equal(await userForSession(db, a.token), null);
  assert.ok(await userForSession(db, b.token), "the other session survives");
  assert.equal(await revokeSession(db, a.token), 0, "revoking twice changes nothing");
});

test("revoking everything for a user ends every one of them", async () => {
  const { db, userId } = await seeded();
  const a = await createSession(db, userId);
  const b = await createSession(db, userId);
  assert.equal(await revokeAllForUser(db, userId, null), 2);
  assert.equal(await userForSession(db, a.token), null);
  assert.equal(await userForSession(db, b.token), null);
});

test("a session is bounded: past its expiry it is nobody, however active", async () => {
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  await db.run("update auth_sessions set expires_at = ?, last_seen_at = ?",
               formatStamp(Date.now() - 1000), formatStamp());
  assert.equal(await userForSession(db, token), null);
});

test("an idle session is revoked rather than merely ignored", async () => {
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  await db.run("update auth_sessions set last_seen_at = ?",
               formatStamp(Date.now() - (IDLE_HOURS + 1) * 3_600_000));
  assert.equal(await userForSession(db, token), null);
  const row = await db.get("select revoked_at, revoked_reason from auth_sessions") as
    { revoked_at: string | null; revoked_reason: string | null };
  assert.ok(row.revoked_at, "the row is closed, not left open to be tried again");
  assert.equal(row.revoked_reason, "idle");
});

test("using a session keeps it alive", async () => {
  const { db, userId } = await seeded();
  const { token } = await createSession(db, userId);
  const before = (await db.get("select last_seen_at from auth_sessions") as
    { last_seen_at: string }).last_seen_at;
  await new Promise((r) => setTimeout(r, 5));
  await userForSession(db, token);
  const after = (await db.get("select last_seen_at from auth_sessions") as
    { last_seen_at: string }).last_seen_at;
  assert.ok(after > before, `${after} should be later than ${before}`);
});

test("the expiry is a working day and cannot be extended by use", async () => {
  const { db, userId } = await seeded();
  const { expiresAt } = await createSession(db, userId);
  const hours = (Date.parse(expiresAt.replace(" ", "T") + "Z") - Date.now()) / 3_600_000;
  assert.ok(Math.abs(hours - SESSION_HOURS) < 0.1, `expires in ${hours}h`);
  const { token } = await createSession(db, userId);
  await userForSession(db, token);
  const after = (await db.get(
    "select expires_at from auth_sessions order by created_at desc limit 1") as
    { expires_at: string }).expires_at;
  const stillHours = (Date.parse(after.replace(" ", "T") + "Z") - Date.now()) / 3_600_000;
  assert.ok(Math.abs(stillHours - SESSION_HOURS) < 0.1, "use must not push the bound out");
});

test("the access review can see what is live for an account", async () => {
  const { db, userId } = await seeded();
  await createSession(db, userId, { ip: "203.0.113.7" });
  const b = await createSession(db, userId);
  assert.equal((await liveSessionsForUser(db, userId)).length, 2);
  await revokeSession(db, b.token);
  const live = await liveSessionsForUser(db, userId);
  assert.equal(live.length, 1);
  assert.equal(live[0].createdIp, "203.0.113.7");
});

test("purge removes expired sessions and keeps live ones", async () => {
  const { db, userId } = await seeded();
  await createSession(db, userId);
  const old = await createSession(db, userId);
  await db.run("update auth_sessions set expires_at = ? where token_hash = ?",
               formatStamp(Date.now() - 60 * 86_400_000), hashToken(old.token));
  assert.equal(await purgeExpiredSessions(db, 30), 1);
  assert.equal((await db.all("select id from auth_sessions")).length, 1);
});
