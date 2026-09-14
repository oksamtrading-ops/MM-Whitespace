-- The order decisions were written in, kept in the row rather than inferred.
--
-- Ordering rested on (decided_at, id). decided_at comes from decisionStamp(),
-- which is monotonic to the microsecond -- but only WITHIN ONE PROCESS: its
-- high-water mark is a module-level variable. Production runs many concurrent
-- serverless instances, so two of them can issue the same microsecond, and the
-- tiebreak is then a random uuid. That does not order anything; it just decides
-- consistently, which is worse, because it looks like an answer.
--
-- The effect was bounded and has never happened: 240 decisions in production,
-- 240 distinct stamps, no ties. Two decisions collide only if they are written
-- in the same microsecond by different instances, and it only changes anything
-- if they are on the same company and field -- where the loser is a decision a
-- person made that undo would then walk past. This is the hazard closing while
-- it is still theoretical, not a repair.
--
-- WHAT THIS REPLACES, AND WHY THE ORDERING GETS SIMPLER
--
-- `order by decided_at desc, id desc` becomes `order by seq desc`. One key, and
-- one that means what it says. decided_at stays as the time a person decided --
-- worth reading, no longer load-bearing -- so a clock correction can no longer
-- reorder an audit trail.
--
-- The backfill numbers existing rows by exactly the ordering the system used
-- until now, (decided_at, id). It preserves history as currently understood
-- rather than asserting a new version of it.
--
-- WHY NOT AN IDENTITY COLUMN
--
-- SQLite allows AUTOINCREMENT only on an INTEGER PRIMARY KEY, and this table
-- already has a uuid one, so no pure-DDL auto column runs on both engines. The
-- value is supplied by the insert instead, from a scalar subquery that is
-- ordinary SQL on both. Inside a transaction each insert sees the rows before
-- it, so a bulk accept numbers itself correctly. Between two concurrent
-- transactions both can read the same maximum -- and then the unique index
-- refuses the second, loudly, which is the whole point: a raised error a
-- reviewer retries, instead of two rows silently claiming the same place.

alter table review_decisions add column if not exists seq bigint;

update review_decisions
   set seq = (select count(*) from review_decisions r2
               where r2.decided_at < review_decisions.decided_at
                  or (r2.decided_at = review_decisions.decided_at
                      and r2.id <= review_decisions.id))
 where seq is null;

create unique index if not exists review_decisions_seq_key on review_decisions (seq);
