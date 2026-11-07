-- How many mining issuers TSX's list named, both exchanges together.
--
-- The landing page says "As of <date>, there are N companies listed in the
-- TSX and TSX-V indicated as Mining and Metals issuers". A period committed
-- from TSX's list kept only the companies at or above its threshold, so N was
-- read and then thrown away. It is kept now (src/lib/db/committsx.ts), and is
-- null for a period made from the practice's workbook, which never held the
-- whole list.
--
-- Q4-2026 was committed, and then widened, from one file: TSX's August 2026
-- list, sha256 f97e685a...025139. Parsed by mmparser.tsxlist on 7 November
-- 2026 it reads 1,075 issuers (185 TSX, 890 TSXV), each sheet tying to TSX's
-- own "Number of Issuers". The backfill names the file, not the period, so it
-- can only ever write that file's count.
--
-- Idempotent on purpose, as 0039 explains.
alter table periods add column if not exists listed_issuers int;
update periods set listed_issuers = 1075
 where source_file_sha256 = 'f97e685a816c5414a2129b5b9564c4fefd7abdb865e9b34628fca4dd49025139'
   and listed_issuers is null;
