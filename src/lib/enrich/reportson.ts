/**
 * The latest fiscal year a document says it reports on.
 *
 * Review's "Newer research" tab offers a finding as a correction when it was
 * CREATED after the accept it disagrees with. Creation is when the model read
 * the document, not when the document was written. On 13 October 2026 a
 * re-run fetched China Gold's 2022 circular ("Deloitte Touche Tohmatsu was first
 * appointed as auditors of the Company on April 1, 2010") and its "no change,
 * auditor since 2010" was offered as a correction to values accepted from the
 * 2026 circular. They were taken, and published in revisions 10 and 11.
 *
 * What a filing reports on is stated in it, and stated the same way across
 * every kind of document stored here: the period it covers ends on a date.
 * "For the year ended December 31, 2025", "three months ended September 30,
 * 2025", "year ended 30 June 2025", "l'exercice clos le 31 décembre 2025". The
 * latest such year is the fiscal year the document reports on. Measured on the
 * 320 documents stored by October 2026: China Gold's stale circular reads 2021
 * and the accepted one 2025; of the 21 times an accepted value was researched
 * again with a different answer, those two were the only ones from an older
 * document. docs/decisions/NEWER-RESEARCH-FROM-OLDER-FILINGS.md has the rest.
 *
 * Not the latest date of any kind: forward-looking dates ("by December 31,
 * 2027") are common and would make a stale document look new. "Ended" is past
 * tense on purpose, and a year after the day the document was fetched cannot
 * be one it reports on.
 */

import type { Sql } from "../db/sql.ts";

/** Bump when the reading changes, so stored years can be read again. */
export const REPORTS_ON_VERSION = "1";

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const MOIS = "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";

/** The period that ended: a year, a quarter, a number of months, a period. */
const PERIOD = String.raw`(?:fiscal\s+|financial\s+)?(?:years?|periods?|quarters?|(?:three|six|nine|twelve|\d{1,2})[\s-]+months?)`;

const MONTH_INDEX: Record<string, number> = Object.fromEntries([
  ..."january february march april may june july august september october november december".split(" ")
    .map((m, i) => [m, i] as const),
  ...[["janvier", 0], ["fevrier", 1], ["février", 1], ["mars", 2], ["avril", 3], ["mai", 4], ["juin", 5],
      ["juillet", 6], ["aout", 7], ["août", 7], ["aoút", 7], ["septembre", 8], ["octobre", 9],
      ["novembre", 10], ["decembre", 11], ["décembre", 11]] as Array<[string, number]>,
]);

/** Each names the day, month and year the period ended. */
const PATTERNS: readonly RegExp[] = [
  // "year ended December 31, 2025", "years ended December 31st 2025"
  new RegExp(String.raw`\b${PERIOD}\s+ended\s+(?<m>${MONTHS})\s+(?<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<y>20\d\d)\b`, "gi"),
  // "year ended 30 June 2025": Australia, Hong Kong, the UK
  new RegExp(String.raw`\b${PERIOD}\s+ended\s+(?<d>\d{1,2})(?:st|nd|rd|th)?\s+(?<m>${MONTHS}),?\s+(?<y>20\d\d)\b`, "gi"),
  // "l'exercice clos le 31 décembre 2025", "exercices terminés le 31 mars 2025"
  new RegExp(String.raw`\b(?:exercices?|p[ée]riodes?)\s+(?:financiers?\s+)?(?:clos|termin[ée]e?s?)\s+le\s+(?<d>\d{1,2})(?:er)?\s+(?<m>${MOIS})\s+(?<y>20\d\d)\b`, "gi"),
];

/**
 * When the document was read, from either engine's shape: a Date, SQLite's
 * "2026-10-13 10:00:00", or Postgres's "2026-10-13 10:00:00.123+00". null when
 * unreadable, which leaves the reading unbounded rather than wrong.
 */
function instant(v: string | Date | null): number | null {
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  let s = String(v).trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  if (!/(Z|[+-]\d\d:\d\d)$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * The latest fiscal year the text reports on, or null when it never says.
 * `fetchedAt` bounds it: a period that had not ended when the document was
 * read is not one it reports on, whatever its tense.
 */
export function reportsOn(text: string | null | undefined, fetchedAt: string | Date | null = null): number | null {
  if (!text) return null;
  const read = instant(fetchedAt);
  let latest: number | null = null;
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const { d, m: month, y } = m.groups as { d: string; m: string; y: string };
      const year = Number(y);
      const ended = Date.UTC(year, MONTH_INDEX[month.toLowerCase()] ?? 0, Number(d));
      if (read !== null && ended > read) continue;
      if (latest === null || year > latest) latest = year;
    }
  }
  return latest;
}

/**
 * Read the year for every stored document this version has not read yet:
 * those stored before migration 0035, and all of them again after a bump.
 * A page at a time, by hash, so a few hundred long filings are never all held
 * at once. Safe to run twice; the second run reads nothing.
 */
export async function backfillReportsOn(db: Sql, pageSize = 25): Promise<{ read: number; dated: number }> {
  let read = 0;
  let dated = 0;
  let after = "";
  for (;;) {
    const page = await db.all(`select content_hash, retrieved_at, text_content from documents
        where (reports_on_version is null or reports_on_version <> ?) and content_hash > ?
        order by content_hash limit ?`, REPORTS_ON_VERSION, after, pageSize) as
      Array<{ content_hash: string; retrieved_at: string | null; text_content: string | null }>;
    if (page.length === 0) return { read, dated };
    for (const d of page) {
      const year = reportsOn(d.text_content, d.retrieved_at);
      await db.run("update documents set reports_on = ?, reports_on_version = ? where content_hash = ?",
                   year, REPORTS_ON_VERSION, d.content_hash);
      read++;
      if (year !== null) dated++;
    }
    after = page[page.length - 1].content_hash;
  }
}
