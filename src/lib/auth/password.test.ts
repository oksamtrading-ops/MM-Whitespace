import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUMMY_HASH, MAX_PASSWORD_BYTES, MIN_PASSWORD_CHARS, hashPassword, needsRehash,
  paramsOf, validatePassword, verifyPassword, WeakPassword,
} from "./password.ts";

test("a password verifies against its own hash and nothing else", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password twice is two different hashes", async () => {
  // The salt, doing its job. Equal hashes would mean a rainbow table works
  // against the whole roster at once.
  const a = await hashPassword("the same password");
  const b = await hashPassword("the same password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("the same password", a), true);
  assert.equal(await verifyPassword("the same password", b), true);
});

test("the hash says what made it, so the cost can be raised later", async () => {
  const hash = await hashPassword("a password worth keeping");
  assert.match(hash, /^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[\w-]+\$[\w-]+$/);
  assert.deepEqual(paramsOf(hash), { ln: 15, r: 8, p: 1 });
  assert.equal(needsRehash(hash), false);
  // A hash from a cheaper era is re-hashed on its owner's next sign-in.
  assert.equal(needsRehash(hash.replace("ln=15", "ln=14")), true);
});

test("a hash that is not ours is refused, never thrown", async () => {
  // A throw on one branch and a false on another is an oracle: different error
  // handling, different logs, different timing, all keyed on whether the
  // account had a usable hash.
  for (const junk of [
    "", "not a hash", "$scrypt$", "$bcrypt$ln=15,r=8,p=1$aaaa$bbbb",
    "$scrypt$ln=15,r=8,p=1$aaaa", "$scrypt$ln=x,r=8,p=1$aaaa$bbbb",
    "$scrypt$ln=99,r=8,p=1$aaaa$bbbb", "$scrypt$r=8,p=1$aaaa$bbbb",
    "$scrypt$ln=15,r=8,p=1$$bbbb",
  ]) {
    assert.equal(await verifyPassword("anything", junk), false, `refused: ${junk}`);
    assert.equal(needsRehash(junk), true, `and re-hashed on sight: ${junk}`);
  }
});

test("an absurd cost in a stored hash is refused rather than honoured", async () => {
  // ln=30 is a gigabyte. A stored hash is data, and data that can ask this
  // process to allocate a gigabyte is a denial of service we wrote ourselves.
  assert.equal(paramsOf("$scrypt$ln=30,r=8,p=1$aaaa$bbbb"), null);
});

test("DUMMY_HASH carries the CURRENT parameters", async () => {
  // signin.ts verifies against this when no account exists, so an unknown
  // address costs what a known one does. The moment it is cheaper than a real
  // verify, the sign-in form is a roster oracle again -- and raising LN without
  // regenerating it is exactly how that happens quietly. This test is the thing
  // that makes raising LN fail the build instead of the property.
  assert.deepEqual(paramsOf(DUMMY_HASH), paramsOf(await hashPassword("x".repeat(20))),
                   "regenerate DUMMY_HASH: its cost no longer matches a real hash");
  assert.equal(needsRehash(DUMMY_HASH), false);
  // And it is a real hash of something nobody knows, not a placeholder.
  assert.equal(await verifyPassword("decoy", DUMMY_HASH), false);
});

test("an over-long password is refused, not truncated", async () => {
  // scrypt has no bcrypt-style truncation: it hashes whatever it is handed, so
  // a 10 MB string is 10 MB of work on an unauthenticated endpoint. Truncating
  // instead would make two different passwords the same password.
  const tooLong = "p".repeat(MAX_PASSWORD_BYTES + 1);
  await assert.rejects(() => hashPassword(tooLong), WeakPassword);
  assert.throws(() => validatePassword(tooLong), WeakPassword);

  const hash = await hashPassword("p".repeat(MAX_PASSWORD_BYTES));
  assert.equal(await verifyPassword(tooLong, hash), false,
               "and it does not verify as its own truncation");
});

test("the policy is length, and the two things that are not secrets", async () => {
  assert.throws(() => validatePassword("short"), WeakPassword);
  assert.throws(() => validatePassword("x".repeat(MIN_PASSWORD_CHARS - 1)), WeakPassword);
  validatePassword("x".repeat(MIN_PASSWORD_CHARS));

  // No composition rules, per NIST SP 800-63B: "one capital, one digit"
  // measurably pushes people towards Passw0rd! and buys nothing.
  validatePassword("all lower case letters and spaces");

  assert.throws(() => validatePassword("kay@example.invalid", { email: "Kay@Example.Invalid" }),
                WeakPassword, "an address is not a secret; it is on every screen");
  assert.throws(() => validatePassword("the same one", { current: "the same one" }), WeakPassword);
});
