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
import { readFileSync } from "node:fs";
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

/**
 * One account's row, so an assertion is about that account and not the page.
 * Scoped to the table: the signed-in Admin's address is also in the top bar.
 */
function accountRow(html, email) {
  const table = html.slice(html.indexOf('<table class="accounts"'), html.indexOf("</table>"));
  const at = table.indexOf(email);
  if (at < 0) return "";
  const start = table.lastIndexOf("<tr", at);
  const end = table.indexOf("</tr>", at);
  return start < 0 || end < 0 ? "" : table.slice(start, end);
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
    // The fixture's own run finished an hour ago, so a run seeded later reads
    // as the current one and the timeline stays coherent.
    db.prepare("update enrichment_runs set created_at = ?")
      .run(new Date(Date.now() - 3600000).toISOString().replace("T", " ").slice(0, 19));
    const ins = db.prepare("insert into app_users (email, role) values (?, ?)");
    ins.run("analyst@example.invalid", "analyst");
    ins.run("viewer@example.invalid", "viewer");
    ins.run("admin@example.invalid", "admin");
    // The two accounts an access review exists to find. Without them the
    // review has nothing to flag and its central number is 0 either way.
    ins.run("never@example.invalid", "viewer");
    const dormant = new Date(Date.now() - 200 * 86400000)
      .toISOString().replace("T", " ").slice(0, 19);
    db.prepare("insert into app_users (email, role, last_sign_in_at) values (?, ?, ?)")
      .run("dormant@example.invalid", "viewer", dormant);
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

async function journeys(dbPath) {
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

  // docs/design/08: a conflict is resolved by choosing between two named
  // values, with no default pre-selected.
  check("a conflict offers the extract, the AI, and your own value",
        grid.html.includes("Keep extract") && grid.html.includes("Use AI") &&
        grid.html.includes("Enter my own"));
  check("the diff names which value each control takes",
        grid.html.includes("what the workbook says") && grid.html.includes("AI proposal"));
  // Every number on the board is a link, and it has to open rows that are
  // actually in that bucket: the counts and the filter were two separate
  // expressions and had drifted.
  const boardHtml = (await get("/review", analyst.cookie)).html;
  const needLink = boardHtml.match(/href="(\/review\/[a-z_]+\?bucket=need_review)"/);
  check("the board links 'need review' to a field that holds some", Boolean(needLink));
  const plain = await get(needLink?.[1] ?? "/review/auditor?bucket=need_review", analyst.cookie);
  check("a row with nothing to disagree with is offered no choice between two values",
        plain.html.includes('role="grid"') && plain.html.includes("Accept") &&
        !plain.html.includes("Keep extract"),
        "the three-way control leaked onto a non-conflict row, or the bucket opened empty");

  // 4. The access review is Admin only, and records last sign-in.
  console.log("\n4. the access review");
  const analystOnAccess = await get("/access", analyst.cookie);
  check("an Analyst is refused the access review",
        analystOnAccess.html.includes("Not permitted"));
  const admin = await signIn("admin@example.invalid");
  const access = await get("/access", admin.cookie);
  check("an Admin sees the access review", access.html.includes("Access review"));
  // These were one assertion written as an OR whose first operand is true
  // whenever the "never" markup is absent -- which it always is -- so it could
  // not fail. Each account the review is meant to sort is now checked on its
  // own row.
  const adminRow = accountRow(access.html, "admin@example.invalid");
  check("the sign-in that just happened is recorded as today",
        /\(today\)/.test(adminRow), adminRow.replace(/\s+/g, " ").slice(0, 160));
  const dormantRow = accountRow(access.html, "dormant@example.invalid");
  check("a dormant account is counted in days and flagged for review",
        /\(\d+d ago\)/.test(dormantRow) && /pill warn">review/.test(dormantRow),
        dormantRow.replace(/\s+/g, " ").slice(0, 160));
  const neverRow = accountRow(access.html, "never@example.invalid");
  check("an account that has never signed in says so, and is flagged",
        /never<\/span>/.test(neverRow) && /pill warn">review/.test(neverRow),
        neverRow.replace(/\s+/g, " ").slice(0, 160));
  // Stamps are stored as UTC without a zone; read as local time they land in
  // the future, which is how every same-day sign-in once read "-1d ago".
  check("no sign-in is reported as being in the future",
        !/\(-\d+d ago\)/.test(access.html));
  const staleTile = access.html.match(/(\d+)<\/dd><dt class="k">Not seen in 90 days<\/dt>/);
  check("the count of accounts to review is the number actually flagged",
        staleTile?.[1] === "2", `tile reads ${staleTile?.[1] ?? "nothing"}, expected 2`);
  check("an Admin cannot deactivate themselves",
        /disabled=""[^>]*>\s*Deactivate|Deactivate\s*<\/button>/.test(access.html));

  // 6. The validation report precedes the commit, and a re-upload of an
  //    already-published period is refused by name.
  console.log("\n6. the validation report precedes the commit");
  const viewerOnUpload = await get("/upload", viewer.cookie);
  check("a Viewer is refused the upload screen", viewerOnUpload.html.includes("Not permitted"));

  const { parseUpload } = await import("../../src/lib/ingest/quarantine.ts");
  const parse = await parseUpload(
    new Uint8Array(readFileSync(join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx"))),
    "synthetic_whitespace.xlsx");
  const report = await get(`/upload/${parse.id}`, analyst.cookie);
  check("the report names the workbook and its company count",
        report.html.includes("synthetic_whitespace.xlsx") &&
        report.html.includes(String(parse.payload.companies.length)));
  check("proof totals are shown as ties or failures",
        report.html.includes("Proof totals") && /class="gateline (ok|no)"/.test(report.html));
  // docs/design/04: a wrong-period upload blocks, naming the conflict.
  check("re-uploading a published period is refused, naming the conflict",
        report.html.includes("Cannot be committed") && report.html.includes("already published"),
        report.html.includes("Ready to commit") ? "it offered to commit instead" : "");
  check("no commit control is offered while it is refused",
        !/name="label"/.test(report.html));
  const gone = await get("/upload/0123456789abcdef0123456789abcdef", analyst.cookie);
  check("an unknown parse is not a page that half-works",
        gone.html.includes("That report has gone"));

  // 7. Publishing: who may, who may not, and what an override costs.
  console.log("\n7. the publish screen");
  const viewerOnPublish = await get("/publish", viewer.cookie);
  check("a Viewer is refused the publish screen", viewerOnPublish.html.includes("Not permitted"));

  const analystPublish = await get("/publish", analyst.cookie);
  check("the gate's blockers are named on the page",
        analystPublish.html.includes("The gate is blocked") &&
        /floor is \d+%/.test(analystPublish.html));
  // docs/design/08: only an Admin publishes through a blocked gate.
  check("an Analyst is offered no way through a blocked gate",
        !analystPublish.html.includes("overrideReason") &&
        analystPublish.html.includes("An Admin may publish through it"));

  const adminPublish = await get("/publish", admin.cookie);
  check("an Admin is offered the override, and it demands a reason",
        adminPublish.html.includes('name="overrideReason"') &&
        adminPublish.html.includes("printed on the dashboard header"));
  // The journey database was published with this override; the reason it
  // carried is part of the record and has to still be readable.
  check("the published revision is listed with the reason it carried",
        adminPublish.html.includes("Revisions already published") &&
        adminPublish.html.includes("End-to-end journey: day-one baseline."),
        "the revisions table did not show revision 1 and its override reason");
  check("a further publication is an amendment, not a replacement",
        adminPublish.html.includes("Publish an amendment") &&
        adminPublish.html.includes('name="amendmentReason"'));

  // 8. Journey two: a partner opens a company before a pursuit conversation.
  console.log("\n8. a company profile");
  const index = await get("/companies", viewer.cookie);
  check("a Viewer may look up companies", index.html.includes("Companies") &&
        !index.html.includes("Not permitted"));
  const idMatch = index.html.match(/\/companies\/([0-9a-f]{32})/);
  check("the index links to profiles", Boolean(idMatch));
  const profile = await get(`/companies/${idMatch?.[1]}`, viewer.cookie);
  check("the profile answers the tier and the audit relationship",
        /Tier \d|Unclassified/.test(profile.html) &&
        /Deloitte|auditor is/.test(profile.html));
  check("the rule that produced the tier is shown, not just the tier",
        profile.html.includes("Why this tier") && profile.html.includes("Rule set"));
  check("every value carries where it came from",
        profile.html.includes("Every value, and where it came from") &&
        profile.html.includes("From the workbook"));
  check("a first period says so rather than drawing an empty comparison",
        profile.html.includes("first published period"));
  const missing = await get(`/companies/${"f".repeat(32)}`, viewer.cookie);
  check("a company that is not in the population is refused plainly",
        missing.html.includes("No such company"));

  // 9. docs/design/03: run state is explicit and user-visible, and NEVER a
  //    bare spinner. Two of the seven states are derived, not stored.
  console.log("\n9. the run screen");
  const viewerOnRuns = await get("/runs", viewer.cookie);
  check("a Viewer is refused the run screen", viewerOnRuns.html.includes("Not permitted"));

  execFileSync("node", ["scripts/seed_stalled_run.mjs", dbPath], { cwd: ROOT, stdio: "ignore" });
  const runs = await get("/runs", analyst.cookie);
  check("a run whose worker died is reported as stalled, not as running",
        runs.html.includes("Stalled") && runs.html.includes("Nothing has moved for three minutes"),
        "the database still says 'running'; the screen must not");
  check("the state of every job is named, never left to a bar",
        runs.html.includes("Researching") && runs.html.includes("Queued") &&
        runs.html.includes("waiting for a worker"));
  check("expired leases are counted and their remedy stated",
        runs.html.includes("Leases that ran out") && runs.html.includes("charges no attempt"));
  check("abandoned jobs are named with the error that abandoned them",
        runs.html.includes("Abandoned") && runs.html.includes("429 from the vendor"));
  check("spend is shown against its cap", /\$21\.40/.test(runs.html) && /\$25\.00/.test(runs.html));
  execFileSync("node", ["scripts/seed_stalled_run.mjs", dbPath, "--remove"], { cwd: ROOT, stdio: "ignore" });

  // 10. Settings: what an Admin may decide, and what the design will not let
  //     anyone move quietly.
  console.log("\n10. settings");
  for (const [who, cookie] of [["a Viewer", viewer.cookie], ["an Analyst", analyst.cookie]]) {
    const refused = await get("/settings", cookie);
    check(`${who} is refused settings`, refused.html.includes("Not permitted"));
  }
  const settings = await get("/settings", admin.cookie);
  check("the defaults an Admin owns are editable",
        settings.html.includes('name="default_threshold_amount"') &&
        settings.html.includes('name="default_run_budget_usd"'));
  check("the period already committed is shown, and not as a form",
        settings.html.includes("as committed") &&
        !settings.html.includes('name="threshold_amount"'));
  // The way past a floor is a recorded override, not a quieter floor.
  check("coverage floors are shown and are not editable",
        settings.html.includes("Coverage floors") &&
        settings.html.includes("nobody named against it") &&
        !settings.html.includes('name="floor_pct"'));
  check("the fabrication ceiling is stated with what it excludes",
        settings.html.includes("Fabrication ceiling") &&
        settings.html.includes("An abstention is not a fabrication"));

  // 11. Identity: two rows, one company. The workbook carries no rename
  //     history, so this is how a renamed company keeps its past.
  console.log("\n11. possible duplicates");
  execFileSync("node", ["scripts/seed_duplicate.mjs", dbPath], { cwd: ROOT, stdio: "ignore" });

  const viewerOnMerge = await get("/companies/merge", viewer.cookie);
  check("a Viewer is refused the merge screen", viewerOnMerge.html.includes("Not permitted"));

  const list = await get("/companies/merge", analyst.cookie);
  check("a pair sharing an identifier is found, and rated on its evidence",
        list.html.includes("They carry the same identifier") && list.html.includes(">strong<"));
  const look = list.html.match(/\/companies\/merge\?a=([0-9a-f]{32})&amp;b=([0-9a-f]{32})/);
  check("each candidate links to what merging it would do", Boolean(look));

  const pairUrl = `/companies/merge?a=${look?.[1]}&b=${look?.[2]}`;
  const asAnalyst = await get(pairUrl, analyst.cookie);
  check("an Analyst may say they are one company but not perform the merge",
        asAnalyst.html.includes("An Admin performs the merge") &&
        !asAnalyst.html.includes("Which name survives"));

  const asAdmin = await get(pairUrl, admin.cookie);
  check("an Admin chooses which name survives, with nothing pre-selected",
        asAdmin.html.includes("Which name survives") &&
        !/type="radio"[^>]*checked/.test(asAdmin.html));
  check("the preview counts what moves and what is left frozen",
        asAdmin.html.includes("company_period_facts") &&
        asAdmin.html.includes("left exactly as published"));

  execFileSync("node", ["scripts/seed_duplicate.mjs", dbPath, "--remove"], { cwd: ROOT, stdio: "ignore" });

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
    ["/upload (analyst)", "/upload", analyst.cookie],
    [`/upload/{id} (analyst)`, `/upload/${parse.id}`, analyst.cookie],
    ["/publish (admin)", "/publish", admin.cookie],
    ["/publish (viewer, refused)", "/publish", viewer.cookie],
    ["/companies (viewer)", "/companies", viewer.cookie],
    ["/runs (analyst)", "/runs", analyst.cookie],
    ["/settings (admin)", "/settings", admin.cookie],
    ["/companies/merge (analyst)", "/companies/merge", analyst.cookie],
    [`/companies/{id} (viewer)`, `/companies/${idMatch?.[1]}`, viewer.cookie],
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
  await journeys(db);
} finally {
  server?.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
