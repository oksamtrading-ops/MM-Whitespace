/**
 * A document an analyst supplies, for a company and a quarter.
 *
 * Some companies' websites refuse the research fetcher (Cloudflare's 403 to
 * Cadillac Mines and GR Silver, 5 November 2026). An Analyst or Admin who has
 * downloaded a filing from the company's own website in a browser supplies it
 * here, with the address they downloaded it from, and pass 2 reads it before
 * anything it fetches (live.ts, fieldsPrepare). docs/decisions/SUPPLIED-DOCUMENTS.md.
 *
 * A file of CHUNK_BYTES or less arrives in one request (supplyWhole) and is
 * read there; its bytes are never written anywhere. Vercel refuses a request
 * body over 4.5 MB before the app sees it, so a larger file comes in pieces:
 * beginUpload, addChunk for each in order, finishUpload. Those pieces wait in
 * document_upload_chunks and are deleted when the last arrives, whatever the
 * outcome, and any upload left past its hour is deleted by the per-minute
 * cron tick (sweep.ts) and by every upload request. That is raw file bytes in
 * Postgres, briefly, which doc 11 otherwise forbids:
 * docs/decisions/SUPPLIED-DOCUMENTS.md records the exception and why it is
 * bounded (the first piece must be a PDF before anything is kept, no piece
 * past the declared count, one open upload per person, MAX_OPEN_BYTES across
 * everyone).
 *
 * Either way the file is read by exactly the code that reads a fetched one
 * (fetch.ts, documentFromBody): the same caps, the same reader, the same
 * hash. Only its text is kept.
 *
 * Every function takes the acting user, and every one that touches an upload
 * checks it is that user's: a server action is a public POST, and an upload
 * id is not a capability.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { formatStamp } from "../db/stamp.ts";
import { personSql } from "../auth/person.ts";
import {
  classifyTier, documentFromBody, FetchRefused, isAllowedHost, MAX_BYTES, MAX_PAGES, sniffType,
  type Extracted, type FetchedDocument,
} from "../enrich/fetch.ts";
import type { PdfLimits } from "../enrich/pdf.ts";
import { EXCLUDED_DOMAINS, hostOf, namesCompany, type DocKind } from "../enrich/live.ts";
import { publicRow, storeDocument } from "../enrich/worker.ts";
import { newestPeriod } from "../db/periods.ts";
import { dropUpload, sweepUploads } from "./sweep.ts";
import { isRowId, isUniqueViolation } from "../db/rowid.ts";

export { isRowId } from "../db/rowid.ts";

export { sweepUploads } from "./sweep.ts";

/** One piece of an upload. Under Vercel's 4.5 MB body limit with room for the form around it. */
export const CHUNK_BYTES = 3 * 1024 * 1024;
/** The fetcher's own cap: a file it would refuse to fetch is refused here too. */
export const MAX_SUPPLY_BYTES = MAX_BYTES;
/** Documents supplied for one company in one quarter, not counting removed ones. Pass 2 reads five in all. */
export const MAX_SUPPLIED = 3;
/** How long an unfinished upload's pieces are kept: the workbook quarantine's hour. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
/**
 * Every open upload's declared bytes together, everyone's. A ceiling on how
 * much file can sit in the database at once, whoever is uploading.
 */
export const MAX_OPEN_BYTES = 100 * 1024 * 1024;
/** Doc 11: text is extracted server-side under a timeout. Looked at between pages (pdf.ts). */
export const EXTRACT_TIMEOUT_MS = 60_000;
/** What the analyst affirms, word for word, and what the audit log records they affirmed. */
export const ATTESTATION =
  "I downloaded this file from this address on the company's own website, publicly, without signing in.";
export const MAX_URL_LENGTH = 2000;

export { kindLabel, SUPPLY_KINDS } from "./kinds.ts";
import { SUPPLY_KINDS } from "./kinds.ts";

/** A refusal in words an analyst can act on. `code` is for the audit log and tests. */
export class SupplyRefused extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SupplyRefused";
    this.code = code;
  }
}

export type Actor = { id: string };
export type PdfExtractor = (bytes: Uint8Array, limits?: PdfLimits) => Promise<Extracted>;

