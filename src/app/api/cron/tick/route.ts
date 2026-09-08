/**
 * The cron tick.
 *
 * It does ALMOST NOTHING on purpose. A cron firing every minute at a function
 * that runs several hundred seconds produces roughly a dozen concurrently live
 * workers; if each applies its own concurrency limit, actual concurrency is the
 * product of the two, which exhausts rate limits immediately and bills compute
 * around the clock even when the ledger is empty.
 *
 * So the tick asks two questions -- is there work, is a slot free -- and returns
 * without invoking anything when the answer is no. Because it does no work
 * itself, a leaked secret only causes a no-op invocation.
 */
import { NextResponse } from "next/server";
import { authoriseCron } from "../../../../lib/auth/session.ts";
import { db } from "../../../../lib/auth/context.ts";
import { reapExpiredLeases } from "../../../../lib/enrich/ledger.ts";

export const dynamic = "force-dynamic";

// @public-endpoint authorises with a constant-time bearer secret, not a role
export async function POST(request: Request) {
  const auth = authoriseCron(request.headers.get("authorization"));
  if (!auth.ok) {
    // Identical response for a missing and a wrong token.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const handle = db();
  const reaped = reapExpiredLeases(handle);

  const pending = (handle.prepare(
    `select count(*) n from enrichment_jobs
      where state = 'queued' and (available_at is null or available_at <= datetime('now'))`,
  ).get() as { n: number }).n;

  const freeSlots = (handle.prepare(
    `select count(*) n from worker_slots
      where leased_by is null or lease_expires_at < datetime('now')`,
  ).get() as { n: number }).n;

  const shouldInvoke = pending > 0 && freeSlots > 0;
  return NextResponse.json({
    reapedLeases: reaped,
    pending,
    freeSlots,
    invokedWorker: shouldInvoke,
    note: shouldInvoke ? "work exists and a slot is free" : "nothing to do",
  });
}
