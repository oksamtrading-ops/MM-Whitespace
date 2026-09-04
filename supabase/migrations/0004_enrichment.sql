-- Milestone 2: the enrichment ledger, the document cache, and findings.
--
-- Two properties of this schema carry most of its weight.
--
-- Research is split from persist. A validated model response is written to
-- enrichment_job_results BEFORE any finding is derived from it, so a crash
-- between the two costs nothing: the retry reads the stored response instead of
-- paying for the call again.
--
-- Findings are append-only and the uniqueness key includes `attempt`, so a
-- forced replay produces a new visible finding rather than silently doing
-- nothing -- the failure mode of keying on company and field alone.

create table enrichment_runs (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references periods(id),
  scope          text not null default 'unreviewed_or_stale',
  status         text not null default 'queued' check (status in
                   ('queued', 'running', 'awaiting_batch', 'halted', 'completed', 'failed')),
  -- A run cannot be created without a budget. Warn at 80%, halt at 100%.
  budget_usd     numeric(10,2) not null,
  spend_usd      numeric(10,4) not null default 0,
  halt_reason    text,
  model          text not null,
  prompt_version text not null,
  rule_set_version text,
  mode           text not null default 'replay' check (mode in ('replay', 'record', 'live')),
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- Global concurrency lives in Postgres, not in worker memory: in-process
-- governors do not compose across instances.
create table worker_slots (
  id                integer primary key,
  leased_by         text,
  lease_expires_at  timestamptz
);

create table enrichment_jobs (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references enrichment_runs(id),
  company_id   uuid not null references companies(id),
  field_group  text not null,
  state        text not null default 'queued' check (state in
                 ('queued', 'claimed', 'researching', 'awaiting_batch',
                  'persisting', 'completed', 'halted', 'dead_letter')),
  attempts     int not null default 0,
  max_attempts int not null default 3,
  -- A lease that expires returns the job to queued and charges no attempt.
  leased_by        text,
  lease_expires_at timestamptz,
  available_at     timestamptz,
  batch_id     text,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (run_id, company_id, field_group)
);
create index enrichment_jobs_claimable_idx on enrichment_jobs (state, available_at);

-- Raw, pre-derivation. Written before findings exist.
create table enrichment_job_results (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references enrichment_jobs(id),
  attempt    int not null,
  raw        jsonb not null,
  request_id text,
  usage      jsonb,
  -- Search results carry encrypted content that must be replayed byte-exact or
  -- a continuation fails, so the assistant turn is persisted verbatim.
  verbatim_turn text,
  created_at timestamptz not null default now(),
  unique (job_id, attempt)
);

-- The document cache. Anchoring verifies against the byte-identical stored
-- artifact keyed by hash, and never re-extracts at verification time --
-- re-extraction drift rejects correct findings when column order changes.
create table documents (
  content_hash          text primary key,
  url                   text not null,
  final_url             text,
  retrieved_at          timestamptz not null default now(),
  extractor             text not null,
  extractor_version     text not null,
  normalization_version text not null,
  text_content          text,
  char_count            int,
  page_count            int,
  chars_per_page        numeric(10,2),
  source_tier           smallint not null check (source_tier between 1 and 5),
  doc_type              text,
  language              text,
  scale_phrase          text,
  has_text_layer        boolean not null default true
);
create index documents_url_idx on documents (url);

create table enrichment_findings (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references enrichment_runs(id),
  job_id                uuid not null references enrichment_jobs(id),
  attempt               int not null,
  company_id            uuid not null references companies(id),
  field_key             text not null references field_catalog(key),
  proposed_value        jsonb,
  -- A versioned function of observable components. The model's self-report is
  -- stored beside it and excluded from the accept threshold.
  evidence_strength     numeric(4,3),
  evidence_version      text,
  evidence_components   jsonb,
  model_self_confidence numeric(4,3),
  anchor_mode           text not null check (anchor_mode in
                          ('exact_normalized', 'proximity', 'label_only', 'none')),
  anchor_start          int,
  anchor_end            int,
  anchor_document_hash  text references documents(content_hash),
  evidence_excerpt      text,
  scale_token           text,
  abstained             boolean not null default false,
  abstention_reason     text,
  -- 'abstained' is its own state. A model that cannot find evidence and says
  -- so is giving a different and more useful answer than a low-confidence
  -- guess, and it must never be counted in the hallucination rate below.
  state                 text not null check (state in
                          ('proposed', 'abstained', 'anchor_mismatch', 'unsupported',
                           'no_text_layer', 'source_unreachable', 'superseded')),
  model                 text not null,
  prompt_version        text not null,
  request_id            text,
  usage                 jsonb,
  created_at            timestamptz not null default now(),
  unique (company_id, field_key, run_id, attempt)
);
create index enrichment_findings_state_idx on enrichment_findings (run_id, state);

create table finding_sources (
  finding_id    uuid not null references enrichment_findings(id),
  url           text not null,
  title         text,
  content_hash  text references documents(content_hash),
  source_tier   smallint not null check (source_tier between 1 and 5),
  doc_type      text,
  retrieved_at  timestamptz,
  primary key (finding_id, url)
);

-- Debited on claim against an estimated cost, reconciled from actual usage on
-- completion. A table, because an in-process bucket does not compose.
create table rate_governor (
  key            text primary key,
  tokens         numeric(14,2) not null,
  capacity       numeric(14,2) not null,
  refill_per_sec numeric(14,4) not null,
  updated_at     timestamptz not null default now()
);
