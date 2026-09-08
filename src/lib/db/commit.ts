/**
 * Commit a parsed period.
 *
 * Precedence is enforced by the database, not here: the promotion of extract
 * values uses a conditional upsert that can only ever overwrite another extract
 * value, so an accepted finding, a manual override or a frozen value survives a
 * re-import even if this code is wrong.
 */
import { DatabaseSync } from "node:sqlite";
import { classify, deriveFootprint, RULE_SET_VERSION, type Evidence, type Stage } from "../tiering/index.ts";

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
function assertPeriodAdmissible(db: DatabaseSync, asOf: string): void {
  const clash = db.prepare(
    "select label, status from periods where market_cap_as_of = ? and status = 'published'",
  ).get(asOf) as { label: string } | undefined;
  if (clash) {
    throw new Error(
      `period ${asOf} is already published as "${clash.label}". ` +
      `A published period is immutable; corrections are amendments that bump the revision.`,
    );
  }
  const later = db.prepare(
    "select label, market_cap_as_of from periods where status = 'published' and market_cap_as_of > ?",
  ).get(asOf) as { label: string; market_cap_as_of: string } | undefined;
  if (later) {
    throw new Error(
      `period ${asOf} predates the published period "${later.label}" (${later.market_cap_as_of}).`,
    );
  }
}

