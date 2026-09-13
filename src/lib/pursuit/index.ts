/**
 * The pursuit workflow: what the practice decides to do about a company.
 *
 * Everything else in this application is a claim about the world with evidence
 * behind it. A pursuit is the opposite -- it is the practice's own judgement,
 * authored by a person, and nothing here is ever proposed, scored or gated.
 * That difference is why pursuit content is Deloitte internal (docs/design/11)
 * and why it must never reach a prompt (docs/design/06): it is not evidence,
 * and a model that read it would be reading the firm's own intentions back to
 * itself.
 *
 * WHO WRITES. Analyst and Admin, decided 13 September 2026. A partner is a
 * Viewer, and docs/design/11 revokes the Viewer from these tables by policy
 * rather than by interface -- so a partner reads the company profile and an
 * Analyst records the pursuit. Changing that means reopening the grant, not
 * adding a button.
 *
 * ONE OPEN PURSUIT PER COMPANY. The schema does not enforce it -- a company
 * pursued again next year is a second row -- but `start` returns the existing
 * one rather than creating a duplicate, because two live pursuits for one
 * company is a reporting bug, not a workflow.
 *
 * NOTHING IS EVER DELETED. A note is somebody's judgement at a moment; an
 * action that was abandoned is a fact about the pursuit. The interface offers
 * no delete, and neither does this module.
 */
import type { Sql } from "../db/sql.ts";
import { decisionStamp } from "../db/stamp.ts";
import { getList } from "../settings/index.ts";

/** Used only where the settings table has no answer. See migration 0020. */
export const FALLBACK_PRIORITIES = ["High", "Medium", "Low"] as const;
export const FALLBACK_STATUSES = ["Open", "Done*"] as const;
export const FALLBACK_OUTCOMES = ["Won", "Lost", "Dormant"] as const;

/**
 * A status, and whether reaching it CLOSES the action.
 *
 * "Closed" was position for a while -- the last status in the list -- which
 * meant exactly one status could end an action. Finished and abandoned then had
 * to share a word, so anything given up on was recorded as done, and a count of
 * completed work silently included the work nobody did. A star in the settings
 * value marks each status that closes: "Open, Done*, Superseded*".
 *
 * One field rather than two, because a separate list of closing statuses can
 * name a status the first list does not have, and then the two disagree with
 * nothing to say which is right.
 */
export type Status = { name: string; closed: boolean };
export type Vocabulary = { priorities: string[]; statuses: Status[]; outcomes: string[] };

export function parseStatuses(terms: readonly string[]): Status[] {
  const parsed = terms.map((t) => ({
    name: t.replace(/\*$/, "").trim(),
    closed: t.trim().endsWith("*"),
  })).filter((s) => s.name.length > 0);
  // A value written before the star existed closes on its last term, which is
  // what it meant then. Without this every action in the database becomes open
  // again the moment this ships.
  if (parsed.length > 0 && !parsed.some((s) => s.closed)) {
    parsed[parsed.length - 1].closed = true;
  }
  return parsed;
}

export async function vocabulary(db: Sql): Promise<Vocabulary> {
  return {
    priorities: await getList(db, "pursuit_priorities", FALLBACK_PRIORITIES),
    statuses: parseStatuses(await getList(db, "pursuit_action_statuses", FALLBACK_STATUSES)),
    outcomes: await getList(db, "pursuit_outcomes", FALLBACK_OUTCOMES),
  };
}

/** The status a new action starts in: the first, which never closes. */
export const firstStatus = (v: Vocabulary): string => v.statuses[0].name;
export const statusNames = (v: Vocabulary): string[] => v.statuses.map((s) => s.name);
export const closedStatuses = (v: Vocabulary): string[] =>
  v.statuses.filter((s) => s.closed).map((s) => s.name);

/**
 * How near a due date has to be to be worth saying anything about.
 *
 * A week, and a constant rather than a setting. Every knob added here is one
 * more thing to configure and one more thing nobody ever changes; the number
 * that matters is whether something is PAST due, and this is only the warning
 * before it.
 */
export const DUE_SOON_DAYS = 7;

export type DueState = "overdue" | "soon" | "later";

