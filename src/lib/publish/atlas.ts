/**
 * The dashboard's read: every company in one publication, as a Viewer may see
 * it, with the facts a partner asks of the market before a conversation.
 *
 * One pass over `published_period_values`, `published_period_tiers` and
 * `published_period_stages`, plus the prior period's newest revision for what
 * changed. Nothing here is a working value, and nothing here is internal:
 * `dtt_market` is never read per company. It reaches the dashboard only as the
 * market aggregate, through `marketPenetration`.
 *
 * Every place is folded onto the globe's keys here, once, so the globe, the
 * bars beside it and the roster links agree on what a place is. A place the
 * geometry cannot draw is kept in words (`unplaced`), never dropped.
 *
 * The client filters this list in memory; the views over it are pure
 * functions in `lens.ts`.
 */
import type { Sql } from "../db/sql.ts";
import { decodePlaces, placeOfHeadOffice, placeOfProperty } from "./globe.ts";
import { hqJurisdiction, provinceCode } from "./jurisdictions.ts";
import { UNNAMED, type Atlas, type AtlasCompany, type AtlasPeriod, type FirmClass } from "./lens.ts";
import { WORLD } from "./world.ts";

export type { Atlas, AtlasCompany, AtlasPeriod, FirmClass };

type Row = { company_id: string; field_key: string; value: unknown };

let KNOWN: ReadonlySet<string> | null = null;
/** Every key the globe can draw or mark, decoded once per process. */
function knownPlaces(): ReadonlySet<string> {
  KNOWN ??= new Set(decodePlaces(WORLD).map((p) => p.key));
  return KNOWN;
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/\b(llp|llc|lp|inc|ltd|pllc|chartered professional accountants|chartered accountants|cpas?|professional corporation)\b\.?/g, "")
  .replace(/[^a-z0-9+&]+/g, " ").trim();

const FIRM_ALIASES: Record<string, string> = {
  "pricewaterhousecoopers": "PwC", "pwc": "PwC", "price waterhouse coopers": "PwC",
  "ey": "Ernst & Young", "ernst young": "Ernst & Young", "ernst & young": "Ernst & Young",
  "deloitte & touche": "Deloitte", "deloitte touche": "Deloitte",
};

/**
 * A firm as a filing writes it ("KPMG LLP", "PricewaterhouseCoopers LLP") to
 * the name the snapshot uses ("KPMG", "PwC"). `previous_auditor` is stored as
 * research read it; the incumbent is canonical. Without this, Deloitte losing
 * a client to "Davidson & Company" and "Deloitte LLP" losing one would be two
 * different firms. An unknown firm comes back cleaned, never guessed.
 */
export function canonicalFirm(raw: string | null, known: Iterable<string>): string | null {
  const t = text(raw);
  if (!t) return null;
  const f = fold(t);
  if (FIRM_ALIASES[f]) return FIRM_ALIASES[f];
  for (const k of known) if (fold(k) === f) return k;
  for (const k of known) {
    const fk = fold(k);
    if (fk.length >= 3 && (f.startsWith(`${fk} `) || f === fk)) return k;
  }
  return t.replace(/,?\s+(LLP|LLC|Inc\.?|Ltd\.?)$/i, "").trim();
}

function money(v: unknown): AtlasCompany["fee"] {
  if (typeof v === "number" && Number.isFinite(v)) return { amount: v, currency: null, year: null };
  if (!v || typeof v !== "object") return null;
  const m = v as { amount?: unknown; currency?: unknown; fiscal_year?: unknown };
  const amount = num(m.amount);
  if (amount === null) return null;
  return { amount, currency: text(m.currency), year: num(m.fiscal_year) };
}

/**
 * A period as one of its publications drew it. The line is the revision's,
 * frozen when it was published, not the period's: a period widened after
 * publishing has a lower threshold than the revisions before it.
 */
async function periodOf(db: Sql, id: string, publicationId: string): Promise<AtlasPeriod & { status: string }> {
  const p = await db.get(`select p.id, p.label, p.status, p.market_cap_as_of,
         coalesce(pp.threshold_amount, p.threshold_amount) as threshold_amount,
         coalesce(pp.threshold_currency, p.threshold_currency) as threshold_currency,
         coalesce(pp.threshold_operator, p.threshold_operator) as threshold_operator
      from periods p join period_publications pp on pp.period_id = p.id
     where p.id = ? and pp.id = ?`, id, publicationId) as {
    id: string; label: string; status: string; market_cap_as_of: string;
    threshold_amount: number; threshold_currency: string; threshold_operator: string;
  } | undefined;
  if (!p) throw new Error(`publication ${publicationId} is not a revision of period ${id}`);
  return { id: p.id, label: p.label, status: p.status, asOf: String(p.market_cap_as_of).slice(0, 10),
    threshold: Number(p.threshold_amount), currency: p.threshold_currency, operator: p.threshold_operator };
}

