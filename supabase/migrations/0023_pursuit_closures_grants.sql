-- POSTGRES ONLY. The 0008 lockdown, extended to the closure record.
--
-- Caught by the invariant in commit.test.ts rather than by remembering: every
-- table any migration creates must have row-level security, because Supabase
-- serves `public` over PostgREST as `anon`, the key that ships in a browser.
--
-- A closure says which pursuits the practice won and lost, which is as
-- Deloitte-internal as anything in this schema. Same treatment as the pursuit
-- it belongs to: the Viewer revoked outright, the Analyst granted select with a
-- matching policy, and no role writes.

revoke all on pursuit_closures from anon, authenticated;
revoke all on pursuit_closures from app_viewer;

grant select on pursuit_closures to app_analyst;
create policy analyst_reads_any_pursuit_closure on pursuit_closures
  for select to app_analyst using (true);

alter table pursuit_closures enable row level security;