/**
 * A due date is a calendar DAY, not an instant.
 *
 * Compared in UTC, as every other stamp in this application is. A date is
 * overdue the day AFTER it: something due on the 30th is not late at nine in
 * the morning on the 30th, which is when somebody is most likely looking at it.
 */
export function dueState(
  dueDate: string | null, now: Date = new Date(), soonDays = DUE_SOON_DAYS,
): DueState | null {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return "overdue";
  return days <= soonDays ? "soon" : "later";
}

export class PursuitRefused extends Error {
  constructor(message: string) { super(message); this.name = "PursuitRefused"; }
}

export type PursuitRow = {
  id: string;
  companyId: string;
  companyName: string;
  priority: string | null;
  /** True when the priority is no longer in the vocabulary. Shown, never rewritten. */
  priorityRetired: boolean;
  ownerId: string | null;
  ownerEmail: string | null;
  createdAt: string;
  /** Open actions past their date. Zero once the pursuit itself is closed. */
  overdueActions: number;
  /** Open actions due within DUE_SOON_DAYS, not yet past. */
  dueSoonActions: number;
  /** Null while the pursuit is open. A closed one keeps everything it had. */
  outcome: string | null;
  /** True when the outcome is no longer in the vocabulary. Shown, never rewritten. */
  outcomeRetired: boolean;
  closedAt: string | null;
  closedByEmail: string | null;
  notes: number;
  openActions: number;
  totalActions: number;
  /** The most recent thing that happened, whatever kind it was. */
  lastActivityAt: string;
};

export type Note = {
  id: string; body: string; authorEmail: string | null; createdAt: string;
};

export type Action = {
  id: string; description: string; dueDate: string | null;
  status: string; statusRetired: boolean; closed: boolean;
  /** Null when there is no date, or when the action is already closed. */
  due: DueState | null;
  ownerEmail: string | null; ownerId: string | null; createdAt: string;
};

/**
 * Every pursuit, with enough of its contents to be ranked without opening it.
 *
 * Ordered by the vocabulary's own order and then by what happened most
 * recently -- not alphabetically, which would put "High" below "Low".
 */
