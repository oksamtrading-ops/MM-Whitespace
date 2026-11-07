/**
 * Saved reports: a companies table, filtered, kept under a name.
 *
 * A REPORT IS A VIEW, NOT A COPY. It stores the table's URL parameters -- the
 * filters, the sort, the hidden columns -- and nothing else, so opening one
 * reads whatever the companies table reads today: the newest published
 * revision. It never holds company data of its own, so it can never carry a
 * value somebody could not otherwise read, and never goes stale.
 *
 * Who may do what (Samuel, 7 November 2026):
 *   - anyone who can sign in, Viewers included, may save one;
 *   - private: its owner sees it, and nobody else does, Admins included;
 *   - public: everyone who can sign in sees it;
 *   - its owner may rename it, change who sees it, update its filters and
 *     delete it; so may an Admin, for any report they can see.
 * Nothing is emailed from the tool: a report is downloaded, and sent on from
 * there by whoever downloaded it.
 *
 * Every write is in the audit log. The permission is checked here, not only by
 * which buttons a page draws, because every server action is an endpoint.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import type { Role } from "../auth/session.ts";
import { personSql } from "../auth/person.ts";
import { formatStamp } from "../db/stamp.ts";
import { parseRosterParams, toRosterParams } from "../profile/roster.ts";

export type Visibility = "private" | "public";
export const VISIBILITIES: readonly Visibility[] = ["private", "public"];

export type Report = {
  id: string;
  name: string;
  visibility: Visibility;
  /** The companies table's query string, canonical: what toRosterParams writes. */
  params: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
};

export type Actor = { id: string; role: Role };

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const REPORT_NAME_MAX = 80;
/** A query string is typed by nobody: past this it is not a filter anyone built. */
export const REPORT_PARAMS_MAX = 4000;

const NOT_FOUND = "No such report, or it is private to the person who saved it.";

export function canSee(r: Pick<Report, "ownerId" | "visibility">, u: Actor): boolean {
  return r.ownerId === u.id || r.visibility === "public";
}

export function canEdit(r: Pick<Report, "ownerId" | "visibility">, u: Actor): boolean {
  return canSee(r, u) && (r.ownerId === u.id || u.role === "admin");
}

export function checkReportName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, message: "Give the report a name." };
  if (name.length > REPORT_NAME_MAX) return { ok: false, message: `Keep the name to ${REPORT_NAME_MAX} characters.` };
  // Control characters have no business in a name that becomes a filename,
  // and direction overrides would let a public name read as something else.
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)) {
    return { ok: false, message: "The name has a character it cannot hold." };
  }
  return { ok: true, name };
}

export function checkVisibility(raw: unknown): Visibility | null {
  return VISIBILITIES.includes(raw as Visibility) ? raw as Visibility : null;
}

/**
 * A query string as the table would write it: parsed through the roster's own
 * vocabulary and written back, so a report holds only what the table reads,
 * in one spelling, and two saves of one view compare equal.
 */
export function canonicalParams(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > REPORT_PARAMS_MAX) return null;
  return toRosterParams(parseRosterParams(new URLSearchParams(raw.replace(/^\?/, "")))).toString();
}

/** A report id is a UUID; anything else is refused before it reaches a query. */
export function isReportId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

type RawReport = {
  id: string; name: string; visibility: string; params: string; owner_id: string; owner_name: string;
  created_at: string; updated_at: string;
};

const SELECT = `select r.id, r.name, r.visibility, r.params, r.owner_id, ${personSql("u")} as owner_name,
                       r.created_at, r.updated_at
                  from saved_reports r join app_users u on u.id = r.owner_id`;

