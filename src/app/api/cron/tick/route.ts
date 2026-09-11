/**
 * The cron tick.
 *
 * It does ALMOST NOTHING on purpose. A cron firing every minute at a function
 * that runs several hundred seconds produces roughly a dozen concurrently live
 * workers; if each applies its own concurrency limit, actual concurrency is the
 * product of the two, which exhausts rate limits immediately and bills compute
 * around the clock even when the ledger is empty.
 *
 * So the tick asks two questions -- is there work, is a slot free -- and asks
 * ONE worker to start when the answer is yes, over HTTP, without waiting for
 * it. Because it does no work itself, a leaked secret only causes a no-op
 * invocation.
 *
 * GET as well as POST: the platform's scheduler calls with GET. The first
 * twelve hours of production ticks answered 405 to it, which no log line
 * flagged and no screen showed -- src/lib/enrich/tick.ts now records every
 * delivery so that absence is visible.
 */
import { NextResponse } from "next/server";
import { authoriseCron } from "../../../../lib/auth/session.ts";
import { db } from "../../../../lib/auth/context.ts";
import { kickWorker } from "../../../../lib/enrich/kick.ts";
import { tick } from "../../../../lib/enrich/tick.ts";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const auth = authoriseCron(request.headers.get("authorization"));
  if (!auth.ok) {
    // Identical response for a missing and a wrong token.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(request.url).origin;
  const result = await tick(db(), { kick: () => kickWorker({ origin }) });
  return NextResponse.json(result);
}

// @public-endpoint authorises with a constant-time bearer secret, not a role
export async function GET(request: Request) {
  return handle(request);
}

// @public-endpoint authorises with a constant-time bearer secret, not a role
export async function POST(request: Request) {
  return handle(request);
}
