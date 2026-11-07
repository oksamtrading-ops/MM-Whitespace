-- Saved reports: the companies table, filtered, kept under a name.
--
-- A report stores the table's URL parameters and nothing else, so it always
-- shows what the companies table shows today -- the newest published revision
-- -- and never holds company data of its own (src/lib/reports/reports.ts).
--
-- Private: its owner sees it. Public: everyone who can sign in sees it. Its
-- owner may rename it, change who sees it, update its filters and delete it;
-- so may an Admin, for a report they can see. Samuel, 7 November 2026.
--
-- Deleted outright: a report is a saved view, and the audit log keeps what it
-- was (report_deleted carries its name, visibility and filters).
create table saved_reports (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  visibility  text not null check (visibility in ('private', 'public')),
  params      text not null,
  owner_id    uuid not null references app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app_users(id)
);
create index saved_reports_owner on saved_reports (owner_id);
create index saved_reports_public on saved_reports (visibility) where visibility = 'public';