function toReport(r: RawReport): Report {
  return {
    id: String(r.id), name: r.name, visibility: r.visibility === "public" ? "public" : "private",
    params: r.params, ownerId: String(r.owner_id), ownerName: r.owner_name,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

/** Every report this person may open: their own, and everybody's public ones. Theirs first, then by name. */
export async function listReports(db: Sql, u: Actor): Promise<Report[]> {
  const rows = await db.all(`${SELECT} where r.owner_id = ? or r.visibility = 'public'`, u.id) as RawReport[];
  return rows.map(toReport).sort((a, b) =>
    Number(b.ownerId === u.id) - Number(a.ownerId === u.id) || a.name.localeCompare(b.name, "en-CA"));
}

/** One report, or null when it does not exist or this person may not see it -- the same answer either way. */
export async function getReport(db: Sql, u: Actor, id: unknown): Promise<Report | null> {
  if (!isReportId(id)) return null;
  const row = await db.get(`${SELECT} where r.id = ?`, id.toLowerCase()) as RawReport | undefined;
  if (!row) return null;
  const r = toReport(row);
  return canSee(r, u) ? r : null;
}

async function audit(db: Sql, event: string, u: Actor, detail: Record<string, unknown>) {
  await db.run("insert into audit_log (event, actor_id, detail) values (?, ?, ?)", event, u.id, JSON.stringify(detail));
}

export async function createReport(db: Sql, u: Actor, raw: { name: unknown; visibility: unknown; params: unknown } | null):
  Promise<Result<{ id: string }>> {
  const input = raw ?? { name: undefined, visibility: undefined, params: undefined };
  const name = checkReportName(input.name);
  if (!name.ok) return name;
  const visibility = checkVisibility(input.visibility);
  if (!visibility) return { ok: false, message: "Choose who can see the report." };
  const params = canonicalParams(input.params ?? "");
  if (params === null) return { ok: false, message: "That view cannot be saved: its filter is too long." };
  const id = randomUUID();
  const at = formatStamp();
  await db.tx(async (db) => {
    await db.run(`insert into saved_reports (id, name, visibility, params, owner_id, updated_by, created_at, updated_at)
                  values (?, ?, ?, ?, ?, ?, ?, ?)`, id, name.name, visibility, params, u.id, u.id, at, at);
    await audit(db, "report_created", u, { report: id, name: name.name, visibility, params });
  });
  return { ok: true, id };
}

/**
 * Rename it, change who sees it, or replace its filters -- any of the three.
 * Refused unless this person owns it, or is an Admin and can see it.
 */
export async function updateReport(db: Sql, u: Actor, id: unknown,
  raw: { name?: unknown; visibility?: unknown; params?: unknown } | null): Promise<Result> {
  const patch = raw && typeof raw === "object" ? raw : {};
  const r = await getReport(db, u, id);
  if (!r) return { ok: false, message: NOT_FOUND };
  if (!canEdit(r, u)) return { ok: false, message: "Only the person who saved this report, or an Admin, can change it." };
  const next = { name: r.name, visibility: r.visibility, params: r.params };
  if (patch.name !== undefined) {
    const name = checkReportName(patch.name);
    if (!name.ok) return name;
    next.name = name.name;
  }
  if (patch.visibility !== undefined) {
    const v = checkVisibility(patch.visibility);
    if (!v) return { ok: false, message: "Choose who can see the report." };
    next.visibility = v;
  }
  if (patch.params !== undefined) {
    const p = canonicalParams(patch.params);
    if (p === null) return { ok: false, message: "That view cannot be saved: its filter is too long." };
    next.params = p;
  }
  const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== r[k]);
  if (changed.length === 0) return { ok: true };
  // Only the columns this change is about, and only while the permission read
  // above still holds: an Admin's rename landing just after the owner made it
  // private must not make it public again.
  const done = await db.tx(async (db) => {
    const sets = changed.map((k) => `${k} = ?`).join(", ");
    const { changes } = await db.run(
      `update saved_reports set ${sets}, updated_by = ?, updated_at = ?
        where id = ? and (owner_id = ? or (visibility = 'public' and ? = 'admin'))`,
      ...changed.map((k) => next[k]), u.id, formatStamp(), r.id, u.id, u.role);
    if (changes === 0) return false;
    await audit(db, "report_updated", u, {
      report: r.id, owner: r.ownerId, changed,
      from: Object.fromEntries(changed.map((k) => [k, r[k]])),
      to: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
    return true;
  });
  return done ? { ok: true } : { ok: false, message: NOT_FOUND };
}

export async function deleteReport(db: Sql, u: Actor, id: unknown): Promise<Result> {
  const r = await getReport(db, u, id);
  if (!r) return { ok: false, message: NOT_FOUND };
  if (!canEdit(r, u)) return { ok: false, message: "Only the person who saved this report, or an Admin, can delete it." };
  const done = await db.tx(async (db) => {
    const { changes } = await db.run(
      "delete from saved_reports where id = ? and (owner_id = ? or (visibility = 'public' and ? = 'admin'))",
      r.id, u.id, u.role);
    if (changes === 0) return false;
    await audit(db, "report_deleted", u, { report: r.id, owner: r.ownerId, name: r.name, visibility: r.visibility, params: r.params });
    return true;
  });
  return done ? { ok: true } : { ok: false, message: NOT_FOUND };
}
