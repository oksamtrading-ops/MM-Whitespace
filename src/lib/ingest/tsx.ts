/**
 * Next quarter's period, from TSX's own list of mining issuers.
 *
 * The practice's workbook arrived once. What moves from one quarter to the
 * next is the exchange's list: who is listed, where, under which ticker, and
 * worth how much. So the next period is the last PUBLISHED one rolled
 * forward. TSX's file supplies the fields it carries; everything else
 * (stages, auditor, fees, website, research) is carried from the last
 * published revision, marked as inherited and dated by the period it came
 * from (db/committsx.ts).
 *
 * This module is the plan, read before anything is written: who is in the
 * population at the threshold, which company each issuer is, and what moved.
 * The validation report shows it, and the commit reads it again inside its
 * own transaction, so the two cannot drift apart over the hour a parse is
 * held. The threshold is the application's, never the file's: the parser
 * returns every issuer, the C$12M ones too.
 *
 * WHICH COMPANY AN ISSUER IS. A ticker first, then a name. The open ticker
 * interval on either exchange finds a company that graduated from TSXV to
 * TSX, and the name finds one whose ticker changed (GGA became GORO in
 * September 2026). Tickers are matched before names across the whole list,
 * so a name can never take a company a ticker has already claimed.
 */
import type { Sql } from "../db/sql.ts";
import { normName } from "../db/commit.ts";
import { carriesStages } from "../profile/company.ts";
import { queueBuckets } from "../review/queue.ts";
import { getNumber, getSetting } from "../settings/index.ts";
import type { ParseFinding } from "./quarantine.ts";

export type TsxIssuer = {
  ticker: string; exchange: string; name: string;
  co_id?: string | null;
  market_cap: number | null;
  regions: Record<string, string[]>;
  region_provenance?: Record<string, string>;
  commodities: string[];
  venture_graduate: boolean;
  head_office_region: string | null;
  listing_type?: string | null;
  listing_date?: string | null;
  sheet?: string;
};

export type Threshold = { amount: number; operator: "gt" | "gte"; currency: string; bandPct: number };

/** The period a TSX list is rolled forward from: the newest published one, at its last revision. */
export type Base = {
  periodId: string; label: string; asOf: string;
  publicationId: string; revision: number;
};

/** A company in the base period, as it was published. */
export type PriorCompany = {
  companyId: string; name: string; ticker: string | null; exchange: string | null;
  marketCap: number | null;
  /** Its property regions as published: what stands when the list marks none. */
  regions?: Record<string, string[]> | null;
};

export type Known = {
  /** Every open ticker interval, on either exchange. */
  tickers: Array<{ companyId: string; ticker: string; exchange: string | null }>;
  /** Normalised names and aliases, each resolved through any merge to the company that stands. */
  names: Map<string, string>;
  /** The base period's population. */
  prior: PriorCompany[];
};

export type Move = "exchange" | "ticker" | "name";

export type Planned = {
  issuer: TsxIssuer;
  /** Null: a company the application has never seen, created at commit. */
  companyId: string | null;
  matchedBy: "ticker" | "name" | null;
  /** Its row in the base period, if it was in the population there. */
  prior: PriorCompany | null;
  moves: Move[];
};

export type DropOut = PriorCompany & {
  /** Still listed but under the line, or not on TSX's list at all. */
  reason: "below_threshold" | "not_listed";
  now: { ticker: string; exchange: string; marketCap: number | null } | null;
};

export type TsxPlan = {
  asOf: string | null;
  threshold: Threshold;
  base: Base | null;
  /** Every issuer on the list, at any market cap. */
  issuers: number;
  /** The new period's population, in the list's order. */
  population: Planned[];
  entrants: Planned[];
  continuing: Planned[];
  dropOuts: DropOut[];
  /** Within the proximity band of the line, on either side. */
  near: Array<{ name: string; ticker: string; exchange: string; marketCap: number; inPeriod: boolean }>;
  /** Reasons the commit is refused. */
  blocking: string[];
};

/** Whether a region map holds any region at all. */
export function anyRegion(r: Record<string, string[]> | null | undefined): boolean {
  return Object.values(r ?? {}).some((v) => Array.isArray(v) && v.length > 0);
}

export function isTsxPayload(p: { kind?: unknown } | null | undefined): boolean {
  return p?.kind === "tsx_list";
}

