/**
 * What has to be true before a session exists. The decision, not the screen.
 *
 * This is a library and not the server action for a reason the test suite
 * enforces: tests/e2e/journeys.mjs does not drive server actions. Magic-link
 * redemption was a GET route, which is the only reason a real session could be
 * exercised end to end at all. A password has no route, so the decision lives
 * here where the journeys can drive it in a subprocess, the way they already
 * drive startRun.
 *
 * THE PROPERTY THIS FILE PROTECTS
 *
 * Every refusal reads the same and takes the same time. Not "one answer whoever
 * asks" -- that was true of magic links, where success and failure both ended in
 * the same sentence, and it cannot be true here: somebody holding a correct
 * password is let in, and already knows the account exists. What remains, and
 * what is worth defending, is that a person at the form cannot tell an address
 * that is on the roster from one that is not, by reading OR by timing.
 *
 * Two things buy that, and both are load-bearing:
 *
 *   1. An unknown address is verified against DUMMY_HASH rather than returned
 *      early, so it pays the same scrypt as a real one.
 *   2. Every refusal is floored to the same wall-clock minimum, because the
 *      throttle can refuse without hashing at all, and "this one came back fast"
 *      is "this one is under attack", which is "this one exists".
 *
 * The differences go to the audit log, where an Admin can read them and the
 * person at the keyboard cannot.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import {
  DUMMY_HASH, hashPassword, needsRehash, validatePassword, verifyPassword, WeakPassword,
} from "./password.ts";
import { allowedDomains, isAllowedDomain, type AppUser, type Role } from "./session.ts";
import { createSession, revokeAllForUser, type NewSession } from "./sessions.ts";

/** Failures counted per address, in a sliding window. */
export const THROTTLE_WINDOW_MINUTES = Number(process.env.MM_SIGNIN_WINDOW_MINUTES ?? 15);
/** Failures per address before every attempt is refused for the rest of the window. */
export const THROTTLE_PER_EMAIL = Number(process.env.MM_SIGNIN_MAX_FAILURES ?? 8);
/** Failures from one address of the network, which catches spraying across accounts. */
export const THROTTLE_PER_IP = Number(process.env.MM_SIGNIN_MAX_FAILURES_IP ?? 30);

/**
 * The floor every refusal is padded to.
 *
 * Must exceed the SLOWEST refusal path, not the fastest, or it does nothing.
 * Today the slowest is one scrypt at ln=15 (~55 ms here, more on a smaller
 * instance). Revisit it when the cost changes -- and note it must also cover a
 * legacy hash left over from a lower cost, which verifies faster than
 * DUMMY_HASH and would otherwise be audible.
 */
export const MIN_REFUSAL_MS = 250;

/**
 * Read per call rather than captured at import, so a test can neutralise it.
 *
 * Not a convenience: the floor costs a quarter of a second on every refusal,
 * and a suite that exercises every refusal path pays it hundreds of times. Held
 * as a module constant it added eight seconds to `npm test`, which is how a
 * check stops being run. The one test that cares about the floor sets it back.
 */
