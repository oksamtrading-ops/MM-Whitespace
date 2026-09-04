import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCacheIsWorking, assertOutputModeIsLegal, classifyError, LiveModeUnavailable,
  ROUTE_CONFIG, send,
} from "./client.ts";
import { EgressViolation, restrictionsFromCatalog } from "./prompt.ts";
import { CassetteMiss } from "./cassette.ts";

const CASSETTE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "cassettes");

const NO_RESTRICTIONS = { terms: [], restrictedCompanyNames: [] };

const base = {
  mode: "replay" as const,
  cassetteDir: CASSETTE_DIR,
  promptVersion: "test",
  schemaHash: "test",
  stablePrefix: "prefix",
  userContent: "Company: Test",
  restrictions: NO_RESTRICTIONS,
};

test("route models match the design's per-route decisions", () => {
  // Discovery is Opus-tier deliberately: picking the wrong company's filing
  // produces a confidently wrong, well-cited fee.
  assert.equal(ROUTE_CONFIG.discovery.model, "claude-opus-5");
  assert.equal(ROUTE_CONFIG.extract_general.model, "claude-sonnet-5");
  assert.equal(ROUTE_CONFIG.extract_fees.model, "claude-opus-5");
  assert.equal(ROUTE_CONFIG.adjudication.model, "claude-opus-5");
});

test("discovery uses the dynamic-filtering web search variant", () => {
  const tool = ROUTE_CONFIG.discovery.tools[0] as Record<string, unknown>;
  assert.equal(tool.type, "web_search_20260209",
    "the 20250305 variant is for models older than Opus 4.6 / Sonnet 4.6");
  assert.equal(ROUTE_CONFIG.extract_general.tools.length, 0,
    "extraction has no tools: separate routes, separate cache prefixes");
});

test("citations and structured output are never both on for a route", () => {
  for (const [name, config] of Object.entries(ROUTE_CONFIG)) {
    assertOutputModeIsLegal(config as never);
    assert.ok(!(config.citations && config.structured), `${name} sets both`);
  }
  // And the guard actually fires.
  assert.throws(
    () => assertOutputModeIsLegal({
      model: "claude-opus-5", effort: "high", tools: [],
      structured: true, citations: true,
    }),
    /cannot both be set/);
});

test("the fees route keeps citations and gives up structured output", () => {
  // An API-generated span over the document cannot be fabricated; a
  // model-authored excerpt in a structured field can.
  assert.equal(ROUTE_CONFIG.extract_fees.citations, true);
  assert.equal(ROUTE_CONFIG.extract_fees.structured, false);
});

test("spend-limit errors halt the run; they are never retried", () => {
  // The 400 shape a self-set spend limit produces. A naive classifier calls
  // this permanent and fails every remaining company one at a time.
  assert.equal(classifyError({ status: 400, error: { error: { type: "billing_error",
    message: "Your credit balance is too low" } } }), "halt");
  assert.equal(classifyError({ status: 429, error: { error: { type: "rate_limit_error",
    message: "spend limit reached for this workspace" } } }), "halt");

  // Ordinary rate limiting is retryable.
  assert.equal(classifyError({ status: 429, error: { error: { type: "rate_limit_error",
    message: "too many requests" } } }), "retry");
  assert.equal(classifyError({ status: 503 }), "retry");
  assert.equal(classifyError({ name: "APIConnectionError", message: "socket hang up" }), "retry");

  // Credentials are a halt, not a dead letter: every job would fail the same way.
  assert.equal(classifyError({ status: 401 }), "halt");
  // A malformed request is this job's problem alone.
  assert.equal(classifyError({ status: 400, error: { error: { type: "invalid_request_error",
    message: "max_tokens is required" } } }), "dead_letter");
});

test("the egress scan runs before anything can leave the process", async () => {
  const restrictions = restrictionsFromCatalog(
    [{ key: "dtt_market", label: "Deloitte market", classification: "deloitte_internal" }]);
  await assert.rejects(
    send({ ...base, route: "extract_general", restrictions,
           userContent: "Market: dtt_market = Ontario" }),
    EgressViolation);
});

test("replay mode reaches no vendor code at all, and a miss is a hard stop", async () => {
  await assert.rejects(
    send({ ...base, route: "extract_general", userContent: "no such recording" }),
    CassetteMiss);
});

test("live mode without credentials fails with an actionable message", async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    await assert.rejects(
      send({ ...base, mode: "live", route: "extract_general" }),
      (e: Error) => {
        assert.ok(e instanceof LiveModeUnavailable);
        assert.match(e.message, /ANTHROPIC_API_KEY/);
        assert.match(e.message, /Spike S3/);
        return true;
      });
  } finally {
    if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});

test("a cache read after the first request is an asserted invariant", () => {
  assert.equal(assertCacheIsWorking([{ cache_read_input_tokens: 0 }]).ok, true,
    "one request cannot read a cache it just wrote");

  const working = assertCacheIsWorking([
    { cache_creation_input_tokens: 8000, cache_read_input_tokens: 0 },
    { cache_read_input_tokens: 7900 },
  ]);
  assert.equal(working.ok, true);

  const broken = assertCacheIsWorking([
    { cache_creation_input_tokens: 8000, cache_read_input_tokens: 0 },
    { cache_creation_input_tokens: 8000, cache_read_input_tokens: 0 },
  ]);
  assert.equal(broken.ok, false);
  assert.match(broken.reason ?? "", /allowed-domain list/);
  assert.match(broken.reason ?? "", /two cache namespaces/);
});
