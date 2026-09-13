-- The Batch API's own ledger.
--
-- docs/design/03 promised this and the job state machine has held a place for
-- it since 0004: `awaiting_batch`, and a `batch_id` column on the job. Nothing
-- ever submitted or polled one, so every company was researched at full price.
-- Batched requests cost half, and the quarterly run is the textbook batch
-- workload -- 259 companies, no human waiting.
--
-- WHY A ROW PER REQUEST. A batch is answered minutes or hours later, by a
-- worker that never saw the one that submitted it, and results come back in
-- any order keyed by custom_id. So each request carries what finishing it
-- needs: which job it belongs to, and the context its pass was cut in half
-- around -- for the fields pass, the content hashes of the documents the
-- prompt indexes, because an answer cites its source by POSITION in that list.

create table enrichment_batches (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references enrichment_runs(id),
  -- The vendor's id, msgbatch_... . Null only between insert and submit.
  vendor_batch_id text unique,
  state           text not null default 'submitting' check (state in
                    ('submitting', 'in_progress', 'ended', 'settled', 'failed')),
  request_count   int not null default 0,
  -- Batches expire after 24 hours; a request that expires is not a failure and
  -- charges no attempt, exactly as a lapsed lease does not.
  expires_at      timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  polled_at       timestamptz,
  ended_at        timestamptz,
  settled_at      timestamptz
);
create index enrichment_batches_open_idx on enrichment_batches (state);

create table enrichment_batch_requests (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references enrichment_batches(id),
  job_id     uuid not null references enrichment_jobs(id),
  -- What the vendor echoes back beside each result. Unique within a batch.
  custom_id  text not null,
  attempt    int not null,
  -- What resume needs and the submitting worker will not be alive to hold.
  context    jsonb not null default '{}',
  state      text not null default 'submitted' check (state in
               ('submitted', 'succeeded', 'errored', 'expired', 'canceled')),
  last_error text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (batch_id, custom_id),
  unique (batch_id, job_id)
);
create index enrichment_batch_requests_batch_idx on enrichment_batch_requests (batch_id, state);