/** The website the application trusts for the company this quarter, as pass 2 reads it (worker.ts, publicRow). */
export async function trustedWebsite(db: Sql, companyId: string, periodId: string): Promise<string | null> {
  const r = await db.get(`select value from company_period_field_values
      where period_id = ? and company_id = ? and field_key = 'website'`, periodId, companyId) as
    { value: string } | undefined;
  if (!r) return null;
  try { const v = JSON.parse(r.value); return typeof v === "string" && v.trim() ? v.trim() : null; }
  catch { return null; }
}

/**
 * The address the analyst says the file came from, held to the company's
 * trusted website or a subdomain of it. Not the IR platform pass 2 also reads
 * (q4cdn.com): it serves every issuer's documents, so an address there says
 * nothing about whose a file is. Never SEDAR+ (decision 1). It becomes an
 * href in review, so nothing but http(s) passes.
 */
export function checkSourceUrl(raw: string, website: string | null): string {
  const text = String(raw ?? "").trim();
  if (!text) throw new SupplyRefused("url_missing", "Give the address you downloaded the file from.");
  if (text.length > MAX_URL_LENGTH) throw new SupplyRefused("url_too_long", "That address is too long to be a filing's.");
  let u: URL;
  try { u = new URL(text); } catch {
    throw new SupplyRefused("url_malformed", "That is not a web address. Paste the address from the browser's address bar.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new SupplyRefused("url_scheme", "The address must start with https:// or http://.");
  }
  if (u.username || u.password) {
    throw new SupplyRefused("url_credentials", "The address must not carry a user name or password.");
  }
  const site = website ? hostOf(website) : null;
  if (!site) {
    throw new SupplyRefused("no_website",
      "This company has no website the application trusts this quarter. Accept its website in review first.");
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new SupplyRefused("url_excluded", "Documents from SEDAR+ are never used.");
  }
  if (!isAllowedHost(host, new Set([site]))) {
    throw new SupplyRefused("url_off_site",
      `The address must be on the company's own website, ${site}. This one is on ${host}.`);
  }
  u.hash = "";
  return u.href;
}

function isKind(kind: string): kind is DocKind {
  return SUPPLY_KINDS.some((k) => k.kind === kind);
}

/** Documents supplied for the company this quarter that are still to be read. */
async function liveCount(db: Sql, companyId: string, periodId: string): Promise<number> {
  return Number((await db.get(`select count(*) n from supplied_documents
      where company_id = ? and period_id = ? and withdrawn_at is null`, companyId, periodId) as { n: number }).n);
}

async function audit(db: Sql, event: string, actor: Actor, periodId: string | null, detail: Record<string, unknown>) {
  await db.run(`insert into audit_log (event, actor_id, period_id, detail) values (?, ?, ?, ?)`,
    event, actor.id, periodId, JSON.stringify(detail));
}

/**
 * Run `work`, and put any refusal in the audit log before passing it on (doc
 * 11: an upload rejected, with its reason). What is recorded is what the
 * analyst declared -- never the file.
 */
async function audited<T>(
  db: Sql, actor: Actor, where: { periodId?: string | null; detail: Record<string, unknown> },
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SupplyRefused) {
      // A period that is not in the database cannot be the audit row's period.
      const period = isRowId(where.periodId)
        ? await db.get("select id from periods where id = ?", where.periodId) as { id: string } | undefined
        : undefined;
      await audit(db, "document_refused", actor, period ? String(period.id) : null,
        { ...where.detail, reason: err.code });
    }
    throw err;
  }
}

export type SupplyInput = {
  companyId: string; periodId: string; url: string; kind: string; filename: string; sizeBytes: number;
  /** The analyst ticked ATTESTATION. */
  attested: boolean;
};

type Checked = { companyId: string; periodId: string; url: string; kind: DocKind; filename: string; size: number };

