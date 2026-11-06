"use server";

/**
 * Supplying a company's document, and removing one. Every action is a public
 * POST endpoint whatever renders it, so each asks for the role first, and
 * src/lib/supply checks every id against the acting user.
 */
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../../../lib/auth/context.ts";
import { extractPdf } from "../../../../../lib/enrich/pdf.ts";
import {
  addChunk, beginUpload, finishUpload, isRowId, SupplyRefused, supplyWhole, withdrawSupplied, type SupplyInput,
} from "../../../../../lib/supply/supply.ts";

export type SupplyResult =
  | { ok: true; pages: number; message: string }
  | { ok: false; message: string };

export type Outcome = { ok: true; message?: string } | { ok: false; message: string };

export type BeginResult =
  | { ok: true; uploadId: string; chunkCount: number; chunkBytes: number }
  | { ok: false; message: string };

function inputFrom(form: FormData, file: { name: string; size: number }): SupplyInput {
  return {
    companyId: String(form.get("companyId") ?? ""), periodId: String(form.get("periodId") ?? ""),
    url: String(form.get("url") ?? ""), kind: String(form.get("kind") ?? ""),
    filename: file.name, sizeBytes: file.size, attested: form.get("attested") === "yes",
  };
}

/** Words for whatever went wrong. A refusal says why; anything else is not shown raw. */
function failed(err: unknown): { ok: false; message: string } {
  if (err instanceof SupplyRefused) return { ok: false, message: err.message };
  console.error("supplying a document failed", err);
  return { ok: false, message: "Something went wrong reading that file. Nothing was kept. Try again." };
}

function done(companyId: string, pages: number): SupplyResult {
  revalidatePath(`/companies/${companyId}/documents`);
  return { ok: true, pages, message: `Read: ${pages} page${pages === 1 ? "" : "s"}. The next pass 2 reads it first.` };
}

/** A file small enough for one request: read here, its bytes never stored. */
export async function supplyDocument(form: FormData): Promise<SupplyResult> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the PDF first." };
  const input = inputFrom(form, file);
  try {
    const out = await supplyWhole(db, { id: user.id }, input, new Uint8Array(await file.arrayBuffer()), { extractPdf });
    return done(input.companyId, out.pageCount);
  } catch (err) {
    return failed(err);
  }
}

/** A larger file: open an upload for its pieces. The file itself is not sent here. */
export async function beginDocumentUpload(form: FormData): Promise<BeginResult> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const input = inputFrom(form, { name: String(form.get("filename") ?? ""), size: Number(form.get("sizeBytes")) });
  try {
    return { ok: true, ...await beginUpload(db, { id: user.id }, input) };
  } catch (err) {
    return failed(err);
  }
}

/** One piece, in order. */
export async function addDocumentPiece(form: FormData): Promise<Outcome> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const piece = form.get("piece");
  if (!(piece instanceof Blob)) return { ok: false, message: "A piece of the file did not arrive. Start again." };
  try {
    await addChunk(db, { id: user.id }, String(form.get("uploadId") ?? ""), Number(form.get("idx")),
      new Uint8Array(await piece.arrayBuffer()));
    return { ok: true };
  } catch (err) {
    return failed(err);
  }
}

/** The last piece is in: read the file. */
export async function finishDocumentUpload(form: FormData): Promise<SupplyResult> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const companyId = String(form.get("companyId") ?? "");
  try {
    const out = await finishUpload(db, { id: user.id }, String(form.get("uploadId") ?? ""), { extractPdf });
    return done(companyId, out.pageCount);
  } catch (err) {
    return failed(err);
  }
}

/** Research stops reading it; what it found and nobody has decided leaves review. */
export async function removeDocument(form: FormData): Promise<Outcome> {
  const { db, user } = await requireRole(["analyst", "admin"]);
  const id = String(form.get("suppliedId") ?? "");
  if (!isRowId(id)) return { ok: false, message: "That document is not supplied any more." };
  try {
    const out = await withdrawSupplied(db, { id: user.id }, id);
    revalidatePath(`/companies/${out.companyId}/documents`);
    return { ok: true, message: out.superseded > 0
      ? `Removed. ${out.superseded} finding${out.superseded === 1 ? "" : "s"} read from it and not yet decided left review.`
      : "Removed. Research will not read it again." };
  } catch (err) {
    return failed(err);
  }
}
