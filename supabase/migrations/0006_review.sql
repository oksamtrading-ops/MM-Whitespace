-- Review decisions.
--
-- Decisions are ROWS, never mutations. That is what makes undo an insert rather
-- than a delete, and it is what lets the audit trail answer what an Analyst
-- actually saw at the moment they decided.

create table review_decisions (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references periods(id),
  company_id     uuid not null references companies(id),
  field_key      text not null references field_catalog(key),
  decision       text not null check (decision in ('accept', 'override', 'flag', 'undo')),
  override_value jsonb,
  reason         text,
  finding_id     uuid references enrichment_findings(id),
  -- Binds the decision to the proposal it judged. Without it an override
  -- silently re-binds to a later proposal and the trail no longer records what
  -- the Analyst actually saw.
  finding_attempt int,
  -- Set when this row undoes an earlier one. An undo is an insert.
  undoes_id      uuid references review_decisions(id),
  -- True when the row came from a bulk accept, so a bulk action can be
  -- distinguished from 500 individual judgements in the audit trail.
  bulk           boolean not null default false,
  actor_id       uuid references app_users(id),
  decided_at     timestamptz not null default now(),
  -- A flag must carry a reason and an override must carry a value. Enforced
  -- here rather than in the interface, because the interface is not the
  -- boundary. Inline rather than ALTER: SQLite has no ADD CONSTRAINT.
  check (decision != 'flag' or (reason is not null and length(trim(reason)) > 0)),
  check (decision != 'override' or override_value is not null),
  check (decision != 'undo' or undoes_id is not null)
);
create index review_decisions_field_idx on review_decisions (period_id, field_key);
create index review_decisions_target_idx on review_decisions (period_id, company_id, field_key);
