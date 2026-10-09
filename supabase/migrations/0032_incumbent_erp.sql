-- Incumbent systems (ERP): the enterprise resource planning system a company
-- runs for its own finance and operations, which the practice asked to see on
-- the companies table.
--
-- Researched, and only from public filings. A company names its ERP mostly
-- when it changes internal controls, so coverage will be thin; an Analyst may
-- override in review, but only by citing the public page that names it
-- (decide.ts, SOURCED_OVERRIDES): an ERP known from an engagement is Deloitte
-- client information, which this build does not store.
--
-- Not bulk-acceptable until its accuracy has been seen on real filings.
--
-- Idempotent on purpose: this file creates no table, so the ledger's adoption
-- rule cannot recognise it as applied and may replay it.
insert into field_catalog (key, label, data_type, origin, classification, stale_after_days, bulk_acceptable) values
  ('incumbent_erp', 'Incumbent systems (ERP)', 'text', 'ai_enriched', 'public', 365, false)
on conflict (key) do nothing;
