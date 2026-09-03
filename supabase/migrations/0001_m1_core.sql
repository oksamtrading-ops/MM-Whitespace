-- Milestone 1 core schema.
--
-- Canonical dialect is Postgres; this file is what ships. src/lib/db/dialect.ts
-- translates it mechanically for the local SQLite runtime so the schema under
-- test is the schema that ships, rather than a hand-maintained second copy.
--
-- POC SCOPE: companies deliberately has NO deloitte_tax_client column. The
-- design specifies one as tri-state, and it is omitted here because this build
-- stores no Deloitte client information.
--
-- Internal-but-not-client data is a different case and is retained: the
-- Deloitte market is the firm's own geographic label on a public company and
-- identifies no client, so it is stored, classified deloitte_internal, and
-- hidden from Viewers by the policy in 0003. That leaves the classification
-- mechanism exercised by a live row rather than by none, which is what a later
-- due-diligence review needs in order to inspect it.
--
-- DEFERRED to later milestones, deliberately absent rather than forgotten:
--   enrichment_runs / _jobs / _job_results / _findings / finding_sources  (M2-M3)
--   review_decisions                                                     (M4)
--   period_publications / published_period_values                        (M4)
--   company_fee_disclosures / fx_rates                                   (fees last)
--   pursuits                                                             (phase 2)

create table app_users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null check (role in ('admin', 'analyst', 'viewer')),
  is_active  boolean not null default true,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table periods (
  id                 uuid primary key default gen_random_uuid(),
  label              text not null unique,
  -- Parsed from the market-cap header, never from the tab name: the tabs say
  -- June 2025 and every dated artifact inside says May 2026.
  market_cap_as_of   date not null,
  threshold_amount   numeric(20,4) not null default 200000000,
  -- The workbook states the threshold three ways and the comparison itself is
  -- ambiguous. Decision 9 settled it at "at or above".
  threshold_operator text not null default 'gte' check (threshold_operator in ('gt', 'gte')),
  threshold_currency char(3) not null default 'CAD',
  -- Decision 9: two companies sit 0.85% and 0.86% above the line.
  proximity_band_pct numeric(5,2) not null default 2.00,
  status             text not null default 'draft'
                       check (status in ('draft', 'enriching', 'in_review', 'published')),
  revision           int not null default 1,
  source_file_sha256 text,
  rule_set_version   text,
  published_at       timestamptz,
  published_by       uuid references app_users(id),
  created_at         timestamptz not null default now()
);

create table companies (
  id                    uuid primary key default gen_random_uuid(),
  canonical_name        text not null,
  name_normalized       text not null,
  incorporation_country char(2),
  first_seen_period_id  uuid references periods(id),
  status                text not null default 'active'
                          check (status in ('active', 'merged', 'delisted')),
  merged_into_id        uuid references companies(id),
  created_at            timestamptz not null default now()
);
create unique index companies_name_normalized_key on companies (name_normalized);

-- Identifiers are intervals, never a composite key. 98 extract rows carry a
-- venture-graduate flag, so a (ticker, exchange) primary key reads an ordinary
-- graduation as a drop-out plus a new entrant.
create table company_identifiers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  scheme     text not null check (scheme in
               ('root_ticker', 'ric', 'sp_entity_id', 'sedar_issuer_no', 'lei')),
  value      text not null,
  exchange   text,
  valid_from date not null,
  valid_to   date,
  source     text not null
);
-- Two partial unique indexes rather than one constraint over the four columns:
-- a UNIQUE constraint treats NULLs as distinct in both Postgres and SQLite, so
-- a scheme with no exchange -- sp_entity_id, 143 of them -- would never conflict
-- with itself and every re-import would insert the whole set again.
create unique index company_identifiers_exchange_key
  on company_identifiers (scheme, value, exchange, valid_from) where exchange is not null;
create unique index company_identifiers_no_exchange_key
  on company_identifiers (scheme, value, valid_from) where exchange is null;
create index company_identifiers_current_idx
  on company_identifiers (scheme, value) where valid_to is null;
create index company_identifiers_company_idx on company_identifiers (company_id);

