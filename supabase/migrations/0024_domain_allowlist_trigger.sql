-- POSTGRES ONLY. The domain allowlist, enforced where doc 11 says it belongs.
--
-- docs/design/11 asks for "a domain allowlist enforced in a database trigger
-- rather than in the interface". Until now it was enforced only in the
-- interface, in two route files that each kept their own copy of the list --
-- while two comments in the source said the database was doing it. A comment
-- claiming a safety property the system does not have is worse than no comment:
-- it is what a reviewer checks INSTEAD of the code.
--
-- WHY A SETTING AND NOT A CONSTANT
--
-- A trigger cannot read MM_ALLOWED_DOMAINS; the environment belongs to the
-- application, not the database. So the list lives in app_settings, beside the
-- pursuit vocabularies, for the same reason they do: the practice owns it and
-- can change it without a deployment. It is seeded with the value production
-- runs on today, so this migration changes no behaviour on the day it lands.
--
-- WHY IT FAILS CLOSED
--
-- If the setting is missing or empty, every insert is refused. An allowlist
-- that admits everyone when it is misconfigured is not an allowlist. The blast
-- radius is small and obvious: nobody can be INVITED until an Admin sets it,
-- and sign-in for people already on the roster is untouched, because the
-- trigger fires on insert and on a change of address -- not on the is_active
-- update that /access writes when it deactivates someone.

insert into app_settings (key, value)
values ('allowed_email_domains', 'gmail.com')
on conflict (key) do nothing;

create or replace function enforce_allowed_email_domain() returns trigger
language plpgsql as $$
declare
  configured text;
  candidate  text;
begin
  candidate := lower(btrim(new.email));

  -- One @ and something either side of it. split_part on a malformed address
  -- returns an empty string, which would otherwise be compared against the
  -- list and simply not match -- the right answer for the wrong reason, and a
  -- reason that stops being right the day someone adds an empty entry.
  if candidate !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not an email address: %', new.email
      using errcode = 'check_violation';
  end if;

  select value into configured from app_settings where key = 'allowed_email_domains';

  if configured is null or btrim(configured) = '' then
    raise exception
      'no domain allowlist is configured, so no account may be created'
      using errcode = 'check_violation',
            hint = 'set allowed_email_domains in app_settings, or on /settings';
  end if;

  if not exists (
    select 1 from unnest(string_to_array(configured, ',')) as d
     where lower(btrim(d)) = split_part(candidate, '@', 2)
       and btrim(d) <> ''
  ) then
    raise exception 'the domain of % is not on the allowlist', new.email
      using errcode = 'check_violation',
            hint = 'add it to allowed_email_domains, or invite a different address';
  end if;

  return new;
end $$;

-- `update of email` and not a bare `update`: /access deactivates a person by
-- writing is_active, and a leaver whose domain was removed from the list after
-- they joined must still be deactivatable. Enforcing on every update would
-- refuse exactly the write that takes their access away.
drop trigger if exists app_users_domain_allowlist on app_users;
create trigger app_users_domain_allowlist
  before insert or update of email on app_users
  for each row execute function enforce_allowed_email_domain();