export async function listPursuits(db: Sql, now: Date = new Date()): Promise<PursuitRow[]> {
  const v = await vocabulary(db);
  // A status the vocabulary no longer knows counts as OPEN. It is not known to
  // close anything, and the safe direction is that work stays visible rather
  // than vanishing from the list because a term was renamed.
  const closed = closedStatuses(v);
  const rows = await db.all(
    `select p.id, p.company_id, c.canonical_name as company_name, p.priority,
            p.owner_id, u.email as owner_email, p.created_at,
            k.outcome, k.closed_at, cb.email as closed_by_email,
            (select count(*) from pursuit_notes n where n.pursuit_id = p.id) as notes,
            (select count(*) from pursuit_actions a where a.pursuit_id = p.id) as total_actions,
            (select count(*) from pursuit_actions a
              where a.pursuit_id = p.id and a.status not in (SLOTS)) as open_actions,
            (select max(t) from (
               select p.created_at as t
               union all select n2.created_at from pursuit_notes n2 where n2.pursuit_id = p.id
               union all select a2.created_at from pursuit_actions a2 where a2.pursuit_id = p.id
             ) x) as last_activity_at
       from pursuits p
       join companies c on c.id = p.company_id
       left join app_users u on u.id = p.owner_id
       left join pursuit_closures k
              on k.pursuit_id = p.id and k.reopened_at is null
       left join app_users cb on cb.id = k.closed_by`
      .replace("SLOTS", closed.map(() => "?").join(", ")),
    ...closed) as Array<Record<string, unknown>>;

  // The open actions' dates, in their own statement. An aggregate would have
  // been one query fewer and `group_concat` is SQLite's alone -- Postgres
  // spells it `string_agg`, and SQL here has to run on both engines as written.
  const datesByPursuit = new Map<string, string[]>();
  for (const row of await db.all(
    `select a.pursuit_id, a.due_date from pursuit_actions a
      where a.due_date is not null and a.status not in (SLOTS)`
      .replace("SLOTS", closed.map(() => "?").join(", ")),
    ...closed) as Array<{ pursuit_id: string; due_date: string }>) {
    const key = String(row.pursuit_id);
    datesByPursuit.set(key, [...(datesByPursuit.get(key) ?? []), String(row.due_date).slice(0, 10)]);
  }

  const rank = new Map(v.priorities.map((p, i) => [p, i]));
  return rows.map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    companyName: String(r.company_name),
    priority: r.priority === null || r.priority === undefined ? null : String(r.priority),
    priorityRetired: r.priority !== null && r.priority !== undefined &&
                     !rank.has(String(r.priority)),
    ownerId: r.owner_id ? String(r.owner_id) : null,
    ownerEmail: r.owner_email ? String(r.owner_email) : null,
    createdAt: String(r.created_at),
    ...dueCounts(datesByPursuit.get(String(r.id)) ?? [], r.closed_at, now),
    outcome: r.outcome === null || r.outcome === undefined ? null : String(r.outcome),
    outcomeRetired: r.outcome !== null && r.outcome !== undefined &&
                    !new Set(v.outcomes).has(String(r.outcome)),
    closedAt: r.closed_at ? String(r.closed_at) : null,
    closedByEmail: r.closed_by_email ? String(r.closed_by_email) : null,
    notes: Number(r.notes),
    openActions: Number(r.open_actions),
    totalActions: Number(r.total_actions),
    lastActivityAt: String(r.last_activity_at ?? r.created_at),
  })).sort((a, b) =>
    // An unprioritised pursuit sorts last, not first: it is the one nobody has
    // judged yet, and it must not sit above the ones somebody called urgent.
    (rank.get(a.priority ?? "") ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b.priority ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * Overdue and due-soon, from the open actions' dates.
 *
 * A CLOSED pursuit has neither. Closing with work outstanding is allowed on
 * purpose -- a pursuit is often lost with actions still open -- and those
 * actions would otherwise be reported as overdue for ever, chasing nobody.
 */
function dueCounts(
  dates: readonly string[], closedAt: unknown, now: Date,
): { overdueActions: number; dueSoonActions: number } {
  if (closedAt) return { overdueActions: 0, dueSoonActions: 0 };
  let overdueActions = 0;
  let dueSoonActions = 0;
  for (const d of dates) {
    const state = dueState(d, now);
    if (state === "overdue") overdueActions++;
    else if (state === "soon") dueSoonActions++;
  }
  return { overdueActions, dueSoonActions };
}

export async function getPursuit(
  db: Sql, id: string, now: Date = new Date(),
): Promise<{ pursuit: PursuitRow; notes: Note[]; actions: Action[] } | null> {
  const all = await listPursuits(db, now);
  const pursuit = all.find((p) => p.id === id);
  if (!pursuit) return null;
  const v = await vocabulary(db);
  const known = new Set(statusNames(v));
  const closedNames = new Set(closedStatuses(v));

  const notes = (await db.all(
    `select n.id, n.body, n.created_at, u.email as author_email
       from pursuit_notes n left join app_users u on u.id = n.author_id
      where n.pursuit_id = ? order by n.created_at desc, n.id desc`, id) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id), body: String(r.body ?? ""),
      authorEmail: r.author_email ? String(r.author_email) : null,
      createdAt: String(r.created_at),
    }));

  const actions = (await db.all(
    `select a.id, a.description, a.due_date, a.status, a.owner_id, a.created_at,
            u.email as owner_email
       from pursuit_actions a left join app_users u on u.id = a.owner_id
      where a.pursuit_id = ? order by a.created_at asc, a.id asc`, id) as Array<Record<string, unknown>>)
    .map((r) => {
      const dueDate = r.due_date ? String(r.due_date).slice(0, 10) : null;
      const closed = closedNames.has(String(r.status ?? ""));
      return {
        id: String(r.id), description: String(r.description ?? ""),
        dueDate,
        status: String(r.status ?? ""),
        statusRetired: Boolean(r.status) && !known.has(String(r.status)),
        closed,
        // A closed action's date is history, not a deadline.
        due: closed || pursuit.closedAt !== null ? null : dueState(dueDate, now),
        ownerId: r.owner_id ? String(r.owner_id) : null,
        ownerEmail: r.owner_email ? String(r.owner_email) : null,
        createdAt: String(r.created_at),
      };
    });

  return { pursuit, notes, actions };
}

