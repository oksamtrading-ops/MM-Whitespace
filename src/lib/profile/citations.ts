/**
 * Where every value came from, and the words that say so.
 *
 * Every value on every screen cites its source, and publish freezes the
 * citation beside the value. A value does not know its own evidence:
 * company_period_field_values records WHAT and its provenance word
 * (extract, ai_accepted, manual_override ...), not which finding put it there.
 * The link runs through the decision standing on the field, which names the
 * finding, whose sources name the documents and whose excerpt is the quote the
 * anchoring gate checked. This module walks that chain once per period.
 *
 * Six kinds, one per provenance:
 *
 *   document      research, accepted -- the filing(s) read, and the quote
 *   searched      research, accepted, and it found nothing: the reason it gave
 *                 ("None of the supplied documents contain an audit fee ...")
 *   review        a reviewer's override -- when, why, and the source they cite
 *   workbook      the source workbook, by period and file hash
 *   prior_period  carried forward from an earlier period
 *   rule          derived by the tier rules, by rule-set version
 *
 * Read in four queries for the whole period, never one per value: publish
 * once paid 3,918 round trips for work like this, and nothing local shows it.
 *
 * A link is written only for http(s). A stored URL came from a fetch, but the
 * page renders it as an href, and a `javascript:` there would run.
 */
import type { Sql } from "../db/sql.ts";
import { standingValueDecisions } from "../review/resolve.ts";

export type DocumentRef = {
  url: string | null; title: string | null; docType: string | null;
  retrievedAt: string | null; contentHash: string | null;
};

export type Citation =
  | { kind: "document"; documents: DocumentRef[] }
  | { kind: "searched"; reason: string | null; decidedAt: string | null }
  | { kind: "review"; decidedAt: string | null; reason: string | null; url: string | null }
  | { kind: "workbook"; period: string; sha256: string | null; asOf: string | null }
  | { kind: "prior_period"; period: string | null }
  | { kind: "rule"; ruleSetVersion: string | null };

/** What publish freezes beside a value, and what the company page shows. */
export type ValueCitation = {
  citation: Citation;
  excerpt: string | null;
  strength: number | null;
  findingId: string | null;
  model: string | null;
  promptVersion: string | null;
};

export const citeKey = (companyId: string, fieldKey: string) => `${companyId}|${fieldKey}`;

/**
 * What to call a document in its citation. Its recorded title or type when
 * there is one; otherwise the file's own name, which says far more than the
 * host does -- "Management Information Circular 2025 (PDF)", not
 * "s21.q4cdn.com", which is the investor-relations CDN half the industry uses.
 * The host is the last resort.
 */
