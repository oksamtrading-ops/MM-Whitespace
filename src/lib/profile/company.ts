/**
 * One company, in one screen: the tier and the rule trace that produced it,
 * footprint, auditor and whether Deloitte holds the audit, fees where known,
 * what changed since last period, and the evidence behind every AI-derived
 * value. Journey two in docs/design/01.
 *
 * A VIEWER READS THE FROZEN SNAPSHOT AND NOTHING ELSE. That boundary is the
 * reason this reads from published_period_* rather than the live tables: a
 * partner must never see an unpublished finding or a draft period. An Analyst
 * may look at the draft, and is told that is what they are looking at.
 */
import type { DatabaseSync } from "node:sqlite";
import { resolveCompanyId } from "../identity/merge.ts";

export type Provenance =
  | "extract" | "ai_accepted" | "manual_override" | "manual_entry" | "derived" | "inherited";

export type ProfileValue = {
  fieldKey: string;
  label: string;
  value: unknown;
  display: string;
  source: string;
  evidenceState: string;
  strength: number | null;
  excerpt: string | null;
  sources: string[];
  /** Set only for an inherited value: which period it came from, and its age. */
  inheritedFrom: { label: string; asOf: string; ageDays: number } | null;
};

export type TraceStep = { ord: number; ruleId: string; inputs: Record<string, unknown>; matched: boolean };

export type CompanyProfile = {
  companyId: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  period: { id: string; label: string; asOf: string };
  /** null when reading the draft, which only an Analyst or Admin may do. */
  publication: { revision: number; publishedAt: string } | null;
  tier: {
    tier: number | null; status: string; footprint: string;
    priorTier: number | null; changed: boolean | null; ruleSetVersion: string;
  } | null;
  /** null when the stored trace no longer produces the tier being shown. */
  trace: TraceStep[] | null;
  values: ProfileValue[];
};

/** Human labels for the provenance of a value. */
export const SOURCE_LABEL: Record<string, string> = {
  extract: "From the workbook",
  ai_accepted: "Researched, accepted",
  manual_override: "Overridden by an analyst",
  manual_entry: "Entered by an analyst",
  derived: "Derived by the rules",
  inherited: "Inherited from an earlier period",
};

/** Fields that have their own place on the page and are not repeated in the table. */
const HEADLINE = new Set(["company_name", "root_ticker", "exchange", "tier", "footprint"]);

export function formatProfileValue(fieldKey: string, raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (fieldKey === "market_cap_cad" && typeof raw === "number") {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD",
                                            maximumFractionDigits: 0 }).format(raw);
  }
  if (fieldKey === "property_regions" && raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Only the regions with something in them; eight empty buckets is noise.
    const held = Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([region, v]) => `${titleish(region)}: ${(v as string[]).join(", ")}`);
    return held.length ? held.join(" · ") : "No properties recorded";
  }
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "object") {
    const on = Object.entries(raw as Record<string, unknown>).filter(([, v]) => v === true);
    return on.length ? on.map(([k]) => k.replace(/_/g, " ")).join(" + ") : "—";
  }
  return String(raw);
}

/** "LATIN AMERICA" reads as a region, not a shout. Short all-caps tokens stay. */
function titleish(region: string): string {
  return region.split(/([ /])/).map((part) =>
    /^[A-Z]{1,3}$/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()).join("");
}

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return text ?? null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Read a company as the given role is allowed to see it.
 *
 * `draft` is true only for an Analyst or Admin looking at a period that has
 * not been published, and the page says so on their behalf.
 */
