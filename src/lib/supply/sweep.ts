/**
 * Unfinished uploads of supplied PDFs, deleted once past their hour.
 *
 * Apart from supply.ts so the per-minute cron tick (enrich/tick.ts) can call
 * it without loading the research worker. The tick is what makes "at most an
 * hour" true: every upload request also sweeps, but uploads are rare, and
 * scripts/retention.mjs is not scheduled. docs/decisions/SUPPLIED-DOCUMENTS.md.
 */
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";

export async function dropUpload(db: Sql, uploadId: string): Promise<void> {
  await db.run("delete from document_upload_chunks where upload_id = ?", uploadId);
  await db.run("delete from document_uploads where id = ?", uploadId);
}

/** Every upload whose hour has passed, anyone's. */
export async function sweepUploads(
  db: Sql, nowMs: number, opts: { dryRun?: boolean } = {},
): Promise<{ examined: number; deleted: number }> {
  const cutoff = formatStamp(nowMs);
  const ids = (await db.all("select id from document_uploads where expires_at <= ?", cutoff) as Array<{ id: string }>)
    .map((r) => String(r.id));
  if (!opts.dryRun) for (const id of ids) await dropUpload(db, id);
  return { examined: ids.length, deleted: opts.dryRun ? 0 : ids.length };
}
