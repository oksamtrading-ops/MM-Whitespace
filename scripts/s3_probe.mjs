/**
 * Spike S3: what this account's key is actually allowed to do.
 *
 *   ANTHROPIC_API_KEY=... node scripts/s3_probe.mjs limits
 *   ANTHROPIC_API_KEY=... node scripts/s3_probe.mjs burn --model claude-sonnet-5 --max 30
 *
 * `limits` sends ONE minimal request to each model the pipeline routes to and
 * prints the rate-limit headers the API answers with -- the limits actually in
 * force for this key's workspace, which may be lower than the documented tier
 * table (new organisations start on an Evaluation tier). Cost: a fraction of
 * a cent. Nothing about any company is sent; the prompt is a fixed word.
 *
 * `burn` exists to trip a workspace spend limit YOU set on purpose, so the
 * real error body can be seen and put through classifyError. It asks for long
 * answers until the API refuses or --max requests have been sent, whichever
 * comes first. Run it only with a key from a throwaway workspace whose spend
 * limit is set as low as the Console allows. Never with the production key.
 *
 * The key is read from the environment and never printed. Retries are off, so
 * an error is seen once, as the API sent it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { classifyError, ROUTE_CONFIG } from "../src/lib/enrich/client.ts";

const [mode = "limits", ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in this shell. Export it for this command only; it is never printed.");
  process.exit(2);
}

const client = new Anthropic({ maxRetries: 0 });

/** $/MTok, input and output, from the published price list (11 September 2026). */
const PRICE = { "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] };
const cost = (model, u) => {
  const [i, o] = PRICE[model] ?? [0, 0];
  return ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o) / 1e6;
};

function report(err) {
  const inner = err?.error?.error ?? {};
  console.log(`  HTTP ${err?.status ?? "—"}  ${inner.type ?? err?.name ?? "error"}`);
  console.log(`  message:      ${inner.message ?? err?.message}`);
  if (inner.details) console.log(`  details:      ${JSON.stringify(inner.details)}`);
  console.log(`  retry-after:  ${err?.headers?.get?.("retry-after") ?? "(absent)"}`);
  console.log(`  request id:   ${err?.requestID ?? "—"}`);
  console.log(`  classifyError says: ${classifyError(err).toUpperCase()}`);
  console.log(`  body, for the S3 record:\n  ${JSON.stringify(err?.error)}`);
}

if (mode === "limits") {
  // The two models the pipeline routes to. Discovery, fee extraction and
  // adjudication share Opus; general extraction is Sonnet.
  const models = [...new Set(Object.values(ROUTE_CONFIG).map((r) => r.model))];
  let workspace = null;
  for (const model of models) {
    console.log(`\n${model}`);
    try {
      const { data, response } = await client.messages.create({
        model, max_tokens: 16,
        // Thinking off at low effort: the answer is one word and this
        // request exists only for its headers.
        thinking: { type: "disabled" }, output_config: { effort: "low" },
        messages: [{ role: "user", content: "Reply with the single word OK." }],
      }).withResponse();
      workspace = response.headers.get("anthropic-workspace-id") ?? workspace;
      for (const [k, v] of response.headers) {
        if (k.startsWith("anthropic-ratelimit-")) console.log(`  ${k.padEnd(46)} ${v}`);
      }
      console.log(`  usage: ${data.usage.input_tokens} in, ${data.usage.output_tokens} out, ` +
                  `about $${cost(model, data.usage).toFixed(5)}`);
    } catch (err) {
      report(err);
    }
  }
  console.log(`\nworkspace: ${workspace ?? "(header absent)"}`);
  console.log("Compare it with the workspace named on the key's row in Console > API keys. " +
              "The Default workspace cannot carry a spend limit.");
} else if (mode === "burn") {
  const model = flag("model", "claude-sonnet-5");
  const max = Number(flag("max", "10"));
  if (!PRICE[model]) { console.error(`--model must be one of ${Object.keys(PRICE).join(", ")}`); process.exit(2); }
  if (!(max > 0 && max <= 100)) { console.error("--max must be between 1 and 100"); process.exit(2); }

  console.log(`Burning against ${model}, at most ${max} requests of up to 4,000 output tokens ` +
              `(about $${(4000 * PRICE[model][1] / 1e6).toFixed(2)} each at most).`);
  let spent = 0;
  for (let n = 1; n <= max; n++) {
    try {
      const msg = await client.messages.create({
        model, max_tokens: 4000,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content:
          "Write a long, plain description of how an ordinary mineral exploration programme " +
          "proceeds from claim staking to a feasibility study. Aim for about 2,500 words." }],
      });
      spent += cost(model, msg.usage);
      console.log(`  ${String(n).padStart(3)}  ok   ${msg.usage.output_tokens} out   running ~$${spent.toFixed(3)}`);
    } catch (err) {
      console.log(`  ${String(n).padStart(3)}  REFUSED after ~$${spent.toFixed(3)}`);
      report(err);
      process.exit(0);
    }
  }
  console.log(`\nSent ${max} requests (~$${spent.toFixed(3)}) without tripping a limit. ` +
              "Lower the workspace spend limit, or raise --max.");
} else {
  console.error("usage: node scripts/s3_probe.mjs limits | burn [--model claude-sonnet-5] [--max 10]");
  process.exit(2);
}
