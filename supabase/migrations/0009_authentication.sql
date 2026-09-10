-- Magic-link sign-in, and sessions that can be revoked.
--
-- Doc 11 settles the shape: magic link only for the pilot, no passwords,
-- invite-only, and "sessions bounded and revocable". Revocable is the word
-- that decides the design -- a stateless token cannot be withdrawn, and the
-- access review screen exists precisely so that a partner who rolls off stops
-- being able to read the client roster THAT AFTERNOON rather than whenever
-- their token happens to expire. So sessions are rows.
--
-- NEITHER TABLE STORES A USABLE CREDENTIAL. Both hold the SHA-256 of the
-- token and never the token itself, so a copy of this database -- a backup, a
-- support export, a leaked read replica -- does not let anyone sign in as
-- anybody. The token exists in the mail that carried it and in the holder's
-- cookie, and nowhere else.

create table auth_magic_links (
  id           uuid primary key default gen_random_uuid(),
  -- The address the link was issued FOR, not a foreign key to app_users: a
  -- request for an unknown address must look exactly like a request for a
  -- known one, or the sign-in form becomes a way to enumerate the roster.
  email        text not null,
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- Single use. Set on redemption; a second presentation finds it non-null.
  consumed_at  timestamptz,
  -- Kept for the audit trail: which request produced the link that was used.
  requested_ip text,
  requested_ua text
);

create index auth_magic_links_email on auth_magic_links (lower(email), issued_at);
create index auth_magic_links_expiry on auth_magic_links (expires_at);

create table auth_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_users(id),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  -- Two clocks. `expires_at` is the bound doc 11 asks for and cannot be
  -- extended; `last_seen_at` drives the idle timeout. A session that is
  -- neither idle nor expired is still revocable by setting revoked_at.
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    uuid references app_users(id),
  revoked_reason text,
  created_ip    text,
  created_ua    text
);

create index auth_sessions_user on auth_sessions (user_id, revoked_at);
create index auth_sessions_expiry on auth_sessions (expires_at);