export function readCompanyProfile(
  db: DatabaseSync, rawCompanyId: string, opts: { allowDraft: boolean },
): CompanyProfile | null {
  // A link made before a merge still lands on the company it was about.
  const companyId = resolveCompanyId(db, rawCompanyId);
  const company = db.prepare(
    "select id, canonical_name from companies where id = ?").get(companyId) as
    { id: string; canonical_name: string } | undefined;
  if (!company) return null;

  const period = db.prepare(
    "select id, label, market_cap_as_of from periods order by market_cap_as_of desc limit 1",
  ).get() as { id: string; label: string; market_cap_as_of: string } | undefined;
  if (!period) return null;

  const pub = db.prepare(
    `select id, revision, published_at from period_publications
      where period_id = ? order by revision desc limit 1`).get(period.id) as
    { id: string; revision: number; published_at: string } | undefined;

  if (!pub && !opts.allowDraft) return null;

  const catalogue = new Map(
    (db.prepare("select key, label from field_catalog").all() as Array<{ key: string; label: string }>)
      .map((f) => [f.key, f.label]));

  const rows = pub
    ? db.prepare(
        `select field_key, value, source, evidence_state, evidence_strength, excerpt, sources
           from published_period_values where publication_id = ? and company_id = ?`,
      ).all(pub.id, companyId) as RawValue[]
    : db.prepare(
        `select field_key, value, source, evidence_state,
                null as evidence_strength, null as excerpt, null as sources, source_period_id
           from company_period_field_values where period_id = ? and company_id = ?`,
      ).all(period.id, companyId) as RawValue[];

  const periods = new Map(
    (db.prepare("select id, label, market_cap_as_of from periods").all() as
      Array<{ id: string; label: string; market_cap_as_of: string }>).map((p) => [p.id, p]));

  const values: ProfileValue[] = rows.map((r) => {
    const value = parseJson(r.value);
    const from = r.source === "inherited" && r.source_period_id
      ? periods.get(r.source_period_id) ?? null : null;
    return {
      fieldKey: r.field_key,
      label: catalogue.get(r.field_key) ?? r.field_key,
      value,
      display: formatProfileValue(r.field_key, value),
      source: r.source,
      evidenceState: r.evidence_state ?? "unknown",
      strength: r.evidence_strength === null || r.evidence_strength === undefined
        ? null : Number(r.evidence_strength),
      excerpt: r.excerpt ?? null,
      sources: (parseJson(r.sources) as string[] | null) ?? [],
      inheritedFrom: from
        ? { label: from.label, asOf: from.market_cap_as_of,
            ageDays: Math.max(0, Math.round(
              (Date.parse(`${period.market_cap_as_of}T00:00:00Z`) -
               Date.parse(`${from.market_cap_as_of}T00:00:00Z`)) / 86_400_000)) }
        : null,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const byKey = new Map(values.map((v) => [v.fieldKey, v]));

  const tierRow = pub
    ? db.prepare(
        `select tier, status, footprint, rule_set_version, prior_tier, tier_changed
           from published_period_tiers where publication_id = ? and company_id = ?`,
      ).get(pub.id, companyId) as TierRow | undefined
    : db.prepare(
        `select tier, status, footprint, rule_set_version,
                null as prior_tier, null as tier_changed
           from tiers where period_id = ? and company_id = ?`,
      ).get(period.id, companyId) as TierRow | undefined;

  // The trace is a live row. It is shown only when it still produces the tier
  // on the page: a trace that disagrees with the tier beside it is worse than
  // no trace at all.
  const live = db.prepare(
    "select tier, status from tiers where period_id = ? and company_id = ?",
  ).get(period.id, companyId) as { tier: number | null; status: string } | undefined;
  const consistent = Boolean(tierRow && live &&
    (live.tier ?? null) === (tierRow.tier ?? null) && live.status === tierRow.status);
  const trace = consistent
    ? (db.prepare(
        "select ord, rule_id, inputs, matched from tier_traces where period_id = ? and company_id = ? order by ord",
      ).all(period.id, companyId) as Array<{ ord: number; rule_id: string; inputs: string; matched: number }>)
        .map((t) => ({ ord: t.ord, ruleId: t.rule_id,
                       inputs: (parseJson(t.inputs) as Record<string, unknown>) ?? {},
                       matched: Boolean(t.matched) }))
    : null;

  return {
    companyId: company.id,
    name: String(byKey.get("company_name")?.value ?? company.canonical_name),
    ticker: (byKey.get("root_ticker")?.value as string | null) ?? null,
    exchange: (byKey.get("exchange")?.value as string | null) ?? null,
    period: { id: period.id, label: period.label, asOf: period.market_cap_as_of },
    publication: pub ? { revision: pub.revision, publishedAt: pub.published_at } : null,
    tier: tierRow
      ? {
          tier: tierRow.tier ?? null, status: tierRow.status, footprint: tierRow.footprint,
          priorTier: tierRow.prior_tier ?? null,
          changed: tierRow.tier_changed === null || tierRow.tier_changed === undefined
            ? null : Boolean(tierRow.tier_changed),
          ruleSetVersion: tierRow.rule_set_version,
        }
      : null,
    trace,
    values: values.filter((v) => !HEADLINE.has(v.fieldKey)),
  };
}

type RawValue = {
  field_key: string; value: string | null; source: string; evidence_state: string | null;
  evidence_strength: number | null; excerpt: string | null; sources: string | null;
  source_period_id?: string | null;
};
type TierRow = {
  tier: number | null; status: string; footprint: string; rule_set_version: string;
  prior_tier: number | null; tier_changed: number | null;
};

/** The published population, for the company index. */
export function listCompanies(db: DatabaseSync, opts: { allowDraft: boolean }): Array<{
  companyId: string; name: string; ticker: string | null; exchange: string | null;
  tier: number | null; status: string; auditor: string | null;
}> {
  const period = db.prepare(
    "select id from periods order by market_cap_as_of desc limit 1").get() as { id: string } | undefined;
  if (!period) return [];
  const pub = db.prepare(
    `select id from period_publications where period_id = ? order by revision desc limit 1`,
  ).get(period.id) as { id: string } | undefined;
  if (!pub && !opts.allowDraft) return [];

  const rows = pub
    ? db.prepare(
        `select c.id as company_id, c.canonical_name as name,
                max(case when v.field_key = 'root_ticker' then v.value end) as ticker,
                max(case when v.field_key = 'exchange' then v.value end) as exchange,
                max(case when v.field_key = 'auditor' then v.value end) as auditor,
                t.tier as tier, t.status as status
           from published_period_tiers t
           join companies c on c.id = t.company_id
           left join published_period_values v
                  on v.publication_id = t.publication_id and v.company_id = t.company_id
          where t.publication_id = ? and c.status != 'merged'
          group by c.id, c.canonical_name, t.tier, t.status
          order by c.canonical_name`).all(pub.id)
    : db.prepare(
        `select c.id as company_id, c.canonical_name as name,
                max(case when v.field_key = 'root_ticker' then v.value end) as ticker,
                max(case when v.field_key = 'exchange' then v.value end) as exchange,
                max(case when v.field_key = 'auditor' then v.value end) as auditor,
                t.tier as tier, t.status as status
           from tiers t
           join companies c on c.id = t.company_id
           left join company_period_field_values v
                  on v.period_id = t.period_id and v.company_id = t.company_id
          where t.period_id = ? and c.status != 'merged'
          group by c.id, c.canonical_name, t.tier, t.status
          order by c.canonical_name`).all(period.id);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    companyId: String(r.company_id),
    name: String(parseJson(r.name) ?? r.name),
    ticker: (parseJson(r.ticker) as string | null) ?? null,
    exchange: (parseJson(r.exchange) as string | null) ?? null,
    tier: r.tier === null ? null : Number(r.tier),
    status: String(r.status),
    auditor: (parseJson(r.auditor) as string | null) ?? null,
  }));
}
