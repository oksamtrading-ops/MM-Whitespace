import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Sql } from "../db/sql.ts";
import { extractPdf } from "../enrich/pdf.ts";
import type { Extracted } from "../enrich/fetch.ts";
import type { PdfLimits } from "../enrich/pdf.ts";
import { seedFixtureDatabase } from "../../../tests/cassettes/build_cassettes.mjs";
import { makePdf } from "../../../tests/fixtures/make_pdf.mjs";
import {
  addChunk, ATTESTATION, beginUpload, CHUNK_BYTES, checkSourceUrl, EXTRACT_TIMEOUT_MS, finishUpload, MAX_OPEN_BYTES,
  MAX_SUPPLIED, suppliedFor, SupplyRefused, supplyWhole, sweepUploads, withdrawSupplied,
} from "./supply.ts";

type Seeded = { db: Sql; periodId: string; companies: Array<{ id: string; name: string; ticker: string }> };

async function setup(website: string | null = "https://www.northco.example") {
  const s = seedFixtureDatabase() as Seeded;
  const company = s.companies[0];
  if (website) {
    await s.db.run(`insert into company_period_field_values (period_id, company_id, field_key, value, source, evidence_state)
       values (?, ?, 'website', ?, 'extract', 'asserted')`, s.periodId, company.id, JSON.stringify(website));
  }
  await s.db.run("insert into app_users (email, role, first_name, last_name) values (?, 'analyst', 'Ana', 'Lyst')", "ana@example.invalid");
  await s.db.run("insert into app_users (email, role, first_name, last_name) values (?, 'analyst', 'Other', 'Person')", "other@example.invalid");
  const ana = { id: String((await s.db.get("select id from app_users where email = 'ana@example.invalid'") as { id: string }).id) };
  const other = { id: String((await s.db.get("select id from app_users where email = 'other@example.invalid'") as { id: string }).id) };
  return { ...s, company, ana, other };
}

const FILING = (name: string) => makePdf([
  `${name}\nManagement's Discussion and Analysis\nFor the six months ended June 30, 2026`,
  `${name} is an exploration-stage mining company with no producing properties.\nThe registered head office is in Toronto, Ontario.`,
]) as Uint8Array;

type Extract = (b: Uint8Array, limits?: PdfLimits) => Promise<Extracted>;

/**
 * Send a file the way the browser does: in one request when it fits, else
 * piece by piece. `pieces` sends even a small one in pieces.
 */
async function supply(db: Sql, actor: { id: string }, companyId: string, periodId: string, bytes: Uint8Array,
  opts: { url?: string; kind?: string; extract?: Extract; pieces?: boolean } = {}) {
  const input = {
    companyId, periodId, url: opts.url ?? "https://www.northco.example/wp-content/uploads/2026/08/Q2-MDA.pdf",
    kind: opts.kind ?? "interim_report", filename: "Q2-MDA.pdf", sizeBytes: bytes.byteLength, attested: true };
  const deps = { extractPdf: opts.extract ?? extractPdf };
  if (bytes.byteLength <= CHUNK_BYTES && !opts.pieces) return supplyWhole(db, actor, input, bytes, deps);
  const { uploadId, chunkCount } = await beginUpload(db, actor, input);
  for (let i = 0; i < chunkCount; i++) {
    await addChunk(db, actor, uploadId, i, bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
  }
  return finishUpload(db, actor, uploadId, deps);
}

const count = async (db: Sql, sql: string, ...args: unknown[]) => Number((await db.get(sql, ...args) as { n: number }).n);

const refusedWith = (code: string) => (e: unknown) => e instanceof SupplyRefused && e.code === code;

test("a supplied PDF is stored as a fetched copy of the same file would be: same hash, text only", async () => {
  const { db, periodId, company, ana } = await setup();
  const bytes = FILING(company.name);
  const out = await supply(db, ana, company.id, periodId, bytes);

  // fetch.ts keys a document by its bytes and the reader: a fetch of this
  // file would land on this row, not beside it.
  const expected = "sha256:" + createHash("sha256").update(bytes).update("\0unpdf@1.8.1").digest("hex");
  assert.equal(out.contentHash, expected);
  const doc = await db.get("select url, final_url, source_tier, doc_type, has_text_layer, text_content from documents where content_hash = ?",
    expected) as Record<string, unknown>;
  assert.equal(doc.url, "https://www.northco.example/wp-content/uploads/2026/08/Q2-MDA.pdf");
  // Stored as a fetch from that address would be: the supplied tier is applied
  // where pass 2 reads it as supplied (live.test.ts), not to the text itself,
  // which a later fetch of the same bytes shares.
  assert.equal(Number(doc.source_tier), 2);
  assert.equal(doc.doc_type, "pdf");
  assert.match(String(doc.text_content), /exploration-stage mining company/);

  const rows = await suppliedFor(db, company.id, periodId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].suppliedBy, "Ana Lyst");
  assert.equal(rows[0].kind, "interim_report");
  assert.equal(rows[0].pageCount, 2);
  assert.equal(rows[0].read, false);

  // A file that fits one request never touches the upload tables, and the
  // supply is audited with what was read and what the analyst affirmed.
  assert.equal(await count(db, "select count(*) n from document_uploads"), 0);
  assert.equal(await count(db, "select count(*) n from audit_log where event = 'document_upload_started'"), 0);
  const audit = JSON.parse((await db.get("select detail from audit_log where event = 'document_supplied'") as { detail: string }).detail);
  assert.equal(audit.contentHash, expected);
  assert.equal(audit.pages, 2);
  assert.equal(audit.attested, ATTESTATION);
});

