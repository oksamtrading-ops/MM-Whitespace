"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../../lib/auth/context.ts";
import { mergeCompanies, MergeRefused } from "../../../../lib/identity/merge.ts";

export type MergeMessage =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Merging is Admin-only for the same reason the publish override is: an
 * Analyst sees the candidates and can say two rows are one company, but the
 * act that rewrites which company a period's data belongs to is signed for.
 */
export async function merge(_prev: MergeMessage | null, form: FormData): Promise<MergeMessage> {
  const { db, user } = await requireRole(["admin"]);
  const winnerId = String(form.get("winnerId") ?? "");
  const loserId = String(form.get("loserId") ?? "");
  const confirmed = form.get("confirm") === "yes";

  if (!confirmed) return { ok: false, message: "Confirm the direction before merging." };

  try {
    const { moved, discarded, preview } =
      await mergeCompanies(db, { winnerId, loserId, actorId: user.id });
    revalidatePath("/companies");
    revalidatePath("/companies/merge");
    return {
      ok: true,
      message: `“${preview.loser.name}” is now “${preview.winner.name}”. ` +
               `${moved} row${moved === 1 ? "" : "s"} moved` +
               (discarded > 0 ? `, ${discarded} already recorded and dropped` : "") +
               `. ${preview.frozenRevisions} published row${preview.frozenRevisions === 1 ? "" : "s"} ` +
               `left exactly as published.`,
    };
  } catch (err) {
    if (err instanceof MergeRefused) return { ok: false, message: err.message };
    throw err;
  }
}