/** The company's pursuit, made if it does not exist. Never a second one. */
export async function startPursuit(
  db: Sql, companyId: string, actorId: string | null,
): Promise<string> {
  const company = await db.get("select id from companies where id = ?", companyId) as
    { id: string } | undefined;
  if (!company) throw new PursuitRefused("There is no such company.");

  const existing = await db.get(
    "select id from pursuits where company_id = ? order by created_at limit 1", companyId) as
    { id: string } | undefined;
  if (existing) return String(existing.id);

  const row = await db.get(
    `insert into pursuits (company_id, owner_id, created_at) values (?, ?, ?) returning id`,
    companyId, actorId, decisionStamp()) as { id: string };
  await db.run(
    `insert into audit_log (event, actor_id, detail) values ('pursuit_started', ?, ?)`,
    actorId, JSON.stringify({ pursuitId: row.id, companyId }));
  return String(row.id);
}

export async function setPriority(
  db: Sql, pursuitId: string, priority: string, actorId: string | null,
): Promise<void> {
  const v = await vocabulary(db);
  // A priority off the list is refused rather than stored: the list is the
  // whole point of having one, and a typo would become a permanent bucket.
  if (!v.priorities.includes(priority)) {
    throw new PursuitRefused(
      `"${priority}" is not one of the priorities in use (${v.priorities.join(", ")}).`);
  }
  const r = await db.run("update pursuits set priority = ? where id = ?", priority, pursuitId);
  if (r.changes !== 1) throw new PursuitRefused("There is no such pursuit.");
  await db.run(`insert into audit_log (event, actor_id, detail) values ('pursuit_prioritised', ?, ?)`,
               actorId, JSON.stringify({ pursuitId, priority }));
}

/** An owner who cannot sign in is not an owner; /access deactivates people. */
async function assertAssignable(db: Sql, ownerId: string | null): Promise<void> {
  if (ownerId === null) return;
  const who = await db.get("select id from app_users where id = ? and is_active", ownerId) as
    { id: string } | undefined;
  if (!who) throw new PursuitRefused("That person is not an active user of this application.");
}

export async function setOwner(
  db: Sql, pursuitId: string, ownerId: string | null, actorId: string | null,
): Promise<void> {
  await assertAssignable(db, ownerId);
  const r = await db.run("update pursuits set owner_id = ? where id = ?", ownerId, pursuitId);
  if (r.changes !== 1) throw new PursuitRefused("There is no such pursuit.");
  await db.run(`insert into audit_log (event, actor_id, detail) values ('pursuit_owner_set', ?, ?)`,
               actorId, JSON.stringify({ pursuitId, ownerId }));
}

/**
 * Who is doing one action, as distinct from who owns the pursuit.
 *
 * An action could be given an owner when it was made and never afterwards,
 * which meant the only way to hand one over was to make a second action and
 * close the first -- a workaround that would have read, permanently, as though
 * the work had been abandoned.
 */
export async function setActionOwner(
  db: Sql, actionId: string, ownerId: string | null, actorId: string | null,
): Promise<void> {
  await assertAssignable(db, ownerId);
  await patchAction(db, actionId, "owner_id", ownerId, "pursuit_action_assigned",
                    { ownerId }, actorId);
}

export async function addNote(
  db: Sql, pursuitId: string, body: string, actorId: string | null,
): Promise<string> {
  const text = body.trim();
  if (!text) throw new PursuitRefused("A note needs something in it.");
  if (text.length > 4000) throw new PursuitRefused("A note longer than 4,000 characters belongs in a document.");
  await assertPursuit(db, pursuitId);
  const row = await db.get(
    `insert into pursuit_notes (pursuit_id, body, author_id, created_at)
     values (?, ?, ?, ?) returning id`, pursuitId, text, actorId, decisionStamp()) as { id: string };
  return String(row.id);
}

