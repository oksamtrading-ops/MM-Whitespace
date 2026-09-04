/**
 * The prompt boundary.
 *
 * A rule saying "never put an internal field in a prompt" fails the first time
 * someone serialises a whole company object into a template. Three independent
 * mechanisms, of which this file is two:
 *
 *   1. A type boundary. buildPrompt accepts only PublicCompanyRow. There is no
 *      code path from an internal-bearing type to the model client.
 *   3. A pre-flight egress scan in the single client module: before the request
 *      goes out, assert the serialised body contains none of the restricted
 *      field keys, labels, or restricted company names.
 *
 * The second mechanism is a revoked column privilege in the database and lives
 * in supabase/migrations/0003. Of the three, only the contract test on this one
 * will still be true in six months, which is why it exists.
 *
 * This build stores no Deloitte client information, so the restricted set is
 * currently the Deloitte market alone. The mechanism is kept whole regardless:
 * it is what a later due-diligence review has to be able to inspect.
 */

export const PROMPT_VERSION = "2026-09-04.1";

/** The ONLY shape the prompt builder accepts. Internal fields cannot be named here. */
export type PublicCompanyRow = {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly rootTicker: string;
  readonly exchange: string;
  readonly interlistedVenues: readonly string[];
  readonly headOfficeLocation: string | null;
  readonly headOfficeRegion: string | null;
  readonly knownRegions: Readonly<Record<string, readonly string[]>>;
  readonly knownCommodities: readonly string[];
  readonly knownWebsite: string | null;
  readonly periodAsOf: string;
};

/** Anything wider than PublicCompanyRow. Never passed to buildPrompt. */
export type InternalCompanyRow = PublicCompanyRow & {
  readonly dttMarket?: string | null;
  readonly comments?: string | null;
  readonly pursuit?: unknown;
};

/**
 * The only constructor. Named fields are copied one by one -- never a spread --
 * so a new internal column added upstream cannot ride along by default.
 */
export function toPublicRow(row: InternalCompanyRow): PublicCompanyRow {
  return {
    companyId: row.companyId,
    canonicalName: row.canonicalName,
    aliases: [...row.aliases],
    rootTicker: row.rootTicker,
    exchange: row.exchange,
    interlistedVenues: [...row.interlistedVenues],
    headOfficeLocation: row.headOfficeLocation,
    headOfficeRegion: row.headOfficeRegion,
    knownRegions: row.knownRegions,
    knownCommodities: [...row.knownCommodities],
    knownWebsite: row.knownWebsite,
    periodAsOf: row.periodAsOf,
  };
}

export type Route = "discovery" | "extract_general" | "extract_fees" | "adjudication";

/**
 * Four route prefixes, never one branching prefix. A conditional system section
 * invalidates the cache for every company after the first that takes the other
 * branch.
 */
const ROUTE_PREFIX: Record<Route, string> = {
  discovery:
    "You locate primary sources about a listed mining issuer. Return candidate " +
    "documents only. Do not state facts about the company; another step extracts them.",
  extract_general:
    "You extract specific fields from documents supplied to you. If the document " +
    "does not state a value, abstain and say so. Abstention is a correct answer.",
  extract_fees:
    "You extract audit and tax fee disclosures from the document supplied. Quote " +
    "the figure exactly as printed, and state separately whether the table is " +
    "expressed in units, thousands or millions. Abstain if the document is silent.",
  adjudication:
    "Two sources disagree. Weigh them and state which is better evidence and why. " +
    "You have no tools and must reason only from the text supplied.",
};

export type CompiledPrompt = {
  route: Route;
  promptVersion: string;
  /** Byte-identical across companies on a route. The cacheable prefix. */
  stablePrefix: string;
  /** Per-company. Never merged into the prefix. */
  userContent: string;
};

export function buildPrompt(route: Route, row: PublicCompanyRow): CompiledPrompt {
  // Deterministic serialisation: an object assembled from an unordered query
  // result is the most likely accidental cache invalidator in this codebase.
  const regions = Object.keys(row.knownRegions).sort()
    .map((k) => `${k}: ${[...row.knownRegions[k]].sort().join(", ") || "(none)"}`)
    .join("\n  ");

  const userContent = [
    `Company: ${row.canonicalName}`,
    row.aliases.length ? `Also known as: ${[...row.aliases].sort().join("; ")}` : null,
    `Ticker: ${row.rootTicker} (${row.exchange})`,
    row.interlistedVenues.length
      ? `Also listed: ${[...row.interlistedVenues].sort().join(", ")}` : null,
    row.headOfficeLocation
      ? `Head office: ${row.headOfficeLocation}${row.headOfficeRegion ? `, ${row.headOfficeRegion}` : ""}`
      : null,
    `Known property regions:\n  ${regions}`,
    row.knownCommodities.length
      ? `Known commodities: ${[...row.knownCommodities].sort().join(", ")}` : null,
    row.knownWebsite ? `Known website: ${row.knownWebsite}` : null,
    `Period as of: ${row.periodAsOf}`,
  ].filter(Boolean).join("\n");

  return { route, promptVersion: PROMPT_VERSION, stablePrefix: ROUTE_PREFIX[route], userContent };
}

export class EgressViolation extends Error {
  term: string;
  where: string;
  constructor(term: string, where: string) {
    super(`prompt egress scan: restricted term "${term}" found in ${where}. Request not sent.`);
    this.name = "EgressViolation";
    this.term = term;
    this.where = where;
  }
}

export type RestrictionSet = {
  /** field_catalog keys and labels classified deloitte_internal. */
  readonly terms: readonly string[];
  /** Names of companies whose client relationship is recorded. Empty in the POC. */
  readonly restrictedCompanyNames: readonly string[];
};

/**
 * Runs on the serialised request body, in the one module that talks to the
 * vendor. A hit throws and dead-letters the job; it never redacts and sends.
 */
export function egressScan(body: unknown, restrictions: RestrictionSet): void {
  const serialised = (typeof body === "string" ? body : JSON.stringify(body) ?? "").toLowerCase();
  for (const term of restrictions.terms) {
    const t = term.trim().toLowerCase();
    if (t && serialised.includes(t)) throw new EgressViolation(term, "the request body");
  }
  for (const name of restrictions.restrictedCompanyNames) {
    const n = name.trim().toLowerCase();
    if (n && serialised.includes(n)) throw new EgressViolation(name, "the request body");
  }
}

/** Read the restricted terms from field_catalog, so the list cannot drift from the schema. */
export function restrictionsFromCatalog(
  rows: Array<{ key: string; label: string; classification: string }>,
  restrictedCompanyNames: readonly string[] = [],
): RestrictionSet {
  const terms = rows
    .filter((r) => r.classification === "deloitte_internal")
    .flatMap((r) => [r.key, r.label]);
  return { terms, restrictedCompanyNames };
}
