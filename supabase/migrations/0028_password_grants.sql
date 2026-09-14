-- POSTGRES ONLY. 0010's lockdown, extended to the password tables.
--
-- 0010 closed auth_magic_links and auth_sessions with the argument that a row in
-- either is a credential's shadow and no application role has any business
-- reading them. auth_passwords is the strongest case of that in the schema: it
-- is the only table that holds a secret belonging to a person rather than to
-- the application.
--
-- auth_sign_in_failures is here for a different reason. It holds no credential,
-- but it is a record of who tried to sign in and when -- which is a record of a
-- person's working hours, and of who is being attacked. Neither is something a
-- Viewer or an Analyst should be able to read out of the data API.
--
-- Grants and policies only work together (0008's lesson). Revoking everything
-- and enabling row-level security with NO policy is deny-by-default for every
-- role: the server reads these as the login it connects with, before it knows
-- who the caller is, which is the only context in which they are ever read.

revoke all on auth_passwords, auth_sign_in_failures from anon, authenticated;
revoke all on auth_passwords, auth_sign_in_failures from app_viewer, app_analyst;
revoke all on auth_passwords, auth_sign_in_failures from enrichment_worker;

alter table auth_passwords enable row level security;
alter table auth_sign_in_failures enable row level security;
