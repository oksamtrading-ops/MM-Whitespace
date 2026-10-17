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
import type { Sql } from "../db/sql.ts";
import { shownPeriod } from "../db/periods.ts";
import { formatFieldValue, STAGE_ORDER, type Stage } from "../format/fields.ts";
import { metaFor, type RosterRow, type StageEvidence } from "./roster.ts";
import { citationOf, citationsForPeriod, type Citation } from "./citations.ts";

export { citationOf };
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
  /** The links among the citation's documents, for anything that only wants addresses. */
  sources: string[];
  /**
   * Where the value came from. null only on a revision published before
   * citations were frozen (1-8), and the page says so rather than guess.
   */
  citation: Citation | null;
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
  /** The four Stage of operations flags, as frozen; null on a revision that froze none. */
  stages: Stage[] | null;
  stageEvidence: StageEvidence;
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

/** A value as the profile shows it. The one formatter every page uses. */
export function formatProfileValue(fieldKey: string, raw: unknown): string {
  return formatFieldValue(fieldKey, raw);
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
 *
 * `internal` admits the Deloitte-internal fields (the Deloitte market). They
 * are dropped here unless it is set, so a Viewer's page never receives them:
 * docs/design/11 says "hidden from Viewers by column, not by interface", and
 * this read used to hand them to every role and leave the choice to the page.
 * Off by default, so a caller that forgets fails closed.
 */
export async function readCompanyProfile(
  db: Sql, rawCompanyId: string, opts: { allowDraft: boolean; internal?: boolean },
): Promise<CompanyProfile | null> {
  // A link made before a merge still lands on the company it was about.
  const companyId = await resolveCompanyId(db, rawCompanyId);
  const company = await db.get("select id, canonical_name from companies where id = ?", companyId) as
    { id: string; canonical_name: string } | undefined;
  if (!company) return null;

  const period = await shownPeriod(db, opts);
  if (!period) return null;

  const pub = await db.get(`select id, revision, published_at from period_publications
      where period_id = ? order by revision desc limit 1`, period.id) as
    { id: string; revision: number; published_at: string } | undefined;

  if (!pub && !opts.allowDraft) return null;

  const catalogue = new Map(
    (await db.all("select key, label, classification from field_catalog") as
      Array<{ key: string; label: string; classification: string }>).map((f) => [f.key, f]));
  const admitted = (r: RawValue) =>
    opts.internal === true || catalogue.get(r.field_key)?.classification !== "deloitte_internal";

  const rows = (pub
    ? await db.all(`select field_key, value, source, evidence_state, evidence_strength, excerpt, sources
           from published_period_values where publication_id = ? and company_id = ?`, pub.id, companyId) as RawValue[]
    : await db.all(`select field_key, value, source, evidence_state,
                null as evidence_strength, null as excerpt, null as sources, source_period_id
           from company_period_field_values where period_id = ? and company_id = ?`, period.id, companyId) as RawValue[]
  ).filter(admitted);

  // A draft has no frozen citations, so they are resolved live -- the same
  // resolver publish freezes from, so an Analyst sees the source a Viewer
  // will see once it is published.
  const liveCites = pub ? null : await citationsForPeriod(db, period.id, { companyId });

  const periods = new Map(
    (await db.all("select id, label, market_cap_as_of from periods") as
      Array<{ id: string; label: string; market_cap_as_of: string }>).map((p) => [p.id, p]));

  const values: ProfileValue[] = rows.map((r) => {
    const value = parseJson(r.value);
    const resolved = liveCites?.get(`${companyId}|${r.field_key}`) ?? null;
    const citation = resolved ? resolved.citation : citationOf(parseJson(r.sources));
    // Where a carried value came from: the working row says so in a draft,
    // and the frozen citation does once published, so its age outlives the
    // publish that would otherwise have dropped it.
    const fromId = r.source !== "inherited" ? null
      : r.source_period_id ?? (citation?.kind === "prior_period" ? citation.periodId ?? null : null);
    const from = fromId ? periods.get(fromId) ?? null : null;
    const documents = citation?.kind === "document" ? citation.documents
      : citation?.kind === "prior_period" && citation.origin?.kind === "document" ? citation.origin.documents : [];
    const strength = resolved ? resolved.strength : r.evidence_strength;
    return {
      fieldKey: r.field_key,
      label: catalogue.get(r.field_key)?.label ?? r.field_key,
      value,
      display: formatProfileValue(r.field_key, value),
      source: r.source,
      evidenceState: r.evidence_state ?? "unknown",
      strength: strength === null || strength === undefined ? null : Number(strength),
      excerpt: resolved ? resolved.excerpt : r.excerpt ?? null,
      sources: documents.map((d) => d.url).filter((u): u is string => Boolean(u)),
      citation,
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
    ? await db.get(`select tier, status, footprint, rule_set_version, prior_tier, tier_changed
           from published_period_tiers where publication_id = ? and company_id = ?`, pub.id, companyId) as TierRow | undefined
    : await db.get(`select tier, status, footprint, rule_set_version,
                null as prior_tier, null as tier_changed
           from tiers where period_id = ? and company_id = ?`, period.id, companyId) as TierRow | undefined;

  // The trace is a live row. It is shown only when it still produces the tier
  // on the page: a trace that disagrees with the tier beside it is worse than
  // no trace at all.
  const live = await db.get("select tier, status from tiers where period_id = ? and company_id = ?", period.id, companyId) as { tier: number | null; status: string } | undefined;
  const consistent = Boolean(tierRow && live &&
    (live.tier ?? null) === (tierRow.tier ?? null) && live.status === tierRow.status);
  const trace = consistent
    ? (await db.all("select ord, rule_id, inputs, matched from tier_traces where period_id = ? and company_id = ? order by ord", period.id, companyId) as Array<{ ord: number; rule_id: string; inputs: string; matched: number }>)
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
    ...(await stagesOfCompany(db, pub?.id ?? null, period.id, companyId, byKey.get("stage_evidence_state")?.value)),
  };
}

/** One company's four flags, with the same "froze none" rule as the table. */
async function stagesOfCompany(db: Sql, publicationId: string | null, periodId: string, companyId: string, evidence: unknown) {
  const stageEvidence: StageEvidence = evidence === "partial" || evidence === "complete" ? evidence : "none";
  if (publicationId && !(await carriesStages(db, publicationId))) return { stages: null, stageEvidence };
  const rows = (publicationId
    ? await db.all("select stage from published_period_stages where publication_id = ? and company_id = ?", publicationId, companyId)
    : await db.all("select stage from company_period_stages where period_id = ? and company_id = ?", periodId, companyId)) as
    Array<{ stage: string }>;
  const stages = STAGE_ORDER.filter((s) => rows.some((r) => r.stage === s));
  return { stages, stageEvidence };
}

/**
 * Whether a revision froze stage rows at all. Zero rows cannot say it -- a
 * period nobody has researched has none either -- so the sign is the citations
 * published in the same act: every value of a revision published since stage
 * rows were frozen carries one, and no value of an older revision does.
 */
export async function carriesStages(db: Sql, publicationId: string): Promise<boolean> {
  return Boolean(await db.get(`select 1 as yes from published_period_values
      where publication_id = ? and sources is not null limit 1`, publicationId));
}

export type UnpublishedChanges = {
  /** The revision the page is showing. */
  revision: number;
  /** Labels of the fields whose working value or provenance differs from it. */
  fields: string[];
  /** Set when the working tier differs from the published one. */
  tier: { from: { tier: number | null; status: string }; to: { tier: number | null; status: string } } | null;
};

/**
 * What an Analyst has changed about a company that the published revision
 * does not show yet.
 *
 * Once a period is published, the profile reads the frozen revision -- for
 * everyone, so a partner never sees an unpublished value. The cost was an
 * Analyst accepting a stage in review and then being told, on this page, that
 * the company had "no stage research yet" (Run 1, Nouveau Monde). This is the
 * difference, for the page to say so. A publication is a straight copy of the
 * working values, so a field-by-field comparison is exact. Never for a Viewer.
 */
export async function unpublishedChanges(db: Sql, companyId: string): Promise<UnpublishedChanges | null> {
  const period = await db.get("select id from periods order by market_cap_as_of desc limit 1") as
    { id: string } | undefined;
  if (!period) return null;
  const pub = await db.get(`select id, revision from period_publications
      where period_id = ? order by revision desc limit 1`, period.id) as
    { id: string; revision: number } | undefined;
  if (!pub) return null;

  type Row = { field_key: string; value: unknown; source: string };
  const live = await db.all(`select field_key, value, source from company_period_field_values
      where period_id = ? and company_id = ?`, period.id, companyId) as Row[];
  const frozen = new Map((await db.all(`select field_key, value, source from published_period_values
      where publication_id = ? and company_id = ?`, pub.id, companyId) as Row[]).map((r) => [r.field_key, r]));

  const changed = new Set<string>();
  for (const row of live) {
    const was = frozen.get(row.field_key);
    frozen.delete(row.field_key);
    // An empty working value with nothing published is not a change anyone can see.
    if (!was) { if (canonical(row.value) !== "null") changed.add(row.field_key); continue; }
    if (canonical(row.value) !== canonical(was.value) || row.source !== was.source) changed.add(row.field_key);
  }
  for (const [key, was] of frozen) if (canonical(was.value) !== "null") changed.add(key);

  // The stage rows are frozen beside the values (from the revision that first
  // froze them), so a stage changed in review is a change the page must name.
  if (await carriesStages(db, pub.id)) {
    const rowsOf = async (sql: string, id: string) =>
      (await db.all(sql, id, companyId) as Array<{ stage: string }>).map((r) => r.stage).sort().join(",");
    const liveStages = await rowsOf("select stage from company_period_stages where period_id = ? and company_id = ?", period.id);
    const pubStages = await rowsOf("select stage from published_period_stages where publication_id = ? and company_id = ?", pub.id);
    if (liveStages !== pubStages) changed.add("stage_evidence_state");
  }

  const tierOf = async (sql: string, id: string) =>
    await db.get(sql, id, companyId) as { tier: number | null; status: string } | undefined;
  const liveTier = await tierOf("select tier, status from tiers where period_id = ? and company_id = ?", period.id);
  const pubTier = await tierOf(`select tier, status from published_period_tiers
      where publication_id = ? and company_id = ?`, pub.id);
  const tierMoved = Boolean(liveTier && pubTier &&
    ((liveTier.tier ?? null) !== (pubTier.tier ?? null) || liveTier.status !== pubTier.status));

  const catalogue = new Map(
    (await db.all("select key, label from field_catalog") as Array<{ key: string; label: string }>)
      .map((f) => [f.key, f.label]));
  return {
    revision: pub.revision,
    fields: [...changed].map((k) => catalogue.get(k) ?? k).sort((a, b) => a.localeCompare(b)),
    tier: tierMoved
      ? { from: { tier: pubTier!.tier ?? null, status: pubTier!.status },
          to: { tier: liveTier!.tier ?? null, status: liveTier!.status } }
      : null,
  };
}

/** A value as comparable text: parsed from either engine's form, keys in order. */
function canonical(raw: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(parseJson(raw)) ?? null);
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

/** The published population, for the company index. One row per company; see roster.ts. */
export type CompanyRow = RosterRow;

type ValueRow = { company_id: string; field_key: string; value: unknown; source: string };

/**
 * The companies table's rows, as the given role may see them.
 *
 * The snapshot is read whole and pivoted here, rather than one `max(case ...)`
 * per field in SQL: the table now carries a dozen fields and searches every
 * other public one, and a pivot that has to be extended in SQL for each new
 * column is how a column ends up shown from one source and filtered from
 * another. Only value, source and evidence are read -- never the quotes,
 * which the company page loads for one company at a time.
 *
 * An internal field (classification deloitte_internal: the Deloitte market) is
 * dropped here, before anything reaches the browser, not hidden in a cell.
 */
export async function listCompanies(db: Sql, opts: { allowDraft: boolean }): Promise<CompanyRow[]> {
  const period = await shownPeriod(db, opts);
  if (!period) return [];
  const pub = await db.get(`select id from period_publications where period_id = ? order by revision desc limit 1`, period.id) as { id: string } | undefined;
  if (!pub && !opts.allowDraft) return [];

  const catalogue = new Map(
    (await db.all("select key, label, classification from field_catalog") as
      Array<{ key: string; label: string; classification: string }>).map((f) => [f.key, f]));

  const base = (pub
    ? await db.all(`select t.company_id, c.canonical_name as name, t.tier, t.status, t.footprint
           from published_period_tiers t join companies c on c.id = t.company_id
          where t.publication_id = ? and c.status != 'merged'
          order by c.canonical_name`, pub.id)
    : await db.all(`select t.company_id, c.canonical_name as name, t.tier, t.status, t.footprint
           from tiers t join companies c on c.id = t.company_id
          where t.period_id = ? and c.status != 'merged'
          order by c.canonical_name`, period.id)) as
    Array<{ company_id: string; name: string; tier: number | null; status: string; footprint: string }>;

  const values = (pub
    ? await db.all(`select company_id, field_key, value, source from published_period_values
          where publication_id = ?`, pub.id)
    : await db.all(`select company_id, field_key, value, source from company_period_field_values
          where period_id = ?`, period.id)) as ValueRow[];

  const stageRows = await stagesFor(db, pub?.id ?? null, period.id);

  const byCompany = new Map<string, Map<string, { value: unknown; source: string }>>();
  for (const v of values) {
    if (catalogue.get(v.field_key)?.classification === "deloitte_internal") continue;
    const id = String(v.company_id);
    if (!byCompany.has(id)) byCompany.set(id, new Map());
    byCompany.get(id)!.set(v.field_key, { value: parseJson(v.value), source: v.source });
  }

  return base.map((b) => {
    const id = String(b.company_id);
    const vals = byCompany.get(id) ?? new Map<string, { value: unknown; source: string }>();
    const get = (k: string) => vals.get(k)?.value ?? null;
    const text = (k: string) => { const v = get(k); return typeof v === "string" && v.trim() ? v : null; };
    const cap = get("market_cap_cad");
    const evidence = get("stage_evidence_state");
    return {
      companyId: id,
      name: String(parseJson(b.name) ?? b.name),
      ticker: text("root_ticker"),
      exchange: text("exchange"),
      tier: b.tier === null ? null : Number(b.tier),
      status: String(b.status),
      footprint: String(b.footprint),
      auditor: text("auditor"),
      marketCap: typeof cap === "number" ? cap : null,
      hqRegion: text("head_office_region"),
      hqCity: text("head_office_location"),
      auditFee: get("audit_fee"),
      erp: text("incumbent_erp"),
      commodities: listOfText(get("commodities")),
      stages: stageRows === null ? null : stageRows.get(id) ?? [],
      stageEvidence: evidence === "partial" || evidence === "complete" ? evidence : "none",
      regions: regionsOf(get("property_regions")),
      sources: Object.fromEntries([...vals].map(([k, v]) => [k, v.source])),
      meta: metaFor([...vals].map(([k, v]) => ({ field: k, label: catalogue.get(k)?.label ?? k, value: v.value }))),
    };
  });
}

/** A stored list of words (commodities), or none: anything else is not a list. */
function listOfText(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/**
 * The stage rows behind the four Stage of operations columns, by company.
 *
 * Draft: the working rows. Published: the rows the revision froze -- and null
 * when it froze none, because revisions before stage rows were published
 * cannot be told apart from "no stages" any other way, and the table must say
 * "not recorded in this revision" rather than show four empty columns.
 */
async function stagesFor(db: Sql, publicationId: string | null, periodId: string): Promise<Map<string, Stage[]> | null> {
  const rows = (publicationId
    ? await publishedStageRows(db, publicationId)
    : await db.all("select company_id, stage from company_period_stages where period_id = ?", periodId)) as
    Array<{ company_id: string; stage: string }> | null;
  if (rows === null) return null;
  const out = new Map<string, Stage[]>();
  for (const r of rows) {
    const id = String(r.company_id);
    if (!out.has(id)) out.set(id, []);
    if ((STAGE_ORDER as readonly string[]).includes(r.stage)) out.get(id)!.push(r.stage as Stage);
  }
  for (const list of out.values()) list.sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  return out;
}

/** A publication's frozen stage rows, or null for a revision that froze none. */
async function publishedStageRows(db: Sql, publicationId: string): Promise<Array<{ company_id: string; stage: string }> | null> {
  if (!(await carriesStages(db, publicationId))) return null;
  return await db.all("select company_id, stage from published_period_stages where publication_id = ?", publicationId) as
    Array<{ company_id: string; stage: string }>;
}

/** property_regions as bucket -> entries, every bucket kept. */
function regionsOf(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([bucket, list]) => [bucket, (list as unknown[]).map(String)]));
}

/**
 * Which period and revision the companies table is showing, for the export's
 * header. The same choice listCompanies makes (shownPeriod): the newest period
 * for a role allowed a draft, the newest published one for everyone else.
 */
export async function rosterBasis(db: Sql, opts: { allowDraft: boolean }): Promise<{
  periodId: string; label: string; revision: number | null; publishedAt: string | null; publicationId: string | null;
} | null> {
  const period = await shownPeriod(db, opts);
  if (!period) return null;
  const pub = await db.get(`select id, revision, published_at from period_publications where period_id = ?
      order by revision desc limit 1`, period.id) as { id: string; revision: number; published_at: string } | undefined;
  if (!pub && !opts.allowDraft) return null;
  return { periodId: period.id, label: period.label, revision: pub ? Number(pub.revision) : null,
           publishedAt: pub?.published_at ?? null, publicationId: pub?.id ?? null };
}
