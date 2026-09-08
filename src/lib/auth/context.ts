/** Build the authorisation context from a Next request. Server-only. */
import "server-only";
import { cookies, headers } from "next/headers";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../db/schema.ts";
import { devClaimSource, type ClaimSource } from "./session.ts";

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

export async function requestCookieHeader(): Promise<string | null> {
  const h = await headers();
  return h.get("cookie");
}
