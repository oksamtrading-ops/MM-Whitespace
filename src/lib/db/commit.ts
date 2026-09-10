/**
 * Commit a parsed period.
 *
 * Precedence is enforced by the database, not here: the promotion of extract
 * values uses a conditional upsert that can only ever overwrite another extract
 * value, so an accepted finding, a manual override or a frozen value survives a
 * re-import even if this code is wrong.
 */
import type { Sql } from "./sql.ts";
import { classify, deriveFootprint, RULE_SET_VERSION, type Evidence, type Stage } from "../tiering/index.ts";
import { getNumber, getSetting } from "../settings/index.ts";

const ABROAD = ["AFRICA", "ASIA", "AUS/NZ/PNG", "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"];

export type ParsedCompany = {
  ticker: string; exchange: string; name: string; ordinal: number;
  market_cap: number | null;
  stages: Stage[]; stage_evidence: Evidence; property_evidence: Evidence;
  regions: Record<string, string[]>;
  region_provenance?: Record<string, "extract" | "analyst_retained" | "absent">;
  commodities: string[]; venture_graduate: boolean;
  auditor: string | null; auditor_class: string | null;
  website?: string | null;
  dtt_market?: string | null;
  entity_id?: string | null;
  tier_workbook: number | null; footprint_workbook: string | null;
};

export type Payload = { period: string; companies: ParsedCompany[] };

export type CommitResult = {
  periodId: string; label: string; companies: number;
  identifiers: number; facts: number; values: number; stages: number;
  tiers: number; traces: number;
  graduations: number; preserved: number;
};