export function meetsThreshold(cap: number | null, t: Threshold): boolean {
  if (cap === null || !Number.isFinite(cap)) return false;
  return t.operator === "gt" ? cap > t.amount : cap >= t.amount;
}

export function nearThreshold(cap: number | null, t: Threshold): boolean {
  if (cap === null || !Number.isFinite(cap) || !(t.amount > 0)) return false;
  return (Math.abs(cap - t.amount) / t.amount) * 100 <= t.bandPct;
}

/**
 * The plan, from what is known. Pure: loadTsxPlan reads the database and
 * calls this, and the tests call it directly.
 */
export function planFrom(
  payload: { period: string | null; companies: TsxIssuer[] },
  known: Known, threshold: Threshold, base: Base | null,
): TsxPlan {
  const blocking: string[] = [];
  if (!base) {
    blocking.push("No period has been published yet. TSX's list rolls the last published period " +
                  "forward, so the first period comes from the practice's workbook.");
  }
  if (threshold.currency !== "CAD") {
    blocking.push(`The threshold is set in ${threshold.currency}, and TSX's list is in Canadian dollars. ` +
                  "An Admin sets the threshold's currency in Settings.");
  }

  const issuers = payload.companies;
  const byTicker = new Map<string, Array<{ companyId: string; exchange: string | null }>>();
  for (const t of known.tickers) {
    const k = t.ticker.toUpperCase();
    byTicker.set(k, [...(byTicker.get(k) ?? []), { companyId: t.companyId, exchange: t.exchange }]);
  }
  const priorById = new Map(known.prior.map((p) => [p.companyId, p]));

  // Tickers across the whole list first, then names: a name may only take a
  // company no ticker has claimed.
  const match: Array<{ companyId: string; by: "ticker" | "name" } | null> = issuers.map(() => null);
  const claimed = new Map<string, number>();
  issuers.forEach((i, n) => {
    const cands = byTicker.get(i.ticker.toUpperCase()) ?? [];
    // One company holds a root ticker at a time. Should two intervals still
    // be open, the one on the same exchange is the issuer; otherwise the one
    // in the base population; otherwise the ticker says nothing.
    const pick = cands.length === 1 ? cands[0]
      : cands.find((c) => c.exchange === i.exchange)
        ?? (cands.filter((c) => priorById.has(c.companyId)).length === 1
          ? cands.find((c) => priorById.has(c.companyId)) : undefined);
    if (pick && !claimed.has(pick.companyId)) {
      match[n] = { companyId: pick.companyId, by: "ticker" };
      claimed.set(pick.companyId, n);
    }
  });
  issuers.forEach((i, n) => {
    if (match[n]) return;
    const id = known.names.get(normName(i.name));
    if (id && !claimed.has(id)) {
      match[n] = { companyId: id, by: "name" };
      claimed.set(id, n);
    }
  });

  const population: Planned[] = [];
  const newNames = new Map<string, string>();
  issuers.forEach((i, n) => {
    if (!meetsThreshold(i.market_cap, threshold)) return;
    const m = match[n];
    const prior = m ? priorById.get(m.companyId) ?? null : null;
    const moves: Move[] = [];
    if (prior) {
      if (prior.exchange && prior.exchange !== i.exchange) moves.push("exchange");
      if (prior.ticker && prior.ticker.toUpperCase() !== i.ticker.toUpperCase()) moves.push("ticker");
      if (normName(prior.name) !== normName(i.name)) moves.push("name");
    }
    if (!m) {
      // A new company is created under its normalised name, which is unique.
      const key = normName(i.name);
      const taken = known.names.get(key);
      if (taken) {
        const holder = issuers[claimed.get(taken) ?? -1];
        blocking.push(`${i.name} (${i.ticker}) has the same name as a company already matched to ` +
                      `${holder ? `${holder.name} (${holder.ticker})` : "another issuer"}. ` +
                      "Two companies cannot share a name; correct the list or merge them first.");
      } else if (newNames.has(key)) {
        blocking.push(`${i.name} (${i.ticker}) and ${newNames.get(key)} are both new and share a name.`);
      }
      newNames.set(key, `${i.name} (${i.ticker})`);
    }
    population.push({ issuer: i, companyId: m?.companyId ?? null, matchedBy: m?.by ?? null, prior, moves });
  });

  const inPopulation = new Set(population.map((p) => p.companyId).filter(Boolean));
  const dropOuts: DropOut[] = known.prior
    .filter((p) => !inPopulation.has(p.companyId))
    .map((p) => {
      const n = claimed.get(p.companyId);
      const i = n === undefined ? undefined : issuers[n];
      return {
        ...p,
        reason: i ? "below_threshold" as const : "not_listed" as const,
        now: i ? { ticker: i.ticker, exchange: i.exchange, marketCap: i.market_cap } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const near = issuers
    .filter((i) => nearThreshold(i.market_cap, threshold))
    .map((i) => ({ name: i.name, ticker: i.ticker, exchange: i.exchange, marketCap: i.market_cap as number,
                   inPeriod: meetsThreshold(i.market_cap, threshold) }))
    .sort((a, b) => b.marketCap - a.marketCap);

  return {
    asOf: payload.period, threshold, base, issuers: issuers.length,
    population,
    entrants: population.filter((p) => !p.prior),
    continuing: population.filter((p) => p.prior),
    dropOuts, near, blocking,
  };
}

/** The Admin's threshold, as a new period would be given it. */
export async function readThreshold(db: Sql): Promise<Threshold> {
  const op = await getSetting(db, "default_threshold_operator");
  return {
    amount: await getNumber(db, "default_threshold_amount", 200_000_000),
    operator: op === "gt" ? "gt" : "gte",
    currency: (await getSetting(db, "default_threshold_currency")) ?? "CAD",
    bandPct: await getNumber(db, "default_proximity_band_pct", 2),
  };
}

/** The newest published period, at its last revision. */
export async function readBase(db: Sql): Promise<Base | null> {
  const row = await db.get(`select p.id, p.label, p.market_cap_as_of, pp.id as publication_id, pp.revision
      from periods p join period_publications pp on pp.period_id = p.id
     order by p.market_cap_as_of desc, pp.revision desc limit 1`) as
    { id: string; label: string; market_cap_as_of: string; publication_id: string; revision: number } | undefined;
  return row
    ? { periodId: String(row.id), label: row.label, asOf: String(row.market_cap_as_of).slice(0, 10),
        publicationId: String(row.publication_id), revision: Number(row.revision) }
    : null;
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};

/** What the application already knows that an issuer could be. */
export async function readKnown(db: Sql, base: Base | null): Promise<Known> {
  const tickers = (await db.all(`select company_id, value, exchange from company_identifiers
      where scheme = 'root_ticker' and valid_to is null`) as
    Array<{ company_id: string; value: string; exchange: string | null }>)
    .map((t) => ({ companyId: String(t.company_id), ticker: String(t.value), exchange: t.exchange ?? null }));

  // A merged company's name and aliases still find the company it became.
  const companies = await db.all("select id, name_normalized, merged_into_id from companies") as
    Array<{ id: string; name_normalized: string; merged_into_id: string | null }>;
  const mergedInto = new Map(companies.map((c) => [String(c.id), c.merged_into_id ? String(c.merged_into_id) : null]));
  const standing = (id: string) => {
    let current = id;
    for (let hop = 0; hop < 4; hop++) {
      const next = mergedInto.get(current);
      if (!next) break;
      current = next;
    }
    return current;
  };
  const names = new Map<string, string>();
  for (const c of companies) names.set(c.name_normalized, standing(String(c.id)));
  for (const a of await db.all("select company_id, name_normalized from company_aliases") as
      Array<{ company_id: string; name_normalized: string }>) {
    if (!names.has(a.name_normalized)) names.set(a.name_normalized, standing(String(a.company_id)));
  }

  const prior: PriorCompany[] = [];
  if (base) {
    const rows = await db.all(`select company_id, field_key, value from published_period_values
        where publication_id = ?
          and field_key in ('company_name', 'root_ticker', 'exchange', 'market_cap_cad', 'property_regions')`,
      base.publicationId) as Array<{ company_id: string; field_key: string; value: unknown }>;
    const by = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const id = String(r.company_id);
      by.set(id, { ...(by.get(id) ?? {}), [r.field_key]: parse(r.value) });
    }
    for (const [companyId, f] of by) {
      prior.push({
        companyId,
        name: String(f.company_name ?? ""),
        ticker: typeof f.root_ticker === "string" ? f.root_ticker : null,
        exchange: typeof f.exchange === "string" ? f.exchange : null,
        marketCap: typeof f.market_cap_cad === "number" ? f.market_cap_cad : null,
        regions: f.property_regions && typeof f.property_regions === "object"
          ? f.property_regions as Record<string, string[]> : null,
      });
    }
  }
  return { tickers, names, prior };
}

/** The plan for a parsed TSX list, against the database as it stands. */
export async function loadTsxPlan(
  db: Sql, payload: { period: string | null; companies: unknown[] },
): Promise<TsxPlan> {
  const base = await readBase(db);
  const plan = planFrom({ period: payload.period, companies: payload.companies as TsxIssuer[] },
                        await readKnown(db, base), await readThreshold(db), base);
  if (base) {
    // Stage rows were first frozen with revision 9. A revision before that
    // has none to carry, and carrying the stage state without its rows would
    // read as "researched, no stage" for every company.
    if (!(await carriesStages(db, base.publicationId))) {
      plan.blocking.push(`${base.label} revision ${base.revision} was published before stage rows were ` +
                         "frozen with a revision, so there are no stages to carry. Publish a new revision of it first.");
    }
    // A list makes a new period after the last published one; a draft
    // already there would be skipped over, and its work left behind.
    const later = await db.get(`select label, market_cap_as_of from periods
        where market_cap_as_of > ? order by market_cap_as_of limit 1`, base.asOf) as
      { label: string; market_cap_as_of: string } | undefined;
    if (later) {
      plan.blocking.push(`"${later.label}" (${String(later.market_cap_as_of).slice(0, 10)}) is already committed ` +
                         `after ${base.label}, the last published period. Publish it first: a list rolls forward ` +
                         "from the last published period only.");
    }
  }
  return plan;
}

/**
 * What the base period still holds that rolling forward will leave behind:
 * changes made since its last revision, and proposals nobody has decided.
 * Both stay with that period. Warnings, acknowledged before the commit.
 */
export async function baseLeftovers(db: Sql, base: Base | null): Promise<ParseFinding[]> {
  if (!base) return [];
  const out: ParseFinding[] = [];
  const changed = await db.get(`select count(distinct v.company_id) n
       from company_period_field_values v
       left join published_period_values p
         on p.publication_id = ? and p.company_id = v.company_id and p.field_key = v.field_key
      where v.period_id = ? and (p.company_id is null or p.value is distinct from v.value)`,
    base.publicationId, base.periodId) as { n: number };
  if (Number(changed.n) > 0) {
    out.push({ kind: "warning", code: "base_unpublished_changes",
      detail: `${Number(changed.n)} ${Number(changed.n) === 1 ? "company has" : "companies have"} changes in ` +
              `${base.label} made since revision ${base.revision} was published. Only the published revision ` +
              "is carried forward; publish a new revision first to carry them." });
  }
  const waiting = (await queueBuckets(db, base.periodId)).reduce((a, b) => a + b.count, 0);
  if (waiting > 0) {
    out.push({ kind: "warning", code: "base_review_waiting",
      detail: `${waiting} research ${waiting === 1 ? "proposal is" : "proposals are"} still in ${base.label}'s ` +
              "review queue. They stay with that period and are not carried forward." });
  }
  return out;
}

/**
 * The Deloitte market a company new to the population is given, from its
 * head office. Read off the practice's own assignments in the first period:
 * every company in British Columbia, Ontario, Quebec, Alberta, Saskatchewan,
 * Nova Scotia and Newfoundland and Labrador had exactly this market, and a
 * head office abroad had none. Manitoba, New Brunswick, Prince Edward Island
 * and the territories never appeared, so they are not guessed: null, and the
 * report names the company.
 */
const MARKET_BY_PROVINCE: Record<string, string> = {
  "British Columbia": "British Columbia",
  "Ontario": "Ontario",
  "Quebec": "Quebec & NCR",
  "Alberta": "Prairies Region",
  "Saskatchewan": "Prairies Region",
  "Nova Scotia": "Atlantic",
  "Newfoundland and Labrador": "Atlantic",
};

export function deloitteMarketFor(headOffice: string | null): { market: string | null; unmapped: boolean } {
  const m = headOffice?.match(/^(.+), Canada$/);
  if (!m) return { market: null, unmapped: false };
  const market = MARKET_BY_PROVINCE[m[1]] ?? null;
  return { market, unmapped: market === null };
}
