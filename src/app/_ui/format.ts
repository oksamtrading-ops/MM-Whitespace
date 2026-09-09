/* Display formatting. Server-rendered only, so no hydration drift. */

const DATE = new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric" });

/**
 * Stored stamps are UTC instants written as "2026-09-09 13:14:35", with no
 * zone on them. Parsing that string directly reads it as LOCAL time, which
 * puts every stamp hours into the future west of Greenwich -- the access
 * review showed everyone who had just signed in as "-1d ago". A bare date is
 * a calendar date, not an instant, and stays local midnight.
 */
export function parseStamp(stamp: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return new Date(`${stamp}T00:00:00`);
  const iso = stamp.includes("T") ? stamp : stamp.replace(" ", "T");
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso.slice(10)) ? iso : `${iso}Z`);
}

/** "2026-09-09 14:32:00" or ISO → "Sep 9, 2026". */
export function fmtDate(stamp: string): string {
  const d = parseStamp(stamp);
  return Number.isNaN(d.getTime()) ? stamp.slice(0, 10) : DATE.format(d);
}

/** Whole days since a stamp. Never negative: a clock skew is not a time machine. */
export function daysSince(stamp: string, now: number = Date.now()): number {
  const t = parseStamp(stamp).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** 0 → "today", 1 → "yesterday", 12 → "12d ago". */
export function agoLabel(days: number): string {
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-CA").format(n);
}

/** "Q3-2026 (2026-05-31)" → { name: "Q3 2026", asOf: "2026-05-31" | null }. */
export function periodName(label: string): { name: string; asOf: string | null } {
  const m = label.match(/^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
  const raw = (m ? m[1] : label).trim();
  return { name: raw.replace(/^(Q[1-4])-(\d{4})$/, "$1 $2"), asOf: m ? m[2] : null };
}

/** 200000000 → "200M"; 1500000 → "1.5M"; 950000 → "950K". */
export function fmtCompact(n: number): string {
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(n);
}
function trim(x: number): string { return (Math.round(x * 10) / 10).toString(); }
