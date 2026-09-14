import { test } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import * as password from "./password.ts";
import { hashPassword } from "./password.ts";
import {
  attemptSignIn, changePassword, ChangeRefused, clearFailures, generatePassword,
  MIN_REFUSAL_MS, purgeSignInFailures, setTemporaryPassword, THROTTLE_PER_EMAIL,
} from "./signin.ts";
import { createSession, userForSession } from "./sessions.ts";

const GOOD = "a perfectly ordinary password";

// The floor costs a quarter second per refusal and this suite exercises every
// refusal there is. Off by default, and switched back on by the one test whose
// subject it is -- see minRefusalMs.
process.env.MM_SIGNIN_MIN_MS = "0";

async function seeded() {
  const db = memorySql();
  await db.run("insert into app_settings (key, value) values ('allowed_email_domains', ?)",
               "example.invalid");
  const ins = "insert into app_users (email, role) values (?, ?) returning id";
  const analyst = await db.get(ins, "analyst@example.invalid", "analyst") as { id: string };
  const gone = await db.get(ins, "gone@example.invalid", "analyst") as { id: string };
  const never = await db.get(ins, "never@example.invalid", "viewer") as { id: string };
  await db.run("update app_users set is_active = false where id = ?", gone.id);
  await db.run("insert into auth_passwords (user_id, hash, set_at) values (?, ?, '2026-01-01 00:00:00.000000')",
               analyst.id, await hashPassword(GOOD));
  await db.run("insert into auth_passwords (user_id, hash, set_at) values (?, ?, '2026-01-01 00:00:00.000000')",
               gone.id, await hashPassword(GOOD));
  return { db, analyst, gone, never };
}

const attempt = (db: Sql, email: string, pw: string, ip: string | null = "10.0.0.1") =>
  attemptSignIn(db, { email, password: pw, ip });

test("the right password on an active account is the only way in", async () => {
  const { db, analyst } = await seeded();
  const got = await attempt(db, "ANALYST@example.invalid", GOOD);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.user.id, analyst.id, "and the address is matched case-insensitively");
  assert.equal(got.mustChangePassword, false);

  // The session is real: it resolves back to the same person.
  const who = await userForSession(db, got.session.token);
  assert.equal(who?.email, "analyst@example.invalid");

  const row = await db.get("select last_sign_in_at from app_users where id = ?", analyst.id) as
    { last_sign_in_at: string | null };
  assert.ok(row.last_sign_in_at, "and the access review has something to review");
});

test("every refusal is one shape, and only the reason differs", async () => {
  const { db } = await seeded();
  const cases: Array<[string, string, string]> = [
    ["not-an-address", GOOD, "malformed"],
    ["someone@elsewhere.test", GOOD, "domain"],
    ["nobody@example.invalid", GOOD, "not on the roster"],
    ["gone@example.invalid", GOOD, "inactive"],
    ["never@example.invalid", GOOD, "no password set"],
    ["analyst@example.invalid", "the wrong one entirely", "bad password"],
  ];
  for (const [email, pw, reason] of cases) {
    const got = await attempt(db, email, pw);
    assert.equal(got.ok, false, `${email} is refused`);
    if (got.ok) continue;
    assert.equal(got.reason, reason);
    // Nothing but the reason comes back. The caller renders one sentence.
    assert.deepEqual(Object.keys(got).sort(), ["ok", "reason"]);
    await clearFailures(db, email);
  }
});

test("EVERY well-formed attempt costs one hash, whoever it is for", async () => {
  // The property: a person at the form cannot tell an address that is on the
  // roster from one that is not, by reading OR by timing. An early return for
  // an unknown address would skip the scrypt and make the difference audible.
  //
  // The floor in signin.ts pads every refusal to the same wall clock, which is
  // what makes a stopwatch useless here -- and also what makes a stopwatch
  // useless as a TEST. So count the hashes instead.
  const { db } = await seeded();
  const wellFormed = [
    ["nobody@example.invalid", GOOD],          // no such account
    ["gone@example.invalid", GOOD],            // deactivated
    ["never@example.invalid", GOOD],           // on the roster, no password yet
    ["analyst@example.invalid", "wrong"],      // wrong password
    ["someone@elsewhere.test", GOOD],          // domain not allowed
    ["analyst@example.invalid", GOOD],         // and the one that works
  ];
  for (const [email, pw] of wellFormed) {
    const before = password.verifyCalls;
    await attempt(db, email, pw);
    assert.equal(password.verifyCalls - before, 1,
                 `exactly one hash for ${email} / ${pw}`);
    await clearFailures(db, email);
  }

  // Malformed is the one exception, and it is deliberate: whoever typed it
  // already knows what they typed, so its speed says nothing about the roster.
  const before = password.verifyCalls;
  await attempt(db, "no-at-sign", GOOD);
  assert.equal(password.verifyCalls - before, 0);
});

