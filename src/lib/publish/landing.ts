/**
 * The figures the landing page states about the tool, all from what is
 * published -- never from a draft, because the page speaks for the tool every
 * reader sees.
 *
 *   - Last updated: the newest published revision of any period.
 *   - As of: the newest published period's market-cap date.
 *   - Listed: how many mining issuers TSX's list for that period named, both
 *     exchanges together (migration 0044). Null for a period made from the
 *     practice's workbook, which never held the whole list.
 *   - Companies: how many the period's newest revision published.
 *   - The line: the threshold that revision was published at (migration 0037),
 *     not the period's, which can since have moved.
 */
import type { Sql } from "../db/sql.ts";
import { formatMoney } from "../format/fields.ts";

export type AboutTheTool = {
  lastUpdated: string;
  asOf: string;
  listedIssuers: number | null;
  companies: number;
  threshold: { amount: number; operator: "gt" | "gte"; currency: string };
};

/** Null until something has been published: there is nothing to state yet. */
export async function aboutTheTool(db: Sql): Promise<AboutTheTool | null> {
  const p = await db.get(
    `select p.market_cap_as_of, p.listed_issuers, pp.id as publication_id,
            coalesce(pp.threshold_amount, p.threshold_amount) as threshold_amount,
            coalesce(pp.threshold_operator, p.threshold_operator) as threshold_operator,
            coalesce(pp.threshold_currency, p.threshold_currency) as threshold_currency
       from periods p join period_publications pp on pp.period_id = p.id
      where pp.revision = (select max(revision) from period_publications x where x.period_id = p.id)
      order by p.market_cap_as_of desc limit 1`) as {
    market_cap_as_of: string; listed_issuers: number | null; publication_id: string;
    threshold_amount: number; threshold_operator: string; threshold_currency: string;
  } | undefined;
  if (!p) return null;
  const n = await db.get("select count(*) as n from published_period_tiers where publication_id = ?",
    p.publication_id) as { n: number };
  const last = await db.get("select max(published_at) as at from period_publications") as { at: string };
  return {
    lastUpdated: String(last.at),
    asOf: String(p.market_cap_as_of).slice(0, 10),
    listedIssuers: p.listed_issuers === null ? null : Number(p.listed_issuers),
    companies: Number(n.n),
    threshold: { amount: Number(p.threshold_amount), operator: p.threshold_operator === "gt" ? "gt" : "gte",
                 currency: p.threshold_currency },
  };
}

/**
 * "MM.YYYY", the practice's own way of dating the tool. An instant is read in
 * Toronto, where the practice is: a revision published at 9 p.m. on 31 October
 * is October's. A bare date is a calendar date and is taken as written.
 */
export function monthYear(stamp: string): string {
  const s = String(stamp);
  const bare = s.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (bare) return `${bare[2]}.${bare[1]}`;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso.slice(10)) ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(5, 7) + "." + s.slice(0, 4);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit" })
    .formatToParts(d);
  const part = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${part("month")}.${part("year")}`;
}

/**
 * "in excess of C$100M" or "of C$100M or more". The practice's draft said "in
 * excess of", which is the "gt" line; the tool's line has been "at or above"
 * since Decision 9, and a company at exactly C$100M is in it.
 */
export function thresholdWords(t: AboutTheTool["threshold"]): string {
  const money = formatMoney(t.amount, t.currency, { compact: true });
  return t.operator === "gt" ? `in excess of ${money}` : `of ${money} or more`;
}
