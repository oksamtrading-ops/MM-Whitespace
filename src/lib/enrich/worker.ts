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
import { join } from "node:path";
import type { Sql } from "../db/sql.ts";
import { gate, type StoredDocument } from "./anchor.ts";
import { evidenceStrength, type EvidenceInput } from "./evidence.ts";
import { Cassettes, cassetteKey, type Mode } from "./cassette.ts";
import { classifyError, type Classification } from "./client.ts";
import {
  claimJobs, claimSlot, ensureSlots, haltRun, recordSpend, releaseSlot, requeueLater, transition,
  WORKER_SLOTS, type ClaimedJob,
} from "./ledger.ts";
import {
  buildPrompt, egressScan, restrictionsFromCatalog, PROMPT_VERSION,
  type PublicCompanyRow, type Route,
} from "./prompt.ts";
import { buildAllowlist, type FetchedDocument } from "./fetch.ts";
import {
  BATCH_DISCOUNT, Meter, preparePass, researchLive, resumePass, sdkVendor,
  type CandidateDoc, type LiveBody, type LiveDeps, type LiveJob, type Pass,
  type PassContext, type Prepared,
} from "./live.ts";
import type { BatchRequestRow, BatchResult, Submission } from "./batch.ts";
import { extractPdf } from "./pdf.ts";
import { nodeHttp, nodeResolve } from "./transport.ts";
import { getNumber } from "../settings/index.ts";

export const SCHEMA_HASH = "findings-v1";
export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Live mode is enabled in this build -- switched on 11 September 2026 by
 * Samuel Owusu, after confirming that decision 1's scope covers web search and
 * fetching issuer sites and EDGAR, that the key comes from the
 * `mm-whitespace-prod` workspace with its own spend limit (S3), and that the
 * key once exposed on screen was deleted.
 *
 * It is still not ON anywhere by default: a deployment researches live only
 * with MM_ENRICH_MODE=live, ANTHROPIC_API_KEY and MM_SEC_CONTACT all set, and
 * the start-run screen refuses before a run exists when any is missing.
 * Setting this back to false stops live research everywhere at once.
 */
export const LIVE_ENABLED = true;

/**
 * Whether this deployment may research at all, and how.
 *
 * Unset means no: a production deployment with no recordings and no live
 * mode would only ever abandon every job, and a screen that offers a button
 * whose only outcome is 259 abandoned jobs teaches people the screen lies.
 * `replay` is for local work and the end-to-end suite, where the fixture
 * companies have recordings; `live` is the eventual production setting.
 */
export function enrichmentMode(
  raw: string | undefined = process.env.MM_ENRICH_MODE,
): { mode: Mode; reason: null } | { mode: null; reason: string } {
  const value = (raw ?? "").trim();
  if (value === "") {
    return { mode: null, reason: "MM_ENRICH_MODE is not set, so this deployment does not research. " +
                                 "Set it to replay for recorded fixtures, or live once live enrichment is enabled." };
  }
  if (value === "replay") return { mode: "replay", reason: null };
  if (value === "live") {
    if (!LIVE_ENABLED) {
      return { mode: null, reason: "MM_ENRICH_MODE=live, but live mode is not enabled in this build " +
                                   "(LIVE_ENABLED in src/lib/enrich/worker.ts). No vendor call has been made." };
    }
    // Refuse at the door rather than abandon every company for the same
    // missing setting one job at a time.
    const missing = [
      !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
      !process.env.MM_SEC_CONTACT && "MM_SEC_CONTACT (SEC EDGAR requires a contact)",
    ].filter(Boolean);
    return missing.length
      ? { mode: null, reason: `Live research needs ${missing.join(" and ")} set in this deployment.` }
      : { mode: "live", reason: null };
  }
  return { mode: null, reason: `MM_ENRICH_MODE=${value} is not a mode (replay or live).` };
}

/** Where recordings live. On a deployment this is whatever was bundled, which may be nothing. */
export function cassetteDir(): string {
  return process.env.MM_CASSETTE_DIR ?? join(process.cwd(), "tests", "cassettes");
}

