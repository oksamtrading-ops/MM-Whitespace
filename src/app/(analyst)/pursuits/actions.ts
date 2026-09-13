"use server";

/**
 * Server actions for the pursuit workflow.
 *
 * Every one compiles to an addressable endpoint whether or not the control
 * that calls it ever renders, so each begins with requireRole and
 * `npm run check:auth` fails the build otherwise. A screen that draws no
 * button is not a permission.
 *
 * Analyst and Admin only, decided 13 September 2026. A partner is a Viewer and
 * docs/design/11 revokes the Viewer from these tables in policy rather than in
 * interface logic -- so widening this means reopening the grant, not editing
 * the list below.
 */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import {
  addAction, addNote, closePursuit, PursuitRefused, reopenPursuit, setActionDueDate, setActionOwner,
  setActionStatus, setOwner, setPriority, startPursuit, sweepTerm, type StrandedKind,
} from "../../../lib/pursuit/index.ts";

export type ActionResult = { ok: boolean; message: string; pursuitId?: string };

/** Turns a refusal into something the screen can say, and lets anything else fail loudly. */
async function attempt(
  run: () => Promise<string | void>, ok: string, paths: string[],
): Promise<ActionResult> {
  try {
    const id = await run();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: ok, ...(typeof id === "string" ? { pursuitId: id } : {}) };
  } catch (err) {
    if (err instanceof PursuitRefused) return { ok: false, message: err.message };
    throw err;
  }
}

export async function beginPursuit(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const companyId = String(form.get("companyId") ?? "");
  return attempt(() => startPursuit(db, companyId, user.id),
                 "Pursuit opened.", ["/pursuits", `/companies/${companyId}`]);
}

export async function prioritise(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  return attempt(() => setPriority(db, pursuitId, String(form.get("priority") ?? ""), user.id),
                 "Priority set.", ["/pursuits", `/pursuits/${pursuitId}`]);
}

export async function assign(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  const raw = String(form.get("ownerId") ?? "");
  return attempt(() => setOwner(db, pursuitId, raw === "" ? null : raw, user.id),
                 raw === "" ? "Owner cleared." : "Owner set.",
                 ["/pursuits", `/pursuits/${pursuitId}`]);
}

export async function note(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  return attempt(() => addNote(db, pursuitId, String(form.get("body") ?? ""), user.id),
                 "Note added.", ["/pursuits", `/pursuits/${pursuitId}`]);
}

export async function action(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  const ownerId = String(form.get("ownerId") ?? "");
  return attempt(() => addAction(db, pursuitId, {
    description: String(form.get("description") ?? ""),
    dueDate: String(form.get("dueDate") ?? ""),
    ownerId: ownerId === "" ? null : ownerId,
  }, user.id), "Action added.", ["/pursuits", `/pursuits/${pursuitId}`]);
}

export async function moveAction(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  return attempt(() => setActionStatus(db, String(form.get("actionId") ?? ""),
                                       String(form.get("status") ?? ""), user.id),
                 "Action moved.", ["/pursuits", `/pursuits/${pursuitId}`]);
}

/** Hand one action to somebody, or take it back. */
export async function assignAction(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  const raw = String(form.get("ownerId") ?? "");
  return attempt(
    () => setActionOwner(db, String(form.get("actionId") ?? ""), raw === "" ? null : raw, user.id),
    raw === "" ? "Action unassigned." : "Action assigned.",
    ["/pursuits", `/pursuits/${pursuitId}`]);
}

/** End a pursuit, with what happened. */
export async function endPursuit(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  return attempt(() => closePursuit(db, pursuitId, outcome, user.id),
                 `Closed as “${outcome}”.`, ["/pursuits", `/pursuits/${pursuitId}`]);
}

/** Open one again. Its own act, not an edit of the closing. */
export async function reopen(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  return attempt(() => reopenPursuit(db, pursuitId, user.id),
                 "Reopened.", ["/pursuits", `/pursuits/${pursuitId}`]);
}

/** Put a date on one action, or take it off. */
export async function dateAction(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const pursuitId = String(form.get("pursuitId") ?? "");
  const raw = String(form.get("dueDate") ?? "").trim();
  return attempt(
    () => setActionDueDate(db, String(form.get("actionId") ?? ""), raw || null, user.id),
    raw ? `Due ${raw}.` : "Due date cleared.",
    ["/pursuits", `/pursuits/${pursuitId}`]);
}

/** Sweep every row out of a term the vocabulary no longer knows. */
export async function sweepStatus(form: FormData): Promise<ActionResult> {
  const { user, db } = await requireRole(["analyst", "admin"]);
  const kind = String(form.get("kind") ?? "status") as StrandedKind;
  const from = String(form.get("from") ?? "");
  const to = String(form.get("to") ?? "");
  if (kind !== "status" && kind !== "priority") {
    return { ok: false, message: "That is not something this can move." };
  }
  let moved = 0;
  const result = await attempt(async () => {
    moved = await sweepTerm(db, kind, from, to, user.id);
  }, "", ["/pursuits"]);
  if (!result.ok) return result;
  const noun = kind === "status" ? "action" : "pursuit";
  return { ok: true,
           message: `${moved} ${noun}${moved === 1 ? "" : "s"} moved from “${from}” to “${to}”.` };
}
