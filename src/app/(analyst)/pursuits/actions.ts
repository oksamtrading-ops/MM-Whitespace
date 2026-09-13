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
  addAction, addNote, PursuitRefused, setActionStatus, setOwner, setPriority, startPursuit,
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
