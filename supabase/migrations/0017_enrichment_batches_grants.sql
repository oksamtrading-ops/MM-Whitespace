-- POSTGRES ONLY. The 0008 lockdown, extended to the batch ledger.
--
-- A batch request's context names documents by hash and nothing else, but it
-- is still the worker's own bookkeeping: the server writes it as the login it
-- connects with, and the run screen reads it the same way.

revoke all on enrichment_batches         from anon, authenticated;
revoke all on enrichment_batch_requests  from anon, authenticated;
revoke all on enrichment_batches         from app_viewer, app_analyst;
revoke all on enrichment_batch_requests  from app_viewer, app_analyst;

grant select, insert, update on enrichment_batches        to enrichment_worker;
grant select, insert, update on enrichment_batch_requests to enrichment_worker;

alter table enrichment_batches        enable row level security;
alter table enrichment_batch_requests enable row level security;
