/**
 * A timestamp that orders decisions.
 *
 * `current_timestamp` cannot do this job. On SQLite it has one-second
 * resolution, so an accept and the override that follows it share a value; on
 * Postgres it is worse than that -- it is the TRANSACTION's start time, so
 * every row written in one transaction is identical by construction. Either
 * way the audit trail loses the order it was written in, and undo walks back
 * an arbitrary decision rather than the last one.
 *
 * SQLite's `rowid` used to break the tie. Postgres has no such column, so the
 * order has to live in the value: microsecond resolution, and a clamp so this
 * process never issues the same stamp twice even when the clock does not move
 * between two calls. Across processes the resolution does the work.
 *
 * The format is fixed-width UTC, which sorts identically as Postgres
 * `timestamptz` and as SQLite text.
 */
/**
 * A timestamp, formatted. No clamp, no state.
 *
 * This is what to use for any moment that is not "now, in order": an expiry, a
 * cutoff, a comparison against a stored value. Handing a future time to
 * decisionStamp() below would advance its high-water mark to that future, and
 * every later "now" would be clamped past it -- which is a link that expires
 * the instant it is issued.
 */
export function formatStamp(at: number = Date.now()): string {
  const iso = new Date(at).toISOString();            // YYYY-MM-DDTHH:MM:SS.sssZ
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000`;
}

let last = "";

/** Now, and strictly after the last one this process issued. Ordering only. */
export function decisionStamp(now: number = Date.now()): string {
  let stamp = formatStamp(now);
  if (stamp <= last) {
    // Same millisecond as the previous call: step the microseconds rather than
    // hand back a value that ties.
    const micros = (Number(last.slice(-6)) + 1).toString().padStart(6, "0");
    stamp = micros.length > 6
      ? last.slice(0, -6) + "999999"
      : last.slice(0, -6) + micros;
  }
  last = stamp;
  return stamp;
}
