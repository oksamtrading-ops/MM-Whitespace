-- Field catalogue and auditor vocabulary.
--
-- Every auditor alias below was observed in the source workbook. Two spellings
-- of one Big-4 firm fold together, a trailing-space collision that reports one
-- firm twice folds away, and a non-Big-4 firm sitting in the Big-4 column keeps
-- its own class.

insert into field_catalog (key, label, data_type, origin, classification, stale_after_days, bulk_acceptable) values
  ('company_name',           'Company',                'text',    'extract',     'public',            null, true),
  ('root_ticker',            'Ticker',                 'text',    'extract',     'public',            null, true),
  ('exchange',               'Exchange',               'text',    'extract',     'public',            null, true),
  ('market_cap_cad',         'Market cap (CAD)',       'numeric', 'extract',     'public',            null, true),
  ('head_office_location',   'Head office',            'text',    'extract',     'public',            null, true),
  ('head_office_region',     'Head office region',     'text',    'extract',     'public',            null, true),
  ('property_regions',       'Property regions',       'json',    'extract',     'public',            null, true),
  ('commodities',            'Commodities',            'json',    'extract',     'public',            null, true),
  ('venture_graduate',       'Venture graduate',       'boolean', 'extract',     'public',            null, true),
  ('stage_evidence_state',   'Stage evidence',         'text',    'ai_enriched', 'public',             180, true),
  ('property_evidence_state','Property evidence',      'text',    'derived',     'public',            null, true),
  ('auditor',                'Auditor',                'text',    'ai_enriched', 'public',             365, true),
  ('website',                'Website',                'text',    'ai_enriched', 'public',             365, true),
  ('footprint',              'Canada vs abroad',       'text',    'derived',     'public',            null, true),
  ('tier',                   'Tier',                   'integer', 'derived',     'public',            null, true),
  -- Fees are excluded from bulk accept: they carry the highest fabrication
  -- stakes of any field and have no baseline to validate against.
  ('audit_fee',              'Audit fees',             'numeric', 'ai_enriched', 'public',            null, false),
  ('tax_fee',                'Tax fees',               'numeric', 'ai_enriched', 'public',            null, false),
  -- Internal but not client data: the firm's own geographic label on a public
  -- company. Stored, hidden from Viewers, never placed in a prompt.
  ('dtt_market',             'Deloitte market',        'text',    'manual',      'deloitte_internal', null, true);

insert into auditors (canonical_name, firm_class) values
  ('Deloitte', 'big4'), ('PwC', 'big4'), ('KPMG', 'big4'), ('Ernst & Young', 'big4'),
  ('BDO', 'national'), ('Grant Thornton', 'national'), ('MNP', 'national'),
  ('Davidson & Company', 'regional'), ('McGovern Hurley', 'regional'),
  ('Crowe MacKay', 'regional'), ('Kingston Ross Pasnak', 'regional'),
  ('MS Partners', 'regional'), ('D+H Group', 'regional'), ('Zeifmans', 'regional'),
  ('Smythe', 'regional'), ('DNTW', 'regional');

-- One statement per alias rather than a VALUES join: the column-aliased
-- VALUES form is Postgres-only and this file has to run on both dialects.
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Deloitte', 'deloitte' from auditors where canonical_name = 'Deloitte';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Deloitte ', 'deloitte ' from auditors where canonical_name = 'Deloitte';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'PwC', 'pwc' from auditors where canonical_name = 'PwC';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'KPMG', 'kpmg' from auditors where canonical_name = 'KPMG';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Ernst & Young', 'ernst & young' from auditors where canonical_name = 'Ernst & Young';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'EY (Ernst & Young)', 'ey (ernst & young)' from auditors where canonical_name = 'Ernst & Young';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'BDO', 'bdo' from auditors where canonical_name = 'BDO';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Grant Thornton', 'grant thornton' from auditors where canonical_name = 'Grant Thornton';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Grant Thornton ', 'grant thornton ' from auditors where canonical_name = 'Grant Thornton';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'MNP', 'mnp' from auditors where canonical_name = 'MNP';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Davidson & Company', 'davidson & company' from auditors where canonical_name = 'Davidson & Company';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'McGovern Hurley', 'mcgovern hurley' from auditors where canonical_name = 'McGovern Hurley';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Crowe MacKay', 'crowe mackay' from auditors where canonical_name = 'Crowe MacKay';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Kingston Ross Pasnak', 'kingston ross pasnak' from auditors where canonical_name = 'Kingston Ross Pasnak';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'MS Partners', 'ms partners' from auditors where canonical_name = 'MS Partners';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'D+H Group', 'd+h group' from auditors where canonical_name = 'D+H Group';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Zeifmans', 'zeifmans' from auditors where canonical_name = 'Zeifmans';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'Smythe', 'smythe' from auditors where canonical_name = 'Smythe';
insert into auditor_aliases (auditor_id, raw_value, normalized)
  select id, 'DNTW', 'dntw' from auditors where canonical_name = 'DNTW';
