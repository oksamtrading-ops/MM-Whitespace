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
