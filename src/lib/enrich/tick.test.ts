import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/sql.ts";
import { readWorkerHealth } from "./health.ts";
import { workerUrl, kickWorker } from "./kick.ts";
import { claimJobs, claimSlot, ensureSlots, WORKER_SLOTS } from "./ledger.ts";
import { tick, TICK_RETENTION_DAYS } from "./tick.ts";
import { createRun, enrichmentMode } from "./worker.ts";
import { seedFixtureDatabase } from "../../../tests/cassettes/build_cassettes.mjs";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

function seeded() {
  return seedFixtureDatabase() as {
    db: Sql; periodId: string;
    companies: Array<{ id: string; name: string; ticker: string }>;
  };
}

test("a tick with nothing to do records itself and asks for no worker", async () => {
  const { db } = seeded();
  let asked = 0;
  const r = await tick(db, { kick: async () => { asked++; return { ok: true, note: "asked" }; } });
  assert.equal(r.invokedWorker, false);
  assert.equal(r.note, "nothing to do");
  assert.equal(asked, 0);
  const rows = await db.get("select count(*) n from cron_ticks") as { n: number };
  assert.equal(rows.n, 1, "the tick writes a heartbeat even when it does nothing");
});

test("a tick with queued work and a free slot asks for exactly one worker", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });
  let asked = 0;
  const r = await tick(db, { kick: async () => { asked++; return { ok: true, note: "a worker was asked to start" }; } });
  assert.equal(r.pending, 2);
  assert.equal(r.freeSlots, WORKER_SLOTS, "a fresh database gets its slot rows on the first tick");
  assert.equal(r.invokedWorker, true);
  assert.equal(asked, 1);
});

test("a tick with every slot taken asks for nobody, and says so", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, companies.map((c) => c.id), { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, WORKER_SLOTS);
  for (let i = 1; i <= WORKER_SLOTS; i++) await claimSlot(db, `w${i}`);
  let asked = 0;
  const r = await tick(db, { kick: async () => { asked++; return { ok: true, note: "" }; } });
  assert.equal(r.freeSlots, 0);
  assert.equal(r.invokedWorker, false);
  assert.equal(asked, 0);
});

test("a tick reaps an expired lease before it counts, and the count includes the reaped job", async () => {
  const { db, periodId, companies } = seeded();
  const { runId } = await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  await ensureSlots(db, WORKER_SLOTS);
  await claimJobs(db, runId, "dead-worker", 1);
  await db.run("update enrichment_jobs set lease_expires_at = '2000-01-01 00:00:00' where run_id = ?", runId);
  const r = await tick(db, { kick: async () => ({ ok: true, note: "asked" }) });
  assert.equal(r.reapedLeases, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.invokedWorker, true);
});

test("a tick records that no worker is configured rather than pretending one was asked", async () => {
  const { db, periodId, companies } = seeded();
  await createRun(db, periodId, [companies[0].id], { cassetteDir: CASSETTE_DIR });
  const r = await tick(db);
  assert.equal(r.invokedWorker, false);
  assert.match(r.note, /no worker is configured/);
});

test("ticks older than the retention window are pruned by the tick itself", async () => {
  const { db } = seeded();
  const old = new Date(Date.now() - (TICK_RETENTION_DAYS + 1) * 86_400_000)
    .toISOString().replace("T", " ").slice(0, 23) + "000";
  await db.run("insert into cron_ticks (ticked_at, note) values (?, 'ancient')", old);
  await tick(db);
  const rows = await db.all("select note from cron_ticks") as Array<{ note: string }>;
  assert.deepEqual(rows.map((r) => r.note), ["nothing to do"]);
});

test("worker health reads the last tick and the day's count", async () => {
  const { db } = seeded();
  await tick(db);
  await tick(db);
  const h = await readWorkerHealth(db);
  assert.ok(h.lastTick);
  assert.equal(h.lastTick!.note, "nothing to do");
  assert.equal(h.ticksLast24h, 2);
  assert.deepEqual(h.recentWorkers, []);
  assert.equal(h.longestLivedSeconds, null);
  assert.equal(h.ledgerMissing, false);
});

test("a database a migration behind reads as an empty ledger, not a failed screen", async () => {
  const { db } = seeded();
  await db.exec("drop table cron_ticks");
  const h = await readWorkerHealth(db);
  assert.equal(h.ledgerMissing, true);
  assert.equal(h.lastTick, null);
});

test("the worker URL prefers the deployment's own address over the request origin", () => {
  assert.equal(workerUrl("http://127.0.0.1:3199", "https://whitespace.example/"),
               "https://whitespace.example/api/worker/drain");
  assert.equal(workerUrl("http://127.0.0.1:3199", undefined), "http://127.0.0.1:3199/api/worker/drain");
  assert.equal(workerUrl(null, undefined), null);
});

test("a kick fails closed without a secret, and reports what the worker answered", async () => {
  const none = await kickWorker({ origin: "http://x", secret: undefined, publicUrl: undefined });
  assert.equal(none.ok, false);
  assert.match(none.note, /MM_CRON_SECRET/);

  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>).authorization });
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }) as unknown as typeof fetch;
  const ok = await kickWorker({ origin: "http://127.0.0.1:1", secret: "s", publicUrl: undefined, fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:1/api/worker/drain");
  assert.equal(calls[0].auth, "Bearer s");

  const refused = (async () => new Response(JSON.stringify({ note: "MM_ENRICH_MODE is not set" }), { status: 409 })) as unknown as typeof fetch;
  const no = await kickWorker({ origin: "http://127.0.0.1:1", secret: "s", publicUrl: undefined, fetchImpl: refused });
  assert.equal(no.ok, false);
  assert.match(no.note, /409.*MM_ENRICH_MODE/);
});

test("the enrichment mode fails closed when unset, and live refuses at the door without its settings", () => {
  assert.equal(enrichmentMode(undefined).mode, null);
  assert.equal(enrichmentMode("").mode, null);
  assert.equal(enrichmentMode("replay").mode, "replay");
  assert.match(enrichmentMode("batch").reason ?? "", /not a mode/);

  const saved = { key: process.env.ANTHROPIC_API_KEY, contact: process.env.MM_SEC_CONTACT };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MM_SEC_CONTACT;
    const missing = enrichmentMode("live");
    assert.equal(missing.mode, null);
    assert.match(missing.reason ?? "", /ANTHROPIC_API_KEY and MM_SEC_CONTACT/);

    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-key";
    assert.match(enrichmentMode("live").reason ?? "", /MM_SEC_CONTACT/);

    process.env.MM_SEC_CONTACT = "contact@example.invalid";
    assert.equal(enrichmentMode("live").mode, "live");
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.contact === undefined) delete process.env.MM_SEC_CONTACT; else process.env.MM_SEC_CONTACT = saved.contact;
  }
});
