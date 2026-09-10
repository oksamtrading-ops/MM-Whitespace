/**
 * Magic-link issue and redemption.
 *
 * Doc 11: "Magic link only for the pilot; no passwords. That removes
 * credential stuffing, password reuse and reset flows in one decision."
 *
 * Three properties do the work here, and each is a decision rather than a
 * detail:
 *
 * THE DATABASE NEVER HOLDS A USABLE LINK. What is stored is the SHA-256 of the
 * token. A backup, a support export or a leaked replica contains no credential,
 * and redemption is a lookup by hash rather than a comparison of secrets.
 *
 * REQUESTING A LINK REVEALS NOTHING. `issueLink` writes a row and returns a
 * token for an address it has never heard of, exactly as it does for a partner
 * on the roster. Whether the mail is sent is decided by the caller, after the
 * roster check, and the answer the form gives is the same either way. A sign-in
 * form that says "no such user" is a way to enumerate a client roster.
 *
 * ONE USE, AND A SHORT WINDOW. The link lands in a mailbox, may be forwarded,
 * scanned by a security appliance, or sit in a backup. Fifteen minutes and a
 * consumed_at stamp bound what a copy is worth.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";

/** Long enough that guessing is not a strategy: 256 bits, url-safe. */
const TOKEN_BYTES = 32;

export const LINK_TTL_SECONDS = Number(process.env.MM_LINK_TTL_SECONDS ?? 15 * 60);

/**
 * How many live links one address may hold. Not a defence against a determined
 * attacker -- it is what stops a typo'd address, or someone clicking twice,
 * from turning the sign-in form into a way to mail-bomb a colleague.
 */
export const MAX_LIVE_LINKS = Number(process.env.MM_LINK_MAX_LIVE ?? 5);

export class TooManyLinks extends Error {
  constructor(email: string) {
    super(`too many unused sign-in links outstanding for ${email}`);
    this.name = "TooManyLinks";
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function stampIn(seconds: number): string {
  return formatStamp(Date.now() + seconds * 1000);
}

export type IssuedLink = { token: string; expiresAt: string };

/**
 * Write a link for this address, whoever it belongs to.
 *
 * The caller decides whether to send it. Keeping that decision out of here is
 * what makes the not-enumerable property testable: this function's behaviour
 * does not depend on the roster at all.
 */
export async function issueLink(
  db: Sql, email: string, meta: { ip?: string | null; ua?: string | null } = {},
): Promise<IssuedLink> {
  const live = await db.get(
    `select count(*) n from auth_magic_links
      where lower(email) = lower(?) and consumed_at is null and expires_at > ?`,
    email, formatStamp()) as { n: number };
  if (Number(live.n) >= MAX_LIVE_LINKS) throw new TooManyLinks(email);

  const token = newToken();
  const expiresAt = stampIn(LINK_TTL_SECONDS);
  await db.run(
    `insert into auth_magic_links (email, token_hash, expires_at, requested_ip, requested_ua)
     values (?, ?, ?, ?, ?)`,
    email, hashToken(token), expiresAt, meta.ip ?? null, (meta.ua ?? null)?.slice(0, 400) ?? null);
  return { token, expiresAt };
}

export type Redemption =
  | { ok: true; email: string }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/**
 * Redeem a token, once.
 *
 * The failure reasons are distinguished for the audit log and NOT for the
 * person holding the link -- every one of them renders as the same sentence.
 * "Expired" tells someone with a stolen link that they had the right token and
 * only missed the window, which is a different invitation to try again.
 */
export async function consumeLink(db: Sql, token: string): Promise<Redemption> {
  if (!token) return { ok: false, reason: "unknown" };
  const now = formatStamp();
  const row = await db.get(
    "select id, email, expires_at, consumed_at from auth_magic_links where token_hash = ?",
    hashToken(token)) as
    { id: string; email: string; expires_at: string; consumed_at: string | null } | undefined;
  if (!row) return { ok: false, reason: "unknown" };
  if (row.consumed_at) return { ok: false, reason: "used" };
  if (row.expires_at <= now) return { ok: false, reason: "expired" };

  // Single use is enforced by the WHERE, not by the read above: two clicks
  // arriving together both pass the check and only one updates a row.
  const claimed = await db.run(
    "update auth_magic_links set consumed_at = ? where id = ? and consumed_at is null",
    now, row.id);
  if (claimed.changes !== 1) return { ok: false, reason: "used" };
  return { ok: true, email: row.email };
}

/** Consumed and expired links are evidence for a while, then they are litter. */
export async function purgeExpiredLinks(db: Sql, olderThanDays = 30): Promise<number> {
  const cutoff = formatStamp(Date.now() - olderThanDays * 86_400_000);
  const r = await db.run("delete from auth_magic_links where expires_at < ?", cutoff);
  return r.changes;
}