function minRefusalMs(): number {
  const raw = Number(process.env.MM_SIGNIN_MIN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : MIN_REFUSAL_MS;
}

/** Why an attempt was refused. For the audit log; never rendered. */
export type Refusal =
  | "malformed" | "domain" | "not on the roster" | "inactive"
  | "no password set" | "bad password" | "throttled";

export type Attempt =
  | { ok: true; session: NewSession; user: AppUser; mustChangePassword: boolean }
  | { ok: false; reason: Refusal };

type Meta = { ip?: string | null; ua?: string | null };

type Candidate = {
  id: string; email: string; role: Role;
  is_active: number; hash: string | null; must_change: number;
};

function lower(email: string): string {
  return email.trim().toLowerCase();
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((go) => setTimeout(go, ms));
}

/** Pad to the floor. Called on every refusal, including the cheap ones. */
async function floor(began: number): Promise<void> {
  await sleep(minRefusalMs() - (Date.now() - began));
}

function windowStart(): string {
  return formatStamp(Date.now() - THROTTLE_WINDOW_MINUTES * 60_000);
}

/** Count recent failures for an address and for a network address. */
async function throttled(db: Sql, email: string, ip: string | null): Promise<boolean> {
  const since = windowStart();
  const byEmail = await db.get(
    "select count(*) n from auth_sign_in_failures where email_lower = ? and at > ?",
    lower(email), since) as { n: number };
  if (Number(byEmail.n) >= THROTTLE_PER_EMAIL) return true;
  if (!ip) return false;
  const byIp = await db.get(
    "select count(*) n from auth_sign_in_failures where ip = ? and at > ?",
    ip, since) as { n: number };
  return Number(byIp.n) >= THROTTLE_PER_IP;
}

async function recordFailure(db: Sql, email: string, ip: string | null): Promise<void> {
  await db.run(
    "insert into auth_sign_in_failures (email_lower, ip, at) values (?, ?, ?)",
    lower(email), ip, formatStamp());
}

/** A success clears the address's counter. The audit log keeps the evidence. */
export async function clearFailures(db: Sql, email: string): Promise<void> {
  await db.run("delete from auth_sign_in_failures where email_lower = ?", lower(email));
}

/** Sweep the counter. It is a counter, not a record of anybody's working hours. */
export async function purgeSignInFailures(db: Sql, olderThanDays = 30): Promise<number> {
  const cutoff = formatStamp(Date.now() - olderThanDays * 86_400_000);
  const { changes } = await db.run("delete from auth_sign_in_failures where at < ?", cutoff);
  return changes;
}

/**
 * Try to sign in.
 *
 * Read the order of operations as a whole; each step is placed where it is for
 * a reason, and moving one re-opens something.
 */
export async function attemptSignIn(
  db: Sql, input: { email: string; password: string } & Meta,
): Promise<Attempt> {
  const email = String(input.email ?? "").trim();
  const password = String(input.password ?? "");
  const ip = input.ip ?? null;

  // 1. Shape. The only early return, and it is safe: whoever typed this already
  //    knows what they typed, so there is nothing to learn from its speed.
  if (!email || !email.includes("@") || email.length > 320
      || !password || Buffer.byteLength(password, "utf8") > 200) {
    return { ok: false, reason: "malformed" };
  }

  const began = Date.now();

  // 2. The throttle is READ here and acted on at the end. Returning now would
  //    skip the hash below, and a refusal that comes back in five milliseconds
  //    instead of sixty says "this address is being attacked", which says "this
  //    address exists".
  const isThrottled = await throttled(db, email, ip);

  // 3. The allowlist, read for every well-formed address alike -- see
  //    allowedDomains for why the list lives in a setting rather than the
  //    environment. Read here, acted on at step 5, for the same reason as the
  //    throttle.
  const domains = await allowedDomains(db);

  // 4. One roster read for every well-formed address alike.
  const row = await db.get(
    `select u.id, u.email, u.role, u.is_active, u.must_change_password as must_change,
            p.hash as hash
       from app_users u
       left join auth_passwords p on p.user_id = u.id
      where lower(u.email) = lower(?)`, email) as Candidate | undefined;

  // 5. The verify, unconditionally. There is deliberately no `if (!row) return`
  //    above this line: an unknown address, an account with no password yet and
  //    a wrong password all pay the same cost. A test counts the calls, because
  //    this is the kind of line somebody "optimises" back out.
  const stored = row?.hash ?? DUMMY_HASH;
  const matched = await verifyPassword(password, stored);

  // 6. Now decide, in the order that refuses on the most general ground first.
  //    The domain check sits HERE and not at the top, where its early return
  //    would skip step 4 and let a stopwatch separate an allowed domain from a
  //    refused one.
  const reason = ((): Refusal | null => {
    if (isThrottled) return "throttled";
    if (!isAllowedDomain(email, domains)) return "domain";
    if (!row) return "not on the roster";
    if (!row.is_active) return "inactive";
    if (!row.hash) return "no password set";
    if (!matched) return "bad password";
    return null;
  })();

  if (reason) {
    // A throttled attempt does not add to the count that throttled it; nothing
    // is learned from it and it would let an attacker hold a lockout open for
    // ever by continuing to knock.
    if (reason !== "throttled") await recordFailure(db, email, ip);
    await floor(began);
    return { ok: false, reason };
  }

  const user = row as Candidate;

  // 7. In. Clear the counter, upgrade the hash if the cost has moved on since
  //    it was made, and mint the session.
  await clearFailures(db, email);
  if (needsRehash(stored)) {
    await db.run("update auth_passwords set hash = ?, set_at = ? where user_id = ?",
                 await hashPassword(password), formatStamp(), user.id);
  }
  const session = await createSession(db, user.id, { ip, ua: input.ua });
  await db.run("update app_users set last_sign_in_at = ? where id = ?", formatStamp(), user.id);

  return {
    ok: true,
    session,
    user: {
      id: user.id, email: user.email, role: user.role, isActive: true,
      mustChangePassword: Boolean(user.must_change),
    },
    mustChangePassword: Boolean(user.must_change),
  };
}

/**
 * An Admin gives somebody a password they must replace.
 *
 * The forced change is what keeps the audit trail honest: decisions in this
 * application are attributed to people, so an Admin must not be left holding a
 * working credential for somebody else's account.
 */
export async function setTemporaryPassword(
  db: Sql, opts: { targetId: string; actorId: string | null },
): Promise<{ password: string; sessionsRevoked: number }> {
  const password = generatePassword();
  const hash = await hashPassword(password);
  const now = formatStamp();

  const sessionsRevoked = await db.tx(async (db) => {
    await db.run(
      `insert into auth_passwords (user_id, hash, set_at) values (?, ?, ?)
       on conflict (user_id) do update set hash = excluded.hash, set_at = excluded.set_at`,
      opts.targetId, hash, now);
    await db.run("update app_users set must_change_password = true where id = ?", opts.targetId);
    // A reset that leaves a stolen session running is the inverse of what the
    // button promises. /access already does this when it deactivates somebody.
    const revoked = await revokeAllForUser(db, opts.targetId, opts.actorId, "password reset");
    const target = await db.get("select email from app_users where id = ?", opts.targetId) as
      { email: string } | undefined;
    // The break-glass for the throttle's denial-of-service: whoever this is for
    // can sign in immediately, even if somebody has been knocking on their door.
    if (target) await clearFailures(db, target.email);
    return revoked;
  });

  return { password, sessionsRevoked };
}

/** Somebody replaces their own password. */
export async function changePassword(
  db: Sql, opts: { userId: string; current: string; next: string; confirm: string },
): Promise<{ session: NewSession; sessionsRevoked: number }> {
  const row = await db.get(
    `select u.email, p.hash from app_users u
       left join auth_passwords p on p.user_id = u.id where u.id = ?`, opts.userId) as
    { email: string; hash: string | null } | undefined;
  if (!row) throw new ChangeRefused("That account no longer exists.");

  // The current password is required even in the forced flow, and it is not
  // ceremony: a password-change action reachable with only a sameSite=lax
  // cookie is the textbook cross-site target, and an attacker who cannot supply
  // the current one cannot drive it whatever an origin check does.
  if (!row.hash || !(await verifyPassword(opts.current, row.hash))) {
    throw new ChangeRefused("That is not your current password.");
  }
  if (opts.next !== opts.confirm) throw new ChangeRefused("Those two do not match.");
  // The policy refuses with its own type, because password.ts knows nothing
  // about this flow. Translated here so a caller catches ONE thing and renders
  // its message -- two error types at a boundary is how one of them ends up
  // rendered as "something went wrong".
  try {
    validatePassword(opts.next, { email: row.email, current: opts.current });
  } catch (err) {
    throw err instanceof WeakPassword ? new ChangeRefused(err.message) : err;
  }

  const hash = await hashPassword(opts.next);
  return await db.tx(async (db) => {
    await db.run("update auth_passwords set hash = ?, set_at = ? where user_id = ?",
                 hash, formatStamp(), opts.userId);
    await db.run("update app_users set must_change_password = false where id = ?", opts.userId);

    // EVERY session ends, including the one doing this, and a fresh one is
    // minted for the caller to set.
    //
    // The main reason somebody changes a password unprompted is that they think
    // it is known. Leaving their other sessions running answers the new
    // password and ignores the problem -- whoever had the old one stays signed
    // in until the session lapses on its own, which is the same failure the
    // access review exists to prevent.
    //
    // Revoking all and re-minting rather than sparing the current row: sparing
    // it means knowing which row is current, and the caller has the cookie, not
    // the id. One rule is easier to be sure of than one rule with an exception.
    const revoked = await revokeAllForUser(db, opts.userId, opts.userId, "password changed");
    const session = await createSession(db, opts.userId, {});
    return { session, sessionsRevoked: revoked };
  });
}

export class ChangeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeRefused";
  }
}

/**
 * A password somebody has to read off one screen and type into another.
 *
 * No O/0/I/l/1: they are the characters that turn a handover into a support
 * call. Grouped because somebody will read it aloud on a call. Rejection
 * sampling rather than a modulo, so every character is equally likely.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function generatePassword(groups = 5, per = 4): string {
  const out: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let chunk = "";
    while (chunk.length < per) {
      for (const byte of randomBytes(per * 2)) {
        if (byte < 256 - (256 % ALPHABET.length)) chunk += ALPHABET[byte % ALPHABET.length];
        if (chunk.length === per) break;
      }
    }
    out.push(chunk);
  }
  return out.join("-");
}
