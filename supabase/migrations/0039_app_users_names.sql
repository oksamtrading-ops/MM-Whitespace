-- A first and a last name for every person, which the tool now requires.
--
-- Supersedes 0038's display_name, which was one free-text field. The tool
-- reads these two instead and no longer reads display_name; the column is
-- left in place because the deployment before this one reads it, and a
-- migration applied ahead of its push must not break the code still running.
--
-- An account without both names is let in only as far as the form that asks
-- for them (assertRole's name gate). An Admin's invitation supplies them, so
-- only accounts invited before this migration meet that form.
--
-- Idempotent on purpose: this file creates no table, so the ledger's adoption
-- rule cannot recognise it as applied and may replay it. One add column per
-- alter table, as 0027 explains.
alter table app_users add column if not exists first_name text;
alter table app_users add column if not exists last_name text;
