-- POSTGRES ONLY. The same lockdown 0008 applied, extended to the two tables
-- that arrived after it.
--
-- These are the highest-value tables in the schema: a row in either is a
-- credential's shadow. No application role reads them. The server reads them
-- as the login it connects with, before it knows who the caller is -- which is
-- the one place in the application that legitimately runs unauthenticated, and
-- the reason the tables hold hashes rather than tokens.

revoke all on auth_magic_links, auth_sessions from anon, authenticated;
revoke all on auth_magic_links, auth_sessions from app_viewer, app_analyst;
revoke all on auth_magic_links, auth_sessions from enrichment_worker;

alter table auth_magic_links enable row level security;
alter table auth_sessions    enable row level security;
