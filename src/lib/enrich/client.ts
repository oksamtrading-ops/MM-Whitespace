/**
 * The ONLY module that talks to the model vendor.
 *
 * Everything that must be true of a request is enforced here rather than
 * scattered: the egress scan runs on the serialised body, the cassette is
 * written before the response is used, and spend-limit errors are classified as
 * halt rather than retry.
 *
 * The SDK is imported dynamically, inside the live path only, so replay mode
 * and the whole test suite run with no dependency installed and CI needs no
 * node_modules. Adding a static import here would forfeit that.
 */
import { Cassettes, cassetteKey, type Mode, type Recording } from "./cassette.ts";
import { egressScan, type RestrictionSet, type Route } from "./prompt.ts";

/**
 * Route configuration.
 *
 * Discovery runs on the Opus tier deliberately: picking the wrong company's
 * filing produces a confidently wrong, well-cited fee, which is the worst
 * failure this system has. The cost delta does not buy that risk across 110
 * interlisted companies and known renames.
 */
export const ROUTE_CONFIG = {
  discovery: {
    model: "claude-opus-5",
    effort: "high" as const,
    // Dynamic-filtering variant. The older web_search_20250305 is for models
    // before Opus 4.6 / Sonnet 4.6 and is the only variant on Vertex.
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    structured: true,
    citations: false,
  },
  extract_general: {
    // 1M context, structured output, effort available. Not the cheapest tier:
    // its context cannot hold a large filing plus a multi-document window, the
    // effort lever is unavailable there, and its minimum cacheable prefix is
    // several times larger -- so a field dictionary of a few thousand tokens
    // silently fails to cache, visible only as a zero in the cache counter.
    model: "claude-sonnet-5",
    effort: "high" as const,
    tools: [],
    structured: true,
    citations: false,
  },
  extract_fees: {
    model: "claude-opus-5",
    effort: "xhigh" as const,
    tools: [],
    // Citations ON, and therefore structured output OFF -- see the note below.
    structured: false,
    citations: true,
  },
  adjudication: {
    model: "claude-opus-5",
    effort: "xhigh" as const,
    tools: [],
    structured: true,
    citations: false,
  },
} as const satisfies Record<Route, RouteConfig>;

export type RouteConfig = {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  tools: ReadonlyArray<Record<string, unknown>>;
  structured: boolean;
  citations: boolean;
};

/**
 * CITATIONS AND STRUCTURED OUTPUT ARE MUTUALLY EXCLUSIVE.
 *
 * docs/design/06-enrichment-pipeline.md asserts that the incompatibility "is
 * true only for web search". Against the current API that is wrong: setting
 * `citations: {enabled: true}` on a document block together with
 * `output_config.format` returns a 400 on any route.
 *
 * The fees route keeps citations and gives up structured output, because the
 * design's own reasoning for citations there is the stronger of the two: an
 * API-generated span over the document cannot be fabricated, whereas a
 * model-authored excerpt in a structured field can. Fee findings are therefore
 * parsed from citation blocks, and the anchoring gate re-verifies them anyway.
 */
export function assertOutputModeIsLegal(config: RouteConfig): void {
  if (config.citations && config.structured) {
    throw new Error(
      "citations and output_config.format cannot both be set: the API returns 400. " +
      "Pick one per route -- fees keep citations, everything else keeps structured output.",
    );
  }
}

/** Errors that must halt a run rather than be retried. */
export type Classification = "retry" | "halt" | "dead_letter";

/**
 * Both spend-limit error shapes route to HALT, not retry and not dead letter.
 * The shapes, verbatim from the API documentation (11 September 2026):
 *
 *   A limit YOU set, org or workspace: HTTP 400, invalid_request_error,
 *   "You have reached your specified [workspace ]API usage limits. ..."
 *   Every reasonable classifier calls a 400 permanent, so without this the
 *   first trip mid-run dead-letters every remaining company one at a time.
 *
 *   The TIER's monthly cap: HTTP 429, rate_limit_error -- the same type as an
 *   ordinary rate limit -- with error.details.error_code =
 *   "enforced_spend_limit_reached" and no retry-after. Retrying fails until
 *   the first of next month.
 *
 * The error_code is matched first because it is the documented discriminator;
 * the message patterns cover the 400, which carries no code.
 */
export function classifyError(err: unknown): Classification {
  const e = err as {
    status?: number;
    error?: { error?: { type?: string; message?: string; details?: { error_code?: string } } };
    message?: string; name?: string;
  };
  const status = e?.status;
  const type = e?.error?.error?.type ?? "";
  const code = e?.error?.error?.details?.error_code ?? "";
  const message = `${e?.error?.error?.message ?? ""} ${e?.message ?? ""}`.toLowerCase();

  const spendLimited =
    code === "enforced_spend_limit_reached" ||
    type === "billing_error" ||
    status === 402 ||
    /you have reached your (specified )?(workspace )?api usage limits/.test(message) ||
    /credit balance/.test(message);
  if (spendLimited) return "halt";

  if (status === 429) return "retry";
  if (status !== undefined && status >= 500) return "retry";
  if (e?.name === "APIConnectionError" || /timeout|econnreset|socket hang up/.test(message)) {
    return "retry";
  }
  if (status === 401 || status === 403) return "halt";
  return "dead_letter";
}