create table company_aliases (
  company_id           uuid not null references companies(id),
  name                 text not null,
  name_normalized      text not null,
  alias_type           text not null
                         check (alias_type in ('legal', 'former', 'source_variant')),
  first_seen_period_id uuid references periods(id),
  source               text not null,
  primary key (company_id, name_normalized)
);

-- A table, not a TypeScript constant: the policy that hides internal fields
-- from a Viewer references it, and bulk_acceptable is how fee fields are kept
-- out of bulk accept without special-casing them in the interface.
create table field_catalog (
  key              text primary key,
  label            text not null,
  data_type        text not null,
  origin           text not null
                     check (origin in ('extract', 'ai_enriched', 'manual', 'derived')),
  classification   text not null
                     check (classification in ('public', 'deloitte_internal')),
  stale_after_days int,
  bulk_acceptable  boolean not null default true
);

-- Immutable typed snapshot of what the file said. Never updated in place.
create table company_period_facts (
  period_id   uuid not null references periods(id),
  company_id  uuid not null references companies(id),
  field_key   text not null,
  raw_value   text,
  typed_value jsonb,
  -- column_absent asserts NOTHING and must leave a prior value standing. Only
  -- absent_blank and absent_sentinel assert that a value is genuinely missing.
  -- Conflating them is what silently deletes the five analyst-added regions.
  assertion   text not null check (assertion in
                ('asserted', 'absent_blank', 'absent_sentinel', 'column_absent')),
  primary key (period_id, company_id, field_key)
);

create table company_period_field_values (
  period_id        uuid not null references periods(id),
  company_id       uuid not null references companies(id),
  field_key        text not null references field_catalog(key),
  value            jsonb,
  source           text not null check (source in
                     ('extract', 'ai_accepted', 'manual_override', 'manual_entry',
                      'derived', 'inherited')),
  evidence_state   text not null check (evidence_state in
                     ('asserted', 'absent_confirmed', 'unknown')),
  source_period_id uuid references periods(id),
  rule_version     text,
  basis_hash       text,
  actor_id         uuid references app_users(id),
  decided_at       timestamptz not null default now(),
  frozen_at        timestamptz,
  primary key (period_id, company_id, field_key)
);

-- Absence of a row means "false" ONLY when stage_evidence_state is complete.
-- That state lives in company_period_field_values under its own field key, and
-- on day one it is 'none' for 242 of 259 companies.
create table company_period_stages (
  period_id  uuid not null references periods(id),
  company_id uuid not null references companies(id),
  stage      text not null check (stage in
               ('exploration', 'development', 'production', 'royalty_streaming')),
  primary key (period_id, company_id, stage)
);

-- firm_class is a property of the FIRM, never of the spreadsheet column a value
-- landed in: MNP sits in the Big-4 column once and the Others column nine times.
create table auditors (
  id             uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  firm_class     text not null
                   check (firm_class in ('big4', 'national', 'regional', 'unknown'))
);
create table auditor_aliases (
  auditor_id uuid not null references auditors(id),
  raw_value  text not null,
  normalized text not null unique,
  primary key (auditor_id, normalized)
);

-- Tier is nullable with a status, not a seventh enum value: unclassified has
-- two independent causes that route to different review queues.
create table tiers (
  period_id        uuid not null references periods(id),
  company_id       uuid not null references companies(id),
  tier             smallint check (tier between 1 and 6),
  status           text not null check (status in
                     ('classified', 'unclassified_no_stage_evidence',
                      'unclassified_no_property_evidence', 'unclassified_conflicting')),
  footprint        text not null check (footprint in
                     ('canada_only', 'abroad', 'canada_and_abroad', 'none')),
  rule_set_version text not null,
  computed_at      timestamptz not null default now(),
  primary key (period_id, company_id)
);

-- Structured rows, not a sentence: the migration view has to say WHICH rule
-- changed between periods, and prose cannot be diffed.
create table tier_traces (
  period_id  uuid not null references periods(id),
  company_id uuid not null references companies(id),
  ord        smallint not null,
  rule_id    text not null,
  inputs     jsonb not null,
  matched    boolean not null,
  primary key (period_id, company_id, ord)
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  actor_id   uuid references app_users(id),
  period_id  uuid references periods(id),
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at);
