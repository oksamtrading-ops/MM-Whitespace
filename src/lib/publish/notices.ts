/**
 * Licence notices for any printable dashboard view (docs/design/10 and 11).
 *
 * The wording is the same as mmparser/export.py, where it originates; the test
 * beside this file holds the two in step so neither can drift. As there: the
 * verbatim notice each licence requires has not yet been confirmed against
 * the terms, and should be before this leaves the practice.
 */
export const EXCHANGE_NOTICE =
  "Exchange-derived columns in this file originate from a TSX Group Inc. issuer " +
  "extract and are provided for internal use only. Not for redistribution.";

export const VENDOR_NOTICE =
  "Screener-derived columns, where present, originate from a Refinitiv/LSEG " +
  "extract and are provided for internal use only. Not for redistribution.";

export const INTERNAL_USE = "INTERNAL USE ONLY - contains licensed third-party data.";

/**
 * How the researched values were produced, shown on the landing page, the
 * company table and profile, the dashboard, and both exports.
 *
 * Deliberately generic. It names no AI tool or vendor, because more than one
 * may be used and the engine is under discussion; the test beside this file
 * refuses a tool's name here and in the export. It also claims nothing the
 * product does not do: every researched value passes a person in review
 * before it is published, and carries the source it came from.
 */
export const AI_NOTICE =
  "Some of the information in this tool is researched with the help of artificial " +
  "intelligence. A person reviews every researched value before it is published, and " +
  "each one shows the source it came from. It can still be incomplete or wrong, so " +
  "check the source before you rely on it.";
