-- POSTGRES ONLY. The 0008 lockdown, extended to the supplied-document tables.
--
-- No application role reads them; the server reads them as the login it
-- connects with, as it does `documents` and `upload_quarantine` (0012).

revoke all on supplied_documents from anon, authenticated;
revoke all on supplied_documents from app_viewer, app_analyst, enrichment_worker;
alter table supplied_documents enable row level security;

revoke all on document_uploads from anon, authenticated;
revoke all on document_uploads from app_viewer, app_analyst, enrichment_worker;
alter table document_uploads enable row level security;

revoke all on document_upload_chunks from anon, authenticated;
revoke all on document_upload_chunks from app_viewer, app_analyst, enrichment_worker;
alter table document_upload_chunks enable row level security;

revoke all on supplied_reads from anon, authenticated;
revoke all on supplied_reads from app_viewer, app_analyst, enrichment_worker;
alter table supplied_reads enable row level security;
