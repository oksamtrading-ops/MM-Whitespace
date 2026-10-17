"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { commitPeriod } from "../../../lib/db/commit.ts";
import { commitTsxPeriod } from "../../../lib/db/committsx.ts";
import { baseLeftovers, isTsxPayload, loadTsxPlan } from "../../../lib/ingest/tsx.ts";
import { requireRole } from "../../../lib/auth/context.ts";
import { dropParse, ParseFailed, parseUpload, readParse } from "../../../lib/ingest/quarantine.ts";

export type UploadResult = { ok: false; message: string; detail?: string };

/**
 * Parse an uploaded workbook and send the Analyst to its validation report.
 * Nothing is written to the database here: the report precedes the commit.
 */
export async function uploadWorkbook(_prev: UploadResult | null, form: FormData): Promise<UploadResult> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const file = form.get("workbook");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a workbook first." };
  }
  let id: string;
  try {
    const parse = await parseUpload(db, new Uint8Array(await file.arrayBuffer()), file.name,
                                    { uploadedBy: user.id });
    id = parse.id;
  } catch (err) {
    if (err instanceof ParseFailed) {
      return { ok: false, message: err.message, detail: err.detail };
    }
    throw err;
  }
  // Outside the try: redirect() signals by throwing, and catching it here
  // would report a successful parse as a failure.
  redirect(`/upload/${id}`);
}

export type CommitResultMessage = { ok: false; message: string };

/** Commit a parsed period. Refuses while anything is blocking. */
export async function commitParsed(_prev: CommitResultMessage | null, form: FormData): Promise<CommitResultMessage> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const id = String(form.get("parseId") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const parse = await readParse(db, id);

  if (!parse) {
    return { ok: false, message: "That parse has expired. Upload the workbook again." };
  }
  if (parse.payload.report.blocking.length > 0) {
    return { ok: false, message: "This workbook has blocking findings and cannot be committed." };
  }
  if (!label) {
    return { ok: false, message: "Name the period before committing." };
  }
  // TSX's list is planned against the database as it stands, so its own
  // refusals and warnings are read again here, as the report read them.
  const tsx = isTsxPayload(parse.payload);
  let warnings = parse.payload.report.warnings.length;
  if (tsx) {
    const plan = await loadTsxPlan(db, parse.payload);
    if (plan.blocking.length > 0) return { ok: false, message: plan.blocking[0] };
    warnings += (await baseLeftovers(db, plan.base)).length;
  }
  if (warnings > 0 && form.get("acknowledged") !== "yes") {
    return { ok: false, message: "Acknowledge the warnings before committing." };
  }

  try {
    if (tsx) {
      await commitTsxPeriod(db, parse.payload, { label, sourceSha256: parse.sha256, actorId: user.id });
    } else {
      await commitPeriod(db, parse.payload as Parameters<typeof commitPeriod>[1], {
        label, sourceSha256: parse.sha256, actorId: user.id,
      });
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await dropParse(db, id);
  // The top bar carries the period and its status.
  revalidatePath("/", "layout");
  redirect("/review");
}