/** One finding as a recorded response states it, before the gate has run. */
export type ProposedFinding = {
  field_key: string;
  value: unknown;
  evidence_excerpt?: string | null;
  numeric?: { value: number; scale: "units" | "thousands" | "millions"; fiscalYear?: number;
             currency?: string | null } | null;
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
  /** The app_users id of whoever started it; null for a script. */
  createdBy?: string | null;
  /** Injected live dependencies. Tests only; production builds them from the environment. */
  live?: LiveDeps;
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
export async function createRun(
  db: Sql, periodId: string, companyIds: string[], opts: RunOptions): Promise<{ runId: string; jobIds: string[] }> {
  // The Admin's default, so the settings screen is not decorative.
  const budget = opts.budgetUsd ?? await getNumber(db, "default_run_budget_usd", 5);
  if (!(await budget > 0)) throw new Error("a run cannot be created without a budget");
  const run = await db.get(
    `insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode, created_by)
     values (?, ?, ?, ?, ?, ?) returning id`,
    periodId, budget, opts.model ?? DEFAULT_MODEL, PROMPT_VERSION,
    opts.mode ?? "replay", opts.createdBy ?? null) as { id: string };

  const ins = `insert into enrichment_jobs (run_id, company_id, field_group)
     values (?, ?, ?) returning id`;
  const jobIds: string[] = [];
  for (const companyId of companyIds) {
    const j = await db.get(ins, run.id, companyId,
                           opts.fieldGroup ?? "general") as { id: string };
    jobIds.push(j.id);
  }
  return { runId: run.id, jobIds };
}

export async function publicRow(db: Sql, companyId: string, periodAsOf: string): Promise<PublicCompanyRow> {
  const c = await db.get("select id, canonical_name from companies where id = ?", companyId) as
    { id: string; canonical_name: string };
  const ident = await db.get(`select value, exchange from company_identifiers
      where company_id = ? and scheme = 'root_ticker' and valid_to is null limit 1`, companyId) as { value: string; exchange: string } | undefined;
  const aliases = (await db.all("select name from company_aliases where company_id = ?", companyId) as Array<{ name: string }>)
    .map((r) => r.name);
  const regionsRow = await db.get(`select value from company_period_field_values
      where company_id = ? and field_key = 'property_regions' limit 1`, companyId) as { value: string } | undefined;

  // A committed period writes every region bucket, empty ones included. An
  // empty bucket says nothing a prompt should carry, and dropping it is what
  // makes a committed company and a hand-seeded one build the same prompt --
  // so a recording answers both, and the cassette key means one thing.
  const knownRegions: Record<string, string[]> = {};
  const parsed = regionsRow ? JSON.parse(regionsRow.value) as Record<string, string[]> : {};
  for (const [region, values] of Object.entries(parsed)) {
    if (Array.isArray(values) && values.length > 0) knownRegions[region] = values;
  }

  // Public values the application already holds -- the workbook's or an
  // accepted one -- so research starts from them rather than rediscovering.
  const known = async (key: string): Promise<string | null> => {
    const r = await db.get(`select value from company_period_field_values
        where company_id = ? and field_key = ? limit 1`, companyId, key) as { value: string } | undefined;
    if (!r) return null;
    try { const v = JSON.parse(r.value); return typeof v === "string" && v.trim() ? v.trim() : null; }
    catch { return null; }
  };

  return {
    companyId: c.id,
    canonicalName: c.canonical_name,
    aliases,
    rootTicker: ident?.value ?? "",
    exchange: ident?.exchange ?? "",
    interlistedVenues: [],
    headOfficeLocation: await known("head_office_location"),
    headOfficeRegion: await known("head_office_region"),
    knownRegions,
    knownCommodities: [],
    knownWebsite: await known("website"),
    periodAsOf,
  };
}

/**
 * The live pipeline's dependencies, from the environment. Refuses rather than
 * starting a run that would fail on every company for the same missing thing.
 */
export async function defaultLiveDeps(db: Sql): Promise<LiveDeps> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set; no vendor call can be made");
  if (!process.env.MM_SEC_CONTACT) {
    throw new Error("MM_SEC_CONTACT is not set. SEC EDGAR refuses requests without a contact in the User-Agent.");
  }
  const catalog = await db.all("select key, label, classification from field_catalog") as
    Array<{ key: string; label: string; classification: string }>;
  return {
    vendor: await sdkVendor(),
    fetch: { http: nodeHttp, resolve: nodeResolve, extractors: { pdf: extractPdf } },
    store: (doc) => storeDocument(db, doc),
    load: (hashes) => loadDocuments(db, hashes),
    restrictions: restrictionsFromCatalog(catalog),
  };
}

