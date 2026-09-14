/**
 * Password hashing. The primitive only -- the decision lives in signin.ts.
 *
 * node:crypto's scrypt, and no dependency. Everything else in this repository
 * that could have been a package is not one: the cookie parser, the mail
 * client, the SQL layer, the test runner. A credential hash is the last place
 * to break that habit, because it is the one an auditor reads line by line.
 *
 * Every other secret this application stores is high-entropy and hashed with a
 * plain SHA-256 -- session tokens, the links that used to exist. That is
 * correct for 256 random bits and wrong for a password, which is guessable by
 * construction. This module exists because of that distinction and nothing
 * else.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as
  (pw: string | Buffer, salt: Buffer, len: number, opts: ScryptOpts) => Promise<Buffer>;

type ScryptOpts = { N: number; r: number; p: number; maxmem: number };

/**
 * The cost. Raise LN, never lower it; each hash records what made it.
 *
 * ln=15 is N=32768: 128 * N * r = 33.5 MB and about 55 ms here. It is one notch
 * BELOW the published floor for scrypt, deliberately, and the reason is the
 * memory rather than the time.
 *
 * Every concurrent verify allocates its full working set, on an endpoint that
 * by definition has not authenticated anybody yet. At 128 MB a cheap flood of
 * /signin exhausts the function's memory and takes the whole deployment with
 * it -- the dashboard, the cron tick, the worker -- which is a worse outcome
 * than the offline-cracking risk it would buy against. An invite-only roster of
 * five people behind the throttle in signin.ts is not that threat model. 33 MB
 * is still far above any GPU core's private cache, which is the property scrypt
 * is actually bought for.
 *
 * Revisit with measurements, not with a blog post.
 */
const LN = 15;
const R = 8;
const P = 1;
const DK_BYTES = 32;
const SALT_BYTES = 16;

/**
 * Passed explicitly because Node's default is 32 MB and this job needs 33.5.
 * Omit it and scrypt throws "memory limit exceeded" -- in production, on the
 * first sign-in, having passed every test that used a smaller N.
 *
 * Set well above the current requirement so raising LN by one is a one-line
 * change here and not a debugging session.
 */
const MAXMEM = 128 * 1024 * 1024;

/**
 * The longest plaintext we will hash.
 *
 * scrypt has no bcrypt-style truncation, so it hashes whatever it is handed: a
 * 10 MB string is 10 MB of work, which is a free denial of service on an
 * unauthenticated endpoint. Refused rather than truncated, because silently
 * truncating makes two different passwords the same password.
 */
export const MAX_PASSWORD_BYTES = 200;

/** The shortest we will accept. Length is the only rule -- see validatePassword. */
export const MIN_PASSWORD_CHARS = 12;

/**
 * How many hashes may be in flight at once.
 *
 * Node's default UV_THREADPOOL_SIZE is 4, so beyond four the work queues inside
 * libuv regardless. The difference is that queueing THERE has already allocated
 * the memory. This queues before allocating, so a flood waits instead of
 * exhausting the heap -- and it bounds the damage independently of the cost
 * parameters above.
 */
const MAX_IN_FLIGHT = 4;

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withPermit<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((go) => waiting.push(go));
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

/** The encoded form's parameters, as read back out of a stored hash. */
export type HashParams = { ln: number; r: number; p: number };

/**
 * `$scrypt$ln=15,r=8,p=1$<salt>$<key>`, base64url.
 *
 * Self-describing, so the cost can be raised without invalidating what is
 * already stored: needsRehash below notices, and a sign-in re-hashes in place.
 *
 * The log2 is stored rather than N so a malformed value cannot reach scrypt as
 * a non-power-of-two. Reading "32768" and trusting it is how a parser hands the
 * library something it will reject at the worst moment.
 */
