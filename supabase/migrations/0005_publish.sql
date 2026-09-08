-- Publish: freeze an immutable snapshot, and gate it.
--
-- Every dashboard reads ONLY the frozen snapshot. Re-deriving the effective
-- value of each field -- override beats accepted finding beats extract -- in a
-- dozen queries would implement the precedence rule a dozen times and let it
-- diverge, reintroducing by architecture the same defect as two tier tables
-- disagreeing on one screen.
--
-- IMMUTABILITY IS BY CONSTRUCTION, NOT BY TRIGGER. Every publish inserts into a
-- fresh publication_id, and a correction after publish is an AMENDMENT that
-- bumps the revision rather than an in-place mutation. So no code path updates
-- a published row, and there is nothing for a trigger to defend. That also
-- keeps the migration portable: Postgres and SQLite trigger syntax do not
-- agree, and a trigger here would have forced a second, drifting schema.
-- 0003 additionally revokes update and delete on Postgres, belt and braces.

create table period_publications (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references periods(id),
  revision       int not null,
  published_at   timestamptz not null default now(),
  published_by   uuid references app_users(id),
  -- The count of companies still carrying an unresolved value at publish. It
  -- is recorded rather than prevented: a period may legitimately publish with
  -- unresolved fields, and the number belongs on the audit trail.
  unresolved_count int not null default 0,
  -- Set only when an Admin published through a blocked gate. It is PRINTED ON
  -- THE DASHBOARD HEADER, which is the mechanism that stops a stale-data
  -- warning becoming a banner nobody reads.
  override_reason  text,
  override_by      uuid references app_users(id),
  -- An amendment says why it exists.
  amendment_reason text,
  check (revision >= 1),
  unique (period_id, revision)
);
create index period_publications_period_idx on period_publications (period_id, revision);

-- Roughly 259 companies by 15 fields is about 4,000 rows per period: trivial to
-- store, and it buys a single-table group-by that stays flat as periods
-- accumulate, precedence resolved exactly once, and a genuinely immutable
-- published period.
create table published_period_values (
  publication_id    uuid not null references period_publications(id),
  company_id        uuid not null references companies(id),
  field_key         text not null references field_catalog(key),
  value             jsonb,
  source            text not null,
  evidence_state    text,
  finding_id        uuid,
  sources           jsonb,
  excerpt           text,
  model             text,
  prompt_version    text,
  evidence_strength numeric(4,3),
  primary key (publication_id, company_id, field_key)
);
create index published_period_values_field_idx on published_period_values (publication_id, field_key);

-- The tier as published, frozen beside the values so a dashboard never has to
-- join back to a mutable table.
create table published_period_tiers (
  publication_id   uuid not null references period_publications(id),
  company_id       uuid not null references companies(id),
  tier             smallint check (tier between 1 and 6),
  status           text not null,
  footprint        text not null,
  rule_set_version text not null,
  prior_tier       smallint,
  tier_changed     boolean,
  primary key (publication_id, company_id)
);

-- Precomputed at publish: proof totals, per-field coverage and evidence
-- aggregates, the cross-tabs, and the migration matrix against the prior
-- published period.
create table publication_aggregates (
  publication_id uuid not null references period_publications(id),
  kind           text not null,
  bucket         text not null,
  sub_bucket     text,
  n              int not null,
  primary key (publication_id, kind, bucket, sub_bucket)
);

-- A judgement about how much of a chart may be missing before the chart
-- misleads. Engineering has no basis for setting these; the practice does, so
-- they are rows rather than constants. Decision 10 records the starting values.
create table coverage_floors (
  chart          text primary key,
  label          text not null,
  driving_field  text not null,
  floor_pct      numeric(5,2),          -- null means no floor
  blocks_publish boolean not null default true
);

insert into coverage_floors (chart, label, driving_field, floor_pct, blocks_publish) values
  ('tier_distribution',     'Tier distribution',            'stage_evidence_state',    95.00, true),
  ('footprint',             'Footprint',                    'footprint',               95.00, true),
  ('province_jurisdiction', 'Province and jurisdiction',    'property_regions',        90.00, true),
  ('auditor_crosstab',      'Auditor cross-tab',            'auditor',                 90.00, true),
  -- Fee coverage is a floor with a NAMED COUNT, never a percentage: "found for
  -- 61 of 259" is honest, where "24%" invites the question of what the other
  -- 76% are, and the answer is not "no fees" but "not disclosed where we may
  -- look". So no percentage floor, and it never blocks a publish.
  ('fee_views',             'Audit and tax fees',           'audit_fee',                null, false);

-- The ceiling on the per-run fabrication rate. Above this a publish is blocked.
-- Abstentions are excluded from the rate by hallucinationRate(); an honest
-- "the document does not disclose this" is the model behaving correctly.
create table publish_thresholds (
  key   text primary key,
  value numeric(6,3) not null
);
insert into publish_thresholds (key, value) values ('max_hallucination_rate', 0.02);
