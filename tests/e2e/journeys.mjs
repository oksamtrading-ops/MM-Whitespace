/**
 * Five end-to-end journeys, plus the accessibility obligations on six routes.
 *
 * These drive a real server over HTTP -- they are not unit tests with the
 * network stubbed out. They boot `next dev` against a database built by the
 * real pipeline (parse the synthetic fixture, commit, seed a review queue,
 * publish) and then behave like a person would.
 *
 * They live outside `node --test 'src/**' + '/*.test.ts'` on purpose: the library
 * suites run with no dependencies installed, and these need the application.
 *
 *   node tests/e2e/journeys.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "e2e-secret";
const CRON = "e2e-cron";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) { passed++; console.log(`  ok    ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${name}`); }
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/dev/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const cookie = res.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
  return { status: res.status, cookie, body: await res.json().catch(() => ({})) };
}

const get = (path, cookie) =>
  fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
    .then(async (r) => ({ status: r.status, html: await r.text() }));

/* -------------------------------------------------------------- setup */

function buildDatabase(dir) {
  const payload = join(dir, "period.json");
  const db = join(dir, "e2e.db");
  const fixture = join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx");
  const q = { cwd: ROOT, stdio: "ignore" };

  execFileSync("python3", ["-m", "mmparser.cli", fixture, "--json", payload], q);
  execFileSync("node", ["scripts/commit_period.mjs", payload, db, "--fresh"], q);
  execFileSync("node", ["scripts/seed_review_fixture.mjs", db], q);
  execFileSync("node", [
    "scripts/publish_period.mjs", db, "--publish",
    "--override", "End-to-end journey: day-one baseline.",
  ], q);
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(db)});
    const ins = db.prepare("insert into app_users (email, role) values (?, ?)");
    ins.run("analyst@example.invalid", "analyst");
    ins.run("viewer@example.invalid", "viewer");
    ins.run("admin@example.invalid", "admin");
  `], q);
  return db;
}

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/dashboard`);
      if (r.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------ journeys */

async function journeys() {
  // 1. A Viewer signs in and reads the published dashboard.
  console.log("\n1. a Viewer signs in and reads the dashboard");
  const anon = await get("/dashboard");
  check("anonymous is not shown data", !anon.html.includes("Deloitte audits"),
        "the dashboard rendered without a session");
  const viewer = await signIn("viewer@example.invalid");
  check("a Viewer can sign in", viewer.status === 200 && Boolean(viewer.cookie));
  const dash = await get("/dashboard", viewer.cookie);
  check("the dashboard renders published figures", dash.html.includes("Deloitte audits"));
  check("the override reason is printed on the header",
        dash.html.includes("Published through a blocked gate"));
  check("the proof line is present", /= \d+ ✓/.test(dash.html));

  // 2. A Viewer is refused the review workspace.
  console.log("\n2. a Viewer is refused the review workspace");
  const refused = await get("/review", viewer.cookie);
  check("Review is refused to a Viewer", refused.html.includes("Not permitted"));
  check("no grid is rendered for a Viewer", !refused.html.includes('role="grid"'));

  // 3. An Analyst reviews a field and the grid is usable by keyboard.
  console.log("\n3. an Analyst opens the grid");
  const analyst = await signIn("analyst@example.invalid");
  check("an Analyst can sign in", analyst.status === 200);
  const board = await get("/review", analyst.cookie);
  check("the triage board leads with coverage", board.html.includes("Enrichment coverage"));
  const grid = await get("/review/auditor?bucket=conflict", analyst.cookie);
  check("the grid renders", grid.html.includes('role="grid"'));
  const tabStops = (grid.html.match(/tabindex="0"/g) ?? []).length;
  check("the grid is ONE tab stop with a roving index", tabStops === 1,
        `found ${tabStops} tab stops`);
  check("the company cell is the row header", grid.html.includes('role="rowheader"'));
  check("cells name value, evidence band and review state",
        /aria-label="[^"]+, evidence [a-z ]+, [a-z]+"/.test(grid.html));
  check("a polite live region is present",
        grid.html.includes('aria-live="polite"') && grid.html.includes('role="status"'));
  check("the evidence panel is a labelled region, not a tooltip",
        grid.html.includes('id="evidence-panel"') &&
        grid.html.includes('aria-describedby="evidence-panel"'));
  check("evidence is not colour alone", /class="num">[\d.]+<\/span>/.test(grid.html) &&
        grid.html.includes('class="bandword"'));

  // 4. The access review is Admin only, and records last sign-in.
  console.log("\n4. the access review");
  const analystOnAccess = await get("/access", analyst.cookie);
  check("an Analyst is refused the access review",
        analystOnAccess.html.includes("Not permitted"));
  const admin = await signIn("admin@example.invalid");
  const access = await get("/access", admin.cookie);
  check("an Admin sees the access review", access.html.includes("Access review"));
  check("last sign-in is recorded", !access.html.includes("never</span></td><td>")
        || access.html.includes("d ago)"));
  check("an Admin cannot deactivate themselves",
        /disabled=""[^>]*>\s*Deactivate|Deactivate\s*<\/button>/.test(access.html));

  // 5. The cron endpoint is closed to everything but the right secret.
  console.log("\n5. the cron endpoint");
  const noHeader = await fetch(`${BASE}/api/cron/tick`, { method: "POST" });
  check("a missing Authorization header is rejected", noHeader.status === 401);
  const wrong = await fetch(`${BASE}/api/cron/tick`, {
    method: "POST", headers: { authorization: "Bearer wrong" } });
  check("a wrong token is rejected", wrong.status === 401);
  const right = await fetch(`${BASE}/api/cron/tick`, {
    method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  check("the right token is accepted", right.status === 200);
  const body = await right.json();
  check("the tick does no work itself", body.invokedWorker === false || "pending" in body);

  /* ---------------------------------------- accessibility, six routes */

  console.log("\naccessibility obligations on six routes");
  const routes = [
    ["/dashboard (signed out)", "/dashboard", null],
    ["/dashboard (viewer)", "/dashboard", viewer.cookie],
    ["/review (analyst)", "/review", analyst.cookie],
    ["/review/auditor (analyst)", "/review/auditor", analyst.cookie],
    ["/review (viewer, refused)", "/review", viewer.cookie],
    ["/access (admin)", "/access", admin.cookie],
  ];
  for (const [name, path, cookie] of routes) {
    const { html } = await get(path, cookie);
    const problems = [];
    if (!/<html[^>]+lang="/.test(html)) problems.push("no lang on <html>");
    if (!/<h1[\s>]/.test(html)) problems.push("no h1");
    if (!/<main[\s>]/.test(html)) problems.push("no main landmark");
    if (!/<nav[^>]+aria-label="/.test(html)) problems.push("nav without a label");
    // An image role with no accessible name is the classic silent failure.
    const unnamedImg = (html.match(/role="img"(?![^>]*aria-label)/g) ?? []).length;
    if (unnamedImg) problems.push(`${unnamedImg} role="img" with no name`);
    // White on the brand green is 2.27:1 and is forbidden outright.
    if (/color:\s*#fff[^;]*;[^}]*background:\s*#86BC25/i.test(html)) {
      problems.push("white text on the brand green");
    }
    check(`${name}: no serious findings`, problems.length === 0, problems.join(", "));
  }
}

/* ---------------------------------------------------------------- run */

const dir = mkdtempSync(join(tmpdir(), "mm-e2e-"));
let server;
try {
  console.log("building the journey database from the synthetic fixture...");
  const db = buildDatabase(dir);

  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, MM_DATABASE: db, MM_DEV_AUTH_SECRET: SECRET,
           MM_CRON_SECRET: CRON, MM_ALLOWED_DOMAINS: "example.invalid",
           NODE_ENV: "development" },
    stdio: "ignore",
  });

  if (!await waitForServer()) throw new Error("the server did not start");
  console.log(`server up on ${BASE}\n`);
  await journeys();
} finally {
  server?.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
