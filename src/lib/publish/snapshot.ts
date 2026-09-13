/**
 * Freeze the snapshot.
 *
 * Publish is a transactional job, not a button that returns instantly. It
 * resolves precedence exactly ONCE -- override beats accepted finding beats
 * extract -- writes the result, and precomputes every aggregate a dashboard
 * needs. After that a dashboard query is a single-table group-by that stays
 * flat as periods accumulate.
 *
 * Corrections after publish are AMENDMENTS that bump the revision. Nothing is
 * ever mutated in place, which is what makes period comparison trustworthy.
 */
import { insertMany, type Sql } from "../db/sql.ts";
import { evaluateGate, overrideBanner, type Blocker, type GateResult } from "./gate.ts";

export class PublishBlocked extends Error {
  blockers: Blocker[];
  gate: GateResult;
  constructor(gate: GateResult) {
    super(
      "publish blocked:\n" + gate.blockers.map((b) => `  - ${b.detail}`).join("\n") +
      "\n  An Admin may override with a reason, which is then printed on the dashboard header.",
    );
    this.name = "PublishBlocked";
    this.blockers = gate.blockers;
    this.gate = gate;
  }
}

export type PublishOptions = {
  actorId?: string | null;
  /** Supplying a reason is what makes an Admin override an override. */
  overrideReason?: string | null;
  amendmentReason?: string | null;
};

