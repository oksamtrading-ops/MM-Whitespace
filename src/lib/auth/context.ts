/** Build the authorisation context from a Next request. Server-only. */
import "server-only";
import { cookies, headers } from "next/headers";
import { openSql, DATABASE_PATH } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { assertRole, devClaimSource, type ClaimSource, type Role } from "./session.ts";

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
 * The provider seam. Only the dev source exists today; magic link and then
 * Deloitte SSO plug in here and change nothing else, because authorisation
 * reads one claim rather than a provider's user table.
 */
export function claims(): ClaimSource {
  return devClaimSource();
}

export async function authContext() {
  const store = await cookies();
  const cookieHeader = store.getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  return { db: db(), claims: claims(), cookieHeader: cookieHeader || null };
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
export async function requireRole(required: readonly Role[]) {
  const ctx = await authContext();
  const user = await assertRole(ctx, required);
  return { user, db: ctx.db, claims: ctx.claims, cookieHeader: ctx.cookieHeader };
}

export async function requestCookieHeader(): Promise<string | null> {
  const h = await headers();
  return h.get("cookie");
}