export function documentLabel(d: Pick<DocumentRef, "url" | "title" | "docType">): string {
  if (d.title?.trim()) return d.title.trim();
  if (d.docType?.trim()) return d.docType.trim().replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
  if (!d.url) return "A filing";
  try {
    const u = new URL(d.url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    const ext = last.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() ?? null;
    const stem = (ext ? last.slice(0, -ext.length - 1) : last).replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
    if (stem.length >= 4 && /[a-z]/i.test(stem) && !/^(index|default|home)$/i.test(stem)) {
      return ext === "pdf" ? `${stem} (PDF)` : stem;
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return d.url;
  }
}

/** Only links that are links. */
export function safeHref(url: unknown): string | null {
  return typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}

/** The first http(s) address a reviewer wrote in their reason, if any: their cited source. */
export function urlIn(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? safeHref(m[0].replace(/[.,;:]+$/, "")) : null;
}

type ValueRow = { company_id: string; field_key: string; source: string; value: string | null; source_period_id: string | null };
type FindingRow = {
  id: string; evidence_excerpt: string | null; evidence_strength: number | null; model: string | null;
  prompt_version: string | null; abstained: number | boolean | null; abstention_reason: string | null;
};
type SourceRow = {
  finding_id: string; url: string; title: string | null; doc_type: string | null;
  retrieved_at: string | null; content_hash: string | null; source_tier: number;
};

/**
 * Every value's citation in a period (or one company of it), keyed by
 * citeKey(company, field).
 */
export async function citationsForPeriod(
  db: Sql, periodId: string, opts: { companyId?: string } = {},
): Promise<Map<string, ValueCitation>> {
  const one = opts.companyId ? " and company_id = ?" : "";
  const args = opts.companyId ? [periodId, opts.companyId] : [periodId];

  const period = await db.get(`select label, market_cap_as_of, source_file_sha256, rule_set_version
      from periods where id = ?`, periodId) as
    { label: string; market_cap_as_of: string; source_file_sha256: string | null; rule_set_version: string | null } | undefined;
  if (!period) return new Map();

  const values = await db.all(`select company_id, field_key, source, value, source_period_id
      from company_period_field_values where period_id = ?${one}`, ...args) as ValueRow[];
  const standing = await standingValueDecisions(db, periodId, opts.companyId);

  // The findings and their sources, for every decision in the period: one
  // query each, joined in memory.
  const findings = new Map((await db.all(`select f.id, f.evidence_excerpt, f.evidence_strength, f.model,
         f.prompt_version, f.abstained, f.abstention_reason
       from enrichment_findings f
      where f.id in (select d.finding_id from review_decisions d
                      where d.period_id = ?${one.replace("company_id", "d.company_id")} and d.finding_id is not null)`,
      ...args) as FindingRow[]).map((f) => [String(f.id), f]));
  const sources = new Map<string, DocumentRef[]>();
  for (const s of await db.all(`select s.finding_id, s.url, s.title, s.doc_type, s.retrieved_at,
         s.content_hash, s.source_tier
       from finding_sources s
      where s.finding_id in (select d.finding_id from review_decisions d
                              where d.period_id = ?${one.replace("company_id", "d.company_id")} and d.finding_id is not null)
      order by s.source_tier, s.url`, ...args) as SourceRow[]) {
    const id = String(s.finding_id);
    if (!sources.has(id)) sources.set(id, []);
    sources.get(id)!.push({
      url: safeHref(s.url), title: s.title ?? null, docType: s.doc_type ?? null,
      retrievedAt: s.retrieved_at ?? null, contentHash: s.content_hash ?? null,
    });
  }

  const priorLabels = new Map((await db.all("select id, label from periods") as Array<{ id: string; label: string }>)
    .map((p) => [String(p.id), p.label]));

  const out = new Map<string, ValueCitation>();
  for (const v of values) {
    const key = citeKey(String(v.company_id), v.field_key);
    const decision = standing.get(key);
    const blank: Omit<ValueCitation, "citation"> =
      { excerpt: null, strength: null, findingId: null, model: null, promptVersion: null };

    if (v.source === "ai_accepted" && decision?.decision === "accept" && decision.finding_id) {
      const f = findings.get(String(decision.finding_id));
      const docs = sources.get(String(decision.finding_id)) ?? [];
      const isNull = v.value === null || v.value === "null";
      const evidence = {
        excerpt: f?.evidence_excerpt ?? null,
        strength: f?.evidence_strength === null || f?.evidence_strength === undefined ? null : Number(f.evidence_strength),
        findingId: String(decision.finding_id), model: f?.model ?? null, promptVersion: f?.prompt_version ?? null,
      };
      if ((docs.length > 0 || evidence.excerpt) && !isNull) {
        // Cited by its document, its quote, or both: "the excerpt or the link".
        out.set(key, { citation: { kind: "document", documents: docs }, ...evidence });
      } else if (isNull || Number(f?.abstained) === 1 || f?.abstained === true) {
        out.set(key, { citation: { kind: "searched", reason: f?.abstention_reason ?? null, decidedAt: decision.decided_at }, ...evidence });
      } else {
        // An accepted research value with no document behind it: a broken
        // chain, which publish refuses (snapshot.ts). Recorded as such, never
        // dressed up as a citation.
        out.set(key, { citation: { kind: "document", documents: [] }, ...evidence });
      }
    } else if (v.source === "ai_accepted") {
      // Says it was researched, but no accept stands behind it: never cite it
      // as anything else. A broken chain, and publish refuses it.
      out.set(key, { citation: { kind: "document", documents: [] }, ...blank });
    } else if (v.source === "manual_override") {
      const d = decision?.decision === "override" ? decision : undefined;
      out.set(key, { citation: { kind: "review", decidedAt: d?.decided_at ?? null, reason: d?.reason ?? null,
                                 url: urlIn(d?.reason) }, ...blank });
    } else if (v.source === "inherited") {
      out.set(key, { citation: { kind: "prior_period", period: v.source_period_id ? priorLabels.get(String(v.source_period_id)) ?? null : null }, ...blank });
    } else if (v.source === "derived") {
      out.set(key, { citation: { kind: "rule", ruleSetVersion: period.rule_set_version ?? null }, ...blank });
    } else {
      // extract and manual_entry: the workbook the period was committed from.
      out.set(key, { citation: { kind: "workbook", period: period.label, sha256: period.source_file_sha256,
                                 asOf: period.market_cap_as_of }, ...blank });
    }
  }
  return out;
}

/**
 * Research values whose evidence chain is broken: accepted, holding a value,
 * and carrying neither a document nor the quote it was read from. Publish
 * refuses while any exist.
 */
export function uncited(citations: Map<string, ValueCitation>): string[] {
  return [...citations]
    .filter(([, c]) => c.citation.kind === "document" && c.citation.documents.length === 0 && !c.excerpt)
    .map(([key]) => key);
}

/** The citation as one line of words, for the export's Sources sheet. */
export function citationWords(c: Citation): { kind: string; title: string | null; url: string | null; retrieved: string | null } {
  switch (c.kind) {
    case "document": {
      const d = c.documents[0];
      return { kind: "Researched from a filing", title: d?.title ?? d?.docType ?? null, url: d?.url ?? null, retrieved: d?.retrievedAt ?? null };
    }
    case "searched": return { kind: "Researched: not disclosed", title: c.reason, url: null, retrieved: c.decidedAt };
    case "review": return { kind: "Entered in review", title: null, url: c.url, retrieved: c.decidedAt };
    case "workbook": return { kind: "Source workbook", title: `${c.period} workbook`, url: null, retrieved: c.asOf };
    case "prior_period": return { kind: "Carried from an earlier period", title: c.period, url: null, retrieved: null };
    case "rule": return { kind: "Derived by the tier rules", title: c.ruleSetVersion ? `Rule set ${c.ruleSetVersion}` : null, url: null, retrieved: null };
  }
}
