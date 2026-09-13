-- A pursuit can end, and can end more than once.
--
-- /pursuits was headed "Open pursuits" and nothing could ever leave it. At ten
-- that is tidy; at eighty it is a list nobody trusts, because the ones that are
-- over are indistinguishable from the ones nobody has touched. Actions were
-- given a way to close on 13 September and pursuits were not.
--
-- Closing records an OUTCOME, not just a date. "This is over" is not worth
-- writing down; "we won it" and "they renewed with their incumbent" are
-- different facts and the whole point of keeping the record. The vocabulary is
-- a setting like the other two, so the practice owns its words.
--
-- WHY A TABLE RATHER THAN THREE COLUMNS ON `pursuits`. Two reasons, and the
-- second is the one that decided it. A pursuit that was called lost, came back
-- and was won is a history, and columns keep only the latest of it. And a
-- migration after the last table-creating one is REPLAYED on a database that
-- predates the ledger -- the adoption rule recognises a file by the table it
-- creates -- so it has to be idempotent, and `alter table add column` is not,
-- on either engine. A file that creates a table is recognised and left alone.
--
-- Open means: no closure of this pursuit has a null reopened_at.
create table pursuit_closures (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references pursuits(id),
  outcome     text not null,
  closed_at   timestamptz not null default now(),
  closed_by   uuid references app_users(id),
  -- Set when it is opened again. The row stays: a pursuit that was called lost
  -- and then came back is worth being able to find afterwards.
  reopened_at timestamptz,
  reopened_by uuid references app_users(id)
);
create index pursuit_closures_open_idx on pursuit_closures (pursuit_id, reopened_at);

insert into app_settings (key, value) values
  ('pursuit_outcomes', 'Won, Lost, Dormant')
on conflict (key) do nothing;