export type PublishResult = {
  publicationId: string;
  periodId: string;
  revision: number;
  companies: number;
  values: number;
  aggregates: number;
  unresolvedCount: number;
  overridden: boolean;
  banner: string | null;
};

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function publishPeriod(
  db: Sql, periodId: string, opts: PublishOptions = {},
): Promise<PublishResult> {
  const gate = await evaluateGate(db, periodId);
  if (!(await gate).publishable && !opts.overrideReason) throw new PublishBlocked(await gate);

  const prior = await db.get(`select p.id, p.label from periods p
      where p.status = 'published' and p.market_cap_as_of <
            (select market_cap_as_of from periods where id = ?)
      order by p.market_cap_as_of desc limit 1`, periodId) as
    { id: string; label: string } | undefined;

  const priorPublication = prior
    ? await db.get(`select id from period_publications where period_id = ?
          order by revision desc limit 1`, prior.id) as { id: string } | undefined
    : undefined;

  const result: PublishResult = {
    publicationId: "", periodId, revision: 1, companies: 0, values: 0,
    aggregates: 0, unresolvedCount:(await gate).unresolvedCount,
    overridden: Boolean(opts.overrideReason), banner: null,
  };

  // One transaction on ONE connection. `db.exec("begin")` looked like this and
  // was not: against a pool, begin, every statement and commit can each land
  // on a different connection -- no atomicity, and a connection returned to
  // the pool still inside a transaction. The callback's `db` shadows the outer
  // one on purpose, so nothing in the body can reach past the transaction.
  await db.tx(async (db) => {
    // An amendment is a new revision, never a mutation of the last one.
    const last = await db.get("select coalesce(max(revision), 0) r from period_publications where period_id = ?", periodId) as { r: number };
    const revision = last.r + 1;
    result.revision = revision;

    await db.run(`insert into period_publications
         (period_id, revision, published_by, unresolved_count,
          override_reason, override_by, amendment_reason)
       values (?, ?, ?, ?, ?, ?, ?)`, periodId, revision, opts.actorId ?? null,(await gate).unresolvedCount,
          opts.overrideReason ?? null,
          opts.overrideReason ? (opts.actorId ?? null) : null,
          revision > 1 ? (opts.amendmentReason ?? "amendment") : null);

    const pub = await db.get(`select id from period_publications where period_id = ? and revision = ?`, periodId, revision) as { id: string };
    result.publicationId = pub.id;

    // --- freeze the resolved values ------------------------------------
    // Precedence is already resolved in company_period_field_values: the
    // conditional upsert in the commit path can only ever overwrite an extract
    // value, so an override or accepted finding standing there IS the winner.
    const values = await db.all(`select company_id, field_key, value, source, evidence_state
         from company_period_field_values where period_id = ?`, periodId) as
      Array<{ company_id: string; field_key: string; value: string;
              source: string; evidence_state: string }>;

    result.values = await insertMany(db, "published_period_values",
      ["publication_id", "company_id", "field_key", "value", "source", "evidence_state"],
      values.map((v) => [pub.id, v.company_id, v.field_key, v.value, v.source, v.evidence_state]));

    // --- freeze the tiers, with the migration against the prior period ---
    const tiers = await db.all(`select company_id, tier, status, footprint, rule_set_version
         from tiers where period_id = ?`, periodId) as
      Array<{ company_id: string; tier: number | null; status: string;
              footprint: string; rule_set_version: string }>;

    // The prior period's tiers in one read rather than one per company. A
    // company the prior publication never held, and one it held with no tier,
    // are both "no prior tier" here, exactly as the per-row lookup had it.
    const priorTiers = new Map<string, number | null>();
    if (priorPublication) {
      for (const row of await db.all(`select company_id, tier from published_period_tiers
          where publication_id = ?`, priorPublication.id) as
        Array<{ company_id: string; tier: number | null }>) {
        priorTiers.set(String(row.company_id), row.tier === null ? null : Number(row.tier));
      }
    }

    result.companies = await insertMany(db, "published_period_tiers",
      ["publication_id", "company_id", "tier", "status", "footprint",
       "rule_set_version", "prior_tier", "tier_changed"],
      tiers.map((t) => {
        const priorValue = priorTiers.get(t.company_id) ?? null;
        return [pub.id, t.company_id, t.tier, t.status, t.footprint, t.rule_set_version,
                priorValue, priorValue === null ? null : (priorValue === t.tier ? 0 : 1)];
      }));

    // --- precompute the aggregates --------------------------------------
    const agg =
      `insert into publication_aggregates (publication_id, kind, bucket, sub_bucket, n)
       values (?, ?, ?, ?, ?)
       on conflict (publication_id, kind, bucket, sub_bucket) do update
         set n = publication_aggregates.n + excluded.n`;
    const count = async (kind: string, bucket: string, sub: string, n: number) => {
      await db.run(agg, pub.id, kind, bucket, sub, n);
      result.aggregates++;
    };

    for (const row of await db.all(`select coalesce(cast(tier as text), status) b, count(*) n
         from published_period_tiers where publication_id = ? group by b`, pub.id) as Array<{ b: string; n: number }>) {
      await count("tier_distribution", row.b, "-", row.n);
    }
    for (const row of await db.all(`select footprint b, count(*) n from published_period_tiers
        where publication_id = ? group by b`, pub.id) as Array<{ b: string; n: number }>) {
      await count("footprint", row.b, "-", row.n);
    }
    for (const row of await db.all(`select value b, count(*) n from published_period_values
        where publication_id = ? and field_key = 'exchange' group by b`, pub.id) as Array<{ b: string; n: number }>) {
      await count("exchange", JSON.parse(row.b) as string, "-", row.n);
    }
    // The auditor cross-tab: firm by tier.
    for (const row of await db.all(`select v.value firm, coalesce(cast(t.tier as text), t.status) band, count(*) n
         from published_period_values v
         join published_period_tiers t
           on t.publication_id = v.publication_id and t.company_id = v.company_id
        where v.publication_id = ? and v.field_key = 'auditor'
        group by firm, band`, pub.id) as Array<{ firm: string; band: string; n: number }>) {
      const firm = row.firm === "null" ? "unknown" : (JSON.parse(row.firm) ?? "unknown");
      await count("auditor_by_tier", String(firm), row.band, row.n);
    }
    // Market, with the foreign-HQ bucket counted rather than dropped: 53 of 259
    // is a fifth of the population, and a partner reading five market bars
    // would otherwise sum 206 with no way to know.
    for (const row of await db.all(`select value b, count(*) n from published_period_values
        where publication_id = ? and field_key = 'dtt_market' group by b`, pub.id) as Array<{ b: string; n: number }>) {
      const market = row.b === "null" ? null : (JSON.parse(row.b) as string | null);
      await count("market", market ?? "__foreign_hq__", "-", row.n);
    }

    // Property footprint by jurisdiction. Unnested here rather than in SQL,
    // because the axis must be derived from a distinct query over the
    // normalised values -- a hardcoded list silently drops a new jurisdiction.
    const CANADA = "CANADA";
    const regionRows = await db.all(`select value v from published_period_values
        where publication_id = ? and field_key = 'property_regions'`, pub.id) as Array<{ v: string }>;
    const province = new Map<string, number>();
    const foreign = new Map<string, number>();
    for (const r of regionRows) {
      let regions: Record<string, string[]>;
      try { regions = JSON.parse(r.v) ?? {}; } catch { continue; }
      for (const [group, values] of Object.entries(regions)) {
        for (const value of values ?? []) {
          const target = group === CANADA ? province : foreign;
          target.set(value, (target.get(value) ?? 0) + 1);
        }
      }
    }
    for (const [k, n] of province) await count("province_footprint", k, "-", n);
    for (const [k, n] of foreign) await count("jurisdiction_footprint", k, "-", n);

    // Auditor share. "Unknown" is its own bucket and will be the longest bar --
    // that is the actual finding, not a gap to hide.
    for (const row of await db.all(`select value b, count(*) n from published_period_values
        where publication_id = ? and field_key = 'auditor' group by b`, pub.id) as Array<{ b: string; n: number }>) {
      const firm = row.b === "null" ? null : (JSON.parse(row.b) as string | null);
      await count("auditor_share", firm ?? "__unknown__", "-", row.n);
    }

    // The migration matrix, prior band to current band.
    if (priorPublication) {
      for (const row of await db.all(`select coalesce(cast(prior_tier as text), 'none') from_band,
                coalesce(cast(tier as text), status) to_band, count(*) n
           from published_period_tiers where publication_id = ?
          group by from_band, to_band`, pub.id) as
        Array<{ from_band: string; to_band: string; n: number }>) {
        await count("migration", row.from_band, row.to_band, row.n);
      }
    }
    // Per-field coverage, frozen so the dashboard never recomputes it.
    for (const c of gate.coverage) {
      await count("coverage", c.chart, "resolved", c.resolved);
      await count("coverage", c.chart, "population", c.population);
    }

    await db.run("update periods set status = 'published', published_at = ?, published_by = ?, revision = ? where id = ?", stamp(), opts.actorId ?? null, revision, periodId);

    // Freeze the source rows so a re-import cannot move a published value. The
    // conditional upsert in the commit path already refuses a frozen row.
    await db.run("update company_period_field_values set frozen_at = ? where period_id = ?", stamp(), periodId);

    await db.run(`insert into audit_log (event, actor_id, period_id, detail)
       values (?, ?, ?, ?)`, revision > 1 ? "period_amended" : "period_published",
          opts.actorId ?? null, periodId,
          JSON.stringify({
            publicationId: pub.id, revision,
            unresolvedCount:(await gate).unresolvedCount,
            overridden: Boolean(opts.overrideReason),
            overrideReason: opts.overrideReason ?? null,
            amendmentReason: revision > 1 ? (opts.amendmentReason ?? "amendment") : null,
            blockers:(await gate).blockers.map((b) => b.detail),
          }));

  });

  if (opts.overrideReason) {
    result.banner = overrideBanner(opts.overrideReason,(await gate).blockers, stamp());
  }
  return result;
}

/** What a dashboard reads. Never the live tables. */
export async function readPublished(db: Sql, periodId: string) {
  const pub = await db.get(`select id, revision, published_at, published_by, override_reason, unresolved_count
       from period_publications where period_id = ? order by revision desc limit 1`, periodId) as {
    id: string; revision: number; published_at: string; published_by: string | null;
    override_reason: string | null; unresolved_count: number;
  } | undefined;
  if (!pub) return null;

  const aggregates = await db.all(`select kind, bucket, sub_bucket, n from publication_aggregates
      where publication_id = ? order by kind, n desc`, pub.id) as
    Array<{ kind: string; bucket: string; sub_bucket: string; n: number }>;

  const byKind: Record<string, Array<{ bucket: string; sub: string; n: number }>> = {};
  for (const a of aggregates) {
    (byKind[a.kind] ??= []).push({ bucket: a.bucket, sub: a.sub_bucket, n: a.n });
  }
  return { publication: pub, aggregates: byKind };
}