/** Everything that can be checked before a byte is read. */
async function checkInput(db: Sql, input: SupplyInput): Promise<Checked> {
  if (input.attested !== true) {
    throw new SupplyRefused("not_attested", "Confirm the file came from the company's website, publicly, without signing in.");
  }
  // Ids first: on Postgres a malformed one is an error, not a missing row.
  const company = isRowId(input.companyId)
    ? await db.get("select id from companies where id = ?", input.companyId) : undefined;
  if (!company) throw new SupplyRefused("no_company", "That company is not in the database.");
  // The quarter analysts work on, and no other: a document is read for the
  // quarter pass 2 is researching, and a past one is published.
  const newest = await newestPeriod(db);
  if (!isRowId(input.periodId) || !newest || String(newest.id) !== input.periodId) {
    throw new SupplyRefused("no_period", "Documents can be supplied only for the current quarter.");
  }
  if (!isKind(input.kind)) throw new SupplyRefused("kind", "Say what kind of document this is.");
  const size = Math.floor(Number(input.sizeBytes));
  if (!Number.isFinite(size) || size <= 0) throw new SupplyRefused("empty", "That file is empty.");
  if (size > MAX_SUPPLY_BYTES) {
    throw new SupplyRefused("too_large",
      `That file is ${(size / 1048576).toFixed(1)} MB. The limit is ${MAX_SUPPLY_BYTES / 1048576} MB, as it is for a filing research fetches.`);
  }
  const filename = clean(input.filename, 255) || "document.pdf";
  const url = checkSourceUrl(input.url, await trustedWebsite(db, input.companyId, input.periodId));
  if (await liveCount(db, input.companyId, input.periodId) >= MAX_SUPPLIED) {
    throw new SupplyRefused("too_many",
      `${MAX_SUPPLIED} documents are already supplied for this company this quarter. Remove one first.`);
  }
  return { companyId: input.companyId, periodId: input.periodId, url, kind: input.kind, filename, size };
}

/** Text from a form, as it may be stored: trimmed, without NULs (Postgres refuses them), and capped. */
function clean(v: unknown, max: number): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/**
 * What the analyst declared, for the audit row of a refusal. Every field is
 * capped: a refusal is written whatever was sent, so a tampered POST must not
 * be able to fill the audit log.
 */
function declared(input: SupplyInput): Record<string, unknown> {
  return {
    companyId: clean(input.companyId, 64), url: clean(input.url, MAX_URL_LENGTH),
    kind: clean(input.kind, 64), filename: clean(input.filename, 255),
    sizeBytes: Number.isFinite(Number(input.sizeBytes)) ? Number(input.sizeBytes) : null,
  };
}

function notAPdf(): SupplyRefused {
  return new SupplyRefused("type_confusion", "That file is not a PDF.");
}

export type Supplied = { id: string; contentHash: string; pageCount: number; charCount: number };
type ReadDeps = { extractPdf: PdfExtractor; now?: () => Date; timeoutMs?: number };

/**
 * A file of CHUNK_BYTES or less, in the request that carries it. Its bytes are
 * read here and dropped with the request: nothing of the file is stored but
 * its text.
 */
export async function supplyWhole(
  db: Sql, actor: Actor, input: SupplyInput, bytes: Uint8Array, deps: ReadDeps,
): Promise<Supplied> {
  return audited(db, actor, { periodId: input.periodId, detail: declared(input) }, async () => {
    await sweepUploads(db, (deps.now ?? (() => new Date()))().getTime());
    const c = await checkInput(db, input);
    if (c.size > CHUNK_BYTES) {
      throw new SupplyRefused("too_large_for_one", "That file is too large to send at once. Start again.");
    }
    if (bytes.byteLength !== c.size) {
      throw new SupplyRefused("incomplete", "The file arrived the wrong size. Start again.");
    }
    return readAndKeep(db, actor, c, bytes, deps);
  });
}

/**
 * Open an upload for a file larger than one request carries. The actor's
 * other open uploads are dropped -- one at a time each -- and any past its
 * hour, anyone's, goes first.
 */
