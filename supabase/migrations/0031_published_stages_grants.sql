-- POSTGRES ONLY. 0030's table, closed and policied like the snapshot beside it.
--
-- A separate file because a policy makes a whole migration Postgres-only
-- (src/lib/db/dialect.ts), and SQLite would then never create the table.
-- Follows 0008 for published_period_tiers: the data API closed to anon and
-- authenticated, select granted to app_analyst, a Viewer policy beside it.
-- One difference, on purpose: 0008 granted app_analyst select on the frozen
-- tables with no analyst policy, and 0019 records why that is a gap -- a
-- grant without a policy returns no rows. This table gets both.

revoke all on published_period_stages from anon, authenticated;
grant select on published_period_stages to app_analyst;
create policy viewer_reads_published_stages on published_period_stages
  for select to app_viewer using (true);
create policy analyst_reads_published_stages on published_period_stages
  for select to app_analyst using (true);
alter table published_period_stages enable row level security;