/** What pass 1 found for this company, so pass 2 reads it instead of searching again. */
async function priorCandidates(db: Sql, companyId: string): Promise<CandidateDoc[] | null> {
  const row = await db.get(`select r.raw from enrichment_job_results r
      join enrichment_jobs j on j.id = r.job_id
     where j.company_id = ? and j.field_group = 'identity'
     order by r.created_at desc limit 1`, companyId) as { raw: string } | undefined;
  if (!row) return null;
  try { return (JSON.parse(row.raw) as LiveBody).candidates ?? null; } catch { return null; }
}

/**
 * Step one: obtain a validated response and store it raw. Nothing is derived
 * here, and nothing downstream may read anything but the stored row.
 */
async function research(
  db: Sql, jobId: string, row: PublicCompanyRow, opts: RunOptions,
  fieldGroup = "general"): Promise<{ body: CassetteBody; attempt: number }> {
  if ((opts.mode ?? "replay") === "live") return researchLiveJob(db, jobId, row, opts, fieldGroup);
  const route: Route = opts.route ?? "extract_general";
  const model = opts.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(route, row);

  // The egress scan runs on the serialised body, in the one place that talks
  // to the vendor. A hit throws and dead-letters the job; it never redacts.
  const catalog = await db.all("select key, label, classification from field_catalog") as
    Array<{ key: string; label: string; classification: string }>;
  egressScan({ prefix: prompt.stablePrefix, content: prompt.userContent },
             restrictionsFromCatalog(catalog));

  const key = cassetteKey({
    route, model, promptVersion: prompt.promptVersion,
    schemaHash: SCHEMA_HASH, content: prompt.userContent,
  });

  const mode: Mode = opts.mode ?? "replay";
  const cassettes = new Cassettes(opts.cassetteDir, mode);
  const rec = cassettes.read(key);
  const body = rec.response as CassetteBody;

  const attempt = ((await db.get("select coalesce(max(attempt), 0) a from enrichment_job_results where job_id = ?", jobId) as { a: number }).a) + 1;

  await db.run(`insert into enrichment_job_results (job_id, attempt, raw, request_id, usage, verbatim_turn)
     values (?, ?, ?, ?, ?, ?)`, jobId, attempt, JSON.stringify(body), rec.key,
        JSON.stringify(rec.usage ?? {}), rec.verbatimTurn ?? null);

  return { body, attempt };
}

/**
 * Live research for one job. Refuses in a build without LIVE_ENABLED unless
 * the caller injected its own dependencies -- which is how the tests drive the
 * whole pipeline with a fake vendor and a fake network, and nothing else can.
 *
 * The result is stored raw before anything is derived from it, as a recording
 * is: a crash after the calls costs a re-derivation, not a second bill.
 */
async function researchLiveJob(
  db: Sql, jobId: string, row: PublicCompanyRow, opts: RunOptions, fieldGroup: string,
): Promise<{ body: CassetteBody; attempt: number }> {
  if (!LIVE_ENABLED && !opts.live) {
    throw new Error(
      "live mode is not enabled in this build. No vendor call has been made. " +
      "Enable it only after the risk and legal review under decision 1 is complete, " +
      "and with a key present.");
  }
  const deps = opts.live ?? await defaultLiveDeps(db);
  const job = await liveJobFor(db, row, fieldGroup);
  const body = await researchLive(job, deps);
  const attempt = await nextAttempt(db, jobId);
  await storeRawResult(db, jobId, attempt, body, `live-${job.pass}`);
  return { body, attempt };
}

/** The pass, the company and what pass 1 already found. One definition. */
async function liveJobFor(db: Sql, row: PublicCompanyRow, fieldGroup: string): Promise<LiveJob> {
  const pass: Pass = fieldGroup === "identity" ? "identity" : "general";
  return {
    pass, row, website: row.knownWebsite,
    priorCandidates: pass === "general" ? await priorCandidates(db, row.companyId) : null,
  };
}

async function nextAttempt(db: Sql, jobId: string): Promise<number> {
  return ((await db.get(
    "select coalesce(max(attempt), 0) a from enrichment_job_results where job_id = ?",
    jobId) as { a: number }).a) + 1;
}