export async function addAction(
  db: Sql, pursuitId: string,
  input: { description: string; dueDate?: string | null; ownerId?: string | null },
  actorId: string | null,
): Promise<string> {
  const description = input.description.trim();
  if (!description) throw new PursuitRefused("An action needs a description.");
  if (description.length > 500) throw new PursuitRefused("An action longer than 500 characters is a note, not an action.");
  const dueDate = parseDueDate(input.dueDate);
  await assertPursuit(db, pursuitId);
  const v = await vocabulary(db);
  const row = await db.get(
    `insert into pursuit_actions (pursuit_id, description, due_date, owner_id, status, created_at)
     values (?, ?, ?, ?, ?, ?) returning id`,
    pursuitId, description, dueDate, input.ownerId ?? null, firstStatus(v), decisionStamp()) as { id: string };
  return String(row.id);
}

/**
 * Write one column on one action, and record that it was written.
 *
 * The three things an action carries after it is made -- its status, its owner,
 * its due date -- differ only in what is checked first and what the audit line
 * is called. Written out three times they drift; the fourth one to be asked for
 * should cost a validation and a name.
 *
 * The column is a literal from the caller in this module, never a value from a
 * request.
 */
async function patchAction(
  db: Sql, actionId: string, column: "status" | "owner_id" | "due_date",
  value: string | null, event: string, detail: Record<string, unknown>,
  actorId: string | null,
): Promise<void> {
  const r = await db.run(
    `update pursuit_actions set ${column} = ? where id = ?`, value, actionId);
  if (r.changes !== 1) throw new PursuitRefused("There is no such action.");
  await db.run(`insert into audit_log (event, actor_id, detail) values (?, ?, ?)`,
               event, actorId, JSON.stringify({ actionId, ...detail }));
}

export async function setActionStatus(
  db: Sql, actionId: string, status: string, actorId: string | null,
): Promise<void> {
  const v = await vocabulary(db);
  if (!statusNames(v).includes(status)) {
    throw new PursuitRefused(
      `"${status}" is not one of the statuses in use (${statusNames(v).join(", ")}).`);
  }
  await patchAction(db, actionId, "status", status, "pursuit_action_moved", { status }, actorId);
}

/** A due date is YYYY-MM-DD, or none at all: a date nobody chose is not a date. */
export function parseDueDate(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PursuitRefused("A due date is YYYY-MM-DD, or empty.");
  }
  // Rejects 2026-02-31 and 2026-13-01, which the shape above accepts.
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new PursuitRefused(`There is no such date as ${value}.`);
  }
  return value;
}

export async function setActionDueDate(
  db: Sql, actionId: string, dueDate: string | null, actorId: string | null,
): Promise<void> {
  const value = parseDueDate(dueDate);
  await patchAction(db, actionId, "due_date", value, "pursuit_action_dated",
                    { dueDate: value }, actorId);
}

/** The closure that is still standing, if the pursuit is closed right now. */
async function openClosure(
  db: Sql, pursuitId: string,
): Promise<{ id: string; outcome: string } | null> {
  const row = await db.get(
    `select id, outcome from pursuit_closures
      where pursuit_id = ? and reopened_at is null
      order by closed_at desc limit 1`, pursuitId) as
    { id: string; outcome: string } | undefined;
  return row ? { id: String(row.id), outcome: String(row.outcome) } : null;
}

async function assertPursuit(db: Sql, pursuitId: string): Promise<void> {
  const row = await db.get("select id from pursuits where id = ?", pursuitId) as
    { id: string } | undefined;
  if (!row) throw new PursuitRefused("There is no such pursuit.");
}

/**
 * Terms a vocabulary no longer knows, that rows are still carrying.
 *
 * Renaming a term deliberately does not rewrite anybody's record, so every row
 * in the old one is stranded. For a STATUS that also means the action counts as
 * open again, because nothing now says it closes; for a PRIORITY it means the
 * pursuit sorts last, among the ones nobody has judged. With one row that is a
 * click. The first real rename with fifty behind it would be an afternoon, and
 * the temptation would be to rewrite them in the database, which loses the fact
 * that they were moved at all.
 *
 * The two are one mechanism because they are one problem. Only the table, the
 * column and the noun differ.
 */