test("a supply restarts the retention clock of text the tool fetched long ago", async () => {
  const { db, periodId, company, ana } = await setup();
  const bytes = FILING(company.name);
  const hash = "sha256:" + createHash("sha256").update(bytes).update("\0unpdf@1.8.1").digest("hex");
  await db.run(`insert into documents (content_hash, url, final_url, retrieved_at, extractor, extractor_version,
       normalization_version, text_content, char_count, page_count, chars_per_page, source_tier, doc_type, has_text_layer)
     values (?, 'https://www.northco.example/old.pdf', 'https://www.northco.example/old.pdf', '2026-08-10T00:00:00.000Z',
       'unpdf', '1.8.1', '1', ?, 10, 2, 5, 2, 'pdf', 1)`, hash, `${company.name} exploration-stage`);
  await supply(db, ana, company.id, periodId, bytes, { extract: async () => ({
    text: `${company.name} is an exploration-stage company.\n`.repeat(40), pageCount: 2, extractor: "unpdf", extractorVersion: "1.8.1" }) });
  const doc = await db.get("select url, retrieved_at from documents where content_hash = ?", hash) as { url: string; retrieved_at: string };
  assert.equal(doc.url, "https://www.northco.example/old.pdf", "one row per text, the first copy's");
  assert.ok(String(doc.retrieved_at) > "2026-11-01", `retrieved_at restarted: ${doc.retrieved_at}`);
});

test("a file over Vercel's request limit arrives in pieces, is read under the page and time limits, and is put back together exactly", async () => {
  const { db, periodId, company, ana } = await setup();
  // 7.3 MB, GR Silver's MD&A's size: three pieces.
  const big = new Uint8Array(7_261_588);
  big.set(new TextEncoder().encode("%PDF-1.7\n"));
  for (let i = 9; i < big.length; i++) big[i] = (i * 31) & 0xff;
  let seen: Uint8Array | null = null;
  let told: PdfLimits | undefined;
  const extract = async (b: Uint8Array, limits?: PdfLimits): Promise<Extracted> => {
    seen = b; told = limits;
    return { text: `${company.name}\n`.repeat(400), pageCount: 31, extractor: "unpdf", extractorVersion: "1.8.1" };
  };
  const out = await supply(db, ana, company.id, periodId, big, { extract });
  assert.ok(seen);
  assert.equal(Buffer.compare(Buffer.from(seen!), Buffer.from(big)), 0, "the bytes read are the bytes sent");
  assert.deepEqual(told, { maxPages: 400, timeoutMs: EXTRACT_TIMEOUT_MS });
  assert.equal(out.contentHash, "sha256:" + createHash("sha256").update(big).update("\0unpdf@1.8.1").digest("hex"));
  assert.equal(await count(db, "select count(*) n from document_upload_chunks"), 0, "the pieces are gone");
  const started = JSON.parse((await db.get("select detail from audit_log where event = 'document_upload_started'") as { detail: string }).detail);
  assert.equal(started.sizeBytes, 7_261_588);
  assert.equal(started.chunkCount, 3);
});

