import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { memorySql } from "../db/open.ts";
import type { Sql } from "../db/sql.ts";
import { recordDecision } from "./decide.ts";
import { fieldRows, olderFilingNote, OLDER_FILING, queueBuckets, SUPERSEDED } from "./queue.ts";
import { storeDocument } from "../enrich/worker.ts";
import { backfillReportsOn, REPORTS_ON_VERSION } from "../enrich/reportson.ts";

/*
 * China Gold, 13 to 18 October 2026. Its auditor change and tenure were
 * accepted on 13 September from the 2026 circular (it reports on 2025). A
 * re-run on 13 October read the 2022 circular (it reports on 2021) and
 * proposed "no change, since 2010". Being the newer FINDING, it was offered on
 * Newer research, taken on 18 October, and published in revisions 10 and 11.
 */
const CIRCULAR_2026 = "NOTICE AND INFORMATION CIRCULAR 2026. On June 26, 2025, Deloitte Touche Tohmatsu " +
  "retired as auditor of the Company following the conclusion of the Company's annual general meeting, " +
  "and BDO Limited was appointed. BDO was appointed following the completion of the audit of the " +
  "Company's financial statements for the year ended December 31, 2025.";
const CIRCULAR_2022 = "Shareholders will be requested to appoint Deloitte Touche Tohmatsu as auditors. The " +
  "annual report for the year ended December 31, 2021 is filed on www.sedar.com. Deloitte Touche " +
  "Tohmatsu was first appointed as auditors of the Company on April 1, 2010.";
const AIF_2027 = "Annual Information Form for the year ended December 31, 2026. Lixin & Ethos CPA LLP has " +
  "been the auditor of the Company for Canadian reporting purposes since February 26, 2026.";
const NO_YEAR = "Appointment of Auditors. BDO Limited is the auditor of the Company.";

async function china() {
  const db = memorySql();
  await db.run("insert into periods (label, market_cap_as_of) values ('Q3-2026', '2026-05-31')");
  const periodId = (await db.get("select id from periods") as { id: string }).id;
  await db.run("insert into companies (canonical_name, name_normalized) values ('China Gold International Resources Corp. Ltd.', 'china gold')");
  const companyId = (await db.get("select id from companies") as { id: string }).id;

  /** A document stored the way the live fetcher stores one. */
  const doc = async (url: string, text: string, retrievedAt: string) => storeDocument(db, {
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    url, finalUrl: url, retrievedAt, extractor: "pdf", extractorVersion: "1", normalizationVersion: "1",
    text, charCount: text.length, pageCount: 1, charsPerPage: text.length,
    sourceTier: 2, docType: "pdf", hasTextLayer: true,
  } as Parameters<typeof storeDocument>[1]);

  /** A finding anchored to a document, written at a time the test chooses. */
  const finding = async (fieldKey: string, value: unknown, documentHash: string, at: string, strength = 0.71) => {
    const run = await db.get(`insert into enrichment_runs (period_id, scope, status, budget_usd, mode, model, prompt_version, created_at)
        values (?, 'all', 'completed', 5, 'live', 'm', '1', ?) returning id`, periodId, at) as { id: string };
    const job = await db.get(`insert into enrichment_jobs (run_id, company_id, field_group, state)
        values (?, ?, 'general', 'completed') returning id`, run.id, companyId) as { id: string };
    const row = await db.get(`insert into enrichment_findings
        (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength, anchor_mode,
         anchor_document_hash, state, evidence_excerpt, model, prompt_version, created_at)
        values (?, ?, 1, ?, ?, ?, ?, 'exact_normalized', ?, 'proposed', 'the passage', 'm', '1', ?)
        returning id`, run.id, job.id, companyId, fieldKey, JSON.stringify(value), strength, documentHash, at) as { id: string };
    await db.run("insert into finding_sources (finding_id, url, content_hash, source_tier) values (?, 'https://chinagoldintl.invalid', ?, 2)",
                 row.id, documentHash);
    return row.id;
  };

  /** Accepted on 13 September, as it was. */
  const accept = async (fieldKey: string, findingId: string) => {
    await recordDecision(db, { periodId, companyId, fieldKey, decision: "accept", findingId, actorId: null });
    await db.run("update review_decisions set decided_at = '2026-09-13 01:00:00' where finding_id = ?", findingId);
  };
  /** Flagged that morning, as the stale fee tables were on 21 October. */
  const flag = async (fieldKey: string, findingId: string, reason: string) => {
    await recordDecision(db, { periodId, companyId, fieldKey, decision: "flag", findingId, actorId: null, reason });
    await db.run("update review_decisions set decided_at = '2026-10-21 11:00:00' where finding_id = ?", findingId);
  };
  return { db, periodId, companyId, doc, finding, accept, flag };
}