export type StrandedKind = "status" | "priority" | "outcome";

export type Stranded = {
  kind: StrandedKind;
  value: string;
  /** Actions for a status; pursuits for a priority. */
  count: number;
};

const TERMS = {
  status: { table: "pursuit_actions", column: "status", noun: "action" },
  priority: { table: "pursuits", column: "priority", noun: "pursuit" },
  outcome: { table: "pursuit_closures", column: "outcome", noun: "closed pursuit" },
} as const satisfies Record<StrandedKind, { table: string; column: string; noun: string }>;

/** The noun to count in, for a screen that has to say what is stranded. */
export const strandedNoun = (kind: StrandedKind): string => TERMS[kind].noun;

export async function strandedTerms(db: Sql): Promise<Stranded[]> {
  const v = await vocabulary(db);
  const known: Record<StrandedKind, Set<string>> = {
    status: new Set(statusNames(v)),
    priority: new Set(v.priorities),
    outcome: new Set(v.outcomes),
  };
  const out: Stranded[] = [];
  for (const kind of ["status", "priority", "outcome"] as const) {
    const t = TERMS[kind];
    // Table and column are literals from TERMS, never a caller's string.
    const rows = await db.all(
      `select ${t.column} as value, count(*) as n from ${t.table}
        where ${t.column} is not null group by ${t.column} order by ${t.column}`) as
      Array<{ value: string; n: number }>;
    for (const r of rows) {
      if (!known[kind].has(String(r.value))) {
        out.push({ kind, value: String(r.value), count: Number(r.n) });
      }
    }
  }
  return out;
}

/**
 * Move every row carrying one term to another, and say how many moved.
 *
 * The destination must be a term the vocabulary knows -- the point is to land
 * somewhere meaningful, and a sweep into another unknown term would strand them
 * all over again. The source is deliberately NOT checked against the
 * vocabulary: moving out of a term no longer in it is the entire use.
 */
export async function sweepTerm(
  db: Sql, kind: StrandedKind, from: string, to: string, actorId: string | null,
): Promise<number> {
  if (!from.trim()) throw new PursuitRefused(`Name the ${kind} to move out of.`);
  if (from === to) throw new PursuitRefused(`That is the ${kind} they already carry.`);
  const v = await vocabulary(db);
  const allowed = kind === "status" ? statusNames(v)
    : kind === "priority" ? v.priorities : v.outcomes;
  const plural = kind === "status" ? "statuses" : kind === "priority" ? "priorities" : "outcomes";
  if (!allowed.includes(to)) {
    throw new PursuitRefused(`"${to}" is not one of the ${plural} in use (${allowed.join(", ")}).`);
  }
  const t = TERMS[kind];
  const r = await db.run(
    `update ${t.table} set ${t.column} = ? where ${t.column} = ?`, to, from);
  if (r.changes === 0) throw new PursuitRefused(`No ${t.noun} carries "${from}".`);
  // One line for the sweep, with its count: a bulk change nobody can see
  // afterwards is the reason bulk changes are frightening.
  await db.run(`insert into audit_log (event, actor_id, detail) values ('pursuit_terms_swept', ?, ?)`,
               actorId, JSON.stringify({ kind, from, to, count: r.changes }));
  return r.changes;
}

/**
 * End a pursuit, with what happened.
 *
 * The outcome is the point. "This is over" is not worth writing down; "we won
 * it" and "they renewed with their incumbent" are different facts, and a list
 * of closed pursuits that does not say which is a list nobody reads twice.
 *
 * Open actions are NOT a reason to refuse. A pursuit is often lost with work
 * outstanding, and making somebody tidy up before recording the loss is how
 * the loss goes unrecorded.
 */
