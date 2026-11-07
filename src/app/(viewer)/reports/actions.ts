"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/context.ts";
import { createReport, deleteReport, updateReport, type Result } from "../../../lib/reports/reports.ts";

/*
 * The three writes behind saved reports. Every role may call them -- anyone
 * who can sign in may save a report -- and reports.ts decides, per report,
 * whether this person may change the one they named: its owner, or an Admin
 * who can see it. The id of the person acting comes from the session, never
 * from the caller.
 */

type NewReport = { name: string; visibility: string; params: string };
type ReportPatch = { name?: string; visibility?: string; params?: string };
type Saved = Result<{ id: string }>;

export async function saveReport(input: NewReport): Promise<Saved> {
  const { user, db } = await requireRole(["viewer", "analyst", "admin"]);
  const got = await createReport(db, user, input);
  if (got.ok) revalidatePath("/reports");
  return got;
}

export async function changeReport(id: string, patch: ReportPatch): Promise<Result> {
  const { user, db } = await requireRole(["viewer", "analyst", "admin"]);
  const got = await updateReport(db, user, id, patch);
  if (got.ok) {
    revalidatePath("/reports");
    revalidatePath(`/reports/${id}`);
  }
  return got;
}

export async function removeReport(id: string): Promise<Result> {
  const { user, db } = await requireRole(["viewer", "analyst", "admin"]);
  const got = await deleteReport(db, user, id);
  if (got.ok) revalidatePath("/reports");
  return got;
}
