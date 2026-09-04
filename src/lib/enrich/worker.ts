/**
 * The worker: one company, end to end.
 *
 * Research is split from persist. The validated model response is written to
 * enrichment_job_results BEFORE any finding is derived from it, so a crash
 * between the two costs nothing -- the retry reads the stored response instead
 * of paying for the call again. This is the cheapest reliability property in
 * the design and it is why the two steps are separate functions here.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { gate, type StoredDocument } from "./anchor.ts";
import { evidenceStrength, type EvidenceInput } from "./evidence.ts";
import { Cassettes, cassetteKey, type Mode } from "./cassette.ts";
import {
  claimJobs, claimSlot, ensureSlots, recordSpend, releaseSlot, transition,
} from "./ledger.ts";
import {
  buildPrompt, egressScan, restrictionsFromCatalog, PROMPT_VERSION,
  type PublicCompanyRow, type Route,
} from "./prompt.ts";
import { buildAllowlist, type FetchedDocument } from "./fetch.ts";

export const SCHEMA_HASH = "findings-v1";
export const DEFAULT_MODEL = "claude-sonnet-5";

/** One finding as a recorded response states it, before the gate has run. */
export type ProposedFinding = {
  field_key: string;
  value: unknown;
  evidence_excerpt?: string | null;
  numeric?: { value: number; scale: "units" | "thousands" | "millions"; fiscalYear?: number } | null;
  model_self_confidence?: number | null;
  abstained?: boolean;
  abstention_reason?: string | null;
  source_url?: string | null;
  source_tier?: 1 | 2 | 3 | 4 | 5;
  document_hash?: string | null;
  document_age_days?: number | null;
  corroborating_sources?: number;
};

export type CassetteBody = {
  findings: ProposedFinding[];
  /** What the application had fetched and stored at record time. */
  documents?: Array<StoredDocument & { url: string; sourceTier: 1 | 2 | 3 | 4 | 5; docType?: string }>;
  usage?: Record<string, number>;
  cost_usd?: number;
};

const FIELD_CADENCE_DAYS: Record<string, number> = {
  stage_evidence_state: 180, auditor: 365, website: 365,
  audit_fee: 365, tax_fee: 365, property_regions: 365,
};

export type RunOptions = {
  mode?: Mode;
  cassetteDir: string;
  model?: string;
  route?: Route;
  fieldGroup?: string;
  budgetUsd?: number;
};

export type ResearchOutcome = {
  runId: string;
  jobId: string;
  findings: Array<{
    fieldKey: string; state: string; anchorMode: string;
    strength: number | null; bulkAcceptable: boolean; reason?: string;
  }>;
  spendUsd: number;
  jobState: string;
};

/** Create a run and one job per company. A run cannot exist without a budget. */
export function createRun(
  db: DatabaseSync, periodId: string, companyIds: string[], opts: RunOptions,
): { runId: string; jobIds: string[] } {
  const budget = opts.budgetUsd ?? 5;
  if (!(budget > 0)) throw new Error("a run cannot be created without a budget");
  db.prepare(
    `insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
     values (?, ?, ?, ?, ?)`,
  ).run(periodId, budget, opts.model ?? DEFAULT_MODEL, PROMPT_VERSION, opts.mode ?? "replay");
  const run = db.prepare(
    "select id from enrichment_runs order by rowid desc limit 1").get() as { id: string };

  const ins = db.prepare(
    `insert into enrichment_jobs (run_id, company_id, field_group) values (?, ?, ?)`);
  const jobIds: string[] = [];
  for (const companyId of companyIds) {
    ins.run(run.id, companyId, opts.fieldGroup ?? "general");
    const j = db.prepare(
      "select id from enrichment_jobs order by rowid desc limit 1").get() as { id: string };
    jobIds.push(j.id);
  }
  return { runId: run.id, jobIds };
}

export function publicRow(db: DatabaseSync, companyId: string, periodAsOf: string): PublicCompanyRow {
  const c = db.prepare(
    "select id, canonical_name from companies where id = ?").get(companyId) as
    { id: string; canonical_name: string };
  const ident = db.prepare(
    `select value, exchange from company_identifiers
      where company_id = ? and scheme = 'root_ticker' and valid_to is null limit 1`,
  ).get(companyId) as { value: string; exchange: string } | undefined;
  const aliases = (db.prepare(
    "select name from company_aliases where company_id = ?").all(companyId) as Array<{ name: string }>)
    .map((r) => r.name);
  const regionsRow = db.prepare(
    `select value from company_period_field_values
      where company_id = ? and field_key = 'property_regions' limit 1`,
  ).get(companyId) as { value: string } | undefined;

  return {
    companyId: c.id,
    canonicalName: c.canonical_name,
    aliases,
    rootTicker: ident?.value ?? "",
    exchange: ident?.exchange ?? "",
    interlistedVenues: [],
    headOfficeLocation: null,
    headOfficeRegion: null,
    knownRegions: regionsRow ? JSON.parse(regionsRow.value) : {},
    knownCommodities: [],
    knownWebsite: null,
    periodAsOf,
  };
}

