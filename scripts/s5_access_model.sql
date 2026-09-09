-- Spike S5: prove the access model on a real Postgres.
--
--   psql "$DATABASE_URL" -f scripts/s5_access_model.sql
--
-- Self-contained: it seeds what it needs, probes every role, prints a table of
-- PASS/FAIL, and removes its own rows. Safe to run against a database holding
-- real data -- it only adds and then deletes rows labelled 'S5-%'.
--
-- The probe treats a privilege error as a refusal, because from the caller's
-- side "permission denied for table" and "zero rows" are both a refusal; what
-- matters is that the data does not come back.

begin;

create temporary table s5_expected (probe text, expected text);

create or replace function pg_temp.s5_probe(who text, q text) returns text
language plpgsql as $$
declare n text;
begin
  execute format('set local role %I', who);
  execute q into n;
  reset role;
  return n;
exception when others then
  reset role;
  return 'REFUSED';
end $$;

-- ---------------------------------------------------------------- seed

insert into periods (label, market_cap_as_of, status, rule_set_version)
values ('S5-draft (2026-08-31)', '2026-08-31', 'draft', '1.0.0'),
       ('S5-published (2026-05-31)', '2026-05-31', 'published', '1.0.0');

insert into companies (canonical_name, name_normalized)
values ('S5 Northco Mining Corp.', 's5 northco mining corp');

insert into company_period_field_values
  (period_id, company_id, field_key, value, source, evidence_state)
select p.id, c.id, f.key, f.val::jsonb, 'extract', 'asserted'
from periods p cross join companies c
cross join (values ('auditor', '"KPMG"'), ('dtt_market', '"Ontario"')) as f(key, val)
where p.label like 'S5-%' and c.name_normalized = 's5 northco mining corp';

insert into tiers (period_id, company_id, tier, status, footprint, rule_set_version)
select p.id, c.id, 4, 'classified', 'none', '1.0.0'
from periods p cross join companies c
where p.label like 'S5-%' and c.name_normalized = 's5 northco mining corp';

insert into tier_traces (period_id, company_id, ord, rule_id, inputs, matched)
select p.id, c.id, 0, 'rule_4_royalty', '{"royalty":true}'::jsonb, true
from periods p cross join companies c
where p.label like 'S5-%' and c.name_normalized = 's5 northco mining corp';

-- ---------------------------------------------------------------- probe

select probe, result, expected,
       case when result = expected then 'PASS' else 'FAIL' end as verdict
from (
  -- The data API. Supabase serves every table in `public` over PostgREST as
  -- `anon`, which is the key that ships inside a browser.
  select 'anon: companies' as probe,
         pg_temp.s5_probe('anon','select count(*)::text from companies') as result,
         'REFUSED' as expected
  union all select 'anon: app_users',
    pg_temp.s5_probe('anon','select count(*)::text from app_users'), 'REFUSED'
  union all select 'anon: draft findings',
    pg_temp.s5_probe('anon','select count(*)::text from enrichment_findings'), 'REFUSED'
  union all select 'anon: audit_log',
    pg_temp.s5_probe('anon','select count(*)::text from audit_log'), 'REFUSED'
  union all select 'anon: published values',
    pg_temp.s5_probe('anon','select count(*)::text from published_period_values'), 'REFUSED'
  union all select 'authenticated: companies',
    pg_temp.s5_probe('authenticated','select count(*)::text from companies'), 'REFUSED'

  -- A Viewer reads published, public values and nothing else.
  union all select 'viewer: the S5 published public field',
    pg_temp.s5_probe('app_viewer', $q$select count(*)::text from company_period_field_values v
      join periods p on p.id = v.period_id
      where p.label = 'S5-published (2026-05-31)' and v.field_key = 'auditor'$q$), '1'
  union all select 'viewer: the S5 published INTERNAL field',
    pg_temp.s5_probe('app_viewer', $q$select count(*)::text from company_period_field_values v
      join periods p on p.id = v.period_id
      where p.label = 'S5-published (2026-05-31)' and v.field_key = 'dtt_market'$q$), '0'
  union all select 'viewer: the S5 draft period',
    pg_temp.s5_probe('app_viewer', $q$select count(*)::text from company_period_field_values v
      join periods p on p.id = v.period_id where p.label = 'S5-draft (2026-08-31)'$q$), '0'
  union all select 'viewer: the S5 draft tier',
    pg_temp.s5_probe('app_viewer', $q$select count(*)::text from tiers t
      join periods p on p.id = t.period_id where p.label = 'S5-draft (2026-08-31)'$q$), '0'
  union all select 'viewer: tier_traces',
    pg_temp.s5_probe('app_viewer','select count(*)::text from tier_traces'), 'REFUSED'
  union all select 'viewer: audit_log',
    pg_temp.s5_probe('app_viewer','select count(*)::text from audit_log'), 'REFUSED'
  union all select 'viewer: enrichment_findings',
    pg_temp.s5_probe('app_viewer','select count(*)::text from enrichment_findings'), 'REFUSED'

  -- An Analyst reads the draft, which is the job.
  union all select 'analyst: the S5 draft tier',
    pg_temp.s5_probe('app_analyst', $q$select count(*)::text from tiers t
      join periods p on p.id = t.period_id where p.label = 'S5-draft (2026-08-31)'$q$), '1'
  union all select 'analyst: the S5 internal field',
    pg_temp.s5_probe('app_analyst', $q$select count(*)::text from company_period_field_values v
      join periods p on p.id = v.period_id
      where p.label like 'S5-%' and v.field_key = 'dtt_market'$q$), '2'

  -- The worker reads what it needs and cannot manufacture an accepted value.
  union all select 'worker: companies',
    pg_temp.s5_probe('enrichment_worker',
      $q$select case when count(*) > 0 then 'some' else 'none' end from companies$q$), 'some'
  union all select 'worker: company_period_field_values',
    pg_temp.s5_probe('enrichment_worker','select count(*)::text from company_period_field_values'), 'REFUSED'
  union all select 'worker: tiers',
    pg_temp.s5_probe('enrichment_worker','select count(*)::text from tiers'), 'REFUSED'
) t order by verdict desc, probe;

-- --------------------------------------------------------------- clean up

delete from tier_traces where period_id in (select id from periods where label like 'S5-%');
delete from tiers where period_id in (select id from periods where label like 'S5-%');
delete from company_period_field_values
 where period_id in (select id from periods where label like 'S5-%');
delete from periods where label like 'S5-%';
delete from companies where name_normalized = 's5 northco mining corp';

commit;
