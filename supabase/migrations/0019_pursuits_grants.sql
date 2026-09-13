-- POSTGRES ONLY. The 0008 lockdown, extended to the pursuit tables.
--
-- This is the reason they ship in Phase 1 at all. An unpoliced table in
-- `public` is served over PostgREST as `anon` -- the key that ships in a
-- browser -- so a table created now and policied "when Phase 2 builds the
-- screen" would be readable by anyone for the whole of the interval.
--
-- docs/design/11 classes every pursuit field as Deloitte internal, "hidden
-- from Viewers by column, not by interface". So a Viewer is revoked outright
-- rather than filtered, which is the stronger of the two.
--
-- 0008's lesson, learned the hard way: a grant and a policy only work
-- together. A grant with no policy returns no rows, and a policy with no grant
-- is "permission denied for table". The Analyst gets both. Nothing writes
-- through a role -- the server writes as the login it connects with -- so no
-- write privilege is granted to anyone here.

revoke all on pursuits, pursuit_notes, pursuit_actions from anon, authenticated;
revoke all on pursuits, pursuit_notes, pursuit_actions from app_viewer;

grant select on pursuits, pursuit_notes, pursuit_actions to app_analyst;
create policy analyst_reads_any_pursuit on pursuits
  for select to app_analyst using (true);
create policy analyst_reads_any_pursuit_note on pursuit_notes
  for select to app_analyst using (true);
create policy analyst_reads_any_pursuit_action on pursuit_actions
  for select to app_analyst using (true);

alter table pursuits        enable row level security;
alter table pursuit_notes   enable row level security;
alter table pursuit_actions enable row level security;
