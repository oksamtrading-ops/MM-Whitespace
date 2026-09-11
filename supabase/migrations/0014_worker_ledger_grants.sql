-- POSTGRES ONLY. The 0008 lockdown, extended to the worker's ledger.
--
-- Nothing in these tables is client data, but nothing in them is for a
-- browser either: the server writes them as the login it connects with, and
-- the run screen reads them the same way.

revoke all on cron_ticks  from anon, authenticated;
revoke all on worker_runs from anon, authenticated;
revoke all on cron_ticks  from app_viewer, app_analyst, enrichment_worker;
revoke all on worker_runs from app_viewer, app_analyst, enrichment_worker;

alter table cron_ticks  enable row level security;
alter table worker_runs enable row level security;
