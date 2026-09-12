import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NotConfigured, PYTHON_ROUTES, pythonEndpoint } from "./endpoint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The defect this exists to prevent, found in production on 12 September 2026:
 * the workbook builder shipped as api/export.py while the application served
 * its own /api/export route. On Vercel they are ONE URL and the Python
 * function wins, so every download answered `{"error": "unauthorized"}` from a
 * function that never saw the person's request. Nothing local catches it --
 * there is no function host here, so the route answers and the tests pass.
 */
test("no Python function shares a URL with a route handler", async () => {
  const functions = readdirSync(join(ROOT, "api")).filter((f) => f.endsWith(".py"));
  assert.ok(functions.length > 0, "there should be Python functions to check");
  for (const file of functions) {
    const name = file.replace(/\.py$/, "");
    assert.equal(existsSync(join(ROOT, "src", "app", "api", name, "route.ts")), false,
      `api/${file} and src/app/api/${name}/route.ts are the same URL on Vercel, ` +
      "and the Python function answers it");
  }
});

test("each function's path is the file that serves it", async () => {
  for (const [route, path] of Object.entries(PYTHON_ROUTES)) {
    assert.ok(existsSync(join(ROOT, "api", `${path}.py`)), `api/${path}.py is missing for ${route}`);
  }
  const env = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "app.example" };
  assert.equal(pythonEndpoint("parse", env)?.url, "https://app.example/api/parse");
  assert.equal(pythonEndpoint("export", env)?.url, "https://app.example/api/workbook");
});

test("locally there is no function host, and a misconfigured deployment says so", async () => {
  assert.equal(pythonEndpoint("export", {}), null, "the caller runs python3 instead");
  assert.equal(pythonEndpoint("export", { MM_EXPORT_URL: "http://x.invalid/api/workbook" })?.url,
               "http://x.invalid/api/workbook");
  assert.throws(() => pythonEndpoint("export", { VERCEL: "1" }), NotConfigured);
  // The protection bypass rides along, or the deployment's own login answers.
  assert.deepEqual(pythonEndpoint("parse", { MM_PARSE_URL: "http://x.invalid/api/parse",
                                             VERCEL_AUTOMATION_BYPASS_SECRET: "s" })?.headers,
                   { "x-vercel-protection-bypass": "s" });
});
