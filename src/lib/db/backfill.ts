/**
 * Head office for a period that is already committed and published.
 *
 * The parser used to read past the workbook's head-office columns, so Q3-2026
 * was committed with a head office for only the ~30 companies research had
 * reached, though the file carries one for all 259. A period cannot be
 * re-uploaded once published, and the fix for future periods (the parser and
 * commitPeriod) does nothing for this one. This writes what the commit would
 * have written, and nothing else:
 *
 *   facts  -- what the file said, for every company it can be read for, and
 *             only where no fact exists (the snapshot of a file is not edited)
 *   values -- the extract value, ONLY where no value row exists at all, so it
 *             never stands over research, an override or any decision
 *
 * Guarded, because it reaches into a published period from outside the
 * commit path: the latest revision must be the one the caller expects, and
 * every company's market cap in the payload must equal the fact the period was
 * committed with -- 259 figures to the cent, which is the proof it is the same
 * workbook. (A file hash cannot be the proof: see `sha256` below.) Dry by default; one
 * transaction when applied; a second run writes nothing.
 *
 * Writing the fact matters as much as the value: review's conflict check and
 * "keep the file's value" read facts, and an undo restores from them. One
 * consequence worth knowing: undoing an accepted research head office now
 * restores the workbook's, as it already does for every other workbook field.
 */
import type { Sql } from "./sql.ts";
import { normName, type Payload } from "./commit.ts";
import { resolveCompanyId } from "../identity/merge.ts";
import { formatStamp } from "./stamp.ts";

export class BackfillRefused extends Error {
  constructor(message: string) { super(message); this.name = "BackfillRefused"; }
}

export type BackfillResult = {
  applied: boolean;
  period: string;
  revision: number | null;
  parsed: number;
  readable: number;
  facts: number;
  values: number;
  /** Companies whose head office already stands from research or review: left alone. */
  standing: number;
  /** In the payload but not in the period: none expected. */
  unmatched: string[];
};

export async function backfillHeadOffice(db: Sql, payload: Payload, opts: {
  apply: boolean; expectRevision: number; actorId?: string | null;
  /**
   * The workbook's SHA-256, RECORDED in the audit row -- not compared.
   * periods.source_file_sha256 means two things: the upload screen stores the
   * workbook's bytes' hash, scripts/commit_period.mjs the hash of the parsed
   * JSON. Q3-2026 was committed by the script, and the JSON's bytes change
   * with every parser change -- including the one this backfill exists for --
   * so no workbook can ever match it. The proof of "same workbook" is the
   * market cap of every company, below.
   */
  sha256?: string | null;
}): Promise<BackfillResult> {
  const period = await db.get(`select id, label, market_cap_as_of from periods
      order by market_cap_as_of desc limit 1`) as { id: string; label: string; market_cap_as_of: string } | undefined;
  if (!period) throw new BackfillRefused("There is no period to backfill.");
  if (payload.period !== period.market_cap_as_of) {
    throw new BackfillRefused(`The workbook is for ${payload.period}, the latest period is ${period.label}.`);
  }
  const pub = await db.get(`select revision from period_publications where period_id = ?
      order by revision desc limit 1`, period.id) as { revision: number } | undefined;
  const revision = pub ? Number(pub.revision) : null;
  if (revision !== opts.expectRevision) {
    throw new BackfillRefused(`Expected revision ${opts.expectRevision} of ${period.label}, found ` +
      `${revision ?? "no publication"}. Something has been published since this was planned; look before writing.`);
  }

  const parsed = payload.companies.filter((c) => "head_office_region" in c);
  if (parsed.length === 0) {
    throw new BackfillRefused("The payload carries no head office: parse it with the current parser.");
  }

  // Match every company first, and prove the workbook is the one committed.
  const plan: Array<{ companyId: string; name: string; region: string | null }> = [];
  const unmatched: string[] = [];
  const mismatched: string[] = [];
  for (const c of parsed) {
    const row = await db.get("select id from companies where name_normalized = ?", normName(c.name)) as { id: string } | undefined;
    if (!row) { unmatched.push(c.name); continue; }
    const companyId = await resolveCompanyId(db, row.id);
    const fact = await db.get(`select typed_value from company_period_facts
        where period_id = ? and company_id = ? and field_key = 'market_cap_cad'`, period.id, companyId) as
      { typed_value: string | null } | undefined;
    const committed = fact?.typed_value === null || fact?.typed_value === undefined ? null : Number(JSON.parse(fact.typed_value));
    if (committed !== (c.market_cap ?? null)) {
      mismatched.push(`${c.name}: the workbook says ${c.market_cap}, the period was committed with ${committed}`);
      continue;
    }
    plan.push({ companyId, name: c.name, region: c.head_office_region ?? null });
  }
  if (mismatched.length > 0) {
    throw new BackfillRefused("This is not the workbook the period was committed from:\n  " +
      mismatched.slice(0, 10).join("\n  ") + (mismatched.length > 10 ? `\n  ...and ${mismatched.length - 10} more` : ""));
  }

  const result: BackfillResult = {
    applied: false, period: period.label, revision, parsed: parsed.length,
    readable: plan.filter((p) => p.region).length, facts: 0, values: 0, standing: 0, unmatched,
  };

  const work = async (tx: Sql, write: boolean) => {
    for (const p of plan) {
      const hasFact = await tx.get(`select 1 as y from company_period_facts
          where period_id = ? and company_id = ? and field_key = 'head_office_region'`, period.id, p.companyId);
      if (!hasFact) {
        result.facts++;
        if (write) {
          await tx.run(`insert into company_period_facts (period_id, company_id, field_key, raw_value, typed_value, assertion)
              values (?, ?, 'head_office_region', ?, ?, ?) on conflict (period_id, company_id, field_key) do nothing`,
            period.id, p.companyId, p.region, p.region === null ? null : JSON.stringify(p.region),
            p.region ? "asserted" : "absent_blank");
        }
      }
      const value = await tx.get(`select source, value from company_period_field_values
          where period_id = ? and company_id = ? and field_key = 'head_office_region'`, period.id, p.companyId) as
        { source: string; value: string | null } | undefined;
      if (value) {
        if (value.source !== "extract") result.standing++;
        continue;
      }
      if (!p.region) continue;
      result.values++;
      if (write) {
        await tx.run(`insert into company_period_field_values
              (period_id, company_id, field_key, value, source, evidence_state, decided_at)
            values (?, ?, 'head_office_region', ?, 'extract', 'asserted', ?)
            on conflict (period_id, company_id, field_key) do nothing`,
          period.id, p.companyId, JSON.stringify(p.region), formatStamp());
      }
    }
  };

  if (!opts.apply) {
    await work(db, false);
    return result;
  }
  await db.tx(async (tx) => {
    await work(tx, true);
    if (result.facts > 0 || result.values > 0) {
      await tx.run(`insert into audit_log (event, actor_id, period_id, detail) values ('head_office_backfilled', ?, ?, ?)`,
        opts.actorId ?? null, period.id, JSON.stringify({
          revision, parsed: result.parsed, readable: result.readable, facts: result.facts,
          values: result.values, standing: result.standing, unmatched: unmatched.length,
          workbook_sha256: opts.sha256 ?? null,
          reason: "The parser read past the workbook's head-office columns; this writes what the commit would have.",
          at: formatStamp(),
        }));
    }
  });
  result.applied = true;
  return result;
}