test("the address must be on the company's own website, over http(s): not the IR platform, never SEDAR+", () => {
  const site = "https://www.northco.example";
  assert.equal(checkSourceUrl(" https://northco.example/files/q2.pdf#page=3 ", site), "https://northco.example/files/q2.pdf");
  assert.equal(checkSourceUrl("https://ir.northco.example/q2.pdf", site), "https://ir.northco.example/q2.pdf");
  // q4cdn.com serves every issuer's documents: an address there says nothing about whose a file is.
  assert.throws(() => checkSourceUrl("https://s21.q4cdn.com/123/files/q2.pdf", site), refusedWith("url_off_site"));
  assert.throws(() => checkSourceUrl("https://www.sedarplus.ca/filings/x.pdf", site), refusedWith("url_excluded"));
  assert.throws(() => checkSourceUrl("javascript:alert(1)", site), refusedWith("url_scheme"));
  assert.throws(() => checkSourceUrl("data:application/pdf;base64,JVBERi0=", site), refusedWith("url_scheme"));
  assert.throws(() => checkSourceUrl("https://northco.example.evil.test/q2.pdf", site), refusedWith("url_off_site"));
  assert.throws(() => checkSourceUrl("https://notnorthco.example/q2.pdf", site), refusedWith("url_off_site"));
  assert.throws(() => checkSourceUrl("https://user:pw@northco.example/q2.pdf", site), refusedWith("url_credentials"));
  assert.throws(() => checkSourceUrl("not a url", site), refusedWith("url_malformed"));
  assert.throws(() => checkSourceUrl("https://northco.example/q2.pdf", null), refusedWith("no_website"));
});

test("an upload is refused before a byte arrives when the company has no trusted website", async () => {
  const { db, periodId, company, ana } = await setup(null);
  await assert.rejects(() => supply(db, ana, company.id, periodId, FILING(company.name)), refusedWith("no_website"));
});

test("what the bytes are decides, never the name: a page saved as .pdf is refused, audited, and never stored", async () => {
  const { db, periodId, company, ana } = await setup();
  const page = new TextEncoder().encode(`<!doctype html><html><body>${company.name} investors</body></html>`);
  await assert.rejects(() => supply(db, ana, company.id, periodId, page), refusedWith("type_confusion"));
  const audit = JSON.parse((await db.get("select detail from audit_log where event = 'document_refused'") as { detail: string }).detail);
  assert.equal(audit.reason, "type_confusion");
  assert.equal(audit.companyId, company.id);
  assert.equal(await count(db, "select count(*) n from documents"), 0);

  // In pieces, the first piece is looked at before it is kept: a workbook
  // picked by mistake never reaches the database.
  const workbook = new Uint8Array(CHUNK_BYTES + 10);
  workbook.set([0x50, 0x4b, 0x03, 0x04]);
  await assert.rejects(() => supply(db, ana, company.id, periodId, workbook), refusedWith("type_confusion"));
  assert.equal(await count(db, "select count(*) n from document_upload_chunks"), 0);
  assert.equal(await count(db, "select count(*) n from document_uploads"), 0);
  assert.equal(await count(db, "select count(*) n from audit_log where event = 'document_refused'"), 2);
});

test("a scan, another company's filing and a PDF over the page cap are refused", async () => {
  const { db, periodId, company, ana } = await setup();
  const scan = async (): Promise<Extracted> => ({ text: "  ", pageCount: 12, extractor: "unpdf", extractorVersion: "1.8.1" });
  await assert.rejects(() => supply(db, ana, company.id, periodId, FILING(company.name), { extract: scan }), refusedWith("no_text_layer"));
  await assert.rejects(() => supply(db, ana, company.id, periodId, FILING("Southco Gold Ltd.")), refusedWith("names_someone_else"));
  // Refused once it is opened, before a page of it is read (pdf.ts).
  const long = makePdf(Array.from({ length: 401 }, () => company.name)) as Uint8Array;
  await assert.rejects(() => supply(db, ana, company.id, periodId, long), refusedWith("too_many_pages"));
  assert.equal((await suppliedFor(db, company.id, periodId)).length, 0);
});

