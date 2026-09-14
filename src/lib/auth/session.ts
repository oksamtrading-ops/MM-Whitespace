/**
 * Authorisation.
 *
 * MIDDLEWARE IS NOT AN AUTHORISATION BOUNDARY. Next.js middleware has a
 * documented bypass class, and every Server Action compiles to an addressable
 * endpoint whether or not the control that calls it ever renders -- so a Viewer
 * who can sign in could call publish. Middleware here does redirects and
 * nothing else; the real check is `assertRole` at the top of every route
 * handler and server action, and a lint rule fails the build when one is
 * missing.
 *
 * PORTABILITY. Authorisation never reads the identity provider's user table.
 * It reads ONE claim -- the email -- and resolves it against the application's
 * own `app_users`. Swapping providers changes the claim source and nothing
 * else, which is what makes the eventual move to Deloitte SSO a configuration
 * change rather than a rewrite.
 *
 * See docs/design/11-security-privacy-compliance.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { SESSION_COOKIE, userForSession } from "./sessions.ts";

export type Role = "admin" | "analyst" | "viewer";

export const ROLE_RANK: Record<Role, number> = { viewer: 1, analyst: 2, admin: 3 };

export type AppUser = {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
};

export class Unauthenticated extends Error {
  constructor(reason: string) {
    super(`not signed in: ${reason}`);
    this.name = "Unauthenticated";
  }
}

export class Forbidden extends Error {
  required: Role[];
  actual: Role | null;
  constructor(required: Role[], actual: Role | null) {
    super(`requires ${required.join(" or ")}; caller is ${actual ?? "unauthenticated"}`);
    this.name = "Forbidden";
    this.required = required;
    this.actual = actual;
  }
}

/**
 * The single seam a provider plugs into. It returns ONE claim and nothing else,
 * which is the whole portability argument: a provider cannot leak its own user
 * model into authorisation because there is nowhere for it to go.
 */
export type ClaimSource = {
  name: string;
  /** The verified email claim, or null when there is no valid session. */
  emailClaim(cookieHeader: string | null): Promise<string | null> | string | null;
};

const DEV_COOKIE = "mm_dev_session";

/**
 * Development claim source: an HMAC-signed cookie.
 *
 * This is NOT magic-link authentication and is not a production provider. It
 * exists so the application can be run and tested before a Supabase project
 * exists. It refuses to operate outside development, so it cannot be reached
 * accidentally in a deployed environment.
 */
export function devClaimSource(secret: string | undefined = process.env.MM_DEV_AUTH_SECRET):
    ClaimSource {
  return {
    name: "dev-signed-cookie",
    emailClaim(cookieHeader) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "the development claim source refuses to run in production. Configure a real " +
          "identity provider (magic link, then Deloitte SSO) before deploying.",
        );
      }
      if (!secret) return null;
      const raw = readCookie(cookieHeader, DEV_COOKIE);
      if (!raw) return null;
      const at = raw.lastIndexOf(".");
      if (at <= 0) return null;
      const email = raw.slice(0, at);
      const signature = raw.slice(at + 1);
      const expected = sign(email, secret);
      if (!constantTimeEquals(signature, expected)) return null;
      return email;
    },
  };
}

/**
 * The pilot's claim source: a session cookie backed by a row.
 *
 * It returns the email and nothing else, which is the whole portability
 * argument -- assertRole resolves that against `app_users` and never learns
 * where the claim came from. Deloitte SSO replaces this function and changes
 * nothing else in the application.
 *
 * The second lookup assertRole then performs is deliberate. Returning the user
 * from here would be one query cheaper and would put a provider's idea of a
 * user into authorisation, which is exactly the coupling section 5 exists to
 * prevent.
 */
export function sessionClaimSource(db: Sql): ClaimSource {
  return {
    name: "magic-link-session",
    async emailClaim(cookieHeader) {
      const token = readCookie(cookieHeader, SESSION_COOKIE);
      if (!token) return null;
      const user = await userForSession(db, token);
      return user?.email ?? null;
    },
  };
}

/**
 * Try each source in turn and take the first claim.
 *
 * This exists for ONE caller: the end-to-end suite, which drives the real
 * magic-link route in one journey and mints dev sessions for the other four,
 * because doc 13 refuses to make every run depend on an inbox. It is selected
 * by the explicit value MM_AUTH=session+dev and never by default, so a
 * deployed instance cannot fall into it -- and the dev source it composes
 * refuses to run in production on its own account regardless.
 */
export function firstOf(...sources: ClaimSource[]): ClaimSource {
  return {
    name: sources.map((s) => s.name).join("+"),
    async emailClaim(cookieHeader) {
      for (const source of sources) {
        const claim = await source.emailClaim(cookieHeader);
        if (claim) return claim;
      }
      return null;
    },
  };
}