export async function closePursuit(
  db: Sql, pursuitId: string, outcome: string, actorId: string | null,
): Promise<void> {
  const v = await vocabulary(db);
  if (!v.outcomes.includes(outcome)) {
    throw new PursuitRefused(
      `"${outcome}" is not one of the outcomes in use (${v.outcomes.join(", ")}).`);
  }
  await assertPursuit(db, pursuitId);
  if (await openClosure(db, pursuitId)) {
    throw new PursuitRefused("That pursuit is already closed. Reopen it first.");
  }
  await db.run(`insert into pursuit_closures (pursuit_id, outcome, closed_at, closed_by)
                values (?, ?, ?, ?)`, pursuitId, outcome, decisionStamp(), actorId);
  await db.run(`insert into audit_log (event, actor_id, detail) values ('pursuit_closed', ?, ?)`,
               actorId, JSON.stringify({ pursuitId, outcome }));
}

/**
 * Reopen one, keeping the outcome it was closed under on the record.
 *
 * Its own event rather than a silent edit: a pursuit that was called lost and
 * then came back is a thing worth being able to find afterwards.
 */
export async function reopenPursuit(
  db: Sql, pursuitId: string, actorId: string | null,
): Promise<void> {
  await assertPursuit(db, pursuitId);
  const open = await openClosure(db, pursuitId);
  if (!open) throw new PursuitRefused("That pursuit is already open.");

  // The closure row stays and is stamped, rather than being deleted: closing,
  // reopening and closing again is a history, and only a row can hold it.
  await db.run(`update pursuit_closures set reopened_at = ?, reopened_by = ? where id = ?`,
               decisionStamp(), actorId, open.id);
  await db.run(`insert into audit_log (event, actor_id, detail) values ('pursuit_reopened', ?, ?)`,
               actorId, JSON.stringify({ pursuitId, wasClosedAs: open.outcome }));
}

/* ------------------------------------------------- narrowing a long list */

/**
 * What a person can ask the list for, and it all lives in the URL.
 *
 * The review grid keeps its find text there "so a view can be handed to a
 * colleague", and a pursuit list is more worth handing over than a grid: "the
 * eleven you own that are past their date" is a message, not a screenshot.
 *
 * Narrowing happens over rows already read rather than in SQL. The population
 * is pursuits, not companies -- tens, not thousands -- and one statement that
 * answers every combination of four filters is a statement nobody can read.
 */
export type PursuitFilter = {
  /** Matched against the company's name, case-insensitively. */
  q?: string;
  /** A user id, or "unassigned". Empty means anyone. */
  owner?: string;
  priority?: string;
  due?: "overdue" | "soon";
};

export const UNASSIGNED = "unassigned";

export function filterPursuits(
  rows: readonly PursuitRow[], f: PursuitFilter,
): PursuitRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.companyName.toLowerCase().includes(q)) return false;
    if (f.owner === UNASSIGNED) { if (r.ownerId !== null) return false; }
    else if (f.owner) { if (r.ownerId !== f.owner) return false; }
    if (f.priority && r.priority !== f.priority) return false;
    if (f.due === "overdue" && r.overdueActions === 0) return false;
    // "Due soon" means what needs attention this week, so it includes what is
    // already past: a list of things due soon that omits the late ones is the
    // opposite of useful.
    if (f.due === "soon" && r.overdueActions === 0 && r.dueSoonActions === 0) return false;
    return true;
  });
}

export type PursuitSort = "priority" | "company" | "activity" | "due";

export const SORTS: Record<PursuitSort, string> = {
  priority: "Priority, then most recent",
  company: "Company name",
  activity: "Most recently touched",
  due: "Most overdue first",
};

/**
 * `priority` is the order listPursuits already returns, so it is left alone
 * rather than re-deriving the vocabulary's rank in a second place.
 */
export function sortPursuits(rows: readonly PursuitRow[], sort: PursuitSort): PursuitRow[] {
  const out = [...rows];
  switch (sort) {
    case "priority": return out;
    case "company": return out.sort((a, b) => a.companyName.localeCompare(b.companyName));
    case "activity": return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    case "due": return out.sort((a, b) =>
      b.overdueActions - a.overdueActions ||
      b.dueSoonActions - a.dueSoonActions ||
      a.companyName.localeCompare(b.companyName));
  }
}

/** A sort from a URL, or the default. Never throws on a bad one. */
export function parseSort(raw: string | null | undefined): PursuitSort {
  return raw === "company" || raw === "activity" || raw === "due" ? raw : "priority";
}
