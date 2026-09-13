/**
 * Which source outranks which, where the arithmetic is not enough.
 *
 * Nothing here touches the network, the database or the filesystem, so both
 * the research pipeline and the review screens can import it without dragging
 * the fetch stack behind them.
 */

/**
 * The fields SEC EDGAR answers from the registrant's PROFILE rather than from
 * a filing, and which the issuer's own filing therefore outranks.
 *
 * A submissions record mixes two kinds of fact. Whether a company files, and
 * under what form, is a fact about the record itself and is current by
 * construction. The address and the fiscal year-end are attributes the filer
 * maintains on its profile, and they go stale while the filings stay current:
 * in Run 2 EDGAR put First Quantum in Vancouver against its own AIF's Toronto,
 * Lundin in Toronto against its circular's Vancouver, and gave First Quantum a
 * 30 November year-end against its circular's 31 December. All three reached
 * review because the profile was scored at tier 1 and the filing at tier 2.
 *
 * So a profile attribute is quoted exactly and scored as a secondary source --
 * high enough to show, below the line for bulk accept -- and for these fields
 * the review queue prefers the better source outright, whatever the score.
 */
export const EDGAR_PROFILE_FIELDS: ReadonlySet<string> = new Set([
  "fiscal_year_end", "head_office_location", "head_office_region",
]);
