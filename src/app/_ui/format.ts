/* Display formatting. Server-rendered only, so no hydration drift. */

const DATE = new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric" });

/** "2026-09-09 14:32:00" or ISO → "Sept 9, 2026". */
export function fmtDate(stamp: string): string {
  const d = new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T") + (stamp.length <= 10 ? "T00:00:00" : ""));
  return Number.isNaN(d.getTime()) ? stamp.slice(0, 10) : DATE.format(d);
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-CA").format(n);
}
