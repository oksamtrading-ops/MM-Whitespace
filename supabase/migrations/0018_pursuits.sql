-- The pursuit tables, shipped EMPTY and policied.
--
-- docs/design/02 scopes this precisely: "Pursuit workflow (activity, priority,
-- notes, owners) -- Data model and access policy only", with the full workflow
-- and its interface in Phase 2. They ship in Phase 1 "empty but policied,
-- because a table with no interface is still reachable through the data API"
-- (docs/design/05). That is the whole of the commitment: no screen, no server
-- action, no parser branch. The source tracker is an empty 19-row template and
-- its parser branch was removed, so there is nothing to migrate in.
--
-- WHAT IS DELIBERATELY NOT DECIDED HERE. `priority` and `status` are free text
-- with no check constraint, because no vocabulary for them is specified
-- anywhere. Inventing one now would be a decision made by whoever wrote the
-- migration rather than by the practice, and Phase 2's interface would then
-- have to fight it. Compare docs/design/05's warning against seeding the tier
-- vocabulary from the tracker, which lists five tiers and omits exploration.
--
-- TWO COLUMNS DOC 05 SPECIFIES ARE DELIBERATELY ABSENT. Its DDL lists `lcsp`,
-- a Lead Client Service Partner -- a person's name -- and `fy_tax_nsr`,
-- Deloitte's own revenue from a client. Samuel's decision, 13 September 2026:
-- neither is created. They are the same class of data the POC already refuses,
-- the `Deloitte Tax Client` column having been removed at parse time for
-- exactly that reason and migration 0015 having chosen researched fields that
-- name no person. An empty column is an invitation, and this build stores no
-- Deloitte client information and nobody's name.
--
-- THE SCHEMA AND DOC 05 THEREFORE DISAGREE ON PURPOSE, and doc 05 says so
-- where it specifies them. Do not "restore" them to match the document. Phase 2
-- may add either, with the firm's own due diligence first -- which is the same
-- condition the tax-client flag carries.
--
-- The DDL in docs/design/05 is abbreviated; the foreign keys, the defaults and
-- pursuit_actions.created_at are completed here to match the rest of the
-- schema rather than to add anything to the model.

create table pursuits (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  priority    text,
  owner_id    uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index pursuits_company_idx on pursuits (company_id);

create table pursuit_notes (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references pursuits(id),
  body        text,
  author_id   uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index pursuit_notes_pursuit_idx on pursuit_notes (pursuit_id);

create table pursuit_actions (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references pursuits(id),
  description text,
  due_date    date,
  owner_id    uuid references app_users(id),
  status      text,
  created_at  timestamptz not null default now()
);
create index pursuit_actions_pursuit_idx on pursuit_actions (pursuit_id, status);
