import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import { memorySql } from "../db/open.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema } from "../db/schema.ts";
import {
  allowedDomains,
  assertRole, authoriseCron, constantTimeEquals, devClaimSource, Forbidden,
  PasswordChangeRequired,
  hasRole, isAllowedDomain, readCookie, resolveUser, signDevSession, Unauthenticated,
  sessionClaimSource,
} from "./session.ts";
import { createSession, revokeSession, SESSION_COOKIE, userForSession } from "./sessions.ts";

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

test("the allowlist comes from the setting, and falls back rather than locking everyone out", async () => {
  // Two route files each parsed MM_ALLOWED_DOMAINS into their own constant.
  // One source now, the same one the 0024 trigger reads, so the interface and
  // the database cannot come to disagree about who may be given an account.
  const db = await seeded();
  const before = process.env.MM_ALLOWED_DOMAINS;
  try {
    process.env.MM_ALLOWED_DOMAINS = "fallback.test";

    // No setting yet -- a database that has not had 0024. Failing closed here
    // would refuse every sign-in including the Admin's, with no way in to fix
    // it, so the environment still answers.
    assert.deepEqual(await allowedDomains(db), ["fallback.test"]);

    await db.run(
      "insert into app_settings (key, value) values ('allowed_email_domains', ?)",
      "gmail.com, deloitte.ca");
    assert.deepEqual(await allowedDomains(db), ["gmail.com", "deloitte.ca"],
                     "the setting wins once it exists");

    // Emptied in the database is not the same as never set: the trigger is
    // what refuses everyone then, where the damage is one value wide.
    await db.run("update app_settings set value = '' where key = 'allowed_email_domains'");
    assert.deepEqual(await allowedDomains(db), ["fallback.test"]);
  } finally {
    if (before === undefined) delete process.env.MM_ALLOWED_DOMAINS;
    else process.env.MM_ALLOWED_DOMAINS = before;
  }
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
  const admin = {
    id: "1", email: "a", role: "admin" as const, isActive: true, mustChangePassword: false,
  };
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

/* ------------------------------------------- the pilot's claim source */

test("a real session satisfies assertRole, and revoking it stops doing so", async () => {
  const db = await seeded();
  const u = await db.get(
    "select id from app_users where email = ?", "analyst@example.invalid") as { id: string };
  const { token } = await createSession(db, u.id);
  const ctx = {
    db, claims: sessionClaimSource(db),
    cookieHeader: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  };

  const user = await assertRole(ctx, ["analyst"]);
  assert.equal(user.email, "analyst@example.invalid");
  await assert.rejects(assertRole(ctx, ["admin"]), Forbidden,
    "a session says who you are, never what you may do");

  await revokeSession(db, token);
  await assert.rejects(assertRole(ctx, ["analyst"]), Unauthenticated);
});

test("the claim source hands back an email and nothing else", async () => {
  // The whole portability argument: a provider cannot leak its user model into
  // authorisation because the seam has nowhere to put it.
  const db = await seeded();
  const u = await db.get(
    "select id from app_users where email = ?", "viewer@example.invalid") as { id: string };
  const { token } = await createSession(db, u.id);
  const claim = await sessionClaimSource(db)
    .emailClaim(`${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  assert.equal(claim, "viewer@example.invalid");
  assert.equal(typeof claim, "string");
});

test("no cookie is not a session, and neither is somebody else's junk", async () => {
  const db = await seeded();
  const src = sessionClaimSource(db);
  assert.equal(await src.emailClaim(null), null);
  assert.equal(await src.emailClaim("other=1"), null);
  assert.equal(await src.emailClaim(`${SESSION_COOKIE}=nonsense`), null);
});

// ------------------------------------------- the temporary-password gate

test("a temporary password stops everything else, and is an Unauthenticated", async () => {
  const db = await seeded();
  const d = await db;
  await d.run("update app_users set must_change_password = true where email = ?",
              "analyst@example.invalid");

  const err = await assertRole(ctxFor(d, "analyst@example.invalid"), ["analyst"])
    .then(() => null, (e: unknown) => e);
  assert.ok(err instanceof PasswordChangeRequired);

  // THE property the rest of the application leans on. Sixteen pages catch
  // `err instanceof Forbidden ? ... : ...` and the route handlers do the same
  // with status codes; nothing catches Unauthenticated by name. So a subclass
  // lands in every else branch and renders the "Sign in" refusal carrying this
  // message, with no page edited. Break this inheritance and twenty screens
  // start reporting "this page could not be drawn" instead.
  assert.ok(err instanceof Unauthenticated, "a subclass, so every catch already handles it");
  assert.ok(!(err instanceof Forbidden), "and not the one that means the wrong role");

  // The one way past, and it is still a real role assertion.
  const ok = await assertRole(ctxFor(d, "analyst@example.invalid"), ["analyst"],
                              { allowPasswordChange: true });
  assert.equal(ok.email, "analyst@example.invalid");
  await assert.rejects(
    () => assertRole(ctxFor(d, "analyst@example.invalid"), ["admin"],
                     { allowPasswordChange: true }),
    Forbidden, "waiving the password gate does not waive the role");
});

test("the session path carries the flag too, or the gate is no gate at all", async () => {
  // userForSession builds an AppUser from its OWN join, so it is a second
  // construction site. Missing the column there leaves the field undefined --
  // falsy -- and everybody already holding a session walks straight through.
  const db = await seeded();
  const d = await db;
  const row = await d.get("select id from app_users where email = ?",
                          "analyst@example.invalid") as { id: string };
  const { token } = await createSession(d, row.id, {});

  assert.equal((await userForSession(d, token))?.mustChangePassword, false);
  await d.run("update app_users set must_change_password = true where id = ?", row.id);
  assert.equal((await userForSession(d, token))?.mustChangePassword, true);
});

test("only four files may waive the password gate", async () => {
  // check_role_assertions.mjs cannot police this: it scans route handlers and
  // "use server" files, and never looks at a page.tsx at all. So the file set
  // is asserted here instead. A fifth file appearing is somebody widening the
  // one chokepoint the whole authorisation model rests on.
  const root = join(ROOT, "src");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (readFileSync(full, "utf8").includes("allowPasswordChange")) {
        found.push(full.slice(root.length + 1).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  // context.ts is absent deliberately: requireRole forwards an AssertOptions
  // without naming the field, so it cannot waive anything on its own behalf.
  // Only the two files that pass the flag, the one that reads it, and this.
  assert.deepEqual(found.sort(), [
    "app/password/actions.ts",
    "app/password/page.tsx",
    "lib/auth/auth.test.ts",
    "lib/auth/session.ts",
  ]);
});