export type SendOptions = {
  route: Route;
  mode: Mode;
  cassetteDir: string;
  promptVersion: string;
  schemaHash: string;
  stablePrefix: string;
  userContent: string;
  restrictions: RestrictionSet;
  /** JSON schema for structured routes. Ignored where citations are on. */
  outputSchema?: Record<string, unknown>;
  /** Documents the APPLICATION fetched. Never a URL the model proposed. */
  documents?: Array<{ title: string; text: string }>;
  maxTokens?: number;
};

export type SendResult = {
  key: string;
  body: unknown;
  usage: Record<string, number>;
  fromCassette: boolean;
};

export class LiveModeUnavailable extends Error {
  constructor(reason: string) {
    super(`live mode unavailable: ${reason}`);
    this.name = "LiveModeUnavailable";
  }
}

/**
 * Send one request, or replay one.
 *
 * In replay mode nothing is imported, constructed or sent. In record mode the
 * response is written to the cassette before it is returned, so a crash after
 * the call still leaves the paid-for result on disk.
 */
export async function send(opts: SendOptions): Promise<SendResult> {
  const config = ROUTE_CONFIG[opts.route] as RouteConfig;
  assertOutputModeIsLegal(config);

  // Runs on the serialised body, before anything leaves the process. A hit
  // throws; it never redacts and sends.
  egressScan(
    { prefix: opts.stablePrefix, content: opts.userContent, documents: opts.documents },
    opts.restrictions,
  );

  const key = cassetteKey({
    route: opts.route,
    model: config.model,
    promptVersion: opts.promptVersion,
    schemaHash: opts.schemaHash,
    content: opts.userContent,
  });

  const cassettes = new Cassettes(opts.cassetteDir, opts.mode);
  if (opts.mode === "replay") {
    const rec = cassettes.read(key);
    return { key, body: rec.response, usage: rec.usage ?? {}, fromCassette: true };
  }

  const { message, usage } = await callVendor(config, opts);
  const recording: Omit<Recording, "key" | "recordedAt"> = {
    request: {
      route: opts.route, model: config.model,
      promptVersion: opts.promptVersion, userContent: opts.userContent,
    },
    response: message,
    usage,
    // Search results carry encrypted content that must be replayed byte-exact
    // or a continuation fails, so the assistant turn is stored verbatim rather
    // than reconstructed.
    verbatimTurn: JSON.stringify(message),
  };
  if (opts.mode === "record") cassettes.write(key, recording);
  return { key, body: message, usage, fromCassette: false };
}

async function callVendor(config: RouteConfig, opts: SendOptions) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new LiveModeUnavailable(
      "no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in the environment. " +
      "Spike S3 (confirm account tier, set per-environment spend limits) is a " +
      "prerequisite for the first live run.",
    );
  }

  let Anthropic: any;
  try {
    // The specifier is assembled rather than written as a literal, on purpose.
    // The SDK is an OPTIONAL runtime dependency reached only on this path, so
    // replay mode, the test suite and CI all run without it installed -- and a
    // literal here would make the type checker demand it be present.
    const specifier = ["@anthropic-ai", "sdk"].join("/");
    ({ default: Anthropic } = await import(/* webpackIgnore: true */ specifier));
  } catch {
    throw new LiveModeUnavailable(
      "@anthropic-ai/sdk is not installed. It is imported dynamically and only " +
      "on this path, so replay mode and the test suite stay dependency-free. " +
      "Run: npm install @anthropic-ai/sdk",
    );
  }
  const client = new Anthropic();

  const content: Array<Record<string, unknown>> = [];
  for (const doc of opts.documents ?? []) {
    content.push({
      type: "document",
      title: doc.title,
      source: { type: "text", media_type: "text/plain", data: doc.text },
      // All-or-none across document blocks.
      ...(config.citations ? { citations: { enabled: true } } : {}),
      // The document block is the highest-value and most-missed cache
      // breakpoint: a large filing read by three or four field-group calls
      // turns three full-price reads into three cheap ones.
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }
  content.push({ type: "text", text: opts.userContent });

  const request: Record<string, unknown> = {
    model: config.model,
    max_tokens: opts.maxTokens ?? 16000,
    // budget_tokens is removed on these models and returns a 400.
    thinking: { type: "adaptive" },
    output_config: {
      effort: config.effort,
      ...(config.structured && opts.outputSchema
        ? { format: { type: "json_schema", schema: opts.outputSchema } }
        : {}),
    },
    system: [
      { type: "text", text: opts.stablePrefix, cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    messages: [{ role: "user", content }],
    ...(config.tools.length ? { tools: config.tools } : {}),
  };

  const message = await client.messages.create(request);
  const u = message.usage ?? {};
  return {
    message,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * A cache read from the second company onward is an asserted invariant, not an
 * aspiration: if it is zero across a run, a silent invalidator is at work and
 * the cost model is wrong.
 */
export function assertCacheIsWorking(
  usages: Array<Record<string, number>>,
): { ok: boolean; reason?: string } {
  if (usages.length < 2) return { ok: true };
  const afterFirst = usages.slice(1);
  const anyRead = afterFirst.some((u) => (u.cache_read_input_tokens ?? 0) > 0);
  if (!anyRead) {
    return {
      ok: false,
      reason:
        "no cache read after the first request. Likely causes, in order: a " +
        "per-company allowed-domain list on the tools block; citations toggled " +
        "between field groups (two cache namespaces, not one); a per-company " +
        "value in the system prompt; or non-deterministic serialisation.",
    };
  }
  return { ok: true };
}
