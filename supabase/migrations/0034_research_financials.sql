-- Six more researched fields, from the filings pass 2 already reads.
--
--   audit_related_fee, other_fee   the two fee lines beside audit and tax in
--                                  the same table, so the whole of what a
--                                  company pays its auditor is on record
--   total_revenue, net_income,     from the audited statements or the MD&A's
--   total_assets                   selected financial information: the size of
--                                  a company beyond its market cap, and what
--                                  fees can be weighed against. The source
--                                  workbook's A.02 carried these from a licensed
--                                  database; these are read from public filings
--                                  and each cites its page.
--   reporting_currency             the currency the statements are presented
--                                  in, which settles a table that says only
--                                  "in millions of dollars"
--
-- Every amount is kept as fees are, {amount, currency, fiscal_year}, in the
-- currency the filing states it in; net income is negative for a loss. None
-- is bulk-acceptable: like the fees, there is no baseline to check them
-- against until a reviewer has seen how they read on real filings.
--
-- Idempotent on purpose: this file creates no table, so the ledger's adoption
-- rule cannot recognise it as applied and may replay it.
insert into field_catalog (key, label, data_type, origin, classification, stale_after_days, bulk_acceptable) values
  ('audit_related_fee',  'Audit-related fees',  'numeric', 'ai_enriched', 'public', 365, false),
  ('other_fee',          'All other fees',      'numeric', 'ai_enriched', 'public', 365, false),
  ('total_revenue',      'Total revenue',       'numeric', 'ai_enriched', 'public', 365, false),
  ('net_income',         'Net income (loss)',   'numeric', 'ai_enriched', 'public', 365, false),
  ('total_assets',       'Total assets',        'numeric', 'ai_enriched', 'public', 365, false),
  ('reporting_currency', 'Reporting currency',  'text',    'ai_enriched', 'public', 365, false)
on conflict (key) do nothing;