/** The response, stored raw before anything is derived from it. */
async function storeRawResult(
  db: Sql, jobId: string, attempt: number, body: CassetteBody, requestId: string,
): Promise<void> {
  await db.run(`insert into enrichment_job_results (job_id, attempt, raw, request_id, usage, verbatim_turn)
     values (?, ?, ?, ?, ?, ?)`, jobId, attempt, JSON.stringify(body), requestId,
        JSON.stringify(body.usage ?? {}), null);
}

/**
 * The first half of a job: everything up to its model call, then hand the
 * request to the batch instead of sending it.
 *
 * A pass that needs no model call at all -- pass 2 where nothing was
 * fetchable -- finishes here rather than occupying a slot in the batch.
 */
export async function prepareJobForBatch(
  db: Sql, runId: string, job: ClaimedJob, periodAsOf: string, opts: RunOptions,
): Promise<{ submission: Submission } | { outcome: ResearchOutcome }> {
  await transition(db, job.id, "researching", { chargeAttempt: true });
  const row = await publicRow(db, job.company_id, periodAsOf);
  const deps = opts.live ?? await defaultLiveDeps(db);
  const meter = new Meter();

  let prepared: Prepared;
  try {
    prepared = await preparePass(await liveJobFor(db, row, job.field_group), deps, meter);
  } catch (err) {
    throw new JobFailed(await routeFailure(db, runId, job.id, err), err);
  }

  const attempt = await nextAttempt(db, job.id);
  if (prepared.kind === "done") {
    await storeRawResult(db, job.id, attempt, prepared.body, `live-${job.field_group}-nodocs`);
    return { outcome: await finishJob(db, runId, job, prepared.body, attempt, opts) };
  }

  await transition(db, job.id, "awaiting_batch");
  return {
    submission: {
      jobId: job.id, attempt, request: prepared.request,
      // The half-spent meter travels with the request: a batched pass is
      // metered by two processes, and without this the fetching half's cost
      // is simply lost from the run's total.
      context: { ...prepared.context, fieldGroup: job.field_group,
                 companyId: job.company_id, periodAsOf,
                 model: String(prepared.request.model ?? ""),
                 spentUsage: meter.usage, spentUsd: meter.cost },
    },
  };
}

/**
 * The second half: the answer has come back, so finish the pass.
 *
 * An expired or cancelled request is NOT a failure -- a batch has 24 hours and
 * the world sometimes takes longer. The job returns to the queue with its
 * attempt given back, exactly as a lapsed lease does.
 */
export async function settleBatchResult(
  db: Sql, runId: string, request: BatchRequestRow, result: BatchResult["result"],
  opts: RunOptions,
): Promise<ResearchOutcome | null> {
  const job = await db.get(
    "select id, company_id, field_group, attempts from enrichment_jobs where id = ?",
    request.job_id) as ClaimedJob | undefined;
  if (!job) return null;

  if (result.type === "expired" || result.type === "canceled") {
    await db.run(`update enrichment_jobs
        set attempts = case when attempts > 0 then attempts - 1 else 0 end, batch_id = null
      where id = ?`, job.id);
    await transition(db, job.id, "queued", {
      error: `the batch ${result.type}; requeued with no attempt charged` });
    return null;
  }
  if (result.type === "errored") {
    throw new JobFailed(
      await routeFailure(db, runId, job.id, result.error),
      result.error);
  }

  const context = safeJson(request.context) as PassContext & {
    fieldGroup?: string; periodAsOf?: string; model?: string;
    spentUsage?: Record<string, number>; spentUsd?: number;
  };
  const deps = opts.live ?? await defaultLiveDeps(db);
  // Half price, and seeded with what the submitting worker already spent.
  const meter = new Meter(BATCH_DISCOUNT);
  meter.seed(context.spentUsage, context.spentUsd);
  // The batched answer is metered HERE. resumePass only meters calls it makes
  // itself, and in the ordinary case it makes none -- so without this line the
  // tokens the batch actually billed for never reach the run's spend at all.
  meter.add(context.model ?? DEFAULT_MODEL, result.message.usage ?? {});

  let body: LiveBody;
  try {
    const row = await publicRow(db, job.company_id, String(context.periodAsOf ?? "").slice(0, 10));
    body = await resumePass(
      await liveJobFor(db, row, String(context.fieldGroup ?? job.field_group)),
      context, result.message, deps, meter);
  } catch (err) {
    throw new JobFailed(await routeFailure(db, runId, job.id, err), err);
  }

  await storeRawResult(db, job.id, request.attempt, body, `batch-${request.custom_id}`);
  return await finishJob(db, runId, job, body, request.attempt, opts);
}

