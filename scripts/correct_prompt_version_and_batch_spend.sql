-- A one-off correction to two production records, 13 September 2026.
--
--   psql "$MM_DATABASE_URL" -f scripts/correct_prompt_version_and_batch_spend.sql
--
-- Run it once, before Run 3. It is one transaction, so it applies whole or not
-- at all, and every clause matches on the value it expects to replace, so a
-- second run reports UPDATE 0 and changes nothing.
--
-- Expected output: UPDATE 11, UPDATE 462, INSERT 0 2, COMMIT.
--
-- WHAT IT CORRECTS, and why each is a record rather than a bug
--
-- 1. Provenance. A live prompt is two halves -- prompt.ts's stable prefix and
--    live.ts's DISCOVERY_RULES / EXTRACTION_RULES -- and only the prefix was
--    ever versioned. Both recording sites in worker.ts wrote the prefix's
--    constant whatever the mode, so all 462 findings and all 11 runs read
--    "2026-09-04.1", a number describing a prompt none of them were asked
--    with. Every run in this database is mode=live, so every one takes the
--    composite. The rules have not changed since these findings were made, so
--    the new stamp describes them accurately rather than retroactively
--    asserting something. Fixed in code at commit f84801e.
--
-- 2. Spend. Meter.add applied the Batch API discount to the per-search charge
--    as well as to the tokens. Anthropic does not discount web search in
--    batches -- "Web search tool calls through the Messages Batches API are
--    priced the same as those in regular Messages API requests" -- so the two
--    batched runs each recorded half their search charge: 18 searches and 6,
--    at half a cent understated apiece, is $0.09 and $0.03. Fixed in code at
--    commit 50d6db8. Only these two runs were batched; every other run was
--    synchronous, metered at rate 1, and is correct as recorded.
--
-- WHY THE RUNS TABLE IS UPDATED ONCE AND NOT TWICE
--
-- Run b5d3d9c3 needs both a restamp and a spend correction. Written as two
-- statements they would both be correct here, inside one transaction -- but
-- written as two data-modifying CTEs in a single statement, which is the
-- tidier-looking form, Postgres would apply only one of them and say nothing.
-- One UPDATE with the money in a CASE cannot fail that way.
--
-- Timing: before Run 3, or not at all. Run 3 writes its findings under the
-- composite, and a backfill afterwards would leave Q3-2026 split between two
-- conventions with no way to tell which rows were relabelled.

begin;

-- The 11 runs, and the money on the two that were batched.
update enrichment_runs
   set prompt_version = '2026-09-04.1+live.2026-09-13.1',
       spend_usd = case
         when id = 'b5d3d9c3-0718-4f13-b5ac-1f6369054c1f' and spend_usd = 0.3936 then 0.4836
         when id = '4ba5d7d7-8a6a-46a1-b223-aca18a85ad7a' and spend_usd = 0.1447 then 0.1747
         else spend_usd end
 where mode = 'live'
   and prompt_version = '2026-09-04.1';

-- The 462 findings those runs produced.
update enrichment_findings
   set prompt_version = '2026-09-04.1+live.2026-09-13.1'
 where prompt_version = '2026-09-04.1';

-- Say that it happened, and why. actor_id is null because no one did this
-- through the application; that is the same convention a script's run already
-- follows (createdBy ?? null).
insert into audit_log (event, actor_id, period_id, detail)
values
  ('enrichment_prompt_version_backfilled',
   null,
   (select id from periods order by created_at desc limit 1),
   jsonb_build_object(
     'from', '2026-09-04.1',
     'to', '2026-09-04.1+live.2026-09-13.1',
     'runs', 11,
     'findings', 462,
     'why', 'Only prompt.ts''s prefix was versioned; live.ts''s rules were versioned by nothing at all. The composite names both halves.',
     'fixed_in_code', 'f84801e')),
  ('enrichment_spend_corrected',
   null,
   (select id from periods order by created_at desc limit 1),
   jsonb_build_object(
     'why', 'The Batch API discount was applied to the per-search charge as well as to tokens; Anthropic does not discount web search in batches.',
     'corrections', jsonb_build_array(
       jsonb_build_object('run', 'b5d3d9c3-0718-4f13-b5ac-1f6369054c1f', 'searches', 18, 'from', 0.3936, 'to', 0.4836),
       jsonb_build_object('run', '4ba5d7d7-8a6a-46a1-b223-aca18a85ad7a', 'searches', 6, 'from', 0.1447, 'to', 0.1747)),
     'total_added_usd', 0.12,
     'fixed_in_code', '50d6db8'));

commit;

-- Afterwards these three should read: 0.4836 and 0.1747; one prompt_version
-- across 462 findings; and 11.6009.
--
--   select id, spend_usd, prompt_version from enrichment_runs
--    where id in ('b5d3d9c3-0718-4f13-b5ac-1f6369054c1f',
--                 '4ba5d7d7-8a6a-46a1-b223-aca18a85ad7a');
--   select prompt_version, count(*) from enrichment_findings group by 1;
--   select round(sum(spend_usd), 4) from enrichment_runs;
