/**
 * The worker, as a platform function.
 *
 * Answers 202 the moment it has scheduled itself, then drains the ledger
 * after the response until the queue is empty or its deadline arrives. The
 * tick and the start-run action both call this and neither waits on it.
 *
 * The deadline is the function's maxDuration less a margin for the job in
 * flight to finish. If the platform ends the invocation anyway, the lease
 * lapses, the next tick returns the job to the queue and no attempt is
 * charged -- so an early end costs time, not money and not a retry.
 *
 * When work remains at the deadline the worker asks for a successor, so a
 * 259-company run advances without waiting for a schedule. Chaining is
 * bounded by the slot table: a successor that finds no free slot exits.
 */
import { after, NextResponse } from "next/server";
import { authoriseCron } from "../../../../lib/auth/session.ts";
import { db } from "../../../../lib/auth/context.ts";
import { drain } from "../../../../lib/enrich/drain.ts";
import { kickWorker } from "../../../../lib/enrich/kick.ts";
import { enrichmentMode } from "../../../../lib/enrich/worker.ts";

export const dynamic = "force-dynamic";

/**
 * Vercel Pro's ceiling with Fluid compute. S1 measured a probe living its full
 * 240 of 240 s at maxDuration 300; live research needs the room. Probe again.
 */
export const maxDuration = 800;
/** The drain loop's own clock, leaving the platform a margin. */
export const DRAIN_DEADLINE_SECONDS = 720;
/** No new job starts with less than this left: a live job runs for minutes. */
export const RESERVE_SECONDS = 240;

// @public-endpoint authorises with a constant-time bearer secret, not a role
export async function POST(request: Request) {
  const auth = authoriseCron(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "1";
  const mode = enrichmentMode();
  if (!probe && mode.mode === null) {
    return NextResponse.json({ accepted: false, note: mode.reason }, { status: 409 });
  }

  const handle = db();
  const host = process.env.VERCEL_REGION ?? "local";
  after(async () => {
    const outcome = await drain(handle, {
      deadlineSeconds: DRAIN_DEADLINE_SECONDS, reserveSeconds: probe ? 0 : RESERVE_SECONDS,
      mode: mode.mode ?? "replay", probe, host,
    });
    if (!probe && outcome.workRemains && outcome.reason === "deadline") {
      await kickWorker({ origin: url.origin });
    }
  });

  return NextResponse.json(
    { accepted: true, probe, deadlineSeconds: DRAIN_DEADLINE_SECONDS, note: probe ? "probe" : "draining" },
    { status: 202 });
}