const changed = { changed: true, date: "2025-06-26", previous_auditor: "Deloitte Touche Tohmatsu" };
const unchanged = { changed: false, date: null, previous_auditor: null };

test("CHINA GOLD: a re-run that read the 2022 circular is not offered against the 2026 one", async () => {
  const { db, periodId, doc, finding, accept } = await china();
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-09-13 00:30:00");
  const stale = await doc("https://chinagoldintl.invalid/circular-2022.pdf", CIRCULAR_2022, "2026-10-13 10:00:00");
  // Stronger evidence on the accepted one, as on 13 September: without its own
  // place in the pick, the row would show the accepted finding and the older
  // filing's would be on no tab at all.
  await accept("auditor_change", await finding("auditor_change", changed, current, "2026-09-13 00:40:00", 0.88));
  const later = await finding("auditor_change", unchanged, stale, "2026-10-13 10:05:00");

  assert.deepEqual(await fieldRows(db, periodId, "auditor_change", SUPERSEDED), [],
                   "a finding from an older filing is not newer research, however recently it was made");
  const [row] = await fieldRows(db, periodId, "auditor_change", OLDER_FILING);
  assert.equal(row.findingId, later, "it is shown, on its own tab, not dropped");
  assert.equal(row.decided, true);
  assert.equal(row.newerThanDecision, false, "so the grid draws no 'Take the newer research' for it");
  assert.equal(row.fromOlderFiling, true);
  assert.deepEqual([row.reportsOn, row.acceptedReportsOn], [2021, 2025]);
  assert.match(olderFilingNote(row)!, /reports on 2021[\s\S]*reports on 2025/);

  // The accepted value stands, and the board counts it where it belongs.
  const value = await db.get(`select value from company_period_field_values
      where period_id = ? and field_key = 'auditor_change'`, periodId) as { value: string };
  assert.deepEqual(JSON.parse(value.value), changed);
  const buckets = await queueBuckets(db, periodId);
  assert.equal(buckets.find((b) => b.key === SUPERSEDED)?.count, 0);
  assert.equal(buckets.find((b) => b.key === OLDER_FILING)?.count, 1);
});

test("a re-run that read a NEWER filing is still newer research", async () => {
  const { db, periodId, doc, finding, accept } = await china();
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-09-13 00:30:00");
  const newer = await doc("https://chinagoldintl.invalid/aif-2026.pdf", AIF_2027, "2026-10-13 10:00:00");
  await accept("auditor_since", await finding("auditor_since", 2025, current, "2026-09-13 00:40:00"));
  const later = await finding("auditor_since", 2026, newer, "2026-10-13 10:05:00");

  const [row] = await fieldRows(db, periodId, "auditor_since", SUPERSEDED);
  assert.equal(row.findingId, later);
  assert.equal(row.newerThanDecision, true);
  assert.equal(row.fromOlderFiling, false);
  assert.deepEqual(await fieldRows(db, periodId, "auditor_since", OLDER_FILING), []);
});

