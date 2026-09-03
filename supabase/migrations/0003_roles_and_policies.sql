-- POSTGRES ONLY. Not applied by the local SQLite runtime, which has no roles
-- and no row-level security. Applied wherever the schema runs on Postgres.
--
-- Three mechanisms together, because row policies cannot hide COLUMNS and the
-- internal fields are columns.

alter table company_period_field_values enable row level security;
alter table company_period_facts        enable row level security;
alter table company_period_stages       enable row level security;
alter table tiers                       enable row level security;
alter table tier_traces                 enable row level security;
alter table periods                     enable row level security;

create role app_analyst nologin;
create role app_viewer  nologin;

-- 1. Internal fields are excluded by field_key, which is why field_catalog is
--    a table rather than a constant in application code.
create policy viewer_reads_public_published on company_period_field_values
for select to app_viewer using (
  exists (select 1 from periods p where p.id = period_id and p.status = 'published')
  and field_key not in (select key from field_catalog
                        where classification = 'deloitte_internal')
);

-- 2. The period-status join belongs on EVERY period-scoped table. Missing it on
--    tiers alone leaks the entire draft classification.
create policy analyst_reads_any_period on tiers for select to app_analyst using (true);
create policy viewer_reads_published_tiers on tiers
for select to app_viewer using (
  exists (select 1 from periods p where p.id = period_id and p.status = 'published')
);
create policy analyst_reads_any_stage on company_period_stages
  for select to app_analyst using (true);
create policy viewer_reads_published_stages on company_period_stages
for select to app_viewer using (
  exists (select 1 from periods p where p.id = period_id and p.status = 'published')
);

-- 3. Viewers are denied outright on the pipeline's own tables.
revoke all on tier_traces, audit_log from app_viewer;

-- The worker never holds the service-role key. Column privileges make the
-- restriction mechanical rather than conventional: this survives a bad
-- refactor, and a lint rule does not.
create role enrichment_worker nologin;
grant select on companies, company_period_facts, company_identifiers to enrichment_worker;
grant insert on audit_log to enrichment_worker;
-- Deliberately absent: any grant at all on company_period_field_values or
-- tiers, so a prompt-injected agent cannot manufacture an accepted value.
