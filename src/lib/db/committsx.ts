/**
 * Commit next quarter's period from TSX's list of mining issuers.
 *
 * The plan (ingest/tsx.ts) says who is in the population and which company
 * each issuer is. This writes it, in one transaction:
 *
 *   - TSX's own fields, from the file: name, ticker, exchange and market cap
 *     always; commodities, venture graduation, head office and property
 *     regions too, unless the last period's value was settled in review
 *     (accepted research or an override), which a list does not overrule.
 *   - Everything else, carried from the last published revision as
 *     `inherited`, with the period it came from, so every screen can say how
 *     old it is and cite what it cited there. The stage rows come with the
 *     stage state.
 *   - A company new to the population: TSX's fields, nothing researched yet,
 *     and the Deloitte market its head office implies.
 *   - Tiers, recomputed from all of that by the same rules as review's retier.
 *
 * Where the list says nothing -- no region marked, no head office it can
 * read -- the last period's value stands. Five companies in the September
 * 2026 list mark no region at all, and each is one of the workbook's five
 * analyst-added regions; reading silence as "none" would have deleted them.
 *
 * Nothing here touches the period it rolls forward from, or its snapshot.
 */
import { insertMany, type Sql } from "./sql.ts";
import { normName, periodAdmissibility } from "./commit.ts";
import { citationOf, settledInReview } from "../profile/citations.ts";
import { classifyResolved } from "../review/resolve.ts";
import { RULE_SET_VERSION, type Evidence, type Stage } from "../tiering/index.ts";
import { anyRegion, deloitteMarketFor, loadTsxPlan, type TsxIssuer, type TsxPlan } from "../ingest/tsx.ts";

/** The fields TSX's list carries. */
export const TSX_FIELDS = [
  "company_name", "root_ticker", "exchange", "market_cap_cad",
  "commodities", "venture_graduate", "head_office_region", "property_regions",
] as const;

/** The list is the authority on these, whatever review said last period. */
const ALWAYS_FROM_LIST = new Set(["company_name", "root_ticker", "exchange", "market_cap_cad"]);

/** Recomputed from the rest, never carried. */
const DERIVED = new Set(["tier", "footprint", "property_evidence_state"]);

export type TsxCommitResult = {
  periodId: string; label: string; basedOn: { label: string; revision: number };
  population: number; continuing: number; entrants: number; dropOuts: number;
  values: number; inherited: number; fromList: number; facts: number; stages: number;
  tiers: number; traces: number; identifiers: number;
  /** Entrants whose head office is in a province with no market yet. */
  unmappedMarkets: string[];
};

type BaseRow = { company_id: string; field_key: string; value: string | null; source: string;
                 evidence_state: string | null; sources: unknown };

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};