test("a filing reporting on the same year is not older: only an earlier year demotes", async () => {
  const { db, periodId, doc, finding, accept } = await china();
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-09-13 00:30:00");
  const sameYear = await doc("https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex99.htm",
    "Annual report on Form 40-F for the fiscal year ended December 31, 2025.", "2026-10-13 10:00:00");
  await accept("auditor_change", await finding("auditor_change", changed, current, "2026-09-13 00:40:00"));
  await finding("auditor_change", unchanged, sameYear, "2026-10-13 10:05:00");
  assert.equal((await fieldRows(db, periodId, "auditor_change", SUPERSEDED)).length, 1);
});

test("A DOCUMENT THAT NEVER SAYS DEMOTES NOTHING: unknown is not older", async () => {
  // Either side unknown leaves the row exactly as it was before the year was
  // read. A wrong demotion would hide a real correction; a missing one only
  // asks a reviewer to look, as every row on that tab always has.
  const { db, periodId, doc, finding, accept } = await china();
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-09-13 00:30:00");
  const silent = await doc("https://chinagoldintl.invalid/notice.pdf", NO_YEAR, "2026-10-13 10:00:00");
  await accept("auditor_change", await finding("auditor_change", changed, current, "2026-09-13 00:40:00"));
  await finding("auditor_change", unchanged, silent, "2026-10-13 10:05:00");
  const [row] = await fieldRows(db, periodId, "auditor_change", SUPERSEDED);
  assert.equal(row.newerThanDecision, true);
  assert.deepEqual([row.reportsOn, row.acceptedReportsOn], [null, 2025]);
});

test("a document stored before 0035 is read by the backfill, once", async () => {
  const db: Sql = memorySql();
  // As the stored rows were on 20 October 2026: text, and no year read.
  await db.run(`insert into documents (content_hash, url, retrieved_at, extractor, extractor_version,
      normalization_version, text_content, char_count, page_count, chars_per_page, source_tier, has_text_layer)
      values ('sha256:old', 'https://chinagoldintl.invalid/circular-2022.pdf', '2026-10-13 10:00:00',
              'pdf', '1', '1', ?, 10, 1, 10, 2, 1)`, CIRCULAR_2022);
  await db.run(`insert into documents (content_hash, url, retrieved_at, extractor, extractor_version,
      normalization_version, text_content, char_count, page_count, chars_per_page, source_tier, has_text_layer)
      values ('sha256:json', 'https://data.sec.gov/submissions/CIK1.json', '2026-10-13 10:00:00',
              'json', '1', '1', '{"cik":"1"}', 10, 1, 10, 3, 1)`);

  assert.deepEqual(await backfillReportsOn(db, 1), { read: 2, dated: 1 }, "a page at a time, every row read");
  const rows = await db.all("select content_hash, reports_on, reports_on_version from documents order by content_hash") as
    Array<{ content_hash: string; reports_on: number | null; reports_on_version: string }>;
  assert.deepEqual(rows.map((r) => [r.content_hash, r.reports_on, r.reports_on_version]),
                   [["sha256:json", null, REPORTS_ON_VERSION], ["sha256:old", 2021, REPORTS_ON_VERSION]]);
  assert.deepEqual(await backfillReportsOn(db), { read: 0, dated: 0 },
                   "a document that says no year is recorded as read, not read again");
});

test("the fetcher stores the year with the document", async () => {
  const { db, doc } = await china();
  const hash = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-09-13 00:30:00");
  const row = await db.get("select reports_on, reports_on_version from documents where content_hash = ?", hash) as
    { reports_on: number; reports_on_version: string };
  assert.deepEqual([row.reports_on, row.reports_on_version], [2025, REPORTS_ON_VERSION]);
});

