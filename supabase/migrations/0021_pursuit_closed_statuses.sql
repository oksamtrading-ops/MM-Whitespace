-- Finished and abandoned stop being the same word.
--
-- 0020 seeded "Open, Done" and the code read "closed" as POSITION: the last
-- status in the list ended an action, so exactly one status could. An action
-- somebody gave up on had to be recorded as Done, which means a count of
-- completed work silently included the work nobody did -- and the pursuit
-- screen's own caption claims the opposite ("an action that was abandoned is a
-- fact about the pursuit").
--
-- A star now marks each status that closes, so "Open, Done*, Superseded*" says
-- what it means. One field rather than two, because a separate list of closing
-- statuses can name a status the first list does not have, and then the two
-- disagree with nothing to say which is right.
--
-- GUARDED, so it changes only the value 0020 seeded. A practice that has since
-- chosen its own vocabulary keeps it, and parseStatuses closes on the last term
-- for any value written before the star existed -- otherwise this migration
-- would quietly reopen every finished action in the database.
update app_settings
   set value = 'Open, Done*'
 where key = 'pursuit_action_statuses'
   and value = 'Open, Done';