/** The values of a few fields in one publication, by company. */
async function valuesOf(db: Sql, publicationId: string, fields: readonly string[]): Promise<Map<string, Map<string, unknown>>> {
  const rows = await db.all(
    `select company_id, field_key, cast(value as text) as value from published_period_values
      where publication_id = ? and field_key in (${fields.map(() => "?").join(", ")})`,
    publicationId, ...fields) as Row[];
  const out = new Map<string, Map<string, unknown>>();
  for (const r of rows) {
    const id = String(r.company_id);
    if (!out.has(id)) out.set(id, new Map());
    out.get(id)!.set(r.field_key, parse(r.value));
  }
  return out;
}

const FIELDS = [
  "root_ticker", "exchange", "market_cap_cad", "auditor", "head_office_region", "head_office_location",
  "property_regions", "commodities", "auditor_since", "auditor_change", "sec_registrant", "fiscal_year_end",
  "audit_fee",
] as const;

/**
 * Read one publication for the dashboard. `publicationId` must belong to
 * `periodId`; the caller chose it (the newest revision of the newest
 * published period).
 */
export async function readAtlas(db: Sql, periodId: string, publicationId: string): Promise<Atlas> {
  const period = await periodOf(db, periodId, publicationId);
  const pub = await db.get(`select id, revision, published_at, override_reason, amendment_reason
      from period_publications where id = ? and period_id = ?`, publicationId, periodId) as
    { id: string; revision: number; published_at: string; override_reason: string | null; amendment_reason: string | null } | undefined;
  if (!pub) throw new Error(`publication ${publicationId} is not a revision of period ${periodId}`);

  const classes = new Map((await db.all("select canonical_name, firm_class from auditors") as
    Array<{ canonical_name: string; firm_class: string }>).map((a) => [a.canonical_name, a.firm_class]));

  const base = await db.all(`select t.company_id, c.canonical_name as name, t.tier, t.status, t.footprint
      from published_period_tiers t join companies c on c.id = t.company_id
     where t.publication_id = ? and c.status != 'merged'`, publicationId) as
    Array<{ company_id: string; name: string; tier: number | null; status: string; footprint: string | null }>;
  const values = await valuesOf(db, publicationId, FIELDS);

  const stageRows = await db.get(`select 1 as yes from published_period_stages where publication_id = ? limit 1`, publicationId)
    ? await db.all("select company_id, stage from published_period_stages where publication_id = ?", publicationId) as
      Array<{ company_id: string; stage: string }>
    : null;
  const stages = new Map<string, string[]>();
  for (const r of stageRows ?? []) {
    const id = String(r.company_id);
    stages.set(id, [...(stages.get(id) ?? []), r.stage]);
  }

  // The prior period: the published one with the latest as-of date before
  // this one, at its newest revision. Its tiers are read from that revision
  // too, not from the prior_tier frozen with this one: that was compared with
  // whichever revision was newest when this was published, and an amendment
  // since would otherwise leave the tier moves on the old revision and every
  // other figure of the comparison on the new.
  const priorRow = await db.get(`select p.id, pp.id as publication_id, pp.revision from periods p
      join period_publications pp on pp.period_id = p.id
     where p.market_cap_as_of < (select market_cap_as_of from periods where id = ?)
     order by p.market_cap_as_of desc, pp.revision desc limit 1`, periodId) as
    { id: string; publication_id: string; revision: number } | undefined;
  let prior: Atlas["prior"] = null;
  const priorValues = new Map<string, Map<string, unknown>>();
  let priorIds: string[] = [];
  const priorTiers = new Map<string, number | null>();
  if (priorRow) {
    const p = await periodOf(db, priorRow.id, priorRow.publication_id);
    for (const r of await db.all("select company_id, tier from published_period_tiers where publication_id = ?", priorRow.publication_id) as
      Array<{ company_id: string; tier: number | null }>) priorTiers.set(String(r.company_id), r.tier === null ? null : Number(r.tier));
    priorIds = [...priorTiers.keys()];
    for (const [id, m] of await valuesOf(db, priorRow.publication_id, ["market_cap_cad", "auditor", "root_ticker"])) priorValues.set(id, m);
    const capTotal = priorIds.reduce((s, id) => s + (num(priorValues.get(id)?.get("market_cap_cad")) ?? 0), 0);
    prior = { id: p.id, label: p.label, asOf: p.asOf, threshold: p.threshold, currency: p.currency, operator: p.operator,
      revision: Number(priorRow.revision), companies: priorIds.length, capTotal };
  }

  const known = knownPlaces();
  const placeTokens: Record<string, string[]> = {};
  const auditorNames = new Set<string>([...classes.keys()]);
  for (const m of values.values()) { const a = text(m.get("auditor")); if (a && a !== UNNAMED) auditorNames.add(a); }

  const companies: AtlasCompany[] = base.map((b) => {
    const id = String(b.company_id);
    const v = values.get(id) ?? new Map<string, unknown>();
    const auditor = text(v.get("auditor"));
    const cls = auditor === null ? null : classes.get(auditor);
    const firmClass: FirmClass | null = auditor === null ? null
      : cls === "big4" || cls === "national" || cls === "regional" ? cls : "other";

    const places = new Set<string>();
    const unplaced: string[] = [];
    const regions = v.get("property_regions");
    if (regions && typeof regions === "object" && !Array.isArray(regions)) {
      for (const [group, list] of Object.entries(regions as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          const entry = String(raw).trim();
          if (!entry) continue;
          const key = placeOfProperty(group, entry, known);
          if (key) {
            places.add(key);
            const token = `${group}:${group === "CANADA" ? provinceCode(entry) : entry}`;
            const tokens = placeTokens[key] ??= [];
            if (!tokens.includes(token)) tokens.push(token);
          } else unplaced.push(`${group}: ${entry}`);
        }
      }
    }

    const hqRegion = text(v.get("head_office_region"));
    const change = v.get("auditor_change") as { changed?: unknown; date?: unknown; previous_auditor?: unknown } | null;
    const sec = v.get("sec_registrant") as { registrant?: unknown; form?: unknown } | null;
    const yearEnd = text(v.get("fiscal_year_end"));
    const since = num(v.get("auditor_since"));
    const p = priorValues.get(id);
    return {
      id,
      name: String(parse(b.name) ?? b.name),
      ticker: text(v.get("root_ticker")),
      exchange: text(v.get("exchange")),
      cap: num(v.get("market_cap_cad")),
      tier: b.tier === null ? null : Number(b.tier),
      status: String(b.status),
      footprint: b.footprint === null ? null : String(b.footprint),
      priorTier: priorTiers.get(id) ?? null,
      auditor,
      firmClass,
      hq: placeOfHeadOffice(hqRegion, known),
      hqToken: hqJurisdiction(hqRegion)?.key ?? null,
      hqRegion,
      hqCity: text(v.get("head_office_location")),
      places: [...places].sort(),
      unplaced,
      commodities: Array.isArray(v.get("commodities")) ? (v.get("commodities") as unknown[]).map(String).filter(Boolean) : [],
      stages: stageRows === null ? null : stages.get(id) ?? [],
      since: since !== null && since > 1800 ? Math.trunc(since) : null,
      change: change && typeof change === "object" && change.changed === true
        ? { date: text(change.date), from: canonicalFirm(text(change.previous_auditor), auditorNames) }
        : null,
      changeKnown: Boolean(change && typeof change === "object" && typeof change.changed === "boolean"),
      sec: sec && typeof sec === "object" && typeof sec.registrant === "boolean" ? sec.registrant : null,
      secForm: sec && typeof sec === "object" ? text(sec.form) : null,
      yearEnd: yearEnd && /^\d{2}-\d{2}$/.test(yearEnd) ? yearEnd : null,
      fee: money(v.get("audit_fee")),
      prior: priorRow && priorIds.includes(id)
        ? { cap: num(p?.get("market_cap_cad")), auditor: text(p?.get("auditor")) }
        : null,
    };
  });

  const here = new Set(companies.map((c) => c.id));
  const leaverIds = priorIds.filter((id) => !here.has(id));
  const leaverNames = leaverIds.length
    ? new Map((await db.all(`select id, canonical_name from companies where id in (${leaverIds.map(() => "?").join(", ")})`, ...leaverIds) as
      Array<{ id: string; canonical_name: string }>).map((r) => [String(r.id), r.canonical_name]))
    : new Map<string, string>();
  const leavers = leaverIds.map((id) => ({
    id, name: leaverNames.get(id) ?? "A company since merged",
    ticker: text(priorValues.get(id)?.get("root_ticker")),
    cap: num(priorValues.get(id)?.get("market_cap_cad")),
    auditor: text(priorValues.get(id)?.get("auditor")),
  })).sort((a, b) => (b.cap ?? 0) - (a.cap ?? 0));

  return {
    period: { id: period.id, label: period.label, asOf: period.asOf, threshold: period.threshold, currency: period.currency, operator: period.operator },
    publication: { id: pub.id, revision: Number(pub.revision), publishedAt: String(pub.published_at),
      overrideReason: pub.override_reason, amendmentReason: pub.amendment_reason },
    prior,
    companies: companies.sort((a, b) => (b.cap ?? -1) - (a.cap ?? -1) || a.name.localeCompare(b.name)),
    leavers,
    placeTokens,
    firmClasses: Object.fromEntries([...classes].filter(([, c]) => c === "big4" || c === "national" || c === "regional")) as Record<string, FirmClass>,
  };
}
