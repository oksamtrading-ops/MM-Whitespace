import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.ts";
import { commitPeriod, type ParsedCompany, type Payload } from "./commit.ts";
import { isPostgresOnly, statements, toSqlite } from "./dialect.ts";

function company(over: Partial<ParsedCompany> = {}): ParsedCompany {
  return {
    ticker: "NRTH", exchange: "TSX", name: "Northco Mining Corp.", ordinal: 1,
    market_cap: 5_000_000_000,
    stages: ["production"], stage_evidence: "complete", property_evidence: "complete",
    regions: { CANADA: ["ON"], "LATIN AMERICA": ["Peru"] },
    region_provenance: { CANADA: "extract", "LATIN AMERICA": "extract" },
    commodities: ["Gold"], venture_graduate: false,
    auditor: "Deloitte", auditor_class: "big4", entity_id: null,
    tier_workbook: 4, footprint_workbook: "Canada & Abroad",
    ...over,
  };
}

function fresh(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  return db;
}

const payload = (companies: ParsedCompany[], period = "2026-05-31"): Payload =>
  ({ period, companies });

test("the canonical Postgres migrations apply, and the policy file is skipped", () => {
  const db = fresh();
  const r = applySchema(new DatabaseSync(":memory:"));
  // Assert the property, not the exact list -- a new migration is expected to
  // be applied and should not fail this test.
  assert.ok(r.applied.includes("0001_m1_core.sql"));
  assert.ok(r.applied.includes("0002_seed_catalog.sql"));
  assert.deepEqual(r.skipped, ["0003_roles_and_policies.sql"],
    "every Postgres-only migration must be skipped locally");
  assert.ok(!r.applied.some((f) => r.skipped.includes(f)));
  const tables = db.prepare(
    "select name from sqlite_master where type='table'").all().map((t: any) => t.name);
  for (const t of ["periods", "companies", "company_identifiers", "company_period_facts",
                   "company_period_field_values", "company_period_stages", "tiers",
                   "tier_traces", "field_catalog", "auditors"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
});

test("no CLIENT information is stored, and internal-but-not-client data is separated", () => {
  const db = fresh();
  // Client information is out of scope entirely: there is no column for it.
  const cols = db.prepare("pragma table_info(companies)").all().map((c: any) => c.name);
  assert.ok(!cols.includes("deloitte_tax_client"),
    "the POC stores no Deloitte client information");

  commitPeriod(db, payload([company({ dtt_market: "Ontario" })]));

  // The Deloitte market IS stored. It is internal but not client data -- the
  // firm's own geographic label on a public company, identifying no client --
  // so it is classified deloitte_internal and hidden from Viewers by policy.
  // That leaves the classification mechanism exercised by a live row rather
  // than by none, which is what a due-diligence review needs to inspect.
  const internal = db.prepare(
    `select distinct v.field_key from company_period_field_values v
       join field_catalog f on f.key = v.field_key
      where f.classification = 'deloitte_internal'
        and v.value is not null and v.value != 'null'`).all() as Array<{ field_key: string }>;
  assert.deepEqual(internal.map((r) => r.field_key), ["dtt_market"],
    "dtt_market is the ONLY internal field carrying values; anything else is a leak");
});

test("committing twice is idempotent", () => {
  const db = fresh();
  const a = commitPeriod(db, payload([company(), company({ ticker: "STHC", name: "Southco Ltd." })]));
  const b = commitPeriod(db, payload([company(), company({ ticker: "STHC", name: "Southco Ltd." })]));
  assert.equal(a.periodId, b.periodId);
  for (const table of ["companies", "company_period_facts", "company_period_field_values",
                       "tiers", "tier_traces", "company_period_stages"]) {
    const n = db.prepare(`select count(*) n from ${table}`).get() as { n: number };
    assert.ok(n.n > 0, `${table} should hold rows`);
  }
  const dupes = db.prepare("select count(*) n from companies").get() as { n: number };
  assert.equal(dupes.n, 2, "a re-commit must not duplicate companies");
  // b.identifiers is 0 by design -- the second commit attempts no inserts.
  // What must hold is that the TABLE is unchanged.
  const idents = db.prepare("select count(*) n from company_identifiers").get() as { n: number };
  assert.equal(idents.n, a.identifiers, "a re-commit must not add identifier rows");
});

test("an identifier with no exchange does not re-insert on every import", () => {
  // Regression: the unique constraint included `exchange`, and NULLs are
  // distinct in both dialects, so all 143 entity identifiers were inserted
  // again on each re-import.
  const db = fresh();
  const withId = company({ entity_id: "1234567" });
  commitPeriod(db, payload([withId]));
  const first = db.prepare(
    "select count(*) n from company_identifiers where scheme = 'sp_entity_id'").get() as { n: number };
  commitPeriod(db, payload([withId]));
  const second = db.prepare(
    "select count(*) n from company_identifiers where scheme = 'sp_entity_id'").get() as { n: number };
  assert.equal(first.n, 1);
  assert.equal(second.n, 1, "a re-import must not duplicate an exchange-less identifier");
});

test("a manual override survives a re-import; the database enforces it, not the caller", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company()]));
  const co = db.prepare("select id from companies limit 1").get() as { id: string };

  db.prepare(
    `update company_period_field_values set value = ?, source = 'manual_override'
      where period_id = ? and company_id = ? and field_key = 'auditor'`,
  ).run(JSON.stringify("KPMG"), r.periodId, co.id);

  // Re-import claims Deloitte again. The conditional upsert must refuse.
  commitPeriod(db, payload([company({ auditor: "Deloitte" })]));
  const row = db.prepare(
    `select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'auditor'`,
  ).get(r.periodId, co.id) as { value: string; source: string };
  assert.equal(row.source, "manual_override");
  assert.equal(JSON.parse(row.value), "KPMG");
});

