import { test } from "node:test";
import type { Sql } from "../db/sql.ts";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPrompt, egressScan, EgressViolation, restrictionsFromCatalog, toPublicRow,
  type InternalCompanyRow,
} from "./prompt.ts";
import { evidenceStrength, bulkAcceptable } from "./evidence.ts";
import { Cassettes, CassetteMiss, cassetteKey } from "./cassette.ts";
import {
  budgetState, claimJobs, claimSlot, ensureSlots, heartbeat, IllegalTransition,
  reapExpiredLeases, recordSpend, releaseSlot, transition,
} from "./ledger.ts";
import { createRun, hallucinationRate, researchOneCompany } from "./worker.ts";
import { seedFixtureDatabase, PERIOD_AS_OF } from "../../../tests/cassettes/build_cassettes.mjs";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

function seeded() {
  return seedFixtureDatabase() as {
    db: Sql; periodId: string;
    companies: Array<{ id: string; name: string; ticker: string }>;
  };
}

// ----------------------------------------------------------------- prompt

test("the prompt builder cannot be handed an internal field", async () => {
  const internal: InternalCompanyRow = {
    companyId: "c1", canonicalName: "Northco Mining Corp.", aliases: [],
    rootTicker: "NRTH", exchange: "TSX", interlistedVenues: [],
    headOfficeLocation: "ON", headOfficeRegion: "Canada",
    knownRegions: { CANADA: ["ON"] }, knownCommodities: ["Gold"],
    knownWebsite: null, periodAsOf: PERIOD_AS_OF,
    dttMarket: "Ontario",                       // internal
    comments: "spoke to the CFO in March",      // internal
  };
  const publicRow = toPublicRow(internal);
  assert.equal((publicRow as Record<string, unknown>).dttMarket, undefined);
  assert.equal((publicRow as Record<string, unknown>).comments, undefined);

  const compiled = buildPrompt("extract_general", publicRow);
  const whole = compiled.stablePrefix + compiled.userContent;
  assert.ok(!whole.includes("Ontario") || !whole.includes("dttMarket"));
  assert.ok(!whole.includes("spoke to the CFO"),
    "a comment must never reach a prompt");
});

test("the egress scan throws rather than redacting and sending", async () => {
  const restrictions = restrictionsFromCatalog([
    { key: "dtt_market", label: "Deloitte market", classification: "deloitte_internal" },
    { key: "auditor", label: "Auditor", classification: "public" },
  ], ["Northco Mining Corp."]);

  assert.throws(
    () => egressScan({ content: "Company market: dtt_market = Ontario" }, restrictions),
    EgressViolation);
  assert.throws(
    () => egressScan({ content: "Please research Northco Mining Corp." }, restrictions),
    EgressViolation);
  // A public field key is not restricted.
  egressScan({ content: "extract the auditor" }, restrictions);
});

test("the prompt prefix is byte-identical across companies on a route", async () => {
  const row = (name: string) => ({
    companyId: name, canonicalName: name, aliases: [], rootTicker: "X", exchange: "TSX",
    interlistedVenues: [], headOfficeLocation: null, headOfficeRegion: null,
    knownRegions: {}, knownCommodities: [], knownWebsite: null, periodAsOf: PERIOD_AS_OF,
  });
  const a = await buildPrompt("extract_general", row("Alpha"));
  const b = await buildPrompt("extract_general", row("Beta"));
  assert.equal(a.stablePrefix, b.stablePrefix, "a per-company value in the prefix kills the cache");
  assert.notEqual(a.userContent, b.userContent);
});

test("serialisation is deterministic, so an unordered query cannot invalidate the cache", async () => {
  const base = {
    companyId: "c", canonicalName: "C", aliases: ["Z Corp", "A Corp"], rootTicker: "C",
    exchange: "TSX", interlistedVenues: [], headOfficeLocation: null, headOfficeRegion: null,
    knownCommodities: ["Silver", "Gold"], knownWebsite: null, periodAsOf: PERIOD_AS_OF,
  };
  const one = buildPrompt("extract_general",
    { ...base, knownRegions: { USA: ["NV"], CANADA: ["ON"] } });
  const two = buildPrompt("extract_general",
    { ...base, aliases: ["A Corp", "Z Corp"], knownCommodities: ["Gold", "Silver"],
      knownRegions: { CANADA: ["ON"], USA: ["NV"] } });
  assert.equal(one.userContent, two.userContent);
});