/*
 * Entree and Marimaca, 21 October 2026. Their FY2022 and FY2023 fee tables were
 * flagged as stale in the morning; the afternoon's run found the FY2025 ones.
 * Only an accept could be overtaken by newer research, so the flagged rows
 * kept no controls on either screen and the FY2025 fees could not be taken.
 */
const STALE = "Stale: FY2021 fee table, two or more fiscal years before the latest; not current, so not accepted.";
const fee = (amount: number, fiscal_year: number) => ({ amount, currency: "USD", fiscal_year });

test("ENTREE: a flagged stale value is offered research from a LATER filing, and taking it stores it", async () => {
  const { db, periodId, companyId, doc, finding, flag } = await china();
  const old = await doc("https://chinagoldintl.invalid/circular-2022.pdf", CIRCULAR_2022, "2026-10-20 23:00:00");
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-10-21 15:00:00");
  await flag("audit_fee", await finding("audit_fee", fee(36936, 2021), old, "2026-10-20 23:55:00"), STALE);
  const later = await finding("audit_fee", fee(54314, 2025), current, "2026-10-21 15:33:00");

  const [row] = await fieldRows(db, periodId, "audit_fee", SUPERSEDED);
  assert.equal(row.findingId, later, "the later filing's value is on Newer research");
  assert.equal(row.decision, "flag");
  assert.equal(row.newerThanDecision, true, "so the grid draws 'Take the newer research' for it");
  assert.deepEqual([row.reportsOn, row.acceptedReportsOn], [2025, 2021]);
  assert.equal((await queueBuckets(db, periodId)).find((b) => b.key === SUPERSEDED)?.count, 1);

  await recordDecision(db, { periodId, companyId, fieldKey: "audit_fee", decision: "accept",
                             findingId: later, actorId: null });
  const value = await db.get(`select value from company_period_field_values
      where period_id = ? and field_key = 'audit_fee'`, periodId) as { value: string };
  assert.deepEqual(JSON.parse(value.value), fee(54314, 2025));
  assert.deepEqual(await fieldRows(db, periodId, "audit_fee", SUPERSEDED), [], "once taken it stops asking");
});

test("a flagged value found again from the same year, an earlier one or an undated one is not offered", async () => {
  // Titan, Torex, Liberty and GoGold, 21 October: 13 fee tables flagged as
  // stale that morning were re-found from the same years that afternoon.
  const { db, periodId, doc, finding, flag } = await china();
  const current = await doc("https://chinagoldintl.invalid/circular-2026.pdf", CIRCULAR_2026, "2026-10-20 23:00:00");
  const sameYear = await doc("https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex99.htm",
    "Annual report on Form 40-F for the fiscal year ended December 31, 2025.", "2026-10-21 15:00:00");
  const earlier = await doc("https://chinagoldintl.invalid/circular-2022.pdf", CIRCULAR_2022, "2026-10-21 15:00:00");
  const silent = await doc("https://chinagoldintl.invalid/notice.pdf", NO_YEAR, "2026-10-21 15:00:00");
  const reason = "Wrong company: the quote is the parent's fee table.";

  for (const [fieldKey, later] of [["audit_fee", sameYear], ["tax_fee", earlier], ["other_fee", silent]] as const) {
    await flag(fieldKey, await finding(fieldKey, fee(1000, 2025), current, "2026-10-20 23:55:00"), reason);
    await finding(fieldKey, fee(2000, 2025), later, "2026-10-21 15:33:00");
    assert.deepEqual(await fieldRows(db, periodId, fieldKey, SUPERSEDED), [], `${fieldKey}: not newer research`);
    assert.deepEqual(await fieldRows(db, periodId, fieldKey, OLDER_FILING), [],
                     `${fieldKey}: nor an older filing -- nothing was accepted for it to be older than`);
    const [row] = await fieldRows(db, periodId, fieldKey, "all");
    assert.equal(row.decision, "flag", `${fieldKey}: the flag stands, with no controls`);
    assert.equal(row.newerThanDecision, false);
  }
});
