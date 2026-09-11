-- POSTGRES ONLY. The 0008 lockdown, extended to the quarantine table.
--
-- A parsed upload is the whole of a licensed extract in structured form, before
-- anyone has decided it may become a period. No application role reads it; the
-- server reads it as the login it connects with.

revoke all on upload_quarantine from anon, authenticated;
revoke all on upload_quarantine from app_viewer, app_analyst, enrichment_worker;

alter table upload_quarantine enable row level security;
