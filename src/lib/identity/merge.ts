/**
 * Two rows, one company.
 *
 * The workbook carries no rename history, so a company that changes its name
 * between periods arrives as a second row and its history stops. Merging is
 * how that is repaired, and it is a REDIRECT RATHER THAN A DELETION: the row
 * merged away keeps its id, gains `merged_into_id`, and every frozen snapshot
 * that ever pointed at it still resolves. A published revision is not edited
 * by anything, this included.
 */
import type { DatabaseSync } from "node:sqlite";

export class MergeRefused extends Error {}

export type Candidate = {
  aId: string; aName: string;
  bId: string; bName: string;
  reason: "shared_identifier" | "alias_collision" | "same_name_stem";
  detail: string;
  /** Strongest first: an identifier is evidence, a similar name is a hunch. */
  strength: 1 | 2 | 3;
};

const REASON_COPY: Record<Candidate["reason"], string> = {
  shared_identifier: "They carry the same identifier",
  alias_collision: "One is already recorded as the other's former name",
  same_name_stem: "The names match once the corporate suffix is removed",
};

export function reasonLabel(reason: Candidate["reason"]): string {
  return REASON_COPY[reason];
}

/** "Northco Mining Corporation" and "Northco Mining Corp." share a stem. */
export function nameStem(normalized: string): string {
  return normalized
    .replace(/\b(incorporated|corporation|corp|inc|limited|ltd|plc|company|co|holdings|group|resources|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pairs worth a person's attention, strongest evidence first.
 *
 * Nothing here merges anything. Every one of these is a proposal: two rows
 * that look like one company, with the reason stated so it can be disagreed
 * with.
 */
export function findDuplicateCandidates(db: DatabaseSync, limit = 50): Candidate[] {
  const found = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const key = [c.aId, c.bId].sort().join(":");
    const existing = found.get(key);
    if (!existing || c.strength < existing.strength) found.set(key, c);
  };

  // 1. The same identifier on two companies. The auditor tab's entity id is
  //    the only stable non-ticker identifier in the corpus.
  const shared = db.prepare(
    `select i.scheme, i.value,
            a.id as aId, a.canonical_name as aName,
            b.id as bId, b.canonical_name as bName
       from company_identifiers i
       join company_identifiers j
         on j.scheme = i.scheme and j.value = i.value and j.company_id > i.company_id
       join companies a on a.id = i.company_id and a.status = 'active'
       join companies b on b.id = j.company_id and b.status = 'active'
      group by a.id, b.id, i.scheme, i.value`,
  ).all() as Array<{ scheme: string; value: string; aId: string; aName: string; bId: string; bName: string }>;
  for (const r of shared) {
    add({ aId: r.aId, aName: r.aName, bId: r.bId, bName: r.bName,
          reason: "shared_identifier", strength: 1,
          detail: `${r.scheme.replace(/_/g, " ")} ${r.value}` });
  }

  // 2. A name already recorded as somebody's former name.
  const aliased = db.prepare(
    `select al.company_id as aId, a.canonical_name as aName,
            c.id as bId, c.canonical_name as bName, al.name as alias
       from company_aliases al
       join companies c on c.name_normalized = al.name_normalized and c.id != al.company_id
       join companies a on a.id = al.company_id
      where a.status = 'active' and c.status = 'active'`,
  ).all() as Array<{ aId: string; aName: string; bId: string; bName: string; alias: string }>;
  for (const r of aliased) {
    add({ aId: r.aId, aName: r.aName, bId: r.bId, bName: r.bName,
          reason: "alias_collision", strength: 2, detail: `“${r.alias}”` });
  }

  // 3. The same name with a different corporate suffix. A hunch, and marked
  //    as one: two genuinely different companies can share a stem.
  const active = db.prepare(
    "select id, canonical_name, name_normalized from companies where status = 'active'",
  ).all() as Array<{ id: string; canonical_name: string; name_normalized: string }>;
  const byStem = new Map<string, typeof active>();
  for (const c of active) {
    const stem = nameStem(c.name_normalized);
    if (stem.length < 4) continue;
    const list = byStem.get(stem) ?? [];
    list.push(c);
    byStem.set(stem, list);
  }
  for (const [stem, list] of byStem) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        add({ aId: list[i].id, aName: list[i].canonical_name,
              bId: list[j].id, bName: list[j].canonical_name,
              reason: "same_name_stem", strength: 3, detail: `“${stem}”` });
      }
    }
  }

  return [...found.values()]
    .sort((x, y) => x.strength - y.strength || x.aName.localeCompare(y.aName))
    .slice(0, limit);
}

/**
 * Every table keyed by company that a merge moves.
 *
 * `unique` names the columns a table is unique on besides the company. Two
 * rows recording the same identifier is the strongest evidence that this is
 * one company -- and moving the second onto the first would violate the very
 * index that made it evidence. Those rows are discarded rather than moved,
 * because the winner already holds the identical fact.
 *
 * published_period_values, published_period_tiers and publication_aggregates
 * are deliberately absent. A published revision is not edited by anything.
 */
const MOVES: Array<{ table: string; column: string; unique?: string[] }> = [
  { table: "company_period_facts", column: "company_id" },
  { table: "company_period_field_values", column: "company_id" },
  { table: "company_period_stages", column: "company_id" },
  { table: "tiers", column: "company_id" },
  { table: "tier_traces", column: "company_id" },
  // No `unique` here on purpose: the index is over (scheme, value, valid_from)
  // across the WHOLE table, so two companies cannot hold an identical
  // identifier row and a repoint cannot collide. Two rows for one identifier
  // differ by the period they were imported in, and both move.
  { table: "company_identifiers", column: "company_id" },
  { table: "company_aliases", column: "company_id", unique: ["name_normalized"] },
  { table: "enrichment_jobs", column: "company_id", unique: ["run_id", "field_group"] },
  { table: "enrichment_findings", column: "company_id" },
  { table: "review_decisions", column: "company_id" },
];