/**
 * Step one: obtain a validated response and store it raw. Nothing is derived
 * here, and nothing downstream may read anything but the stored row.
 */
function research(
  db: DatabaseSync, jobId: string, row: PublicCompanyRow, opts: RunOptions,
): { body: CassetteBody; attempt: number } {
  const route: Route = opts.route ?? "extract_general";
  const model = opts.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(route, row);

  // The egress scan runs on the serialised body, in the one place that talks
  // to the vendor. A hit throws and dead-letters the job; it never redacts.
  const catalog = db.prepare(
    "select key, label, classification from field_catalog").all() as
    Array<{ key: string; label: string; classification: string }>;
  egressScan({ prefix: prompt.stablePrefix, content: prompt.userContent },
             restrictionsFromCatalog(catalog));

  const key = cassetteKey({
    route, model, promptVersion: prompt.promptVersion,
    schemaHash: SCHEMA_HASH, content: prompt.userContent,
  });

  const mode: Mode = opts.mode ?? "replay";
  if (mode === "live") {
    throw new Error(
      "live mode is not enabled in this build. No vendor call has been made. " +
      "Enable it only after the risk and legal review under decision 1 is complete, " +
      "and with a key present.",
    );
  }
  const cassettes = new Cassettes(opts.cassetteDir, mode);
  const rec = cassettes.read(key);
  const body = rec.response as CassetteBody;

  const attempt = ((db.prepare(
    "select coalesce(max(attempt), 0) a from enrichment_job_results where job_id = ?",
  ).get(jobId) as { a: number }).a) + 1;

  db.prepare(
    `insert into enrichment_job_results (job_id, attempt, raw, request_id, usage, verbatim_turn)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(jobId, attempt, JSON.stringify(body), rec.key,
        JSON.stringify(rec.usage ?? {}), rec.verbatimTurn ?? null);

  return { body, attempt };
}

/** Step two: derive findings from the STORED response and run every one through the gate. */
function persist(
  db: DatabaseSync, runId: string, jobId: string, companyId: string,
  body: CassetteBody, attempt: number, opts: RunOptions,
): ResearchOutcome["findings"] {
  const model = opts.model ?? DEFAULT_MODEL;
  const docs = new Map<string, StoredDocument>();
  for (const d of body.documents ?? []) {
    const hash = d.contentHash ?? `sha256:${createHash("sha256").update(d.text).digest("hex")}`;
    const stored: StoredDocument = { ...d, contentHash: hash };
    docs.set(hash, stored);
    db.prepare(
      `insert into documents (content_hash, url, retrieved_at, extractor, extractor_version,
                              normalization_version, text_content, char_count, page_count,
                              chars_per_page, source_tier, doc_type, scale_phrase, has_text_layer)
       values (?, ?, ?, 'fixture', '1.0.0', '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (content_hash) do nothing`,
    ).run(hash, d.url, new Date().toISOString(), d.text, d.text.length,
          d.pageCount ?? 1, d.charsPerPage ?? d.text.length,
          d.sourceTier, d.docType ?? null, d.scalePhrase ?? null,
          d.hasTextLayer === false ? 0 : 1);
  }

  const out: ResearchOutcome["findings"] = [];
  for (const f of body.findings) {
    const doc = f.document_hash ? docs.get(f.document_hash) ?? null
              : (body.documents?.length ? docs.get([...docs.keys()][0])! : null);

    // An abstention is not put through the gate: there is no claim to anchor,
    // and routing it to `unsupported` would inflate the hallucination rate that
    // gates publish with what is actually the model behaving correctly.
    const verdict = f.abstained
      ? {
          state: "abstained" as const,
          anchor: { mode: "none" as const, start: null, end: null,
                    documentHash: doc?.contentHash ?? null },
          bulkAcceptable: false,
          reason: f.abstention_reason ?? "the model abstained",
        }
      : gate({
          fieldKey: f.field_key,
          excerpt: f.evidence_excerpt ?? null,
          numeric: f.numeric ? { ...f.numeric, fieldKey: f.field_key } : null,
          document: doc,
          sourceReachable: doc !== null,
        });

    const ev: EvidenceInput = {
      sourceTier: f.source_tier ?? 5,
      documentAgeDays: f.document_age_days ?? null,
      expectedCadenceDays: FIELD_CADENCE_DAYS[f.field_key] ?? 365,
      anchorMode: verdict.anchor.mode,
      corroboratingSources: f.corroborating_sources ?? 0,
      extractionAgreement: null,
    };
    const score = evidenceStrength(ev);

    db.prepare(
      `insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, proposed_value,
          evidence_strength, evidence_version, evidence_components,
          model_self_confidence, anchor_mode, anchor_start, anchor_end,
          anchor_document_hash, evidence_excerpt, scale_token, abstained,
          abstention_reason, state, model, prompt_version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, jobId, attempt, companyId, f.field_key, JSON.stringify(f.value ?? null),
          score.strength, score.version, JSON.stringify(score.components),
          f.model_self_confidence ?? null, verdict.anchor.mode,
          verdict.anchor.start, verdict.anchor.end, verdict.anchor.documentHash,
          f.evidence_excerpt ?? null, f.numeric?.scale ?? null,
          f.abstained ? 1 : 0, f.abstention_reason ?? null,
          verdict.state, model, PROMPT_VERSION);

    const finding = db.prepare(
      "select id from enrichment_findings order by rowid desc limit 1").get() as { id: string };
    if (f.source_url) {
      db.prepare(
        `insert into finding_sources (finding_id, url, content_hash, source_tier, doc_type)
         values (?, ?, ?, ?, ?) on conflict do nothing`,
      ).run(finding.id, f.source_url, verdict.anchor.documentHash,
            f.source_tier ?? 5, null);
    }

    out.push({
      fieldKey: f.field_key, state: verdict.state, anchorMode: verdict.anchor.mode,
      strength: score.strength, bulkAcceptable: verdict.bulkAcceptable,
      reason: verdict.reason,
    });
  }
  return out;
}

/**
 * The fetch allowlist, derived from the extract.
 *
 * Built from the issuer websites the workbook itself carries, never from a
 * domain a model proposed -- that asymmetry is what makes "the application
 * fetched this" a meaningful claim. A model may nominate a URL; if its host is
 * not reachable from this set, the fetcher declines it.
 */
export function allowlistFromPeriod(db: DatabaseSync, periodId: string): Set<string> {
  const rows = db.prepare(
    `select value from company_period_field_values
      where period_id = ? and field_key = 'website' and value is not null`,
  ).all(periodId) as Array<{ value: string }>;

  const domains: string[] = [];
  for (const r of rows) {
    let v: unknown;
    try { v = JSON.parse(r.value); } catch { v = r.value; }
    if (typeof v !== "string" || !v) continue;
    // Only values that are actually URLs. 45 of 143 in the real workbook are
    // page titles, and a page title is not a domain.
    if (!/^https?:\/\//i.test(v)) continue;
    try { domains.push(new URL(v).hostname); } catch { /* not a URL after all */ }
  }
  return buildAllowlist(domains);
}

/** Persist a fetched document. The text is stored; the file never is. */
export function storeDocument(db: DatabaseSync, doc: FetchedDocument): string {
  db.prepare(
    `insert into documents (content_hash, url, final_url, retrieved_at, extractor,
                            extractor_version, normalization_version, text_content,
                            char_count, page_count, chars_per_page, source_tier,
                            doc_type, has_text_layer)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (content_hash) do nothing`,
  ).run(doc.contentHash, doc.url, doc.finalUrl, doc.retrievedAt, doc.extractor,
        doc.extractorVersion, doc.normalizationVersion, doc.text, doc.charCount,
        doc.pageCount, doc.charsPerPage, doc.sourceTier, doc.docType,
        doc.hasTextLayer ? 1 : 0);
  return doc.contentHash;
}

/**
 * The per-run hallucination rate that gates publish.
 *
 * Abstentions are excluded deliberately: a model that says it cannot find a
 * value is behaving correctly, and counting that as a hallucination would both
 * understate the pipeline and block publishes for the wrong reason.
 */
export function hallucinationRate(
  db: DatabaseSync, runId: string,
): { unsupported: number; assessed: number; rate: number } {
  const row = db.prepare(
    `select
       sum(case when state = 'unsupported' then 1 else 0 end) as unsupported,
       sum(case when state != 'abstained' then 1 else 0 end)  as assessed
     from enrichment_findings where run_id = ?`,
  ).get(runId) as { unsupported: number | null; assessed: number | null };
  const unsupported = row.unsupported ?? 0;
  const assessed = row.assessed ?? 0;
  return { unsupported, assessed, rate: assessed === 0 ? 0 : unsupported / assessed };
}

/** Drive one job from queued to completed. */
export function researchOneCompany(
  db: DatabaseSync, runId: string, periodAsOf: string, opts: RunOptions,
): ResearchOutcome {
  ensureSlots(db, 4);
  const workerId = `worker-${process.pid}-${Date.now()}`;
  const slot = claimSlot(db, workerId);
  if (slot === null) {
    throw new Error("no free worker slot; the worker exits rather than exceeding concurrency");
  }
  try {
    const [job] = claimJobs(db, runId, workerId, 1);
    if (!job) throw new Error("no claimable job in this run");

    transition(db, job.id, "researching", { chargeAttempt: true });
    const row = publicRow(db, job.company_id, periodAsOf);

    let body: CassetteBody, attempt: number;
    try {
      ({ body, attempt } = research(db, job.id, row, opts));
    } catch (err) {
      transition(db, job.id, "dead_letter", { error: (err as Error).message });
      throw err;
    }

    transition(db, job.id, "persisting");
    const findings = persist(db, runId, job.id, job.company_id, body, attempt, opts);
    transition(db, job.id, "completed");

    const budget = recordSpend(db, runId, body.cost_usd ?? 0);
    const state = (db.prepare("select state from enrichment_jobs where id = ?")
      .get(job.id) as { state: string }).state;

      return { runId, jobId: job.id, findings, spendUsd: budget.spend, jobState: state };
  } finally {
    releaseSlot(db, slot);
  }
}
