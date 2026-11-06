-- Documents an Analyst or Admin supplied for a company, for one quarter.
--
-- Some companies' websites refuse the research fetcher (Cloudflare's 403 to
-- Cadillac Mines and GR Silver, 5 November 2026). An analyst downloads the
-- filing in a browser and supplies it; pass 2 reads it before anything it
-- fetches. docs/decisions/SUPPLIED-DOCUMENTS.md.
--
-- The text goes where a fetched filing's goes, `documents`, under the same
-- hash a fetch of the same file would give. This records only who supplied
-- it, for which company and quarter, and from what address on the company's
-- website. A removed document keeps its row, so a finding read from it still
-- says where its quote came from.
create table supplied_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  period_id     uuid not null references periods(id),
  content_hash  text not null references documents(content_hash),
  url           text not null,
  kind          text not null,
  filename      text not null,
  size_bytes    integer not null,
  page_count    integer not null,
  supplied_by   uuid not null references app_users(id),
  supplied_at   timestamptz not null default now(),
  withdrawn_at  timestamptz,
  withdrawn_by  uuid references app_users(id)
);
create index supplied_documents_period_company on supplied_documents (period_id, company_id);
create index supplied_documents_hash on supplied_documents (content_hash);
-- One live row per file, company and quarter, so the same file supplied
-- twice at once keeps one (supply.ts maps the refusal to "already supplied").
create unique index supplied_documents_live on supplied_documents (company_id, period_id, content_hash)
  where withdrawn_at is null;

-- An upload in flight. Vercel refuses a request body over 4.5 MB before the
-- app sees it, so the browser sends the file in pieces; they wait here until
-- the last one arrives, are read together and deleted. Whatever is left -- a
-- closed tab, a refused file -- is swept after an hour by the per-minute cron
-- tick (supply/sweep.ts), and by scripts/retention.mjs. Each piece is base64
-- text, which both engines store alike.
create table document_uploads (
  id           text primary key,
  company_id   uuid not null references companies(id),
  period_id    uuid not null references periods(id),
  url          text not null,
  kind         text not null,
  filename     text not null,
  size_bytes   integer not null,
  chunk_count  integer not null,
  uploaded_by  uuid not null references app_users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index document_uploads_expires on document_uploads (expires_at);
-- One open upload a person. beginUpload drops a person's earlier upload
-- first; this keeps two begun at once, from two tabs, from both standing.
create unique index document_uploads_one_open on document_uploads (uploaded_by);

create table document_upload_chunks (
  upload_id  text not null references document_uploads(id),
  idx        integer not null,
  data       text not null,
  primary key (upload_id, idx)
);

-- Which pass 2 job read which supplied document. A supplied document reopens
-- the company for pass 2 (start.ts, passCoverage) until a job has READ it --
-- not merely been created after it: a job prepared before the supply, waiting
-- on a batch, never sees it.
create table supplied_reads (
  supplied_id  uuid not null references supplied_documents(id),
  job_id       uuid not null references enrichment_jobs(id),
  primary key (supplied_id, job_id)
);

-- A finding read from a supplied document says so itself, written when the
-- finding is. Review's label and its refusal to bulk-accept (doc 11: a quote
-- not in text the application fetched itself "can never be bulk-accepted")
-- read this, so neither depends on the document still being supplied, or on
-- which copy of the same bytes the documents table kept.
alter table enrichment_findings add column if not exists supplied_document_id uuid references supplied_documents(id);
