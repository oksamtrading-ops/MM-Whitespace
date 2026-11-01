/**
 * Put the findings already called unsupported through the gate again, against
 * the document each one names and no other.
 *
 * "Unsupported" counts as a fabrication, and the share of them gates publish.
 * Until 1 November 2026 the gate called a quote unsupported unless it matched
 * its document exactly, so a dropped dash or a stitched "..." counted the same
 * as an invented name; Q4 2026 stood at 145 of 5,522, 2.63% against a 2.0%
 * ceiling. anchor.ts now holds those for a person instead. This applies that
 * to the findings stored before it.
 *
 * It only ever moves unsupported to anchor_mismatch: held, never
 * bulk-acceptable, never a proposal -- even for a finding the current gate
 * would now propose outright, since a backfill is not a research run. Each
 * move is written to the audit log with the gate's reason. Running it again
 * re-reads what is still unsupported and moves nothing new.
 */

import type { Sql } from "../db/sql.ts";
import { gate, type Inexact, type NumericClaim, type Scale, type StoredDocument } from "./anchor.ts";

export type Rechecked = {
  findingId: string; fieldKey: string; anchorMode: string;
  inexact: Inexact | null; reason: string | null;
};

type FindingRow = {
  id: string; period_id: string | null; field_key: string; proposed_value: unknown;
  scale_token: string | null; evidence_excerpt: string | null; anchor_document_hash: string;
};

type DocumentRow = {
  content_hash: string; text_content: string | null; char_count: number | string | null;
  page_count: number | string | null; chars_per_page: number | string | null;
  has_text_layer: boolean | number | null;
};

function json(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

const num = (v: number | string | null) => (v === null ? undefined : Number(v));

function storedDocument(d: DocumentRow): StoredDocument {
  return {
    contentHash: d.content_hash, text: d.text_content ?? "",
    charCount: num(d.char_count), pageCount: num(d.page_count),
    charsPerPage: d.chars_per_page === null ? null : Number(d.chars_per_page),
    hasTextLayer: d.has_text_layer === null ? undefined : Boolean(d.has_text_layer),
  };
}

/** The claim as the worker put it to the gate, rebuilt from what it stored. */
function numericClaim(f: FindingRow, value: unknown): NumericClaim | null {
  if (!f.scale_token || !value || typeof value !== "object") return null;
  const v = value as { amount?: unknown; currency?: string | null; fiscal_year?: number | string | null };
  if (typeof v.amount !== "number") return null;
  return { value: v.amount, scale: f.scale_token as Scale, fiscalYear: v.fiscal_year ?? null,
           currency: v.currency ?? null, fieldKey: f.field_key };
}

export async function recheckUnsupported(
  db: Sql, opts: { dryRun?: boolean } = {}): Promise<{ checked: number; held: Rechecked[] }> {
  const findings = await db.all(`select f.id, r.period_id, f.field_key, f.proposed_value, f.scale_token,
        f.evidence_excerpt, f.anchor_document_hash
      from enrichment_findings f join enrichment_runs r on r.id = f.run_id
      where f.state = 'unsupported' and f.anchor_document_hash is not null
      order by f.anchor_document_hash, f.id`) as FindingRow[];

  const held: Rechecked[] = [];
  let doc: StoredDocument | null = null;
  for (const f of findings) {
    if (doc?.contentHash !== f.anchor_document_hash) {
      const row = await db.get(`select content_hash, text_content, char_count, page_count, chars_per_page,
          has_text_layer from documents where content_hash = ?`, f.anchor_document_hash) as DocumentRow | undefined;
      doc = row ? storedDocument(row) : null;
    }
    if (!doc) continue;

    const value = json(f.proposed_value);
    const verdict = gate({
      fieldKey: f.field_key,
      excerpt: f.evidence_excerpt,
      numeric: numericClaim(f, value),
      stage: f.field_key === "stage_evidence_state" && value && typeof value === "object"
        ? value as Record<string, boolean | null> : null,
      document: doc,
    });
    if (verdict.state !== "anchor_mismatch" && verdict.state !== "proposed") continue;

    const change: Rechecked = {
      findingId: f.id, fieldKey: f.field_key, anchorMode: verdict.anchor.mode,
      inexact: verdict.anchor.inexact ?? null,
      reason: verdict.reason ?? (verdict.state === "proposed"
        ? "anchors under the current gate; held all the same, since a backfill makes no proposals" : null),
    };
    if (!opts.dryRun) {
      const moved = await db.tx(async (db) => {
        const { changes } = await db.run(`update enrichment_findings
            set state = 'anchor_mismatch', anchor_mode = ?, anchor_start = ?, anchor_end = ?
            where id = ? and state = 'unsupported'`,
          verdict.anchor.mode, verdict.anchor.start, verdict.anchor.end, f.id);
        if (changes === 0) return false;
        await db.run("insert into audit_log (event, period_id, detail) values ('finding_rechecked', ?, ?)",
          f.period_id, JSON.stringify({ finding_id: f.id, field_key: f.field_key, from: "unsupported",
                                        to: "anchor_mismatch", anchor_mode: change.anchorMode,
                                        inexact: change.inexact, reason: change.reason }));
        return true;
      });
      if (!moved) continue;
    }
    held.push(change);
  }
  return { checked: findings.length, held };
}
