-- POSTGRES ONLY. What spike S5 found when 0003 was finally executed.
--
-- 0003 had never run anywhere. Applied to a real Postgres, three things were
-- true that no amount of reading would have settled:
--
-- 1. A POLICY GRANTS NOTHING. 0003 writes policies for app_viewer and
--    app_analyst but never grants select on the tables they govern, so every
--    read was "permission denied for table" rather than a filtered row. It
--    failed closed, which is the safe direction, and it meant the internal-
--    field rule had never filtered anything because no Viewer got far enough
--    to be filtered.
--
-- 2. RLS ON `periods` WITH NO POLICY SILENTLY DEFEATS THE POLICIES THAT READ
--    IT. viewer_reads_public_published tests `exists (select 1 from periods
--    where status = 'published')`, and that subquery is itself subject to RLS
--    for the querying role. With no policy on periods a Viewer sees zero
--    periods, so the EXISTS is false for every row and the Viewer sees
--    nothing at all. A Viewer would have opened an empty dashboard and nobody
--    would have known why.
--
-- 3. THE DATA API BYPASSES ALL OF IT. Supabase serves every table in `public`
--    over PostgREST as the `anon` role, which is the key that ships in a
--    browser. 0003 enables row-level security on six tables; the schema has
--    thirty-one. anon could read app_users, enrichment_findings,
--    review_decisions, audit_log and the whole company population.
--
-- This application never talks to PostgREST -- it queries from the server --
-- so the data API is closed rather than policed. RLS stays on everything
-- underneath it, so a later grant cannot open a table by accident.

-- 1. The policies in 0003 govern privileges nobody had.
grant usage on schema public to app_viewer, app_analyst;
grant select on companies, field_catalog, periods, company_period_facts,
                company_period_field_values, company_period_stages, tiers
  to app_viewer, app_analyst;
grant select on tier_traces, enrichment_findings, review_decisions,
                period_publications, published_period_values,
                published_period_tiers, publication_aggregates
  to app_analyst;

-- 2. The period a policy is asking about has to be readable by the role asking.
create policy viewer_reads_published_periods on periods
  for select to app_viewer using (status = 'published');
create policy analyst_reads_any_period_row on periods
  for select to app_analyst using (true);
create policy viewer_reads_published_facts on company_period_facts
  for select to app_viewer using (
    exists (select 1 from periods p where p.id = period_id and p.status = 'published'));
create policy analyst_reads_any_fact on company_period_facts
  for select to app_analyst using (true);
create policy analyst_reads_any_value on company_period_field_values
  for select to app_analyst using (true);

-- 3. Close the data API. Nothing in this application reads through it.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Row-level security on everything, so a future grant cannot open a table by
-- accident. Deny-by-default: a table with RLS and no policy for a role
-- returns no rows to it.
alter table app_settings              enable row level security;
alter table app_users                 enable row level security;
alter table audit_log                 enable row level security;
alter table auditor_aliases           enable row level security;
alter table auditors                  enable row level security;
alter table companies                 enable row level security;
alter table company_aliases           enable row level security;
alter table company_identifiers       enable row level security;
alter table coverage_floors           enable row level security;
alter table documents                 enable row level security;
alter table enrichment_findings       enable row level security;
alter table enrichment_job_results    enable row level security;
alter table enrichment_jobs           enable row level security;
alter table enrichment_runs           enable row level security;
alter table field_catalog             enable row level security;
alter table finding_sources           enable row level security;
alter table period_publications       enable row level security;
alter table publication_aggregates    enable row level security;
alter table publish_thresholds        enable row level security;
alter table published_period_tiers    enable row level security;
alter table published_period_values   enable row level security;
alter table rate_governor             enable row level security;
alter table review_decisions          enable row level security;
alter table schema_migrations         enable row level security;
alter table worker_slots              enable row level security;

-- A Viewer reads the frozen snapshot and the catalogue that describes it.
create policy viewer_reads_companies on companies for select to app_viewer using (true);
create policy viewer_reads_catalog on field_catalog for select to app_viewer using (true);
create policy viewer_reads_publications on period_publications
  for select to app_viewer using (
    exists (select 1 from periods p where p.id = period_id and p.status = 'published'));
create policy viewer_reads_published_values on published_period_values
  for select to app_viewer using (
    field_key not in (select key from field_catalog where classification = 'deloitte_internal'));
create policy viewer_reads_published_tiers_frozen on published_period_tiers
  for select to app_viewer using (true);
create policy viewer_reads_aggregates on publication_aggregates
  for select to app_viewer using (true);
create policy analyst_reads_companies on companies for select to app_analyst using (true);
create policy analyst_reads_catalog on field_catalog for select to app_analyst using (true);
