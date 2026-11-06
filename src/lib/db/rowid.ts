/**
 * A row id as either engine writes one: Postgres's uuid, SQLite's 32 hex
 * digits. Postgres refuses anything else compared with a uuid column, with an
 * error rather than no row, so an id that came from outside is checked first.
 */
export function isRowId(id: unknown): id is string {
  return typeof id === "string" && /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(id);
}

/** A unique index refused the write: Postgres's 23505, SQLite's UNIQUE constraint. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return Boolean(e) && (e!.code === "23505" || /UNIQUE constraint failed/i.test(String(e!.message ?? "")));
}
