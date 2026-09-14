/** Build the authorisation context from a Next request. Server-only. */
import "server-only";
import { cookies, headers } from "next/headers";
import { openSql, DATABASE_PATH } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import {
  assertRole, devClaimSource, firstOf, sessionClaimSource,
  type AssertOptions, type ClaimSource, type Role,
} from "./session.ts";

export { DATABASE_PATH };

let cached: Sql | null = null;

/**
 * One handle for the process. Postgres pools inside it, SQLite holds one file
 * open; either way opening a database per request is what turns a page into a
 * connection storm.
 */
export function db(): Sql {
  if (!cached) cached = openSql();
  return cached;
}

/**
 * The provider seam.
 *
 * Magic link is the pilot's provider and is the default. The development
 * source stays reachable behind MM_AUTH=dev so the application can still be
 * run and end-to-end tested without an inbox -- doc 13 mints sessions in setup
 * rather than driving the sign-in email, or every run depends on a mailbox --
 * and it refuses to operate in production on its own account.
 *
 * Deloitte SSO plugs in here and changes nothing else, because authorisation
 * reads one claim rather than a provider's user table.
 */
export function claims(database: Sql = db()): ClaimSource {
  const which = process.env.MM_AUTH ?? "session";
  switch (which) {
    case "dev": return devClaimSource();
    case "session": return sessionClaimSource(database);
    // The end-to-end suite, which drives the real link route once and mints
    // dev sessions for the rest. Never a default.
    case "session+dev": return firstOf(sessionClaimSource(database), devClaimSource());
    default:
      throw new Error(
        `MM_AUTH=${which} is not a claim source (session, dev, session+dev)`);
  }
}

export async function authContext() {
  const store = await cookies();
  const cookieHeader = store.getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  const database = db();
  return { db: database, claims: claims(database), cookieHeader: cookieHeader || null };
}

/**
 * THE entry point for every route handler, server action and guarded page.
 *
 * It builds the context and asserts the role in one call, so there is nothing
 * an author can legitimately put before it -- which is what lets
 * scripts/check_role_assertions.mjs demand it be the literal first statement.
 * An earlier shape needed authContext() first, and "nearly first" is not a rule
 * a checker can enforce.
 */
export async function requireRole(required: readonly Role[], options: AssertOptions = {}) {
  const ctx = await authContext();
  const user = await assertRole(ctx, required, options);
  return { user, db: ctx.db, claims: ctx.claims, cookieHeader: ctx.cookieHeader };
}

export async function requestCookieHeader(): Promise<string | null> {
  const h = await headers();
  return h.get("cookie");
}
