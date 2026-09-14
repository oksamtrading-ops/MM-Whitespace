/**
 * Sessions, as rows.
 *
 * Doc 11 asks for sessions that are "bounded and revocable", and revocable is
 * the word that decides the design. A signed stateless token cannot be
 * withdrawn: once issued it is good until it expires, and the only remedies
 * are to rotate a signing key -- which logs out everybody -- or to keep a
 * denylist, which is a session table with extra steps.
 *
 * The access review screen is the reason this matters. There is no leaver
 * process for an application outside Deloitte's own estate, so deactivation is
 * the whole of offboarding, and it has to take effect on the next request
 * rather than whenever a token happens to lapse.
 *
 * TWO CLOCKS. `expires_at` is the bound and cannot be extended -- a session
 * ends after MM_SESSION_HOURS however busy its holder is, which is what makes
 * it bounded rather than perpetual. `last_seen_at` drives the idle timeout, so
 * a laptop left open in a client's lobby stops being a way in.
 *
 * The stored value is the SHA-256 of the cookie, so this table is not a set of
 * credentials.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import type { AppUser, Role } from "./session.ts";

export const SESSION_COOKIE = "mm_session";

/** A working day. Long enough to review a period; short enough to be a bound. */
export const SESSION_HOURS = Number(process.env.MM_SESSION_HOURS ?? 12);
/** Idle timeout. Long enough for a meeting, short enough for a lobby. */
export const IDLE_HOURS = Number(process.env.MM_SESSION_IDLE_HOURS ?? 4);

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function stampIn(ms: number): string {
  return formatStamp(Date.now() + ms);
}

export type NewSession = { token: string; expiresAt: string };

/**
 * How the session cookie is set, in one place.
 *
 * It used to be written out once, in the route that redeemed a link. Now two
 * callers set it -- signing in, and changing a password, which mints a fresh
 * session -- and two hand-written copies of these flags is how one of them
 * quietly loses `httpOnly` or `secure`.
 *
 * sameSite "lax" rather than "strict": the session has to survive arriving from
 * a link somebody was sent, and strict would drop it on that first navigation.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  };
}

export async function createSession(
  db: Sql, userId: string, meta: { ip?: string | null; ua?: string | null } = {},
): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = stampIn(SESSION_HOURS * 3_600_000);
  await db.run(
    `insert into auth_sessions (user_id, token_hash, expires_at, created_ip, created_ua)
     values (?, ?, ?, ?, ?)`,
    userId, hashToken(token), expiresAt, meta.ip ?? null,
    (meta.ua ?? null)?.slice(0, 400) ?? null);
  return { token, expiresAt };
}

/**
 * The user behind a session cookie, or null.
 *
 * One statement joins the session to the roster, so a deactivated account is
 * refused by the same read that validates the session rather than by a second
 * check somebody could forget. Touching `last_seen_at` is what makes the idle
 * timeout mean anything, and it is a write on every request -- cheap, and the
 * alternative is an idle timeout that never fires.
 */
export async function userForSession(db: Sql, token: string | null): Promise<AppUser | null> {
  if (!token) return null;
  const now = formatStamp();
  const row = await db.get(
    `select s.id, s.last_seen_at, u.id as user_id, u.email, u.role, u.is_active,
            u.must_change_password
       from auth_sessions s join app_users u on u.id = s.user_id
      where s.token_hash = ? and s.revoked_at is null and s.expires_at > ?`,
    hashToken(token), now) as {
      id: string; last_seen_at: string; user_id: string;
      email: string; role: Role; is_active: number | boolean;
      must_change_password: number | boolean;
    } | undefined;
  if (!row) return null;
  if (!row.is_active) return null;

  const idleCutoff = formatStamp(Date.now() - IDLE_HOURS * 3_600_000);
  if (row.last_seen_at <= idleCutoff) {
    await revokeSessionById(db, row.id, null, "idle");
    return null;
  }
  await db.run("update auth_sessions set last_seen_at = ? where id = ?", now, row.id);
  // The flag comes from the same join, not from a second read. This is the
  // AppUser the session path builds, and a gate that only knew about
  // resolveUser's would be no gate at all for anyone already signed in.
  return {
    id: row.user_id, email: row.email, role: row.role, isActive: true,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function revokeSession(
  db: Sql, token: string, by: string | null = null, reason = "signed out",
): Promise<number> {
  const r = await db.run(
    `update auth_sessions set revoked_at = ?, revoked_by = ?, revoked_reason = ?
      where token_hash = ? and revoked_at is null`,
    formatStamp(), by, reason, hashToken(token));
  return r.changes;
}

async function revokeSessionById(
  db: Sql, id: string, by: string | null, reason: string,
): Promise<void> {
  await db.run(
    `update auth_sessions set revoked_at = ?, revoked_by = ?, revoked_reason = ?
      where id = ? and revoked_at is null`,
    formatStamp(), by, reason, id);
}

/**
 * Everything this person holds, gone.
 *
 * Called when an Admin deactivates an account. Without it, deactivation stops
 * the NEXT sign-in and leaves the current one running, which is the opposite
 * of what the access review screen appears to promise.
 */
export async function revokeAllForUser(
  db: Sql, userId: string, by: string | null, reason = "account deactivated",
): Promise<number> {
  const r = await db.run(
    `update auth_sessions set revoked_at = ?, revoked_by = ?, revoked_reason = ?
      where user_id = ? and revoked_at is null`,
    formatStamp(), by, reason, userId);
  return r.changes;
}

export type LiveSession = {
  id: string; createdAt: string; lastSeenAt: string; expiresAt: string; createdIp: string | null;
};

/** What the access review shows next to an account: is anyone signed in as it. */
export async function liveSessionsForUser(db: Sql, userId: string): Promise<LiveSession[]> {
  const rows = await db.all(
    `select id, created_at, last_seen_at, expires_at, created_ip
       from auth_sessions
      where user_id = ? and revoked_at is null and expires_at > ?
      order by last_seen_at desc`,
    userId, formatStamp());
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    lastSeenAt: String(r.last_seen_at),
    expiresAt: String(r.expires_at),
    createdIp: r.created_ip === null ? null : String(r.created_ip),
  }));
}

/** An expired session is not a credential; after a while it is not evidence either. */
export async function purgeExpiredSessions(db: Sql, olderThanDays = 30): Promise<number> {
  const cutoff = formatStamp(Date.now() - olderThanDays * 86_400_000);
  const r = await db.run("delete from auth_sessions where expires_at < ?", cutoff);
  return r.changes;
}
