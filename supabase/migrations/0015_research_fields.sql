-- Three researched fields, approved 11 September 2026, each chosen because it
-- changes a pursuit decision and can be cited from a public filing.
--
--   fiscal_year_end  When an audit proposal can land. "MM-DD".
--                    Source: the financial statements, or EDGAR's own record.
--   auditor_since    The year the current auditor was first appointed. Tenure
--                    is how long a relationship has run.
--                    Source: the management information circular.
--   auditor_change   Whether the auditor changed in the last 24 months, when,
--                    and from whom. The strongest whitespace signal there is.
--                    Source: the change-of-auditor reporting package the issuer
--                    must publish (NI 51-102 s.4.11), the circular, the AIF.
--   sec_registrant   Whether the company files with the SEC, under what form,
--                    and its CIK. A US listing means a PCAOB audit, which
--                    narrows the field of firms that can take it.
--                    Source: EDGAR, fetched by the application itself.
--
-- None of these names a person. An executive change is a real trigger too,
-- but names are personal data and this build refuses them; see
-- docs/decisions/S3-ACCOUNT-LIMITS.md and the approval that chose these three.

-- Idempotent on purpose. This file creates no table, so the ledger's adoption
-- rule (a database made before the ledger has had the prefix ending at its
-- last present table) cannot recognise it as applied, and would replay it.
insert into field_catalog (key, label, data_type, origin, classification, stale_after_days, bulk_acceptable) values
  ('fiscal_year_end', 'Fiscal year-end',            'text',    'ai_enriched', 'public', 365, true),
  ('auditor_since',   'Auditor since',              'integer', 'ai_enriched', 'public', 365, true),
  ('auditor_change',  'Auditor change (24 months)', 'json',    'ai_enriched', 'public', 180, true),
  ('sec_registrant',  'SEC registrant',             'json',    'ai_enriched', 'public', 365, true)
on conflict (key) do nothing;

-- Head office was catalogued as coming from the extract, and no extract column
-- has ever filled it: 0 of 259. It is researched now, like website.
update field_catalog set origin = 'ai_enriched', stale_after_days = 365
 where key in ('head_office_location', 'head_office_region');
