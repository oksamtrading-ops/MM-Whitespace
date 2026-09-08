"use server";

/**
 * Server actions for the review grid.
 *
 * Every one of these compiles to an addressable endpoint whether or not the
 * control that calls it ever renders, so each begins with assertRole and
 * `npm run check:auth` fails the build otherwise. The grid not drawing a button
 * is not a permission.
 */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../../lib/auth/context.ts";
import {
  bulkConfirmation, partitionForBulkAccept, recordDecision, undoLast,
} from "../../../../lib/review/decide.ts";
import { fieldRows } from "../../../../lib/review/queue.ts";

export type ActionResult = { ok: boolean; message: string };

export async function decide(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);

  const periodId = String(form.get("periodId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  const fieldKey = String(form.get("fieldKey") ?? "");
  const decision = String(form.get("decision") ?? "") as "accept" | "override" | "flag";
  const reason = form.get("reason") ? String(form.get("reason")) : null;
  const rawOverride = form.get("overrideValue");
  const findingId = form.get("findingId") ? String(form.get("findingId")) : null;
  const findingAttempt = form.get("findingAttempt")
    ? Number(form.get("findingAttempt")) : null;

  try {
    recordDecision(db, {
      periodId, companyId, fieldKey, decision,
      overrideValue: decision === "override"
        ? (rawOverride === null ? undefined : String(rawOverride)) : undefined,
      reason, findingId, findingAttempt, actorId: user.id,
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath(`/review/${fieldKey}`);
  return { ok: true, message: `${decision} recorded` };
}

export async function undo(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);

  const periodId = String(form.get("periodId") ?? "");
  const fieldKey = String(form.get("fieldKey") ?? "");
  const result = undoLast(db, periodId, fieldKey, user.id);
  revalidatePath(`/review/${fieldKey}`);
  return result
    ? { ok: true, message: "Last decision undone." }
    : { ok: false, message: "Nothing left to undo." };
}

export async function bulkAccept(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);

  const periodId = String(form.get("periodId") ?? "");
  const fieldKey = String(form.get("fieldKey") ?? "");
  const bucket = String(form.get("bucket") ?? "bulkable");
  const threshold = Number(form.get("threshold") ?? 0.8);
  // Stage determines tier, so the opt-in is TYPED rather than a checkbox.
  const stageOptIn = String(form.get("stageOptIn") ?? "").trim().toUpperCase() === "STAGE";

  const rows = fieldRows(db, periodId, fieldKey, bucket, threshold);
  const { accept, refused } = partitionForBulkAccept(fieldKey, rows, { threshold, stageOptIn });

  for (const c of accept) {
    recordDecision(db, {
      periodId, companyId: c.companyId, fieldKey, decision: "accept",
      findingId: c.findingId, findingAttempt: c.findingAttempt,
      actorId: user.id, bulk: true,
    });
  }
  db.prepare(
    `insert into audit_log (event, actor_id, period_id, detail) values ('bulk_accept', ?, ?, ?)`,
  ).run(user.id, periodId, JSON.stringify({
    fieldKey, threshold, accepted: accept.length, refused: refused.length,
    companies: accept.map((c) => c.companyId),
  }));

  revalidatePath(`/review/${fieldKey}`);
  return {
    ok: true,
    message: `${accept.length} accepted. ${refused.length} left for individual review.`,
  };
}

export async function confirmationText(
  periodId: string, fieldKey: string, fieldLabel: string, bucket: string, threshold: number,
): Promise<string> {
  const { db } = await requireRole(["analyst", "admin"]);
  const rows = fieldRows(db, periodId, fieldKey, bucket, threshold);
  const { accept, refused } = partitionForBulkAccept(fieldKey, rows, { threshold });
  return bulkConfirmation(fieldLabel, accept.length, threshold, refused.length);
}
