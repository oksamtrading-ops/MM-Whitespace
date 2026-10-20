"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "../../../lib/auth/context.ts";
import { evaluateGate } from "../../../lib/publish/gate.ts";
import { revisionChanges } from "../../../lib/publish/changes.ts";
import { publishPeriod, PublishBlocked } from "../../../lib/publish/snapshot.ts";

export type PublishMessage = { ok: false; message: string };

/** An override reason is read by a partner months later, so it has to be a sentence. */
const MIN_REASON = 20;

/**
 * Publish, or amend, the latest committed period.
 *
 * NOT YET A JOB. docs/design/08 calls for a transactional job with a progress
 * state, because on Postgres the snapshot write will take tens of seconds.
 * Against SQLite it completes in milliseconds, so this is a server action with
 * a pending state. It is transactional either way -- publishPeriod writes the
 * whole revision or none of it. When the database moves, this moves with it.
 *
 * The gate is re-evaluated here rather than trusted from the page: the screen
 * that offered the button may be minutes old, and a decision recorded since
 * then can have closed or opened it.
 */
export async function publish(_prev: PublishMessage | null, form: FormData): Promise<PublishMessage> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const periodId = String(form.get("periodId") ?? "");
  const overrideReason = String(form.get("overrideReason") ?? "").trim();
  const amendmentReason = String(form.get("amendmentReason") ?? "").trim();

  const period = await db.get("select id, label, status from periods where id = ?", periodId) as { id: string; label: string; status: string } | undefined;
  if (!period) return { ok: false, message: "That period no longer exists." };

  const gate = await evaluateGate(db, periodId);
  const amending = Boolean(await db.get("select 1 from period_publications where period_id = ? limit 1", periodId));

  if (!gate.publishable) {
    if (user.role !== "admin") {
      return { ok: false, message: "The gate is blocked. Only an Admin may publish through it." };
    }
    if (overrideReason.length < MIN_REASON) {
      return {
        ok: false,
        message: `An override needs a reason of at least ${MIN_REASON} characters. It is printed ` +
                 "on the dashboard header for as long as this revision stands.",
      };
    }
  }
  if (amending && !amendmentReason) {
    return { ok: false, message: "An amendment needs a reason. The published revision is not replaced." };
  }
  // Read here, not trusted from the page, for the reason the gate is: the page
  // may be minutes old, and an undo since then can have emptied the list.
  if (amending) {
    const changes = await revisionChanges(db, periodId);
    if (changes && changes.total === 0 && form.get("nothingChanged") !== "yes") {
      return {
        ok: false,
        message: `Nothing has changed since revision ${changes.revision}, so this revision would differ ` +
                 "from it only in its reasons. Reload the page to see that, and tick the box to publish it anyway.",
      };
    }
  }

  try {
    await publishPeriod(db, periodId, {
      actorId: user.id,
      overrideReason:gate.publishable ? null : overrideReason,
      amendmentReason: amending ? amendmentReason : null,
    });
  } catch (err) {
    if (err instanceof PublishBlocked) {
      return { ok: false, message: "The gate closed while this was being published. Reload and look again." };
    }
    return { ok: false, message: (err as Error).message };
  }
  // The top bar carries the revision. Without this it keeps saying rev 1 on
  // the page that says Revision 2, which is the sort of quiet disagreement
  // this product exists to prevent.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
