-- The market-cap threshold a revision was published at.
--
-- A period's threshold was fixed when the period was created, so the
-- dashboard read it from the period. Since a period can be widened -- TSX's
-- list for the same date, committed again at a lower threshold, adds the
-- companies between the two lines (src/lib/db/committsx.ts) -- the period's
-- threshold can now fall after it has been published. Q4-2026 was published
-- four times at C$200M before the Admin lowered the threshold to C$100M on
-- 30 October 2026 to widen it. Read from the period, revision 4 would then
-- say "C$100M" over 266 companies that are all above C$200M. Each revision
-- now keeps its own, and the dashboard reads the revision's.
--
-- Existing revisions take their period's threshold, which none has changed
-- before this migration.
--
-- Idempotent on purpose: this file creates no table, so the ledger's adoption
-- rule cannot recognise it as applied and may replay it. One add column per
-- alter table, as 0027 explains.
alter table period_publications add column if not exists threshold_amount numeric(20,4);
alter table period_publications add column if not exists threshold_operator text;
alter table period_publications add column if not exists threshold_currency char(3);
update period_publications
   set threshold_amount   = (select p.threshold_amount from periods p where p.id = period_publications.period_id),
       threshold_operator = (select p.threshold_operator from periods p where p.id = period_publications.period_id),
       threshold_currency = (select p.threshold_currency from periods p where p.id = period_publications.period_id)
 where threshold_amount is null;
