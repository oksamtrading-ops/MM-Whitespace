-- Passwords, replacing the magic link. docs/decisions/S6-PASSWORD-AUTH.md.
--
-- WHY THE HASH IS NOT A COLUMN ON app_users
--
-- 0010 says it plainly about the tables it locks down: "these are the
-- highest-value tables in the schema: a row in either is a credential's shadow.
-- No application role reads them." app_users is not one of those. It carries
-- RLS from 0008, but it is read by six screens, joined for owner names and
-- actor emails, and projected into interfaces all over the application.
--
-- A password hash belongs with the sessions and not with the roster, so it gets
-- its own table under 0010's grants (0028) and app_users keeps no secret at all.
-- The flag beside it is a different kind of thing -- a boolean about the state
-- of an account, not a credential -- so it stays on app_users, where resolveUser
-- and userForSession can read it without a join on the authorisation path.
--
-- WHY must_change_password DEFAULTS TO FALSE
--
-- There are twelve `insert into app_users` sites across the fixtures, the unit
-- tests and the end-to-end seed, and not one of them names this column. A
-- default of true would put every one of those users behind the change-password
-- gate and fail every journey. It is also the wrong meaning: "must change" is a
-- property of a password somebody else chose FOR you, which is exactly and only
-- what setTemporaryPassword does, so that is where it is set.
--
-- ONE add column PER alter table, DELIBERATELY
--
-- applySchema's addColumnIfNotExists matches a single column name, and SQLite
-- permits one ADD COLUMN per ALTER TABLE. The Postgres-style comma-separated
-- form parses here and silently drops everything after the first column on the
-- other engine -- a difference that would only ever show up locally, in a test
-- that suddenly cannot see a column production has.

alter table app_users add column if not exists must_change_password boolean not null default false;

-- The credential. One row per user, or none: a NULL row means "cannot sign in
-- with a password", which is the correct state for somebody just invited and
-- the reason there is no not-null hash on app_users to lie about it.
create table if not exists auth_passwords (
  user_id  uuid primary key references app_users(id),
  hash     text not null,
  set_at   timestamptz not null default now()
);

-- Failed attempts, counted. NOT evidence -- audit_log is the evidence, and that
-- distinction is what licenses deleting these rows on a successful sign-in.
--
-- email_lower is deliberately NOT a foreign key, for the reason 0009 gives about
-- auth_magic_links: counting only against addresses that resolve to a real
-- account would make "you are throttled" reachable only for real accounts, and
-- turn a fast refusal into a way to ask whether somebody is on the roster.
--
-- THE TRADE THIS TABLE MAKES, stated because it is a real cost:
-- counting per address means anybody who knows a colleague's address can lock
-- that colleague out by failing on purpose, and both admins here use guessable
-- gmail addresses. It is accepted because the window slides and expires by
-- itself, there is no permanent lock and no unlock screen to deadlock behind,
-- the refusal is indistinguishable from any other so an attacker cannot confirm
-- it landed, and scripts/set_temp_password.mjs clears the counter from outside
-- the application entirely. An unlock button on /access would be the deadlock:
-- both admins locked out, and the cure behind an admin session.
create table if not exists auth_sign_in_failures (
  id          uuid primary key default gen_random_uuid(),
  email_lower text not null,
  ip          text,
  at          timestamptz not null default now()
);

create index if not exists auth_sign_in_failures_email on auth_sign_in_failures (email_lower, at);
create index if not exists auth_sign_in_failures_ip on auth_sign_in_failures (ip, at);
create index if not exists auth_sign_in_failures_at on auth_sign_in_failures (at);