export async function beginUpload(
  db: Sql, actor: Actor, input: SupplyInput, now: () => Date = () => new Date(),
): Promise<{ uploadId: string; chunkCount: number; chunkBytes: number }> {
  return audited(db, actor, { periodId: input.periodId, detail: declared(input) }, async () => {
    await sweepUploads(db, now().getTime());
    const c = await checkInput(db, input);
    const mine = await db.all("select id from document_uploads where uploaded_by = ?", actor.id) as Array<{ id: string }>;
    for (const m of mine) await dropUpload(db, String(m.id));
    const open = Number((await db.get("select coalesce(sum(size_bytes), 0) n from document_uploads") as { n: number }).n);
    if (open + c.size > MAX_OPEN_BYTES) {
      throw new SupplyRefused("busy", "Too many files are being uploaded at once. Try again in a few minutes.");
    }

    const uploadId = randomBytes(16).toString("hex");
    const chunkCount = Math.ceil(c.size / CHUNK_BYTES);
    try {
      await db.run(`insert into document_uploads (id, company_id, period_id, url, kind, filename, size_bytes,
                      chunk_count, uploaded_by, created_at, expires_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uploadId, c.companyId, c.periodId, c.url, c.kind, c.filename, c.size, chunkCount, actor.id,
        formatStamp(now().getTime()), formatStamp(now().getTime() + UPLOAD_TTL_MS));
    } catch (err) {
      // One open upload a person, held by the index (0041): two begun at
      // once from two tabs cannot both be kept.
      if (isUniqueViolation(err)) {
        throw new SupplyRefused("upload_open", "Another of your uploads started at the same moment. Try again.");
      }
      throw err;
    }
    await audit(db, "document_upload_started", actor, c.periodId, {
      uploadId, companyId: c.companyId, url: c.url, kind: c.kind, filename: c.filename, sizeBytes: c.size,
      chunkCount, attested: ATTESTATION });
    return { uploadId, chunkCount, chunkBytes: CHUNK_BYTES };
  });
}

type UploadRow = {
  id: string; company_id: string; period_id: string; url: string; kind: string; filename: string;
  size_bytes: number; chunk_count: number; uploaded_by: string; expires_at: string;
};

export function isUploadId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

/** The actor's own upload, still open. Anyone else's, or an expired one, is "gone": the same answer either way. */
async function ownUpload(db: Sql, actor: Actor, uploadId: string, now: () => Date): Promise<UploadRow> {
  if (!isUploadId(uploadId)) throw new SupplyRefused("upload_gone", "That upload has gone. Start again.");
  const u = await db.get(`select id, company_id, period_id, url, kind, filename, size_bytes, chunk_count,
                                 uploaded_by, expires_at
       from document_uploads where id = ?`, uploadId) as UploadRow | undefined;
  if (!u || String(u.uploaded_by) !== actor.id || String(u.expires_at) <= formatStamp(now().getTime())) {
    throw new SupplyRefused("upload_gone", "That upload has gone. Start again.");
  }
  return u;
}

/** What the audit log says about an upload: what was declared for it. */
function uploadDetail(u: UploadRow | null, uploadId: string): Record<string, unknown> {
  return u
    ? { uploadId, companyId: u.company_id, url: u.url, kind: u.kind, filename: u.filename, sizeBytes: Number(u.size_bytes) }
    : { uploadId: String(uploadId).slice(0, 64) };
}

async function uploadFor(db: Sql, uploadId: string): Promise<UploadRow | null> {
  if (!isUploadId(uploadId)) return null;
  return (await db.get(`select id, company_id, period_id, url, kind, filename, size_bytes, chunk_count,
                                uploaded_by, expires_at from document_uploads where id = ?`, uploadId) as UploadRow | undefined) ?? null;
}

/** The size piece `idx` must be: every piece is CHUNK_BYTES but the last, which is what is left. */
function pieceSize(u: UploadRow, idx: number): number {
  const size = Number(u.size_bytes);
  return idx < Number(u.chunk_count) - 1 ? CHUNK_BYTES : size - CHUNK_BYTES * (Number(u.chunk_count) - 1);
}

/**
 * One piece, in order. The first must begin as a PDF does before it is kept,
 * so a file of any other kind -- a workbook picked by mistake -- never reaches
 * the database at all.
 */
export async function addChunk(
  db: Sql, actor: Actor, uploadId: string, idx: number, bytes: Uint8Array, now: () => Date = () => new Date(),
): Promise<void> {
  const known = await uploadFor(db, uploadId);
  const mine = known && String(known.uploaded_by) === actor.id ? known : null;
  return audited(db, actor, { periodId: mine?.period_id ?? null, detail: uploadDetail(mine, uploadId) }, async () => {
    await sweepUploads(db, now().getTime());
    const u = await ownUpload(db, actor, uploadId, now);
    const have = Number((await db.get("select count(*) n from document_upload_chunks where upload_id = ?", uploadId) as { n: number }).n);
    // In order, and never past the last: pieces beyond the declared count
    // would sit in the database outside MAX_OPEN_BYTES until the hour passed.
    if (!Number.isInteger(idx) || idx !== have || idx >= Number(u.chunk_count)) {
      await dropUpload(db, uploadId);
      throw new SupplyRefused("chunk_index", "A piece of the file arrived out of order. Start again.");
    }
    // Exact, not "at most": the declared size was checked against the cap, and
    // a piece of any other length means the pieces will not add up to it.
    if (bytes.byteLength !== pieceSize(u, idx)) {
      await dropUpload(db, uploadId);
      throw new SupplyRefused("chunk_size", "A piece of the file arrived the wrong size. Start again.");
    }
    if (idx === 0 && sniffType(bytes.subarray(0, 2048), "application/pdf") !== "pdf") {
      await dropUpload(db, uploadId);
      throw notAPdf();
    }
    await db.run("insert into document_upload_chunks (upload_id, idx, data) values (?, ?, ?)",
      uploadId, idx, Buffer.from(bytes).toString("base64"));
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SupplyRefused("timeout",
      "Reading that PDF took too long. Is it one very large scanned file?")), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Put the pieces together and read them. The pieces are deleted first,
 * whatever happens next: a refused file is not kept either.
 */
export async function finishUpload(db: Sql, actor: Actor, uploadId: string, deps: ReadDeps): Promise<Supplied> {
  const now = deps.now ?? (() => new Date());
  const known = await uploadFor(db, uploadId);
  const mine = known && String(known.uploaded_by) === actor.id ? known : null;
  return audited(db, actor, { periodId: mine?.period_id ?? null, detail: uploadDetail(mine, uploadId) }, async () => {
    await sweepUploads(db, now().getTime());
    const u = await ownUpload(db, actor, uploadId, now);
    let bytes: Buffer;
    try {
      const rows = await db.all(`select idx, data from document_upload_chunks
          where upload_id = ? order by idx`, uploadId) as Array<{ idx: number; data: string }>;
      if (rows.length !== Number(u.chunk_count) || rows.some((r, i) => Number(r.idx) !== i)) {
        throw new SupplyRefused("incomplete", "Not every piece of the file arrived. Start again.");
      }
      bytes = Buffer.concat(rows.map((r) => Buffer.from(String(r.data), "base64")));
    } finally {
      await dropUpload(db, uploadId);
    }
    if (bytes.byteLength !== Number(u.size_bytes)) {
      throw new SupplyRefused("incomplete", "The file arrived the wrong size. Start again.");
    }
    // Checked again, now: the website or the count may have changed while the
    // pieces were arriving.
    const c = await checkInput(db, {
      companyId: String(u.company_id), periodId: String(u.period_id), url: String(u.url), kind: String(u.kind),
      filename: String(u.filename), sizeBytes: Number(u.size_bytes), attested: true,
    });
    return readAndKeep(db, actor, c, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), deps);
  });
}

/**
 * Read the file as a fetched filing is read and keep its text, or say why not.
 * The caller has checked what was declared; this checks what arrived.
 */
async function readAndKeep(db: Sql, actor: Actor, c: Checked, bytes: Uint8Array, deps: ReadDeps): Promise<Supplied> {
  const now = deps.now ?? (() => new Date());
  if (sniffType(bytes.subarray(0, 2048), "application/pdf") !== "pdf") throw notAPdf();
  const timeoutMs = deps.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  // The text is stored as a fetch from this address would store it, tier and
  // all: one row per text, whoever brought it, and a later fetch of the same
  // bytes reads this row back (fieldsResume). That the analyst supplied it is
  // said where it is read as supplied -- live.ts, asSupplied: the supplied
  // tier, and the supplied row on every finding.
  const site = hostOf(await trustedWebsite(db, c.companyId, c.periodId) ?? "") ?? "";
  let doc: FetchedDocument;
  try {
    doc = await withTimeout(documentFromBody(bytes, "application/pdf", {
      url: c.url, finalUrl: c.url, retrievedAt: now().toISOString(),
      sourceTier: classifyTier(new URL(c.url).hostname, new Set([site])),
    }, { pdf: deps.extractPdf }, { timeoutMs }), timeoutMs);
  } catch (err) {
    if (err instanceof SupplyRefused) throw err;
    if (err instanceof FetchRefused) {
      const words: Record<string, string> = {
        too_large: `That file is over the ${MAX_SUPPLY_BYTES / 1048576} MB limit.`,
        too_many_pages: `That PDF has more pages than research reads (${MAX_PAGES}).`,
        extract_timeout: "Reading that PDF took too long. Is it one very large scanned file?",
        type_confusion: "That file is not a PDF.",
      };
      throw new SupplyRefused(err.code, words[err.code] ?? "That file could not be read as a PDF.");
    }
    throw new SupplyRefused("unreadable", "That file could not be read as a PDF.");
  }
  // The bytes, never the name: a page saved as .pdf is still a page.
  if (doc.docType !== "pdf") throw notAPdf();
  if (!doc.hasTextLayer) {
    throw new SupplyRefused("no_text_layer",
      "That PDF has no text to read: it is a scan. Research cannot quote from a picture of a page.");
  }
  const period = await db.get("select market_cap_as_of from periods where id = ?", c.periodId) as { market_cap_as_of: string };
  const row = await publicRow(db, c.companyId, String(period.market_cap_as_of).slice(0, 10), c.periodId);
  if (namesCompany(doc.text, row) < 0) {
    throw new SupplyRefused("names_someone_else",
      `That PDF does not name ${row.canonicalName}, by its name, a former name or its ticker. Research reads only the company's own documents.`);
  }
  const duplicate = () => new SupplyRefused("duplicate", "That file is already supplied for this company this quarter.");
  // The same file again is refused, unless retention has emptied the text
  // the first one left: then this one takes its place, puts the text back
  // and reopens the company for pass 2 (readSupplied's own advice).
  const already = await db.get(`select s.id, d.text_content is null as emptied
       from supplied_documents s join documents d on d.content_hash = s.content_hash
      where s.company_id = ? and s.period_id = ? and s.content_hash = ? and s.withdrawn_at is null`,
    c.companyId, c.periodId, doc.contentHash) as { id: string; emptied: unknown } | undefined;
  const replaces = already && (already.emptied === true || Number(already.emptied) === 1) ? String(already.id) : null;
  if (already && !replaces) throw duplicate();

  return db.tx(async (t) => {
    if (replaces) {
      const r = await t.run(`update supplied_documents set withdrawn_at = ?, withdrawn_by = ?
          where id = ? and withdrawn_at is null`, formatStamp(now().getTime()), actor.id, replaces);
      if (r.changes !== 1) throw duplicate();
    }
    // Counted again inside the write, so two at once cannot make four.
    if (await liveCount(t, c.companyId, c.periodId) >= MAX_SUPPLIED) {
      throw new SupplyRefused("too_many",
        `${MAX_SUPPLIED} documents are already supplied for this company this quarter. Remove one first.`);
    }
    await storeDocument(t, doc);
    // One row per text, whoever brought it first. Retention empties text 90
    // days after retrieved_at, so a supply restarts that clock: an analyst who
    // supplies a file today expects it read, not emptied next week because
    // the tool fetched the same bytes in the summer.
    await t.run("update documents set retrieved_at = ? where content_hash = ?", doc.retrievedAt, doc.contentHash);
    try {
      await t.run(`insert into supplied_documents (company_id, period_id, content_hash, url, kind, filename,
                     size_bytes, page_count, supplied_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        c.companyId, c.periodId, doc.contentHash, c.url, c.kind, c.filename, c.size, doc.pageCount, actor.id);
    } catch (err) {
      // The same file supplied twice at once: the index (0041) keeps one.
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
    const r = await t.get(`select id from supplied_documents where company_id = ? and period_id = ?
        and content_hash = ? and withdrawn_at is null`, c.companyId, c.periodId, doc.contentHash) as { id: string };
    await audit(t, "document_supplied", actor, c.periodId, {
      suppliedId: r.id, companyId: c.companyId, url: c.url, kind: c.kind, filename: c.filename,
      contentHash: doc.contentHash, sizeBytes: c.size, pages: doc.pageCount, attested: ATTESTATION,
      ...(replaces ? { replaces } : {}) });
    return { id: String(r.id), contentHash: doc.contentHash, pageCount: doc.pageCount, charCount: doc.charCount };
  });
}

/**
 * Research stops reading it. Its row stays, so what was read from it still
 * says where. Findings read from it that nobody has decided on are
 * superseded: they leave review rather than wait there to be accepted from a
 * document the analyst has taken back. A decided one stays decided -- undo it
 * in review if it should go.
 */
export async function withdrawSupplied(
  db: Sql, actor: Actor, suppliedId: string, now: () => Date = () => new Date(),
): Promise<{ companyId: string; periodId: string; superseded: number }> {
  const gone = () => new SupplyRefused("gone", "That document is not supplied any more.");
  if (!isRowId(suppliedId)) throw gone();
  return db.tx(async (t) => {
    // The update decides: of two removals at once, one changes the row and
    // the other is told it has gone. It also holds the row until this
    // commits, so a pass 2 save reading it (worker.ts, persist) waits and
    // then sees it withdrawn.
    const r = await t.run(`update supplied_documents set withdrawn_at = ?, withdrawn_by = ?
        where id = ? and withdrawn_at is null`, formatStamp(now().getTime()), actor.id, suppliedId);
    if (r.changes !== 1) throw gone();
    const s = await t.get(`select id, company_id, period_id, url, content_hash from supplied_documents
        where id = ?`, suppliedId) as { id: string; company_id: string; period_id: string; url: string; content_hash: string };
    // Undecided: no decision, or only ones since undone (as review counts them, queue.ts).
    const open = await t.all(`select f.id from enrichment_findings f
        where f.supplied_document_id = ? and f.state != 'superseded'
          and not exists (select 1 from review_decisions d
                           where d.finding_id = f.id and d.decision != 'undo'
                             and not exists (select 1 from review_decisions u where u.undoes_id = d.id))`,
      s.id) as Array<{ id: string }>;
    for (const f of open) {
      await t.run("update enrichment_findings set state = 'superseded' where id = ?", f.id);
    }
    await audit(t, "document_withdrawn", actor, s.period_id, {
      suppliedId: s.id, companyId: s.company_id, url: s.url, contentHash: s.content_hash,
      supersededFindings: open.map((f) => String(f.id)) });
    return { companyId: String(s.company_id), periodId: String(s.period_id), superseded: open.length };
  });
}

export type SuppliedRow = {
  id: string; url: string; kind: string; filename: string; sizeBytes: number; pageCount: number;
  contentHash: string; suppliedAt: string; suppliedBy: string; withdrawnAt: string | null;
  /** A pass 2 job has read it (supplied_reads), whatever it found there. */
  read: boolean;
};

/** Every document supplied for the company this quarter, newest first, removed ones included. */
export async function suppliedFor(db: Sql, companyId: string, periodId: string): Promise<SuppliedRow[]> {
  const rows = await db.all(`select s.id, s.url, s.kind, s.filename, s.size_bytes, s.page_count, s.content_hash,
            s.supplied_at, s.withdrawn_at, ${personSql("u")} as supplied_by,
            exists (select 1 from supplied_reads sr where sr.supplied_id = s.id) as was_read
       from supplied_documents s left join app_users u on u.id = s.supplied_by
      where s.company_id = ? and s.period_id = ?
      order by s.supplied_at desc, s.id`, companyId, periodId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id), url: String(r.url), kind: String(r.kind), filename: String(r.filename),
    sizeBytes: Number(r.size_bytes), pageCount: Number(r.page_count), contentHash: String(r.content_hash),
    suppliedAt: String(r.supplied_at), suppliedBy: String(r.supplied_by ?? "an analyst"),
    withdrawnAt: r.withdrawn_at === null || r.withdrawn_at === undefined ? null : String(r.withdrawn_at),
    read: r.was_read === true || Number(r.was_read) === 1,
  }));
}