function normName(name: string): string {
  let t = (name ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ");
  for (const s of [" corporation", " corp", " incorporated", " inc", " limited",
                   " ltd", " plc", " company", " co", " nl", " sa", " ag"]) {
    while (t.endsWith(s)) t = t.slice(0, -s.length);
  }
  return t.replace(/[^a-z0-9 ]/g, "").trim();
}

/** A period whose as-of date is already published must not be re-committed. */
/**
 * Why this period may not be committed, or null. Exported so the validation
 * report can say so BEFORE the Analyst fills in a commit form, rather than
 * letting them find out by pressing the button.
 */
export async function periodAdmissibility(db: Sql, asOf: string): Promise<string | null> {
  const clash = await db.get("select label, status from periods where market_cap_as_of = ? and status = 'published'", asOf) as { label: string } | undefined;
  if (clash) {
    return `period ${asOf} is already published as "${clash.label}". ` +
      `A published period is immutable; corrections are amendments that bump the revision.`;
  }
  const later = await db.get("select label, market_cap_as_of from periods where status = 'published' and market_cap_as_of > ?", asOf) as { label: string; market_cap_as_of: string } | undefined;
  if (later) {
    return `period ${asOf} predates the published period "${later.label}" (${later.market_cap_as_of}).`;
  }
  return null;
}

async function assertPeriodAdmissible(db: Sql, asOf: string): Promise<void> {
  const why = await periodAdmissibility(db, asOf);
  if (why) throw new Error(why);
}

export async function commitPeriod(
  db: Sql,
  payload: Payload,
  opts: { label?: string; sourceSha256?: string; actorId?: string | null } = {}): Promise<CommitResult> {
  const asOf = payload.period;
  if (!asOf) throw new Error("payload has no period date; the parser must resolve one before commit");
  await assertPeriodAdmissible(db, asOf);

  const label = opts.label ?? asOf;
  const result: CommitResult = {
    periodId: "", label, companies: 0, identifiers: 0, facts: 0, values: 0,
    stages: 0, tiers: 0, traces: 0, graduations: 0, preserved: 0,
  };

  db.exec("begin");
  try {
    // The Admin's defaults are copied ONTO the period at creation and belong
    // to it from then on: a re-commit must not move the threshold a period
    // was published against.
    await db.run(`insert into periods (label, market_cap_as_of, source_file_sha256, rule_set_version,
                            threshold_amount, threshold_operator, threshold_currency,
                            proximity_band_pct)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (label) do update set source_file_sha256 = excluded.source_file_sha256,
                                          rule_set_version  = excluded.rule_set_version`, label, asOf, opts.sourceSha256 ?? null, RULE_SET_VERSION,
          await getNumber(db, "default_threshold_amount", 200_000_000),
          await getSetting(db, "default_threshold_operator") ?? "gte",
          await getSetting(db, "default_threshold_currency") ?? "CAD",
          await getNumber(db, "default_proximity_band_pct", 2));
    const period = await db.get("select id from periods where label = ?", label) as { id: string };
    result.periodId = period.id;

    const insCompany = `insert into companies (canonical_name, name_normalized, first_seen_period_id)
       values (?, ?, ?) on conflict (name_normalized) do nothing`;
    const getCompany = "select id from companies where name_normalized = ?";
    const insAlias = `insert into company_aliases (company_id, name, name_normalized, alias_type, first_seen_period_id, source)
       values (?, ?, ?, 'source_variant', ?, 'workbook') on conflict do nothing`;

    const findIdent = `select id, exchange from company_identifiers
       where company_id = ? and scheme = 'root_ticker' and valid_to is null`;
    const insIdent = `insert into company_identifiers (company_id, scheme, value, exchange, valid_from, source)
       values (?, ?, ?, ?, ?, 'extract') on conflict do nothing`;
    const closeIdent = "update company_identifiers set valid_to = ? where id = ?";

    const insFact = `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id, field_key) do update
         set raw_value = excluded.raw_value, typed_value = excluded.typed_value,
             assertion = excluded.assertion`;

    // The invariant. Promotion of an extract value may only ever overwrite
    // another extract value, and never a frozen one.
    const upsertValue = `insert into company_period_field_values as v
         (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id, field_key) do update
         set value = excluded.value, evidence_state = excluded.evidence_state,
             decided_at = current_timestamp
         where v.source = 'extract' and v.frozen_at is null`;

    const insStage = `insert into company_period_stages (period_id, company_id, stage)
       values (?, ?, ?) on conflict do nothing`;
    const insTier = `insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id) do update
         set tier = excluded.tier, status = excluded.status,
             footprint = excluded.footprint, rule_set_version = excluded.rule_set_version`;
    const clearTrace = "delete from tier_traces where period_id = ? and company_id = ?";
    const insTrace = `insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
       values (?, ?, ?, ?, ?, ?)`;

    for (const c of payload.companies) {
      const key = normName(c.name);
      await db.run(insCompany, c.name, key, period.id);
      const company = await db.get(getCompany, key) as { id: string };
      result.companies++;
      await db.run(insAlias, company.id, c.name, key, period.id);

      // --- identity: a graduation closes one interval and opens another ----
      const current = await db.all(findIdent, company.id) as Array<{ id: string; exchange: string }>;
      const match = current.find((i) => i.exchange === c.exchange);
      if (!match) {
        for (const stale of current) {
          await db.run(closeIdent, asOf, stale.id);
          result.graduations++;
        }
        await db.run(insIdent, company.id, "root_ticker", c.ticker, c.exchange, asOf);
        result.identifiers++;
      }
      if (c.entity_id) {
        await db.run(insIdent, company.id, "sp_entity_id", String(c.entity_id), null, asOf);
        result.identifiers++;
      }

      // --- facts: the immutable snapshot of what the file said -------------
      const fact = async (fieldKey: string, raw: unknown, typed: unknown, assertion: string) => {
        await db.run(insFact, period.id, company.id, fieldKey,
          raw === null || raw === undefined ? null : String(raw),
          typed === null || typed === undefined ? null : JSON.stringify(typed), assertion);
        result.facts++;
      };
      await fact("company_name", c.name, c.name, "asserted");
      await fact("root_ticker", c.ticker, c.ticker, "asserted");
      await fact("exchange", c.exchange, c.exchange, "asserted");
      await fact("market_cap_cad", c.market_cap, c.market_cap,
           c.market_cap === null ? "absent_blank" : "asserted");
      await fact("commodities", c.commodities.join(", "), c.commodities, "asserted");
      await fact("venture_graduate", c.venture_graduate, c.venture_graduate, "asserted");
      await fact("auditor", c.auditor, c.auditor, c.auditor === null ? "absent_sentinel" : "asserted");

      // Region provenance decides the assertion, and the assertion is what
      // makes a safe re-upload possible.
      const prov = c.region_provenance ?? {};
      const anyRetained = Object.values(prov).includes("analyst_retained");
      if (anyRetained) result.preserved++;
      await fact("property_regions", JSON.stringify(c.regions), c.regions,
           anyRetained ? "asserted" : (c.property_evidence === "none" ? "absent_blank" : "asserted"));

      // --- resolved values -------------------------------------------------
      const value = async (fieldKey: string, v: unknown, source: string, state: string) => {
        await db.run(upsertValue, period.id, company.id, fieldKey, JSON.stringify(v ?? null), source, state);
        result.values++;
      };
      await value("company_name", c.name, "extract", "asserted");
      await value("root_ticker", c.ticker, "extract", "asserted");
      await value("exchange", c.exchange, "extract", "asserted");
      await value("market_cap_cad", c.market_cap, "extract",
            c.market_cap === null ? "unknown" : "asserted");
      await value("commodities", c.commodities, "extract", "asserted");
      await value("venture_graduate", c.venture_graduate, "extract", "asserted");
      await value("property_regions", c.regions, "extract",
            c.property_evidence === "none" ? "absent_confirmed" : "asserted");
      await value("auditor", c.auditor, "extract", c.auditor === null ? "unknown" : "asserted");
      // Null where the source held a page title rather than a URL: that is an
      // enrichment target, not a website.
      await value("website", c.website ?? null, "extract",
            c.website ? "asserted" : "unknown");
      // Internal but not client data: the firm's own label on a public company.
      // Classified deloitte_internal and hidden from Viewers by policy.
      await value("dtt_market", c.dtt_market ?? null, "manual_entry",
            c.dtt_market ? "asserted" : "unknown");
      await value("stage_evidence_state", c.stage_evidence, "extract",
            c.stage_evidence === "none" ? "unknown" : "asserted");
      await value("property_evidence_state", c.property_evidence, "derived", "asserted");

      // --- stage presence rows ---------------------------------------------
      for (const stage of c.stages) { await db.run(insStage, period.id, company.id, stage); result.stages++; }

      // --- classification ---------------------------------------------------
      const propsCanada = (c.regions?.CANADA ?? []).length > 0;
      const propsAbroad = ABROAD.some((k) => (c.regions?.[k] ?? []).length > 0);
      const footprint = deriveFootprint(propsCanada, propsAbroad, c.property_evidence);
      const cls = classify({
        stages: c.stages, stageEvidence: c.stage_evidence,
        footprint, propertyEvidence: c.property_evidence,
      });
      await db.run(insTier, period.id, company.id, cls.tier, cls.status, cls.footprint, cls.ruleSetVersion);
      result.tiers++;
      await db.run(clearTrace, period.id, company.id);
      for (const t of cls.trace) {
        // A boolean, not 1/0: the adapter converts it for SQLite and Postgres
        // wants the real thing.
        await db.run(insTrace, period.id, company.id, t.ord, t.ruleId,
                     JSON.stringify(t.inputs), t.matched);
        result.traces++;
      }
      await value("footprint", cls.footprint, "derived", "asserted");
      await value("tier", cls.tier, "derived", cls.tier === null ? "unknown" : "asserted");
    }

    await db.run(`insert into audit_log (event, actor_id, period_id, detail)
       values ('import_committed', ?, ?, ?)`, opts.actorId ?? null, period.id, JSON.stringify(result));

    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
  return result;
}
