"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/context.ts";
import { kickWorker } from "../../../lib/enrich/kick.ts";
import { startRun, StartRefused, type Scope } from "../../../lib/enrich/start.ts";
import { enrichmentMode } from "../../../lib/enrich/worker.ts";

export type StartResult = { ok: false; message: string };

/**
 * Start a run, then ask a worker to begin without waiting for the schedule.
 *
 * Every refusal is decided in src/lib/enrich/start.ts, not here and not in
 * the form: the estimate blocks, a large scope needs its count typed, a full
 * re-run is Admin-only, and one run at a time.
 */
export async function start(_prev: StartResult | null, form: FormData): Promise<StartResult> {
  const { db, user } = await requireRole(["analyst", "admin"]);

  const mode = enrichmentMode();
  if (mode.mode === null) return { ok: false, message: mode.reason };

  const periodId = String(form.get("periodId") ?? "");
  const scope: Scope = String(form.get("scope") ?? "") === "all" ? "all" : "unresearched";
  const budgetUsd = Number(String(form.get("budgetUsd") ?? "").replace(/[$,\s]/g, ""));
  const typed = String(form.get("confirmCount") ?? "").trim();
  const confirmCount = typed === "" ? null : Number(typed);

  const period = await db.get("select id from periods where id = ?", periodId) as { id: string } | undefined;
  if (!period) return { ok: false, message: "That period no longer exists." };
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { ok: false, message: "A run cannot be created without a budget." };
  }

  try {
    await startRun(db, {
      periodId, scope, budgetUsd, mode: mode.mode,
      actor: { id: user.id, role: user.role }, confirmCount,
    });
  } catch (err) {
    if (err instanceof StartRefused) return { ok: false, message: err.message };
    throw err;
  }

  // The worker is asked, not awaited. If it cannot be reached, the tick asks
  // again within the minute; the run screen shows the ask either way. The
  // origin is only a fallback: a deployment sets MM_PUBLIC_URL and uses that.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  await kickWorker({ origin });

  revalidatePath("/runs");
  redirect("/runs");
}
