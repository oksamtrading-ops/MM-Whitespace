-- POSTGRES ONLY. The 0008 lockdown, extended to saved reports.
--
-- No application role reads them; the server reads them as the login it
-- connects with, and checks who may see each one itself (reports.ts).

revoke all on saved_reports from anon, authenticated;
revoke all on saved_reports from app_viewer, app_analyst, enrichment_worker;
alter table saved_reports enable row level security;