test("an extract value IS updated by a re-import", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company({ market_cap: 1 })]));
  const co = db.prepare("select id from companies limit 1").get() as { id: string };
  commitPeriod(db, payload([company({ market_cap: 2 })]));
  const row = db.prepare(
    `select value, source from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'market_cap_cad'`,
  ).get(r.periodId, co.id) as { value: string; source: string };
  assert.equal(row.source, "extract");
  assert.equal(JSON.parse(row.value), 2);
});

test("a frozen value is never overwritten, even when its source is extract", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company({ market_cap: 1 })]));
  const co = db.prepare("select id from companies limit 1").get() as { id: string };
  db.prepare(
    `update company_period_field_values set frozen_at = (datetime('now'))
      where period_id = ? and company_id = ? and field_key = 'market_cap_cad'`,
  ).run(r.periodId, co.id);
  commitPeriod(db, payload([company({ market_cap: 999 })]));
  const row = db.prepare(
    `select value from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'market_cap_cad'`,
  ).get(r.periodId, co.id) as { value: string };
  assert.equal(JSON.parse(row.value), 1, "publish freezes a value; a re-import must not move it");
});

test("an analyst-retained region is recorded as asserted, not as absent", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company({
    regions: { CANADA: ["NT"] },
    region_provenance: { CANADA: "analyst_retained" },
  })]));
  assert.equal(r.preserved, 1);
  const fact = db.prepare(
    `select assertion from company_period_facts
      where period_id = ? and field_key = 'property_regions'`).get(r.periodId) as { assertion: string };
  assert.equal(fact.assertion, "asserted",
    "a carried-forward value must not be recorded as absence, or the next import deletes it");
});

test("a venture graduation closes one identifier interval and opens another on the same company", () => {
  const db = fresh();
  commitPeriod(db, payload([company({ ticker: "GRAD", exchange: "TSXV" })], "2026-05-31"));
  const before = db.prepare("select count(*) n from companies").get() as { n: number };

  commitPeriod(db, payload([company({ ticker: "GRAD", exchange: "TSX" })], "2026-08-31"));
  const after = db.prepare("select count(*) n from companies").get() as { n: number };
  assert.equal(after.n, before.n, "a graduation is not a drop-out plus a new entrant");

  const ids = db.prepare(
    `select exchange, valid_to from company_identifiers
      where scheme = 'root_ticker' order by valid_from`).all() as Array<{ exchange: string; valid_to: string | null }>;
  assert.equal(ids.length, 2);
  assert.equal(ids[0].exchange, "TSXV");
  assert.equal(ids[0].valid_to, "2026-08-31", "the venture interval closes");
  assert.equal(ids[1].exchange, "TSX");
  assert.equal(ids[1].valid_to, null, "the senior interval is open");
});

test("a published period cannot be re-committed, and an earlier period is refused", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company()], "2026-05-31"));
  db.prepare("update periods set status = 'published' where id = ?").run(r.periodId);

  assert.throws(() => commitPeriod(db, payload([company()], "2026-05-31")),
    /already published/);
  assert.throws(() => commitPeriod(db, payload([company()], "2026-02-28")),
    /predates the published period/);
});

test("the trace is stored rule by rule, not as a sentence", () => {
  const db = fresh();
  const r = commitPeriod(db, payload([company({ stages: [], stage_evidence: "none" })]));
  const trace = db.prepare(
    `select ord, rule_id, matched from tier_traces where period_id = ? order by ord`,
  ).all(r.periodId) as Array<{ rule_id: string; matched: number }>;
  assert.equal(trace.length, 1);
  assert.equal(trace[0].rule_id, "guard_no_stage_evidence");
  assert.equal(trace[0].matched, 1);
  const tier = db.prepare("select tier, status from tiers where period_id = ?")
    .get(r.periodId) as { tier: number | null; status: string };
  assert.equal(tier.tier, null);
  assert.equal(tier.status, "unclassified_no_stage_evidence");
});

test("a failed commit rolls back entirely", () => {
  const db = fresh();
  assert.throws(() => commitPeriod(db, payload([company(), company({ stages: ["bogus" as any] })])));
  const n = db.prepare("select count(*) n from companies").get() as { n: number };
  assert.equal(n.n, 0, "a rejected stage must not leave a half-written period behind");
});

test("the dialect refuses what it cannot faithfully translate", () => {
  assert.throws(() => toSqlite("create trigger t before insert on x begin end;"), /triggers/);
  assert.throws(() => toSqlite("select * from (values (1)) as v(a);"), /VALUES/);
  assert.ok(isPostgresOnly("create policy p on t for select using (true);"));
  assert.ok(!isPostgresOnly("create table t (id uuid primary key);"));
  assert.match(toSqlite("id uuid primary key default gen_random_uuid()"), /randomblob/);
  assert.equal(statements("select 1; -- a ; comment\nselect 2;").length, 2);
});
