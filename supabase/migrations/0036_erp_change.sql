-- ERP change: whether a company is selecting, implementing or has recently
-- completed a new ERP system, from what its filings say, even when they do not
-- name the system. For pursuit, a change in progress is the fact that matters:
-- on 21 October 2026 the incumbent ERP was named by one company's filings of
-- 248 read (Cameco), while Teck's said it was "selecting and implementing a
-- new enterprise resource planning system".
--
-- The value is {status, year}: status is selecting, implementing or completed
-- (within 24 months of the period date); year is the go-live or completion
-- year a filing gives, or null.
--
-- Researched from the filings pass 2 already reads, and overridden only by
-- citing the public page that says so (decide.ts, SOURCED_OVERRIDES), as the
-- incumbent ERP is: an ERP project known from an engagement is Deloitte client
-- information, which this build does not store. Not bulk-acceptable.
--
-- Idempotent on purpose: this file creates no table, so the ledger's adoption
-- rule cannot recognise it as applied and may replay it.
insert into field_catalog (key, label, data_type, origin, classification, stale_after_days, bulk_acceptable) values
  ('erp_change', 'ERP change', 'json', 'ai_enriched', 'public', 365, false)
on conflict (key) do nothing;