export async function commitTsxPeriod(
  db: Sql,
  payload: { kind?: string; period: string | null; companies: unknown[] },
  opts: { label: string; sourceSha256?: string; actorId?: string | null },
): Promise<TsxCommitResult> {
  if (payload.kind !== "tsx_list") throw new Error("this is not a parsed TSX list");
  const asOf = payload.period;
  if (!asOf) throw new Error("payload has no period date; the parser must resolve one before commit");
  const label = opts.label.trim();
  if (!label) throw new Error("name the period before committing");

  let result: TsxCommitResult | null = null;
  await db.tx(async (db) => {
    const plan: TsxPlan = await loadTsxPlan(db, payload);
    if (plan.blocking.length > 0) throw new Error(plan.blocking.join(" "));
    const base = plan.base!;

    const why = await periodAdmissibility(db, asOf);
    if (why) throw new Error(why);
    // A list makes a new period; it never adds to one already committed. The
    // plan has refused any period after the base, so a name taken is the
    // base's own or an older one's.
    if (await db.get("select 1 as taken from periods where label = ?", label)) {
      throw new Error(`A period is already named "${label}". Name this one differently.`);
    }

    // The Admin's threshold is copied onto the period, as commitPeriod does.
    const t = plan.threshold;
    await db.run(`insert into periods (label, market_cap_as_of, source_file_sha256, rule_set_version,
                     threshold_amount, threshold_operator, threshold_currency, proximity_band_pct, source_kind)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'tsx_list')`,
      label, asOf, opts.sourceSha256 ?? null, RULE_SET_VERSION, t.amount, t.operator, t.currency, t.bandPct);
    const periodId = String((await db.get("select id from periods where label = ?", label) as { id: string }).id);

    // --- the last published revision, read once ----------------------------
    const baseRows = await db.all(`select company_id, field_key, value, source, evidence_state, sources
        from published_period_values where publication_id = ?`, base.publicationId) as BaseRow[];
    const baseBy = new Map<string, Map<string, BaseRow>>();
    for (const r of baseRows) {
      const id = String(r.company_id);
      if (!baseBy.has(id)) baseBy.set(id, new Map());
      baseBy.get(id)!.set(r.field_key, r);
    }
    const baseStages = new Map<string, Stage[]>();
    for (const r of await db.all(`select company_id, stage from published_period_stages where publication_id = ?`,
        base.publicationId) as Array<{ company_id: string; stage: Stage }>) {
      const id = String(r.company_id);
      baseStages.set(id, [...(baseStages.get(id) ?? []), r.stage]);
    }
    const openTickers = new Map<string, Array<{ id: string; value: string; exchange: string | null }>>();
    for (const r of await db.all(`select id, company_id, value, exchange from company_identifiers
        where scheme = 'root_ticker' and valid_to is null`) as
        Array<{ id: string; company_id: string; value: string; exchange: string | null }>) {
      const id = String(r.company_id);
      openTickers.set(id, [...(openTickers.get(id) ?? []), { id: String(r.id), value: String(r.value), exchange: r.exchange }]);
    }

    // Where a carried value came from: the base period, or -- for a value the
    // base had itself carried -- the period its frozen citation names.
    const originOf = (row: BaseRow): string => {
      if (row.source !== "inherited") return base.periodId;
      const c = citationOf(parse(row.sources));
      return (c?.kind === "prior_period" && c.periodId) ? c.periodId : base.periodId;
    };

    const facts: unknown[][] = [];
    const values: unknown[][] = [];
    const stages: unknown[][] = [];
    const tiers: unknown[][] = [];
    const traces: unknown[][] = [];
    const aliases: unknown[][] = [];
    const identifiers: unknown[][] = [];
    const unmappedMarkets: string[] = [];
    let inherited = 0, fromList = 0;

    for (const p of plan.population) {
      const i: TsxIssuer = p.issuer;
      let companyId = p.companyId;
      if (!companyId) {
        await db.run(`insert into companies (canonical_name, name_normalized, first_seen_period_id)
            values (?, ?, ?)`, i.name, normName(i.name), periodId);
        companyId = String((await db.get("select id from companies where name_normalized = ?", normName(i.name)) as
          { id: string }).id);
      }
      aliases.push([companyId, i.name, normName(i.name), "source_variant", periodId, "tsx_list"]);

      // --- identity: a new ticker or exchange closes one interval, opens another
      const open = openTickers.get(companyId) ?? [];
      if (!open.some((o) => o.value.toUpperCase() === i.ticker.toUpperCase() && o.exchange === i.exchange)) {
        for (const o of open) await db.run("update company_identifiers set valid_to = ? where id = ?", asOf, o.id);
        identifiers.push([companyId, "root_ticker", i.ticker, i.exchange, asOf, "tsx_list"]);
      }

      const prior = p.prior ? baseBy.get(companyId) ?? new Map<string, BaseRow>() : new Map<string, BaseRow>();
      const resolved = new Map<string, unknown>();
      const put = (field: string, value: unknown, source: string, evidence: string, from: string | null = null) => {
        values.push([periodId, companyId, field, JSON.stringify(value ?? null), source, evidence, from]);
        resolved.set(field, value ?? null);
      };
      const carry = (field: string, row: BaseRow) => {
        put(field, parse(row.value), "inherited", row.evidence_state ?? "unknown", originOf(row));
        inherited++;
      };
      const fact = (field: string, value: unknown, assertion: string) => {
        facts.push([periodId, companyId, field,
          value === null || value === undefined ? null : (typeof value === "string" ? value : JSON.stringify(value)),
          JSON.stringify(value ?? null), assertion]);
      };

      // --- TSX's fields -------------------------------------------------------
      const listSays: Record<(typeof TSX_FIELDS)[number], { value: unknown; says: boolean; evidence: string }> = {
        company_name: { value: i.name, says: true, evidence: "asserted" },
        root_ticker: { value: i.ticker, says: true, evidence: "asserted" },
        exchange: { value: i.exchange, says: true, evidence: "asserted" },
        market_cap_cad: { value: i.market_cap, says: true, evidence: i.market_cap === null ? "unknown" : "asserted" },
        commodities: { value: i.commodities ?? [], says: (i.commodities ?? []).length > 0, evidence: "asserted" },
        venture_graduate: { value: Boolean(i.venture_graduate), says: true, evidence: "asserted" },
        head_office_region: { value: i.head_office_region, says: Boolean(i.head_office_region), evidence: "asserted" },
        property_regions: { value: i.regions ?? {}, says: anyRegion(i.regions), evidence: "asserted" },
      };
      for (const field of TSX_FIELDS) {
        const said = listSays[field];
        const before = prior.get(field);
        const fromFile = ALWAYS_FROM_LIST.has(field) || !before || (said.says && !settledInReview(before));
        if (fromFile) {
          // Silence from a company new to the population is still the file's
          // word, recorded as such: blank, not a value.
          const blank = said.value === null || !said.says;
          put(field, said.value, "extract", blank ? "unknown" : said.evidence);
          fact(field, said.value, blank ? "absent_blank" : "asserted");
          fromList++;
        } else {
          carry(field, before!);
        }
      }

      // --- everything else ------------------------------------------------------
      if (p.prior) {
        for (const [field, row] of prior) {
          if ((TSX_FIELDS as readonly string[]).includes(field) || DERIVED.has(field)) continue;
          carry(field, row);
        }
        for (const s of baseStages.get(companyId) ?? []) stages.push([periodId, companyId, s]);
      } else {
        // New to the population: nothing researched, the file's silence.
        put("auditor", null, "extract", "unknown");
        put("website", null, "extract", "unknown");
        put("stage_evidence_state", "none", "extract", "unknown");
        const m = deloitteMarketFor(i.head_office_region);
        if (m.unmapped) unmappedMarkets.push(`${i.name} (${i.ticker}): ${i.head_office_region}`);
        put("dtt_market", m.market, "derived", m.market ? "asserted" : "unknown");
      }

      // --- classification, exactly as retier does it ---------------------------
      const { propertyEvidence, cls } = classifyResolved({
        stageEvidence: (resolved.get("stage_evidence_state") ?? "none") as Evidence,
        stages: p.prior ? baseStages.get(companyId) ?? [] : [],
        regions: resolved.get("property_regions") as Record<string, string[]> | null,
        storedPropertyEvidence: (parse(prior.get("property_evidence_state")?.value ?? null) ?? "none") as Evidence,
      });
      tiers.push([periodId, companyId, cls.tier, cls.status, cls.footprint, cls.ruleSetVersion]);
      for (const tr of cls.trace) {
        traces.push([periodId, companyId, tr.ord, tr.ruleId, JSON.stringify(tr.inputs), tr.matched]);
      }
      put("property_evidence_state", propertyEvidence, "derived", "asserted");
      put("footprint", cls.footprint, "derived", "asserted");
      put("tier", cls.tier, "derived", cls.tier === null ? "unknown" : "asserted");
    }

    await insertMany(db, "company_aliases",
      ["company_id", "name", "name_normalized", "alias_type", "first_seen_period_id", "source"], aliases,
      "on conflict do nothing");
    await insertMany(db, "company_identifiers",
      ["company_id", "scheme", "value", "exchange", "valid_from", "source"], identifiers, "on conflict do nothing");
    await insertMany(db, "company_period_facts",
      ["period_id", "company_id", "field_key", "raw_value", "typed_value", "assertion"], facts);
    await insertMany(db, "company_period_field_values",
      ["period_id", "company_id", "field_key", "value", "source", "evidence_state", "source_period_id"], values);
    await insertMany(db, "company_period_stages", ["period_id", "company_id", "stage"], stages);
    await insertMany(db, "tiers",
      ["period_id", "company_id", "tier", "status", "footprint", "rule_set_version"], tiers);
    await insertMany(db, "tier_traces",
      ["period_id", "company_id", "ord", "rule_id", "inputs", "matched"], traces);

    result = {
      periodId, label, basedOn: { label: base.label, revision: base.revision },
      population: plan.population.length, continuing: plan.continuing.length,
      entrants: plan.entrants.length, dropOuts: plan.dropOuts.length,
      values: values.length, inherited, fromList, facts: facts.length, stages: stages.length,
      tiers: tiers.length, traces: traces.length, identifiers: identifiers.length, unmappedMarkets,
    };
    await db.run(`insert into audit_log (event, actor_id, period_id, detail) values ('import_committed', ?, ?, ?)`,
      opts.actorId ?? null, periodId, JSON.stringify({
        kind: "tsx_list", ...result,
        dropOutsBelowThreshold: plan.dropOuts.filter((d) => d.reason === "below_threshold").length,
        dropOutsNotListed: plan.dropOuts.filter((d) => d.reason === "not_listed").length,
      }));
  });
  return result!;
}
