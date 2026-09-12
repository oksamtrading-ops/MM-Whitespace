/**
 * GET /api/export -- the period as a workbook, downloaded.
 *
 * Journey four: the deliverable is a clean template, not the uploaded file
 * (docs/design/10). The bytes are built by the same Python the command line
 * uses; this route is the boundary -- who may ask, which period, and the
 * audit line recording that a licensed extract left the application.
 *
 * ANALYST AND ADMIN ONLY. The export carries the working period, which
 * includes values nobody has published yet, so a Viewer must not have it
 * (src/lib/export/period.ts explains why the working period and not the
 * frozen revision).
 */
import { NextResponse } from "next/server";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { ExportFailed, exportWorkbook } from "../../../lib/export/period.ts";

export const dynamic = "force-dynamic";
/** 259 companies of openpyxl, over one HTTP hop. */
export const maxDuration = 120;

export async function GET(request: Request) {
  // The guard is the first statement, and scripts/check_role_assertions.mjs
  // fails the build if it ever stops being: a refusal is a response here, not
  // an exception page.
  const ctx = await requireRole(["analyst", "admin"]).catch((err: unknown) => err as Error);
  if (ctx instanceof Error) {
    return ctx instanceof Forbidden
      ? NextResponse.json({ error: "Your account may not export this period." }, { status: 403 })
      : NextResponse.json({ error: (ctx as Unauthenticated).message }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" as const : "xlsx" as const;
  const periodId = url.searchParams.get("period") ?? undefined;

  try {
    const file = await exportWorkbook(ctx.db, { periodId, format });
    await ctx.db.run(
      `insert into audit_log (event, actor_id, detail) values ('export_downloaded', ?, ?)`,
      ctx.user.id, JSON.stringify({ format, filename: file.filename, bytes: file.bytes.byteLength }));
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        // The filename is built from the period label, not from anything a
        // person typed, and is quoted so a comma cannot end the header early.
        "content-disposition": `attachment; filename="${file.filename}"`,
        "content-length": String(file.bytes.byteLength),
        // A licensed extract is never cached by a proxy on the way out.
        "cache-control": "no-store, private",
      },
    });
  } catch (err) {
    const failed = err instanceof ExportFailed;
    return NextResponse.json(
      { error: failed ? err.message : "That period could not be exported.",
        detail: failed ? err.detail : undefined },
      { status: failed ? 422 : 500 });
  }
}