function encode(salt: Buffer, key: Buffer): string {
  return `$scrypt$ln=${LN},r=${R},p=${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

type Decoded = { params: HashParams; salt: Buffer; key: Buffer };

/**
 * Parse, or null. NEVER throws.
 *
 * A throw on one branch and a false on another is an oracle: the caller's error
 * handling differs, its logs differ, and its timing differs, all keyed on
 * whether the account had a usable hash. Every malformed input takes the same
 * path out of here as a wrong password.
 */
function decode(encoded: string): Decoded | null {
  const parts = encoded.split("$");
  // ["", "scrypt", "ln=..,r=..,p=..", salt, key]
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "scrypt") return null;
  const params: Record<string, number> = {};
  for (const pair of parts[2].split(",")) {
    const [k, v] = pair.split("=");
    if (!k || !v || !/^\d+$/.test(v)) return null;
    params[k] = Number(v);
  }
  const { ln, r, p } = params;
  if (!Number.isInteger(ln) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Bounds, not preferences: ln beyond 20 is gigabytes and would be a denial of
  // service against ourselves the moment a stored hash claimed it.
  if (ln < 1 || ln > 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  try {
    const salt = Buffer.from(parts[3], "base64url");
    const key = Buffer.from(parts[4], "base64url");
    if (salt.length === 0 || key.length === 0) return null;
    return { params: { ln, r, p }, salt, key };
  } catch {
    return null;
  }
}

/** The parameters a stored hash was made with, or null if it is not one of ours. */
export function paramsOf(encoded: string): HashParams | null {
  return decode(encoded)?.params ?? null;
}

/** Hash a password for storage. Refuses anything longer than MAX_PASSWORD_BYTES. */
export async function hashPassword(plain: string): Promise<string> {
  assertHashable(plain);
  const salt = randomBytes(SALT_BYTES);
  const key = await withPermit(() =>
    scrypt(plain, salt, DK_BYTES, { N: 2 ** LN, r: R, p: P, maxmem: MAXMEM }));
  return encode(salt, key);
}

/**
 * Does this password match this stored hash?
 *
 * Returns false for a malformed or over-long input rather than throwing -- see
 * decode. The comparison is timingSafeEqual on equal-length buffers, which is
 * the one case it is safe to call it in; a length mismatch means the stored
 * hash was made at a different key length, which decode has already bounded.
 */
export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  verifyCalls += 1;
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) return false;
  const decoded = decode(encoded);
  if (!decoded) return false;
  const { params, salt, key } = decoded;
  let computed: Buffer;
  try {
    computed = await withPermit(() => scrypt(plain, salt, key.length,
      { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: MAXMEM }));
  } catch {
    return false;
  }
  if (computed.length !== key.length) return false;
  return timingSafeEqual(computed, key);
}

/**
 * Was this hash made at a cost we have since raised?
 *
 * A sign-in that returns true re-hashes the password it just verified, so the
 * population upgrades itself one successful sign-in at a time rather than in a
 * migration that cannot see anybody's password.
 */
export function needsRehash(encoded: string): boolean {
  const params = paramsOf(encoded);
  if (!params) return true;
  return params.ln !== LN || params.r !== R || params.p !== P;
}

/**
 * A hash of nothing anybody knows, used when the account does not exist.
 *
 * signin.ts verifies against this rather than returning early, so an unknown
 * address costs exactly what a known one does. Without it the sign-in form is a
 * roster oracle with a stopwatch for a probe.
 *
 * Hard-coded rather than computed at import: generating it would spend the full
 * cost on every cold start, on every instance, to produce a value that is not
 * secret. The salt being fixed and public costs nothing -- there is no password
 * here to protect, only work to spend.
 *
 * It MUST carry the current parameters, or the decoy is cheaper than a real
 * verify and the oracle reopens. A test asserts that, so raising LN fails the
 * build rather than the property.
 */
export const DUMMY_HASH =
  "$scrypt$ln=15,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$mcQiT0oXEwdPeTQNBg1KninXDQDKngNwMNBk-NE1Mkc";

/**
 * How many times verifyPassword has been called, ever, in this process.
 *
 * Instrumentation, and it exists for one test. The property signin.ts depends
 * on is that EVERY well-formed attempt costs one scrypt -- an unknown address,
 * a deactivated account, one with no password yet, a throttled one. The
 * obvious way to check that is a stopwatch, and the refusal floor in signin.ts
 * deliberately makes the stopwatch useless: every refusal is padded to the same
 * wall clock, which is the whole point of it.
 *
 * So the count is the only honest way to assert it from a test. A live binding,
 * read across the module boundary; costs a number in production.
 */
export let verifyCalls = 0;

export class WeakPassword extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPassword";
  }
}

function assertHashable(plain: string): void {
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) {
    throw new WeakPassword(`A password may not be longer than ${MAX_PASSWORD_BYTES} bytes.`);
  }
}

/**
 * The policy, in one place, thrown as one error type.
 *
 * Length and nothing else, per NIST SP 800-63B: composition rules ("one capital,
 * one digit") measurably push people towards Passw0rd! and buy nothing. The
 * refusals that remain are the ones that describe a password which is not a
 * secret at all -- the user's own address, or a repeat of what it replaces.
 */
export function validatePassword(
  plain: string, opts: { email?: string; current?: string } = {},
): void {
  if (plain.length < MIN_PASSWORD_CHARS) {
    throw new WeakPassword(`A password must be at least ${MIN_PASSWORD_CHARS} characters.`);
  }
  assertHashable(plain);
  if (opts.email && plain.trim().toLowerCase() === opts.email.trim().toLowerCase()) {
    throw new WeakPassword("A password cannot be your email address.");
  }
  if (opts.current && plain === opts.current) {
    throw new WeakPassword("That is the password you are replacing.");
  }
}