// --------------------------------------------------------------- evidence

test("evidence strength is a async function of observable components, not self-report", async () => {
  const strong = evidenceStrength({
    sourceTier: 1, documentAgeDays: 30, expectedCadenceDays: 365,
    anchorMode: "exact_normalized", corroboratingSources: 3, extractionAgreement: true,
  });
  const weak = evidenceStrength({
    sourceTier: 5, documentAgeDays: 900, expectedCadenceDays: 180,
    anchorMode: "label_only", corroboratingSources: 0, extractionAgreement: false,
  });
  assert.ok(strong.strength > 0.9, `expected a strong score, got ${strong.strength}`);
  assert.ok(weak.strength < 0.2, `expected a weak score, got ${weak.strength}`);
  assert.equal(strong.version, "1.0.0");
});

test("an unanchored finding is never bulk-acceptable, whatever it scores", async () => {
  const calibrated = {
    field: "audit_fee", minStrength: 0.5,
    calibrationRunId: "run-1", measuredPrecision: 0.94,
  };
  const score = evidenceStrength({
    sourceTier: 1, documentAgeDays: 1, expectedCadenceDays: 365,
    anchorMode: "label_only", corroboratingSources: 3, extractionAgreement: true,
  });
  assert.equal(bulkAcceptable(score, calibrated, "label_only"), false);

  // And an uncalibrated threshold does not authorise bulk accept at all.
  const anchored = evidenceStrength({
    sourceTier: 1, documentAgeDays: 1, expectedCadenceDays: 365,
    anchorMode: "exact_normalized", corroboratingSources: 3, extractionAgreement: true,
  });
  assert.equal(bulkAcceptable(anchored, { ...calibrated, calibrationRunId: null },
    "exact_normalized"), false);
  assert.equal(bulkAcceptable(anchored, calibrated, "exact_normalized"), true);
});

// ---------------------------------------------------------------- ledger

test("a worker with no free slot exits rather than exceeding concurrency", async () => {
  const { db } = await seeded();
  await ensureSlots(db, 2);
  assert.equal(await claimSlot(db, "w1"), 1);
  assert.equal(await claimSlot(db, "w2"), 2);
  assert.equal(await claimSlot(db, "w3"), null, "the third worker must find no slot");
  await releaseSlot(db, 1);
  assert.equal(await claimSlot(db, "w3"), 1);
});

test("an expired lease returns the job to queued and charges NO attempt", async () => {
  const { db, periodId, companies } = await seeded();
  const { runId } = await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, 1);
  const [job] = await claimJobs(db, runId, "w1", 1);
  assert.ok(job);

  // Force the lease into the past, as a killed worker would leave it.
  await db.run("update enrichment_jobs set lease_expires_at = '2000-01-01 00:00:00' where id = ?", job.id);
  const reaped = await reapExpiredLeases(db);
  assert.equal(reaped, 1);

  const after = await db.get("select state, attempts, leased_by from enrichment_jobs where id = ?", job.id) as { state: string; attempts: number; leased_by: string | null };
  assert.equal(after.state, "queued");
  assert.equal(after.attempts, 0, "a killed worker must not burn a retry");
  assert.equal((await after).leased_by, null);
});

test("heartbeat extends the lease of held jobs only", async () => {
  const { db, periodId, companies } = await seeded();
  const { runId } = await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, 1);
  await claimJobs(db, runId, "w1", 1);
  assert.equal(await heartbeat(db, "w1"), 1);
  assert.equal(await heartbeat(db, "someone-else"), 0);
});

test("an illegal state transition throws instead of corrupting the ledger", async () => {
  const { db, periodId, companies } = await seeded();
  const { runId, jobIds } = await createRun(db, periodId, [companies[0].id],
    { cassetteDir: CASSETTE_DIR });
  await assert.rejects(
() => transition(db, jobIds[0], "completed"), IllegalTransition);
  await transition(db, jobIds[0], "claimed");
  await transition(db, jobIds[0], "researching");
  await assert.rejects(() => transition(db, jobIds[0], "completed"), IllegalTransition);
  void runId;
});

