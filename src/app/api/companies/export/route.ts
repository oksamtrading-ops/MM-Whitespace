/**
 * GET /api/companies/export -- the companies table, as filtered on screen.
 *
 * The filter is the same URL parameters the table reads (?tier=2&hq=CA:ON...),
 * parsed by the same module, so the file holds exactly the rows the screen
 * did. format=csv for a flat table; anything else is a workbook.
 *
 * EVERY ROLE, unlike /api/export. That one carries the working period; this
 * one carries the published snapshot -- the draft only for a role allowed to
 * see a draft -- which a Viewer can already read row by row. Each download is
 * still recorded: a licensed extract leaving the application is the event the
 * audit log exists for, whoever takes it.
 */
import { NextResponse } from "next/server";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { ExportFailed } from "../../../../lib/export/period.ts";
import { exportTable } from "../../../../lib/export/table.ts";
import { toRosterParams } from "../../../../lib/profile/roster.ts";
import { formatStamp } from "../../../../lib/db/stamp.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const ctx = await requireRole(["viewer", "analyst", "admin"]).catch((err: unknown) => err as Error);
  if (ctx instanceof Error) {
    return ctx instanceof Forbidden
      ? NextResponse.json({ error: "Your account may not export the companies table." }, { status: 403 })
      : NextResponse.json({ error: (ctx as Unauthenticated).message }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" as const : "xlsx" as const;
  const allowDraft = ctx.user.role !== "viewer";

  try {
    const file = await exportTable(ctx.db, { allowDraft, params: url.searchParams, format });
    await ctx.db.run(
      `insert into audit_log (event, actor_id, period_id, detail) values ('companies_exported', ?, ?, ?)`,
      ctx.user.id, file.periodId,
      JSON.stringify({
        format, filename: file.filename, bytes: file.bytes.byteLength,
        params: toRosterParams(file.filter).toString(), filter: file.filterWords,
        rows: file.rows, total: file.total,
        basis: file.revision === null ? "draft" : `revision ${file.revision}`, at: formatStamp(),
      }));
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename}"`,
        "content-length": String(file.bytes.byteLength),
        "cache-control": "no-store, private",
      },
    });
  } catch (err) {
    const failed = err instanceof ExportFailed;
    return NextResponse.json(
      { error: failed ? err.message : "The companies table could not be exported.",
        detail: failed ? err.detail : undefined },
      { status: failed ? 422 : 500 });
  }
}
