-- The pursuit vocabularies, as settings rather than as check constraints.
--
-- Nothing in the design specifies terms for a pursuit's priority or an action's
-- status. A vocabulary invented in a migration is a decision made by whoever
-- wrote the migration, and the interface then has to fight it -- compare
-- docs/design/05's warning against seeding the tier vocabulary from the
-- tracker, which lists five tiers and omits exploration entirely.
--
-- So these are defaults the practice owns and an Admin can change on /settings
-- without a deployment. They are deliberately dull: two statuses and three
-- priorities, which is the smallest thing that is still a choice.
--
-- Idempotent, because this file creates no table and the ledger's adoption rule
-- cannot recognise it as applied.
insert into app_settings (key, value) values
  ('pursuit_priorities',       'High, Medium, Low'),
  ('pursuit_action_statuses',  'Open, Done')
on conflict (key) do nothing;