test("exhausting the budget halts the run and every unfinished job", async () => {
  const { db, periodId, companies } = await seeded();
  const { runId } = await createRun(db, periodId, companies.map((c) => c.id),
    { cassetteDir: CASSETTE_DIR, budgetUsd: 1 });

  const warned = await recordSpend(db, runId, 0.85);
  assert.equal(warned.warn, true);
  assert.equal(warned.halt, false);

  const halted = await recordSpend(db, runId, 0.30);
  assert.equal(halted.halt, true);
  const run = await db.get("select status, halt_reason from enrichment_runs where id = ?", runId) as { status: string; halt_reason: string };
  assert.equal(run.status, "halted");
  assert.match(run.halt_reason, /budget exhausted/);
  const stuck = await db.get("select count(*) n from enrichment_jobs where run_id = ? and state = 'halted'", runId) as { n: number };
  assert.equal(stuck.n, 2, "both spend-limit shapes route to halt, not retry");
});

test("a run cannot be created without a budget", async () => {
  const { db, periodId, companies } = await seeded();
  await assert.rejects(
() => createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR, budgetUsd: 0 }),
    /without a budget/);
});

// -------------------------------------------------------------- cassettes

test("replay mode sends nothing, and a miss is a hard stop", async () => {
  const cassettes = new Cassettes(CASSETTE_DIR, "replay");
  assert.throws(() => cassettes.read("extract_general-doesnotexist"), CassetteMiss);
});

test("a changed prompt version changes the cassette key by design", async () => {
  const base = { route: "extract_general", model: "claude-sonnet-5",
                 schemaHash: "findings-v1", content: "Company: X" };
  const a = cassetteKey({ ...base, promptVersion: "1" });
  const b = cassetteKey({ ...base, promptVersion: "2" });
  assert.notEqual(a, b, "a stale recording must not answer a changed prompt");
});

test("live mode without a key refuses before anything is sent", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { db, periodId, companies } = await seeded();
    const { runId } = await createRun(db, periodId, [companies[0].id],
      { cassetteDir: CASSETTE_DIR, mode: "live" });
    await assert.rejects(
      () => researchOneCompany(db, runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR, mode: "live" }),
      /ANTHROPIC_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ------------------------------------------------------------- end to end

test("ONE COMPANY END TO END, and the planted fabricated fee is rejected", async () => {
  const { db, periodId, companies } = await seeded();
  const northco = companies.find((c) => c.name === "Northco Mining Corp.")!;
  const { runId } = await createRun(db, periodId, [northco.id], { cassetteDir: CASSETTE_DIR });

  const outcome = await researchOneCompany(db, runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });

  // The ledger moved all the way through.
  assert.equal(outcome.jobState, "completed");

  const byField = Object.fromEntries(outcome.findings.map((f) => [f.fieldKey, f]));

  // Stage: anchored against the AIF, which is what unblocks the tier column.
  assert.equal(byField.stage_evidence_state.state, "proposed");
  assert.equal(byField.stage_evidence_state.anchorMode, "exact_normalized");

  // Auditor: anchored.
  assert.equal(byField.auditor.state, "proposed");

  // The real audit fee: 412 printed under an "in thousands" header, and the
  // label sits in a different table cell -- so only proximity can anchor it.
  assert.equal(byField.audit_fee.state, "proposed");
  assert.equal(byField.audit_fee.anchorMode, "proximity");
  assert.equal(byField.audit_fee.bulkAcceptable, true);

  // THE PLANTED FABRICATION. 265 appears nowhere in the fee table.
  assert.notEqual(byField.tax_fee.state, "proposed");
  assert.equal(byField.tax_fee.bulkAcceptable, false,
    "a fabricated fee must never be bulk-acceptable");

  // The raw response was stored BEFORE any finding was derived from it, so a
  // crash between the two costs a re-derivation and not a re-call.
  const raw = await db.get("select count(*) n from enrichment_job_results where job_id = ?",outcome.jobId) as
    { n: number };
  assert.equal(raw.n, 1);

  // Every finding carries a versioned evidence score and names its document.
  const rows = await db.all(`select field_key, state, anchor_mode, evidence_strength, evidence_version,
            anchor_document_hash, model_self_confidence
       from enrichment_findings where run_id = ?`, runId) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.evidence_version, "1.0.0");
    assert.ok(typeof r.evidence_strength === "number");
    assert.ok(r.anchor_document_hash, `${r.field_key} must name the document it was checked against`);
    assert.ok(r.model_self_confidence !== null,
      "the self-report is stored, and excluded from the threshold");
  }

  // The fabricated fee scored HIGHER on self-confidence than the real one --
  // which is exactly why the threshold does not read that column.
  const tax = rows.find((r) => r.field_key === "tax_fee")!;
  const audit = rows.find((r) => r.field_key === "audit_fee")!;
  assert.ok((tax.model_self_confidence as number) > (audit.model_self_confidence as number));
  assert.ok((audit.evidence_strength as number) > (tax.evidence_strength as number),
    "evidence strength must rank the anchored fee above the fabricated one");
});

