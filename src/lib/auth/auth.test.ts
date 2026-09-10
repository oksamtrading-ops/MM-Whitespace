import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema } from "../db/schema.ts";
import {
  assertRole, authoriseCron, constantTimeEquals, devClaimSource, Forbidden,
  hasRole, isAllowedDomain, readCookie, resolveUser, signDevSession, Unauthenticated,
} from "./session.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SECRET = "test-secret";

async function seeded() {
  const db = memorySql();
  const ins = "insert into app_users (email, role) values (?, ?)";
  await db.run(ins, "analyst@example.invalid", "analyst");
  await db.run(ins, "viewer@example.invalid", "viewer");
  await db.run(ins, "admin@example.invalid", "admin");
  await db.run(ins, "gone@example.invalid", "analyst");
  await db.run("update app_users set is_active = 0 where email = 'gone@example.invalid'");
  return db;
}

const ctxFor = (db: Sql, email: string | null) => ({
  db,
  claims: { name: "test", emailClaim: () => email },
  cookieHeader: null,
});

// ------------------------------------------------------- the user table

test("authorisation resolves ONE claim against the application's own user table", async () => {
  const db = await seeded();
  // Not the provider's user table -- which is what makes swapping providers a
  // configuration change rather than a rewrite.
  const user = await resolveUser(await db, "analyst@example.invalid");
  assert.equal(user?.role, "analyst");
  assert.equal((await resolveUser(await db, "ANALYST@EXAMPLE.INVALID"))?.role, "analyst");
});

test("invite-only: an email the provider would accept is still not a user", async () => {
  const db = await seeded();
  assert.equal(await resolveUser(await db, "stranger@example.invalid"), null);
});

test("a deactivated user is not a user", async () => {
  // There is no leaver process for an application outside Deloitte's estate, so
  // deactivation is the only thing between a partner who rolls off and the roster.
  const db = await seeded();
  assert.equal(await resolveUser(await db, "gone@example.invalid"), null);
});

test("the domain allowlist matches the whole domain, not a suffix", async () => {
  assert.equal(isAllowedDomain("a@deloitte.ca", ["deloitte.ca"]), true);
  assert.equal(isAllowedDomain("a@evil-deloitte.ca", ["deloitte.ca"]), false);
  assert.equal(isAllowedDomain("a@deloitte.ca.evil.test", ["deloitte.ca"]), false);
  assert.equal(isAllowedDomain("no-at-sign", ["deloitte.ca"]), false);
});

// ------------------------------------------------------------ assertRole

test("assertRole refuses an unauthenticated caller", async () => {
  const db = await seeded();
  await assert.rejects(assertRole(ctxFor(db, null), ["viewer"]), Unauthenticated);
});

test("assertRole refuses a caller whose claim resolves to no active user", async () => {
  const db = await seeded();
  await assert.rejects(
    assertRole(ctxFor(db, "gone@example.invalid"), ["analyst"]), Unauthenticated);
});

test("A VIEWER CANNOT REACH AN ANALYST ENDPOINT", async () => {
  // Every Server Action compiles to an addressable endpoint whether or not the
  // control that calls it renders, so a Viewer who can sign in could call
  // publish. This assertion -- not the rail omitting a link -- is the boundary.
  const db = await seeded();
  await assert.rejects(
    assertRole(ctxFor(db, "viewer@example.invalid"), ["analyst", "admin"]),
    (err: Forbidden) => {
      assert.ok(err instanceof Forbidden);
      assert.equal(err.actual, "viewer");
      return true;
    });
});

test("an analyst is not an admin", async () => {
  const db = await seeded();
  await assert.rejects(
    assertRole(ctxFor(db, "analyst@example.invalid"), ["admin"]), Forbidden);
  const admin = await assertRole(ctxFor(db, "admin@example.invalid"), ["admin"]);
  assert.equal(admin.role, "admin");
});

test("hasRole is exact membership, never a rank comparison", async () => {
  const admin = { id: "1", email: "a", role: "admin" as const, isActive: true };
  assert.equal(hasRole(admin, ["admin"]), true);
  assert.equal(hasRole(admin, ["analyst"]), false, "admin is not silently an analyst");
  assert.equal(hasRole(null, ["viewer"]), false);
});

// -------------------------------------------------------- the dev source

test("a forged or unsigned cookie yields no claim", async () => {
  const source = devClaimSource(SECRET);
  const good = signDevSession("analyst@example.invalid", SECRET);
  assert.equal(source.emailClaim(`mm_dev_session=${good}`), "analyst@example.invalid");

  assert.equal(source.emailClaim("mm_dev_session=admin@example.invalid.deadbeef"), null);
  assert.equal(source.emailClaim("mm_dev_session=admin@example.invalid"), null);
  assert.equal(source.emailClaim(null), null);
  // Signed with a different secret.
  assert.equal(
    source.emailClaim(`mm_dev_session=${signDevSession("a@b.invalid", "other")}`), null);
});

test("the development claim source refuses to run in production", async () => {
  const saved = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    assert.throws(() => devClaimSource(SECRET).emailClaim("mm_dev_session=x.y"),
      /refuses to run in production/);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved;
  }
});

test("comparing values of different lengths does not throw or leak", async () => {
  assert.equal(constantTimeEquals("abc", "abc"), true);
  assert.equal(constantTimeEquals("abc", "abcdefghijk"), false);
  assert.equal(constantTimeEquals("", "x"), false);
});

test("cookie parsing survives adjacent names and encoded values", async () => {
  assert.equal(readCookie("other=1; mm_dev_session=abc; x=2", "mm_dev_session"), "abc");
  assert.equal(readCookie("xmm_dev_session=nope", "mm_dev_session"), null);
  assert.equal(readCookie("mm_dev_session=a%40b", "mm_dev_session"), "a@b");
});

// -------------------------------------------------------------- the cron

test("the cron endpoint fails CLOSED when no secret is configured", async () => {
  const r = authoriseCron("Bearer anything", undefined);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /failing closed/);
});

test("a missing Authorization header is rejected, not allowed", async () => {
  // Rejecting on absence rather than allowing when unset is the difference
  // between a closed door and an open one.
  assert.equal(authoriseCron(null, "s3cret").ok, false);
  assert.equal(authoriseCron("Bearer wrong", "s3cret").ok, false);
  assert.equal(authoriseCron("Bearer s3cret", "s3cret").ok, true);
  assert.equal(authoriseCron("s3cret", "s3cret").ok, true);
});

// ----------------------------------------------------------- the lint rule

test("THE AUTH CHECK FAILS on an endpoint with no assertion", async () => {
  // A check that never fails proves nothing. This plants an unguarded route
  // handler and asserts the build would break.
  const tmp = mkdtempSync(join(tmpdir(), "mm-auth-"));
  try {
    const dir = join(tmp, "src", "app", "api", "danger");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "route.ts"),
      "export async function POST(request: Request) {\n" +
      "  const body = await request.json();\n" +
      "  return Response.json(body);\n}\n");

    let failed = false;
    let output = "";
    try {
      execFileSync("node", [join(ROOT, "scripts", "check_role_assertions.mjs"), tmp],
                   { encoding: "utf8" });
    } catch (err) {
      failed = true;
      output = String((err as { stderr?: string }).stderr ?? "");
    }
    assert.equal(failed, true, "an unguarded route handler must fail the check");
    assert.match(output, /POST/);
    assert.match(output, /@public-endpoint/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the auth check passes on the real application", async () => {
  const out = execFileSync(
    "node", [join(ROOT, "scripts", "check_role_assertions.mjs")],
    { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /every route handler and server action begins with an authorisation check/);
});