test("at most three documents a quarter, never the same file twice; a removed one makes room", async () => {
  const { db, periodId, company, ana } = await setup();
  const first = await supply(db, ana, company.id, periodId, FILING(company.name));
  await assert.rejects(() => supply(db, ana, company.id, periodId, FILING(company.name)), refusedWith("duplicate"));
  for (let i = 1; i < MAX_SUPPLIED; i++) {
    await supply(db, ana, company.id, periodId, makePdf([`${company.name}\nPage ${i} of something else entirely.\n`.repeat(12)]) as Uint8Array);
  }
  await assert.rejects(() => supply(db, ana, company.id, periodId, makePdf([`${company.name}\nOne more.\n`.repeat(12)]) as Uint8Array),
    refusedWith("too_many"));

  const out = await withdrawSupplied(db, ana, first.id);
  assert.equal(out.superseded, 0);
  await supply(db, ana, company.id, periodId, makePdf([`${company.name}\nOne more.\n`.repeat(12)]) as Uint8Array);
  const rows = await suppliedFor(db, company.id, periodId);
  assert.equal(rows.length, MAX_SUPPLIED + 1, "a removed document is still listed");
  assert.equal(rows.filter((r) => r.withdrawnAt === null).length, MAX_SUPPLIED);
  assert.ok(await db.get("select 1 from audit_log where event = 'document_withdrawn'"));
  await assert.rejects(() => withdrawSupplied(db, ana, first.id), refusedWith("gone"));
  await assert.rejects(() => withdrawSupplied(db, ana, "not-an-id"), refusedWith("gone"));
});

test("the same file again replaces the first when retention has emptied its text, and reopens the company", async () => {
  const { db, periodId, company, ana } = await setup();
  const first = await supply(db, ana, company.id, periodId, FILING(company.name));
  await db.run("update documents set text_content = null where content_hash = ?", first.contentHash);
  const again = await supply(db, ana, company.id, periodId, FILING(company.name));
  assert.notEqual(again.id, first.id);
  assert.match(String((await db.get("select text_content from documents where content_hash = ?", first.contentHash) as
    { text_content: string }).text_content), /exploration-stage/);
  const rows = await suppliedFor(db, company.id, periodId);
  assert.deepEqual(rows.filter((r) => r.withdrawnAt === null).map((r) => r.id), [again.id]);
  const audit = JSON.parse((await db.get("select detail from audit_log where event = 'document_supplied' order by rowid desc limit 1") as
    { detail: string }).detail);
  assert.equal(audit.replaces, first.id);
});

test("a document is supplied only for the current quarter, and malformed ids are refused and audited", async () => {
  const { db, periodId, company, ana } = await setup();
  const bytes = FILING(company.name);
  const input = { companyId: company.id, periodId, url: "https://northco.example/q2.pdf", kind: "interim_report",
    filename: "q2\u0000.pdf", sizeBytes: bytes.byteLength, attested: true };
  // A newer quarter makes this one past.
  await db.run("insert into periods (label, market_cap_as_of) values ('Next', '2099-01-01')");
  await assert.rejects(() => supplyWhole(db, ana, input, bytes, { extractPdf }), refusedWith("no_period"));
  await assert.rejects(() => supplyWhole(db, ana, { ...input, companyId: "x' or 1=1" }, bytes, { extractPdf }), refusedWith("no_company"));
  await assert.rejects(() => beginUpload(db, ana, { ...input, periodId: "not-a-uuid", filename: "y".repeat(5000) }), refusedWith("no_period"));
  const refusals = (await db.all("select detail, period_id from audit_log where event = 'document_refused'") as
    Array<{ detail: string; period_id: string | null }>);
  assert.equal(refusals.length, 3);
  const last = JSON.parse(refusals[2].detail);
  assert.equal(last.filename.length, 255, "what is declared is capped in the audit log");
  assert.equal(refusals[2].period_id, null);
  assert.ok(!JSON.parse(refusals[0].detail).filename.includes("\u0000"));
});

