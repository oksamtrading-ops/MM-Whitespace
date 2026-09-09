"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { commitPeriod } from "../../../lib/db/commit.ts";
import { requireRole } from "../../../lib/auth/context.ts";
import { dropParse, ParseFailed, parseUpload, readParse } from "../../../lib/ingest/quarantine.ts";

export type UploadResult = { ok: false; message: string; detail?: string };

/**
 * Parse an uploaded workbook and send the Analyst to its validation report.
 * Nothing is written to the database here: the report precedes the commit.
 */
export async function uploadWorkbook(_prev: UploadResult | null, form: FormData): Promise<UploadResult> {
  await requireRole(["analyst", "admin"]);
  const file = form.get("workbook");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a workbook first." };
  }
  let id: string;
  try {
    const parse = await parseUpload(new Uint8Array(await file.arrayBuffer()), file.name);
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
  const parse = readParse(id);

  if (!parse) {
    return { ok: false, message: "That parse has expired. Upload the workbook again." };
  }
  if (parse.payload.report.blocking.length > 0) {
    return { ok: false, message: "This workbook has blocking findings and cannot be committed." };
  }
  if (!label) {
    return { ok: false, message: "Name the period before committing." };
  }
  if (parse.payload.report.warnings.length > 0 && form.get("acknowledged") !== "yes") {
    return { ok: false, message: "Acknowledge the warnings before committing." };
  }

  try {
    commitPeriod(db, parse.payload as Parameters<typeof commitPeriod>[1], {
      label, sourceSha256: parse.sha256, actorId: user.id,
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  dropParse(id);
  // The top bar carries the period and its status.
  revalidatePath("/", "layout");
  redirect("/review");
}