/** Derive, gate, record: the tail both paths share once a body exists. */
async function finishJob(
  db: Sql, runId: string, job: ClaimedJob, body: CassetteBody, attempt: number, opts: RunOptions,
): Promise<ResearchOutcome> {
  await transition(db, job.id, "persisting");
  const findings = await persist(db, runId, job.id, job.company_id, body, attempt, opts);
  await transition(db, job.id, "completed");
  const budget = await recordSpend(db, runId, body.cost_usd ?? 0);
  const state = (await db.get("select state from enrichment_jobs where id = ?", job.id) as { state: string }).state;
  return { runId, jobId: job.id, findings, spendUsd: budget.spend, jobState: state };
}

function safeJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)) as Record<string, unknown>; } catch { return {}; }
}

/** Step two: derive findings from the STORED response and run every one through the gate. */
async function persist(
  db: Sql, runId: string, jobId: string, companyId: string,
  body: CassetteBody, attempt: number, opts: RunOptions): Promise<ResearchOutcome["findings"]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const docs = new Map<string, StoredDocument>();
  for (const d of body.documents ?? []) {
    const hash = d.contentHash ?? `sha256:${createHash("sha256").update(d.text).digest("hex")}`;
    const stored: StoredDocument = { ...d, contentHash: hash };
    docs.set(hash, stored);
    await db.run(`insert into documents (content_hash, url, retrieved_at, extractor, extractor_version,
                              normalization_version, text_content, char_count, page_count,
                              chars_per_page, source_tier, doc_type, scale_phrase, has_text_layer)
       values (?, ?, ?, 'fixture', '1.0.0', '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (content_hash) do nothing`, hash, d.url, new Date().toISOString(), d.text, d.text.length,
          d.pageCount ?? 1, d.charsPerPage ?? d.text.length,
          d.sourceTier, d.docType ?? null, d.scalePhrase ?? null,
          d.hasTextLayer === false ? 0 : 1);
  }

  const out: ResearchOutcome["findings"] = [];
  for (const f of body.findings) {
    // A finding is checked against the document it names and no other. One
    // that names none is unverified -- source_unreachable, the manual queue --
    // never quietly checked against whatever else the job happened to fetch.
    const doc = f.document_hash ? docs.get(f.document_hash) ?? null : null;

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
          stage: f.field_key === "stage_evidence_state" && f.value && typeof f.value === "object"
            ? f.value as Record<string, boolean | null> : null,
          document: doc,
          sourceReachable: doc !== null,
        });

    // A fee the model gave no currency, where the document states one beside
    // the figure: take the document's word, which is the one the gate checked.
    const stated = "matched" in verdict.anchor ? verdict.anchor.matched?.currency : undefined;
    const value = f.value && typeof f.value === "object" && "amount" in (f.value as object) &&
      !(f.value as { currency?: string | null }).currency && stated
      ? { ...(f.value as object), currency: stated }
      : f.value;

    const ev: EvidenceInput = {
      sourceTier: f.source_tier ?? 5,
      documentAgeDays: f.document_age_days ?? null,
      expectedCadenceDays: FIELD_CADENCE_DAYS[f.field_key] ?? 365,
      anchorMode: verdict.anchor.mode,
      corroboratingSources: f.corroborating_sources ?? 0,
      extractionAgreement: null,
    };
    const score = evidenceStrength(ev);

    const finding = await db.get(`insert into enrichment_findings
         (run_id, job_id, attempt, company_id, field_key, proposed_value,
          evidence_strength, evidence_version, evidence_components,
          model_self_confidence, anchor_mode, anchor_start, anchor_end,
          anchor_document_hash, evidence_excerpt, scale_token, abstained,
          abstention_reason, state, model, prompt_version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       returning id`, runId, jobId, attempt, companyId, f.field_key, JSON.stringify(value ?? null),
          score.strength, score.version, JSON.stringify(score.components),
          f.model_self_confidence ?? null, verdict.anchor.mode,
          verdict.anchor.start, verdict.anchor.end, verdict.anchor.documentHash,
          f.evidence_excerpt ?? null, f.numeric?.scale ?? null,
          Boolean(f.abstained), f.abstention_reason ?? null,
          verdict.state, model, PROMPT_VERSION) as { id: string };
    if (f.source_url) {
      await db.run(`insert into finding_sources (finding_id, url, content_hash, source_tier, doc_type)
         values (?, ?, ?, ?, ?) on conflict do nothing`, finding.id, f.source_url, verdict.anchor.documentHash,
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
export async function allowlistFromPeriod(db: Sql, periodId: string): Promise<Set<string>> {
  const rows = await db.all(`select value from company_period_field_values
      where period_id = ? and field_key = 'website' and value is not null`, periodId) as Array<{ value: string }>;

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
export async function storeDocument(db: Sql, doc: FetchedDocument): Promise<string> {
  await db.run(`insert into documents (content_hash, url, final_url, retrieved_at, extractor,
                            extractor_version, normalization_version, text_content,
                            char_count, page_count, chars_per_page, source_tier,
                            doc_type, has_text_layer)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (content_hash) do nothing`, doc.contentHash, doc.url, doc.finalUrl, doc.retrievedAt, doc.extractor,
        doc.extractorVersion, doc.normalizationVersion, doc.text, doc.charCount,
        doc.pageCount, doc.charsPerPage, doc.sourceTier, doc.docType,
        doc.hasTextLayer ? 1 : 0);
  return doc.contentHash;
}

/**
 * Documents back out of the store, in the order asked for.
 *
 * ORDER IS THE POINT. An extraction answer cites its source by position in the
 * list it was given, so a list that comes back in the database's order, or
 * short one row, attributes a finding to a different filing. Missing hashes
 * are simply absent and the caller compares the lengths.
 */
export async function loadDocuments(
  db: Sql, hashes: readonly string[],
): Promise<FetchedDocument[]> {
  if (hashes.length === 0) return [];
  const rows = await db.all(
    `select content_hash, url, final_url, retrieved_at, extractor, extractor_version,
            normalization_version, text_content, char_count, page_count, chars_per_page,
            source_tier, doc_type, has_text_layer
       from documents where content_hash in (${hashes.map(() => "?").join(", ")})`,
    ...hashes) as Array<Record<string, unknown>>;
  const byHash = new Map(rows.map((r) => [String(r.content_hash), r]));
  return hashes.map((h) => byHash.get(h)).filter((r) => r !== undefined).map((r) => ({
    contentHash: String(r.content_hash),
    url: String(r.url),
    finalUrl: String(r.final_url ?? r.url),
    retrievedAt: String(r.retrieved_at),
    extractor: String(r.extractor),
    extractorVersion: String(r.extractor_version),
    normalizationVersion: String(r.normalization_version),
    // Retention clears the text at 90 days and keeps the row, so a document
    // can exist with nothing to read. An empty string is the honest reading.
    text: r.text_content === null || r.text_content === undefined ? "" : String(r.text_content),
    charCount: Number(r.char_count),
    pageCount: Number(r.page_count),
    charsPerPage: Number(r.chars_per_page),
    sourceTier: Number(r.source_tier) as FetchedDocument["sourceTier"],
    docType: String(r.doc_type) as FetchedDocument["docType"],
    hasTextLayer: Number(r.has_text_layer) === 1,
  }));
}

/**
 * The per-run hallucination rate that gates publish.
 *
 * Abstentions are excluded deliberately: a model that says it cannot find a
 * value is behaving correctly, and counting that as a hallucination would both
 * understate the pipeline and block publishes for the wrong reason.
 */
export async function hallucinationRate(
  db: Sql, runId: string): Promise<{ unsupported: number; assessed: number; rate: number }> {
  const row = await db.get(`select
       sum(case when state = 'unsupported' then 1 else 0 end) as unsupported,
       sum(case when state != 'abstained' then 1 else 0 end)  as assessed
     from enrichment_findings where run_id = ?`, runId) as { unsupported: number | null; assessed: number | null };
  const unsupported = row.unsupported ?? 0;
  const assessed = row.assessed ?? 0;
  return { unsupported, assessed, rate: assessed === 0 ? 0 : unsupported / assessed };
}

/** A job that did not complete, and which of the three ways it went. */
export class JobFailed extends Error {
  outcome: Classification;
  constructor(outcome: Classification, cause: unknown) {
    super((cause as Error)?.message ?? String(cause));
    this.name = "JobFailed";
    this.outcome = outcome;
    this.cause = cause;
  }
}

/** Backoff for a retryable failure: the vendor's retry-after when it gives one, else exponential. */
export function retryDelayMs(err: unknown, attempts: number, random: () => number = Math.random): number {
  const header = (err as { headers?: { get?: (k: string) => string | null } })?.headers?.get?.("retry-after");
  const vendor = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : 0;
  const exponential = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
  // Jitter, so a dozen jobs throttled together do not all come back together.
  return Math.max(vendor, exponential) + Math.floor(random() * 5_000);
}

/**
 * Route a research failure the way docs/design/03's failure table says.
 *
 *   retry        back to the queue after a delay; dead-lettered once the job's
 *                attempts are spent. An overloaded vendor (529) is not the
 *                job's fault and charges no attempt.
 *   halt         the whole run stops, with the vendor's message as the reason.
 *                A spend limit, bad credentials or a billing problem would
 *                fail every remaining company the same way, so failing them
 *                one at a time is the one wrong answer.
 *   dead_letter  this job alone is wrong: a malformed request, a refusal, a
 *                missing recording, an egress-scan hit.
 */
export async function routeFailure(
  db: Sql, runId: string, jobId: string, err: unknown, now: number = Date.now(),
): Promise<Classification> {
  const message = ((err as Error)?.message ?? String(err)).split("\n")[0].slice(0, 500);
  const outcome = classifyError(err);

  if (outcome === "halt") {
    // A spend limit or a revoked key says nothing about this job, so the
    // attempt charged on entering research is given back (docs/design/03:
    // "release leases without incrementing attempts"). Run 1 halted on the
    // first job and left it one attempt down; resumed, it would have had two.
    await db.run(`update enrichment_jobs set attempts = case when attempts > 0 then attempts - 1 else 0 end
        where id = ?`, jobId);
    await haltRun(db, runId, `the model vendor refused: ${message}`);
    return "halt";
  }
  if (outcome === "retry") {
    const job = await db.get("select attempts, max_attempts from enrichment_jobs where id = ?", jobId) as
      { attempts: number; max_attempts: number };
    const overloaded = (err as { status?: number })?.status === 529;
    if (!overloaded && job.attempts >= job.max_attempts) {
      await transition(db, jobId, "dead_letter", { error: `attempts exhausted; last: ${message}` });
      return "dead_letter";
    }
    await requeueLater(db, jobId, new Date(now + retryDelayMs(err, job.attempts)), message, overloaded);
    return "retry";
  }
  await transition(db, jobId, "dead_letter", { error: message });
  return "dead_letter";
}

/**
 * One CLAIMED job, through to a terminal state -- or back to the queue.
 *
 * The caller holds the slot and the lease; this holds the order of operations.
 * A research failure is routed by routeFailure and rethrown as JobFailed, so
 * a drain loop can count it and move on while a single-company caller sees it.
 */
export async function processJob(
  db: Sql, runId: string, job: ClaimedJob, periodAsOf: string, opts: RunOptions,
): Promise<ResearchOutcome> {
  await transition(db, job.id, "researching", { chargeAttempt: true });
  const row = await publicRow(db, job.company_id, periodAsOf);

  let body: CassetteBody, attempt: number;
  try {
    ({ body, attempt } = await research(db, job.id, row, opts, job.field_group));
  } catch (err) {
    throw new JobFailed(await routeFailure(db, runId, job.id, err), err);
  }

  return await finishJob(db, runId, job, body, attempt, opts);
}

/** Drive one job from queued to completed. */
export async function researchOneCompany(
  db: Sql, runId: string, periodAsOf: string, opts: RunOptions): Promise<ResearchOutcome> {
  await ensureSlots(db, WORKER_SLOTS);
  const workerId = `worker-${process.pid}-${Date.now()}`;
  const slot = await claimSlot(db, workerId);
  if (slot === null) {
    throw new Error("no free worker slot; the worker exits rather than exceeding concurrency");
  }
  try {
    const [job] = await claimJobs(db, runId, workerId, 1);
    if (!job) throw new Error("no claimable job in this run");
    return await processJob(db, runId, job, periodAsOf, opts);
  } finally {
    await releaseSlot(db, slot);
  }
}