test("abstention is a first-class outcome, not a failure", async () => {
  const { db, periodId, companies } = await seeded();
  const royalco = companies.find((c) => c.name === "Royalco Streaming Inc.")!;
  const { runId } = await createRun(db, periodId, [royalco.id], { cassetteDir: CASSETTE_DIR });
  const outcome = await researchOneCompany(db, runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });
  assert.equal((await outcome).jobState, "completed");

  const abstained = await db.all(`select field_key, state, abstained, abstention_reason from enrichment_findings
      where run_id = ? and abstained = 1`, runId) as Array<Record<string, unknown>>;
  assert.equal(abstained.length, 1);
  assert.equal(abstained[0].field_key, "audit_fee");
  assert.equal(abstained[0].state, "abstained",
    "abstention has its own state; routing it to unsupported would inflate the publish gate");
  assert.match(String(abstained[0].abstention_reason), /does not disclose/);

  // The rate that gates publish must not count an honest abstention.
  const rate = await hallucinationRate(db, runId);
  assert.equal(rate.unsupported, 0);
  assert.equal(rate.assessed, 1, "only the non-abstained finding is assessed");
  assert.equal(rate.rate, 0);
});

test("the publish gate counts unsupported findings and excludes abstentions", async () => {
  const { db, periodId, companies } = await seeded();
  const northco = companies.find((c) => c.name === "Northco Mining Corp.")!;
  const royalco = companies.find((c) => c.name === "Royalco Streaming Inc.")!;

  const a = await createRun(db, periodId, [northco.id], { cassetteDir: CASSETTE_DIR });
  await researchOneCompany(db,(await a).runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });
  // Northco: 4 findings, none abstained, none unsupported (the fabrication is
  // anchor_mismatch -- plausible but unanchored, which is quarantine, not a lie).
  const ra = await hallucinationRate(db,(await a).runId);
  assert.equal(ra.assessed, 4);
  assert.equal(ra.unsupported, 0);

  const b = await createRun(db, periodId, [royalco.id], { cassetteDir: CASSETTE_DIR });
  await researchOneCompany(db,(await b).runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });
  const rb = await hallucinationRate(db,(await b).runId);
  assert.equal(rb.assessed, 1, "the abstention is not assessed");
});

test("spend is reconciled onto the run from the recorded usage", async () => {
  const { db, periodId, companies } = await seeded();
  const northco = companies.find((c) => c.name === "Northco Mining Corp.")!;
  const { runId } = await createRun(db, periodId, [northco.id],
    { cassetteDir: CASSETTE_DIR, budgetUsd: 5 });
  await researchOneCompany(db, runId, PERIOD_AS_OF, { cassetteDir: CASSETTE_DIR });
  const b = await budgetState(db, runId);
  assert.ok((await b).spend > 0, "usage from the recording must be debited against the budget");
  assert.equal((await b).halt, false);
});
