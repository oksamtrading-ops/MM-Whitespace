/** Build the authorisation context from a Next request. Server-only. */
import "server-only";
import { cookies, headers } from "next/headers";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import { assertRole, devClaimSource, type ClaimSource, type Role } from "./session.ts";

export const DATABASE_PATH = process.env.MM_DATABASE ?? "./period.db";

let cached: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (cached) return cached;
  const handle = new DatabaseSync(DATABASE_PATH);
  handle.exec("pragma foreign_keys = on");
  const has = handle.prepare(
    "select count(*) n from sqlite_master where type='table' and name='app_users'",
  ).get() as { n: number };
  if (has.n === 0) applySchema(handle);
  cached = handle;
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