test("a refusal is never quicker than the floor", async () => {
  // A throttled attempt refuses without hashing at all. Unfloored it would come
  // back in a few milliseconds against sixty, and "this one came back fast" is
  // "this one is being attacked", which is "this one exists".
  const { db } = await seeded();
  delete process.env.MM_SIGNIN_MIN_MS;
  try {
    const began = Date.now();
    const got = await attempt(db, "nobody@example.invalid", GOOD);
    assert.equal(got.ok, false);
    assert.ok(Date.now() - began >= MIN_REFUSAL_MS - 5,
              `took ${Date.now() - began}ms, floor is ${MIN_REFUSAL_MS}ms`);
  } finally {
    process.env.MM_SIGNIN_MIN_MS = "0";
  }
});

test("the throttle bites, and a correct password does not get past it", async () => {
  const { db } = await seeded();
  for (let i = 0; i < THROTTLE_PER_EMAIL; i += 1) {
    const got = await attempt(db, "analyst@example.invalid", `wrong ${i}`);
    assert.equal(got.ok, false);
  }
  const now = await attempt(db, "analyst@example.invalid", GOOD);
  assert.equal(now.ok, false, "the right password, refused, because of the knocking");
  if (!now.ok) assert.equal(now.reason, "throttled");

  // Knocking again while throttled does not extend the lockout -- an attacker
  // must not be able to hold somebody out for ever by continuing to knock.
  const n = await db.get("select count(*) n from auth_sign_in_failures") as { n: number };
  await attempt(db, "analyst@example.invalid", "wrong again");
  const after = await db.get("select count(*) n from auth_sign_in_failures") as { n: number };
  assert.equal(Number(after.n), Number(n.n), "a throttled attempt is not counted");
});

test("a success clears the counter, and the sweep clears the rest", async () => {
  const { db } = await seeded();
  for (let i = 0; i < THROTTLE_PER_EMAIL - 1; i += 1) {
    await attempt(db, "analyst@example.invalid", `wrong ${i}`);
  }
  const got = await attempt(db, "analyst@example.invalid", GOOD);
  assert.equal(got.ok, true, "still under the ceiling, so the right password works");
  const left = await db.get(
    "select count(*) n from auth_sign_in_failures where email_lower = 'analyst@example.invalid'") as
      { n: number };
  assert.equal(Number(left.n), 0, "and the slate is wiped");

  // An old failure and a fresh one, so the sweep's cutoff is asserted rather
  // than whatever the clock happened to do between two statements.
  await db.run(
    "insert into auth_sign_in_failures (email_lower, ip, at) values ('old@example.invalid', null, ?)",
    "2026-01-01 00:00:00.000000");
  await attempt(db, "nobody@example.invalid", GOOD);
  assert.equal(await purgeSignInFailures(db, 30), 1,
               "the sweep exists because a record of every attempt is a record of working hours");
  const kept = await db.get("select count(*) n from auth_sign_in_failures") as { n: number };
  assert.equal(Number(kept.n), 1, "and it keeps the one still inside the window");
});

test("an Admin's temporary password forces a change and ends every live session", async () => {
  const { db, analyst } = await seeded();
  const live = await createSession(db, analyst.id, {});
  assert.ok(await userForSession(db, live.token), "a session is running");

  const { password: temp, sessionsRevoked } = await setTemporaryPassword(
    db, { targetId: analyst.id, actorId: null });

  assert.equal(sessionsRevoked, 1);
  assert.equal(await userForSession(db, live.token), null,
               "a reset that leaves a stolen session running is the inverse of what it promises");

  const got = await attempt(db, "analyst@example.invalid", temp);
  assert.equal(got.ok, true);
  if (got.ok) assert.equal(got.mustChangePassword, true, "and they are made to replace it");
  assert.equal((await attempt(db, "analyst@example.invalid", GOOD)).ok, false,
               "the old password is gone");
});

test("changing a password refuses without the current one, and clears the flag", async () => {
  const { db, analyst } = await seeded();
  const next = "something else entirely";

  await assert.rejects(() => changePassword(
    db, { userId: analyst.id, current: "not it", next, confirm: next }), ChangeRefused);
  await assert.rejects(() => changePassword(
    db, { userId: analyst.id, current: GOOD, next, confirm: "mismatched" }), ChangeRefused);
  await assert.rejects(() => changePassword(
    db, { userId: analyst.id, current: GOOD, next: "short", confirm: "short" }), ChangeRefused);

  await db.run("update app_users set must_change_password = true where id = ?", analyst.id);
  await changePassword(db, { userId: analyst.id, current: GOOD, next, confirm: next });

  const got = await attempt(db, "analyst@example.invalid", next);
  assert.equal(got.ok, true);
  if (got.ok) assert.equal(got.mustChangePassword, false, "the gate is lifted");
  assert.equal((await attempt(db, "analyst@example.invalid", GOOD)).ok, false);
});

test("a generated password is readable, and has no characters that start support calls", async () => {
  const one = generatePassword();
  assert.match(one, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){4}$/);
  assert.doesNotMatch(one, /[O0Il1]/, "the characters nobody can read aloud");
  assert.notEqual(generatePassword(), generatePassword());
});