export function commitPeriod(
  db: DatabaseSync,
  payload: Payload,
  opts: { label?: string; sourceSha256?: string; actorId?: string | null } = {},
): CommitResult {
  const asOf = payload.period;
  if (!asOf) throw new Error("payload has no period date; the parser must resolve one before commit");
  assertPeriodAdmissible(db, asOf);

  const label = opts.label ?? asOf;
  const result: CommitResult = {
    periodId: "", label, companies: 0, identifiers: 0, facts: 0, values: 0,
    stages: 0, tiers: 0, traces: 0, graduations: 0, preserved: 0,
  };

  db.exec("begin");
  try {
    db.prepare(
      `insert into periods (label, market_cap_as_of, source_file_sha256, rule_set_version)
       values (?, ?, ?, ?)
       on conflict (label) do update set source_file_sha256 = excluded.source_file_sha256,
                                          rule_set_version  = excluded.rule_set_version`,
    ).run(label, asOf, opts.sourceSha256 ?? null, RULE_SET_VERSION);
    const period = db.prepare("select id from periods where label = ?").get(label) as { id: string };
    result.periodId = period.id;

    const insCompany = db.prepare(
      `insert into companies (canonical_name, name_normalized, first_seen_period_id)
       values (?, ?, ?) on conflict (name_normalized) do nothing`);
    const getCompany = db.prepare("select id from companies where name_normalized = ?");
    const insAlias = db.prepare(
      `insert into company_aliases (company_id, name, name_normalized, alias_type, first_seen_period_id, source)
       values (?, ?, ?, 'source_variant', ?, 'workbook') on conflict do nothing`);

    const findIdent = db.prepare(
      `select id, exchange from company_identifiers
       where company_id = ? and scheme = 'root_ticker' and valid_to is null`);
    const insIdent = db.prepare(
      `insert into company_identifiers (company_id, scheme, value, exchange, valid_from, source)
       values (?, ?, ?, ?, ?, 'extract') on conflict do nothing`);
    const closeIdent = db.prepare("update company_identifiers set valid_to = ? where id = ?");

    const insFact = db.prepare(
      `insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id, field_key) do update
         set raw_value = excluded.raw_value, typed_value = excluded.typed_value,
             assertion = excluded.assertion`);

    // The invariant. Promotion of an extract value may only ever overwrite
    // another extract value, and never a frozen one.
    const upsertValue = db.prepare(
      `insert into company_period_field_values as v
         (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id, field_key) do update
         set value = excluded.value, evidence_state = excluded.evidence_state,
             decided_at = (datetime('now'))
         where v.source = 'extract' and v.frozen_at is null`);

    const insStage = db.prepare(
      `insert into company_period_stages (period_id, company_id, stage)
       values (?, ?, ?) on conflict do nothing`);
    const insTier = db.prepare(
      `insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
       values (?, ?, ?, ?, ?, ?)
       on conflict (period_id, company_id) do update
         set tier = excluded.tier, status = excluded.status,
             footprint = excluded.footprint, rule_set_version = excluded.rule_set_version`);
    const clearTrace = db.prepare("delete from tier_traces where period_id = ? and company_id = ?");
    const insTrace = db.prepare(
      `insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
       values (?, ?, ?, ?, ?, ?)`);

    for (const c of payload.companies) {
      const key = normName(c.name);
      insCompany.run(c.name, key, period.id);
      const company = getCompany.get(key) as { id: string };
      result.companies++;
      insAlias.run(company.id, c.name, key, period.id);

      // --- identity: a graduation closes one interval and opens another ----
      const current = findIdent.all(company.id) as Array<{ id: string; exchange: string }>;
      const match = current.find((i) => i.exchange === c.exchange);
      if (!match) {
        for (const stale of current) {
          closeIdent.run(asOf, stale.id);
          result.graduations++;
        }
        insIdent.run(company.id, "root_ticker", c.ticker, c.exchange, asOf);
        result.identifiers++;
      }
      if (c.entity_id) {
        insIdent.run(company.id, "sp_entity_id", String(c.entity_id), null, asOf);
        result.identifiers++;
      }

      // --- facts: the immutable snapshot of what the file said -------------
      const fact = (fieldKey: string, raw: unknown, typed: unknown, assertion: string) => {
        insFact.run(period.id, company.id, fieldKey,
          raw === null || raw === undefined ? null : String(raw),
          typed === null || typed === undefined ? null : JSON.stringify(typed), assertion);
        result.facts++;
      };
      fact("company_name", c.name, c.name, "asserted");
      fact("root_ticker", c.ticker, c.ticker, "asserted");
      fact("exchange", c.exchange, c.exchange, "asserted");
      fact("market_cap_cad", c.market_cap, c.market_cap,
           c.market_cap === null ? "absent_blank" : "asserted");
      fact("commodities", c.commodities.join(", "), c.commodities, "asserted");
      fact("venture_graduate", c.venture_graduate, c.venture_graduate, "asserted");
      fact("auditor", c.auditor, c.auditor, c.auditor === null ? "absent_sentinel" : "asserted");

      // Region provenance decides the assertion, and the assertion is what
      // makes a safe re-upload possible.
      const prov = c.region_provenance ?? {};
      const anyRetained = Object.values(prov).includes("analyst_retained");
      if (anyRetained) result.preserved++;
      fact("property_regions", JSON.stringify(c.regions), c.regions,
           anyRetained ? "asserted" : (c.property_evidence === "none" ? "absent_blank" : "asserted"));

      // --- resolved values -------------------------------------------------
      const value = (fieldKey: string, v: unknown, source: string, state: string) => {
        upsertValue.run(period.id, company.id, fieldKey, JSON.stringify(v ?? null), source, state);
        result.values++;
      };
      value("company_name", c.name, "extract", "asserted");
      value("root_ticker", c.ticker, "extract", "asserted");
      value("exchange", c.exchange, "extract", "asserted");
      value("market_cap_cad", c.market_cap, "extract",
            c.market_cap === null ? "unknown" : "asserted");
      value("commodities", c.commodities, "extract", "asserted");
      value("venture_graduate", c.venture_graduate, "extract", "asserted");
      value("property_regions", c.regions, "extract",
            c.property_evidence === "none" ? "absent_confirmed" : "asserted");
      value("auditor", c.auditor, "extract", c.auditor === null ? "unknown" : "asserted");
      // Null where the source held a page title rather than a URL: that is an
      // enrichment target, not a website.
      value("website", c.website ?? null, "extract",
            c.website ? "asserted" : "unknown");
      value("stage_evidence_state", c.stage_evidence, "extract",
            c.stage_evidence === "none" ? "unknown" : "asserted");
      value("property_evidence_state", c.property_evidence, "derived", "asserted");

      // --- stage presence rows ---------------------------------------------
      for (const stage of c.stages) { insStage.run(period.id, company.id, stage); result.stages++; }

      // --- classification ---------------------------------------------------
      const propsCanada = (c.regions?.CANADA ?? []).length > 0;
      const propsAbroad = ABROAD.some((k) => (c.regions?.[k] ?? []).length > 0);
      const footprint = deriveFootprint(propsCanada, propsAbroad, c.property_evidence);
      const cls = classify({
        stages: c.stages, stageEvidence: c.stage_evidence,
        footprint, propertyEvidence: c.property_evidence,
      });
      insTier.run(period.id, company.id, cls.tier, cls.status, cls.footprint, cls.ruleSetVersion);
      result.tiers++;
      clearTrace.run(period.id, company.id);
      for (const t of cls.trace) {
        insTrace.run(period.id, company.id, t.ord, t.ruleId, JSON.stringify(t.inputs),
                     t.matched ? 1 : 0);
        result.traces++;
      }
      value("footprint", cls.footprint, "derived", "asserted");
      value("tier", cls.tier, "derived", cls.tier === null ? "unknown" : "asserted");
    }

    db.prepare(
      `insert into audit_log (event, actor_id, period_id, detail)
       values ('import_committed', ?, ?, ?)`,
    ).run(opts.actorId ?? null, period.id, JSON.stringify(result));

    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
  return result;
}