export type MergePreview = {
  winner: { id: string; name: string };
  loser: { id: string; name: string };
  moves: Array<{ table: string; rows: number }>;
  /** Rows the winner already holds identically, which are dropped not moved. */
  duplicates: number;
  /** Periods where both hold data. Any at all, and the merge is refused. */
  overlappingPeriods: string[];
  frozenRevisions: number;
};

function company(db: DatabaseSync, id: string) {
  return db.prepare(
    "select id, canonical_name, status, merged_into_id from companies where id = ?").get(id) as
    { id: string; canonical_name: string; status: string; merged_into_id: string | null } | undefined;
}

export function mergePreview(db: DatabaseSync, winnerId: string, loserId: string): MergePreview {
  const winner = company(db, winnerId);
  const loser = company(db, loserId);
  if (!winner || !loser) throw new MergeRefused("One of those companies no longer exists.");
  if (winnerId === loserId) throw new MergeRefused("A company cannot be merged into itself.");
  if (loser.status === "merged") {
    throw new MergeRefused(`“${loser.canonical_name}” has already been merged away.`);
  }
  if (winner.status === "merged") {
    throw new MergeRefused(`“${winner.canonical_name}” has itself been merged into another company.`);
  }

  const moves = MOVES.map((m) => ({
    table: m.table,
    rows: (db.prepare(`select count(*) n from ${m.table} where ${m.column} = ?`)
      .get(loserId) as { n: number }).n,
  })).filter((m) => m.rows > 0);

  let duplicates = 0;
  for (const m of MOVES) {
    if (!m.unique) continue;
    duplicates += (db.prepare(
      `select count(*) n from ${m.table} l where l.${m.column} = ? and exists (
         select 1 from ${m.table} w where w.${m.column} = ?
           and ${m.unique.map((c) => `w.${c} is l.${c}`).join(" and ")})`,
    ).get(loserId, winnerId) as { n: number }).n;
  }

  // Two companies with data in one period are two companies. Merging them
  // would collide on (period_id, company_id) and, worse, would be wrong.
  const overlappingPeriods = (db.prepare(
    `select distinct p.label
       from company_period_facts a
       join company_period_facts b
         on b.period_id = a.period_id and b.company_id = ?
       join periods p on p.id = a.period_id
      where a.company_id = ?`,
  ).all(winnerId, loserId) as Array<{ label: string }>).map((r) => r.label);

  const frozenRevisions = (db.prepare(
    "select count(*) n from published_period_values where company_id = ?")
    .get(loserId) as { n: number }).n;

  return {
    winner: { id: winner.id, name: winner.canonical_name },
    loser: { id: loser.id, name: loser.canonical_name },
    moves, duplicates, overlappingPeriods, frozenRevisions,
  };
}

export type MergeResult = { moved: number; discarded: number; preview: MergePreview };

export function mergeCompanies(
  db: DatabaseSync, opts: { winnerId: string; loserId: string; actorId?: string | null },
): MergeResult {
  const preview = mergePreview(db, opts.winnerId, opts.loserId);
  if (preview.overlappingPeriods.length > 0) {
    throw new MergeRefused(
      `Both hold data in ${preview.overlappingPeriods.join(", ")}. Two companies in one ` +
      `period are two companies, not one recorded twice.`);
  }

  let moved = 0;
  let discarded = 0;
  db.exec("begin");
  try {
    for (const m of MOVES) {
      // `is` rather than `=`, so a NULL exchange matches a NULL exchange:
      // 143 identifiers have no exchange and would otherwise never match.
      if (m.unique) {
        const r = db.prepare(
          `delete from ${m.table} where rowid in (
             select l.rowid from ${m.table} l where l.${m.column} = ? and exists (
               select 1 from ${m.table} w where w.${m.column} = ?
                 and ${m.unique.map((c) => `w.${c} is l.${c}`).join(" and ")}))`,
        ).run(opts.loserId, opts.winnerId);
        discarded += Number(r.changes ?? 0);
      }
      const r = db.prepare(`update ${m.table} set ${m.column} = ? where ${m.column} = ?`)
        .run(opts.winnerId, opts.loserId);
      moved += Number(r.changes ?? 0);
    }
    // The name it was known by is kept, or the merge loses the very thing it
    // was performed to preserve.
    db.prepare(
      `insert or ignore into company_aliases
         (company_id, name, name_normalized, alias_type, source)
       select ?, canonical_name, name_normalized, 'former', 'merge'
         from companies where id = ?`,
    ).run(opts.winnerId, opts.loserId);

    // A redirect, not a deletion: published revisions still point here.
    db.prepare(
      "update companies set status = 'merged', merged_into_id = ? where id = ?",
    ).run(opts.winnerId, opts.loserId);

    db.prepare(
      `insert into audit_log (event, actor_id, detail) values ('companies_merged', ?, ?)`,
    ).run(opts.actorId ?? null, JSON.stringify({
      winner: preview.winner, loser: preview.loser, moved, discarded,
      frozenRevisionsLeftIntact: preview.frozenRevisions,
    }));
    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
  return { moved, discarded, preview };
}

/** Follow a merge, so a link made before it still lands on the company. */
export function resolveCompanyId(db: DatabaseSync, id: string, hops = 4): string {
  let current = id;
  for (let i = 0; i < hops; i++) {
    const row = db.prepare("select merged_into_id from companies where id = ?").get(current) as
      { merged_into_id: string | null } | undefined;
    if (!row?.merged_into_id) return current;
    current = row.merged_into_id;
  }
  return current;
}