export function signDevSession(email: string, secret: string): string {
  return `${email}.${sign(email, secret)}`;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Compare a fixed-width digest of each side so differing lengths do not leak
  // through an early return, and never throw on a length mismatch.
  const ha = createHmac("sha256", "cmp").update(ab).digest();
  const hb = createHmac("sha256", "cmp").update(bb).digest();
  return timingSafeEqual(ha, hb);
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Resolve the claim against the APPLICATION's user table.
 *
 * Invite-only: an email with no row is not a user, whatever the provider says.
 * A deactivated row is not a user either -- there is no leaver process for an
 * application outside Deloitte's own estate, so deactivation is the only thing
 * standing between a partner who rolls off and the client roster.
 */
export async function resolveUser(db: Sql, email: string | null): Promise<AppUser | null> {
  if (!email) return null;
  const row = await db.get("select id, email, role, is_active from app_users where lower(email) = lower(?)", email) as { id: string; email: string; role: Role; is_active: number } | undefined;
  if (!row) return null;
  if (!row.is_active) return null;
  return { id: row.id, email: row.email, role: row.role, isActive: true };
}

/**
 * Does this address's domain pass? The comparison only -- see allowedDomains
 * for where the list comes from.
 *
 * The authority is the database: migration 0024 puts the same rule in a
 * trigger on app_users, so an address that does not pass cannot be given an
 * account by any route, including a hand-written insert. This function is the
 * interface's copy of that rule, and it exists to refuse early and say
 * something useful rather than to be the gate. Until 0024 the comment here
 * claimed the database was already doing it, which it was not.
 */
export function isAllowedDomain(email: string, allowed: readonly string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.some((d) => domain === d.toLowerCase());
}

/**
 * The one list, read from the one place that holds it.
 *
 * Two route files each parsed MM_ALLOWED_DOMAINS into their own constant, with
 * their own copy of the default -- two copies of one fact, which is how the
 * two ever come to disagree. The setting is the source now, so the interface
 * and the trigger cannot drift apart, and an Admin can change both at once on
 * /settings instead of through a redeployment.
 *
 * The environment remains the fallback for a database that has not had 0024:
 * failing closed here would refuse every sign-in, including the Admin's, with
 * no way in to fix it. The trigger fails closed instead, where the worst case
 * is that nobody new can be invited for as long as it takes to set one value.
 */
export async function allowedDomains(database: Sql): Promise<string[]> {
  const fromEnv = (process.env.MM_ALLOWED_DOMAINS ?? "deloitte.ca,example.invalid")
    .split(",").map((d) => d.trim()).filter(Boolean);
  const row = await database.get(
    "select value from app_settings where key = 'allowed_email_domains'")
      .catch(() => null) as { value: string } | null;
  const configured = (row?.value ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  return configured.length > 0 ? configured : fromEnv;
}

export function hasRole(user: AppUser | null, required: readonly Role[]): boolean {
  if (!user) return false;
  return required.includes(user.role);
}

/**
 * THE authorisation check. Every route handler and every server action calls
 * this as its first statement; `npm run check:auth` fails the build otherwise.
 */
export async function assertRole(
  ctx: { db: Sql; claims: ClaimSource; cookieHeader: string | null },
  required: readonly Role[],
): Promise<AppUser> {
  const email = await ctx.claims.emailClaim(ctx.cookieHeader);
  if (!email) throw new Unauthenticated("no verified email claim");
  const user = await resolveUser(ctx.db, email);
  if (!user) throw new Unauthenticated("no active application user for that claim");
  if (!hasRole(user, required)) throw new Forbidden([...required], user.role);
  return user;
}

/**
 * The cron endpoint is publicly addressable, so the secret is compared in
 * constant time, a MISSING header is rejected rather than allowed, and an unset
 * server secret fails closed rather than open.
 *
 * Because the tick does no work itself, a leaked secret only causes a no-op
 * invocation.
 */
export function authoriseCron(
  authorizationHeader: string | null,
  secret: string | undefined = process.env.MM_CRON_SECRET,
): { ok: true } | { ok: false; reason: string } {
  if (!secret) {
    return { ok: false, reason: "MM_CRON_SECRET is not set; failing closed" };
  }
  if (!authorizationHeader) {
    // Rejecting on absence, rather than allowing when unset, is the difference
    // between a closed door and an open one.
    return { ok: false, reason: "missing Authorization header" };
  }
  const presented = authorizationHeader.replace(/^Bearer\s+/i, "");
  if (!constantTimeEquals(presented, secret)) {
    return { ok: false, reason: "bad token" };
  }
  return { ok: true };
}