test("a removal is undone by nothing, and an undone decision leaves its finding to be superseded", async () => {
  const { db, periodId, company, ana } = await setup();
  const s = await supply(db, ana, company.id, periodId, FILING(company.name));
  // A finding read from it, accepted and then undone: undecided again.
  const run = await db.get(`insert into enrichment_runs (period_id, budget_usd, model, prompt_version, mode)
      values (?, 5, 'test-model', 'test', 'replay') returning id`, periodId) as { id: string };
  const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
      values (?, ?, 'general', 'completed') returning id`, run.id, company.id) as { id: string };
  const f = await db.get(`insert into enrichment_findings (run_id, job_id, attempt, company_id, field_key, proposed_value,
        evidence_strength, anchor_mode, state, model, prompt_version, supplied_document_id)
      values (?, ?, 1, ?, 'auditor', '"KPMG LLP"', 0.5, 'exact_normalized', 'proposed', 'test-model', 'test', ?) returning id`,
    run.id, job.id, company.id, s.id) as { id: string };
  const d = await db.get(`insert into review_decisions (period_id, company_id, field_key, decision, finding_id, actor_id)
      values (?, ?, 'auditor', 'accept', ?, ?) returning id`, periodId, company.id, f.id, ana.id) as { id: string };
  await db.run(`insert into review_decisions (period_id, company_id, field_key, decision, undoes_id, actor_id)
      values (?, ?, 'auditor', 'undo', ?, ?)`, periodId, company.id, d.id, ana.id);
  const out = await withdrawSupplied(db, ana, s.id);
  assert.equal(out.superseded, 1);
  assert.equal((await db.get("select state from enrichment_findings where id = ?", f.id) as { state: string }).state, "superseded");
  await assert.rejects(() => withdrawSupplied(db, ana, s.id), refusedWith("gone"));
  assert.equal(await count(db, "select count(*) n from audit_log where event = 'document_withdrawn'"), 1);
});

test("an upload is its owner's alone, its pieces arrive in order and the declared size, and one is open at a time", async () => {
  const { db, periodId, company, ana, other } = await setup();
  const bytes = FILING(company.name);
  const input = { companyId: company.id, periodId, url: "https://northco.example/q2.pdf", kind: "interim_report",
    filename: "q2.pdf", sizeBytes: bytes.byteLength, attested: true };
  const { uploadId } = await beginUpload(db, ana, input);

  await assert.rejects(() => addChunk(db, other, uploadId, 0, bytes), refusedWith("upload_gone"));
  await assert.rejects(() => finishUpload(db, other, uploadId, { extractPdf }), refusedWith("upload_gone"));
  await assert.rejects(() => addChunk(db, ana, uploadId, 1, bytes), refusedWith("chunk_index"));
  await assert.rejects(() => addChunk(db, ana, "../../etc", 0, bytes), refusedWith("upload_gone"));
  // Each refusal is in the audit log; another person's attempt names only the upload.
  const refusals = (await db.all("select detail from audit_log where event = 'document_refused'") as Array<{ detail: string }>)
    .map((r) => JSON.parse(r.detail));
  assert.deepEqual(refusals.map((r) => r.reason), ["upload_gone", "upload_gone", "chunk_index", "upload_gone"]);
  assert.equal(refusals[0].companyId, undefined);
  assert.equal(refusals[2].companyId, company.id);

  // A piece out of order ends the upload, as a wrong-sized one does.
  await assert.rejects(() => finishUpload(db, ana, uploadId, { extractPdf }), refusedWith("upload_gone"));
  // So does a piece past the last: it would sit outside the cap on open bytes.
  const past = await beginUpload(db, ana, input);
  await addChunk(db, ana, past.uploadId, 0, bytes);
  await assert.rejects(() => addChunk(db, ana, past.uploadId, 1, bytes), refusedWith("chunk_index"));
  assert.equal(await count(db, "select count(*) n from document_upload_chunks"), 0);
  // A wrong-sized piece ends the upload.
  const second = await beginUpload(db, ana, input);
  await assert.rejects(() => addChunk(db, ana, second.uploadId, 0, bytes.subarray(1)), refusedWith("chunk_size"));
  await assert.rejects(() => addChunk(db, ana, second.uploadId, 0, bytes), refusedWith("upload_gone"));

  // Beginning another drops the one before: one open upload each.
  const third = await beginUpload(db, ana, input);
  await addChunk(db, ana, third.uploadId, 0, bytes);
  const fourth = await beginUpload(db, ana, input);
  await assert.rejects(() => finishUpload(db, ana, third.uploadId, { extractPdf }), refusedWith("upload_gone"));
  assert.equal(await count(db, "select count(*) n from document_upload_chunks"), 0);

  // One left past its hour is gone at the next upload request, anyone's.
  await addChunk(db, ana, fourth.uploadId, 0, bytes);
  assert.deepEqual(await sweepUploads(db, Date.now(), { dryRun: true }), { examined: 0, deleted: 0 });
  const later = () => new Date(Date.now() + 61 * 60 * 1000);
  await beginUpload(db, other, input, later);
  assert.equal(await count(db, "select count(*) n from document_uploads where id = ?", fourth.uploadId), 0);
  assert.equal(await count(db, "select count(*) n from document_upload_chunks"), 0);
});

test("all open uploads together are capped, whoever began them", async () => {
  const { db, periodId, company, ana, other } = await setup();
  const big = { companyId: company.id, periodId, url: "https://northco.example/q2.pdf", kind: "interim_report",
    filename: "q2.pdf", sizeBytes: 25 * 1024 * 1024, attested: true };
  const users = [ana, other];
  for (let i = 2; users.length * big.sizeBytes <= MAX_OPEN_BYTES; i++) {
    await db.run("insert into app_users (email, role, first_name, last_name) values (?, 'analyst', 'U', ?)", `u${i}@example.invalid`, String(i));
    users.push({ id: String((await db.get("select id from app_users where email = ?", `u${i}@example.invalid`) as { id: string }).id) });
  }
  for (const u of users.slice(0, -1)) await beginUpload(db, u, big);
  await assert.rejects(() => beginUpload(db, users.at(-1)!, big), refusedWith("busy"));
});

test("what is declared is checked up front, and the analyst must say the file was public", async () => {
  const { db, periodId, company, ana } = await setup();
  const base = { companyId: company.id, periodId, url: "https://northco.example/q2.pdf", kind: "interim_report",
    filename: "q2.pdf", attested: true };
  await assert.rejects(() => beginUpload(db, ana, { ...base, sizeBytes: 0 }), refusedWith("empty"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, sizeBytes: 26 * 1024 * 1024 }), refusedWith("too_large"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, kind: "sec_annual_report", sizeBytes: 10 }), refusedWith("kind"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, companyId: "nope", sizeBytes: 10 }), refusedWith("no_company"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, periodId: "nope", sizeBytes: 10 }), refusedWith("no_period"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, attested: false, sizeBytes: 10 }), refusedWith("not_attested"));
  const bytes = FILING(company.name);
  await assert.rejects(() => supplyWhole(db, ana, { ...base, sizeBytes: bytes.byteLength, attested: false }, bytes, { extractPdf }),
    refusedWith("not_attested"));
  await assert.rejects(() => supplyWhole(db, ana, { ...base, sizeBytes: bytes.byteLength + 1 }, bytes, { extractPdf }),
    refusedWith("incomplete"));
  await assert.rejects(() => beginUpload(db, ana, { ...base, url: "https://www.sedarplus.ca/x.pdf", sizeBytes: 10 }),
    refusedWith("url_excluded"));
  const reasons = (await db.all("select period_id, detail from audit_log where event = 'document_refused'") as
    Array<{ period_id: string | null; detail: string }>);
  assert.deepEqual(reasons.map((r) => JSON.parse(r.detail).reason),
    ["empty", "too_large", "kind", "no_company", "no_period", "not_attested", "not_attested", "incomplete", "url_excluded"]);
  assert.equal(reasons[4].period_id, null, "a quarter that is not in the database is not the audit row's quarter");
  assert.equal(JSON.parse(reasons.at(-1)!.detail).url, "https://www.sedarplus.ca/x.pdf");
});
