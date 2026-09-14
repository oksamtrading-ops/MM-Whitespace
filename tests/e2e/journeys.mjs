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
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Fixture passwords. Long enough to satisfy the policy, and obviously not
   secrets: they exist only inside a temporary database this script creates. */
const ANALYST_PASSWORD = "journey analyst password";
const NEVER_PASSWORD = "journey never password";
const TEMP_PASSWORD = "journey temporary password";

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
 * A row carrying the review flag. The pill holds an icon before its word
 * (docs/design/18 section 8), so the class and the word are not adjacent.
 */
const FLAGGED = /class="pill warn">(?:<svg[\s\S]*?<\/svg>)?review<\/span>/;

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

/**
 * A link, straight into the table. The mailbox is not the thing under test,
 * Sign in through the library rather than the form.
 *
 * This suite does not drive server actions, and password sign-in has no route
 * to drive -- which is exactly why the decision lives in a library. Returns the
 * cookie header a browser would have been sent, or null if it was refused.
 */
function signInDirectly(dbPath, email, password) {
  try {
    const out = execFileSync("node", ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      import { SqliteSql } from "./src/lib/db/sqlite.ts";
      import { attemptSignIn } from "./src/lib/auth/signin.ts";
      const handle = new DatabaseSync(${JSON.stringify(dbPath)});
      handle.exec("pragma foreign_keys = on");
      const db = new SqliteSql(handle);
      const got = await attemptSignIn(db, {
        email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}, ip: "10.0.0.9" });
      process.stdout.write(got.ok ? got.session.token : "");
      await db.close();
    `], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return out ? `mm_session=${out}` : null;
  } catch (err) {
    console.log(`  signIn failed: ${(err.stderr ?? err.message).toString().trim().split("\n").pop()}`);
    return null;
  }
}

/** Replace a password the way the /password action does, through the library. */
function changePasswordDirectly(dbPath, email, current, next) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    import { SqliteSql } from "./src/lib/db/sqlite.ts";
    import { changePassword } from "./src/lib/auth/signin.ts";
    const handle = new DatabaseSync(${JSON.stringify(dbPath)});
    handle.exec("pragma foreign_keys = on");
    const db = new SqliteSql(handle);
    const u = await db.get("select id from app_users where email = ?", ${JSON.stringify(email)});
    await changePassword(db, { userId: u.id, current: ${JSON.stringify(current)},
                               next: ${JSON.stringify(next)}, confirm: ${JSON.stringify(next)} });
    await db.close();
  `], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}

/** Give somebody a password in the fixture, the way an Admin would. */
function setPasswordDirectly(dbPath, email, password, mustChange = false) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    import { SqliteSql } from "./src/lib/db/sqlite.ts";
    import { hashPassword } from "./src/lib/auth/password.ts";
    const handle = new DatabaseSync(${JSON.stringify(dbPath)});
    handle.exec("pragma foreign_keys = on");
    const db = new SqliteSql(handle);
    const u = await db.get("select id from app_users where email = ?", ${JSON.stringify(email)});
    await db.run("insert into auth_passwords (user_id, hash, set_at) values (?, ?, ?)",
                 u.id, await hashPassword(${JSON.stringify(password)}), "2026-01-01 00:00:00.000000");
    await db.run("update app_users set must_change_password = ? where id = ?",
                 ${mustChange ? "true" : "false"}, u.id);
    await db.close();
  `], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}

/**
 * A run, created the way the start-run action creates one -- through the same
 * library function, with the same refusals -- and then left for the worker.
 */
function startRunDirectly(dbPath, email) {
  try {
    return execFileSync("node", ["--input-type=module", "-e", `
      import { DatabaseSync } from "node:sqlite";
      import { SqliteSql } from "./src/lib/db/sqlite.ts";
      import { startRun } from "./src/lib/enrich/start.ts";
      const handle = new DatabaseSync(${JSON.stringify(dbPath)});
      handle.exec("pragma foreign_keys = on");
      const db = new SqliteSql(handle);
      const period = await db.get("select id from periods order by market_cap_as_of desc limit 1");
      const user = await db.get("select id, role from app_users where email = ?", ${JSON.stringify(email)});
      const r = await startRun(db, { periodId: period.id, scope: "all", budgetUsd: 25, mode: "replay",
                                     actor: { id: user.id, role: user.role } });
      process.stdout.write(r.runId);
      await db.close();
    `], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    console.log(`  startRun failed: ${(err.stderr ?? err.message).toString().trim().split("\n").pop()}`);
    return null;
  }
}

/**
 * Accept a field's current proposal, then record a LATER one that says
 * something else -- the situation Run 1 produced twice. Done straight into the
 * database because the clock is what matters: the decision must predate the
 * proposal, and both happen within one second of each other here.
 */
function supersedeDecision(dbPath, fieldKey, newValue) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    const f = db.prepare(\`select e.*, r.period_id from enrichment_findings e
        join enrichment_runs r on r.id = e.run_id
       where e.field_key = ? order by e.created_at limit 1\`).get(${JSON.stringify(fieldKey)});
    db.prepare(\`insert into review_decisions
        (period_id, company_id, field_key, decision, finding_id, finding_attempt, decided_at)
        values (?, ?, ?, 'accept', ?, ?, '2026-01-01 00:00:00')\`)
      .run(f.period_id, f.company_id, f.field_key, f.id, f.attempt);
    db.prepare(\`insert into company_period_field_values
        (period_id, company_id, field_key, value, source, evidence_state)
        values (?, ?, ?, ?, 'ai_accepted', 'asserted')
        on conflict (period_id, company_id, field_key) do update set value = excluded.value,
            source = 'ai_accepted'\`)
      .run(f.period_id, f.company_id, f.field_key, f.proposed_value);
    db.prepare(\`insert into enrichment_findings
        (run_id, job_id, attempt, company_id, field_key, proposed_value, evidence_strength,
         anchor_mode, state, evidence_excerpt, model, prompt_version, created_at)
        values (?, ?, ?, ?, ?, ?, 0.9, 'exact_normalized', 'proposed', ?, ?, ?, '2026-06-01 00:00:00')\`)
      .run(f.run_id, f.job_id, f.attempt + 90, f.company_id, f.field_key,
           ${JSON.stringify(newValue)}, f.evidence_excerpt ?? 'a later filing', f.model, f.prompt_version);
  `], { cwd: ROOT, stdio: "ignore" });
}

function setActive(dbPath, email, active) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.prepare("update app_users set is_active = ? where email = ?")
      .run(${active ? 1 : 0}, ${JSON.stringify(email)});
  `], { cwd: ROOT, stdio: "ignore" });
}

function seedPursuit(dbPath, email, note) {
  return execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    const id = () => db.prepare("select lower(hex(randomblob(16))) v").get().v;
    const co = db.prepare("select id, canonical_name from companies order by canonical_name limit 1").get();
    const who = db.prepare("select id from app_users where email = ?").get(${JSON.stringify(email)});
    const p = id();
    db.prepare("insert into pursuits (id, company_id, priority, owner_id, created_at) values (?,?,?,?,?)")
      .run(p, co.id, "High", who.id, "2026-09-13 09:00:00.000000");
    db.prepare("insert into pursuit_notes (id, pursuit_id, body, author_id, created_at) values (?,?,?,?,?)")
      .run(id(), p, ${JSON.stringify(note)}, who.id, "2026-09-13 09:05:00.000000");
    db.prepare("insert into pursuit_actions (id, pursuit_id, description, due_date, owner_id, status, created_at) values (?,?,?,?,?,?,?)")
      .run(id(), p, "Send the fee benchmark", "2026-10-01", who.id, "Open", "2026-09-13 09:06:00.000000");
    process.stdout.write(JSON.stringify({ pursuitId: p, companyId: co.id, name: co.canonical_name }));
  `], { cwd: ROOT, encoding: "utf8" });
}

function strandAction(dbPath, status) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.prepare("update pursuit_actions set status = ?").run(${JSON.stringify(status)});
  `], { cwd: ROOT, stdio: "ignore" });
}

function datePastDue(dbPath) {
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.prepare("update pursuit_actions set due_date = '2000-01-01', status = 'Open'").run();
  `], { cwd: ROOT, stdio: "ignore" });
}

function analystId(dbPath) {
  return execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    process.stdout.write(db.prepare("select id from app_users where email = 'analyst@example.invalid'").get().id);
  `], { cwd: ROOT, encoding: "utf8" });
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
    // An analyst holding a password somebody else chose, for the gate. It is
    // given a recent sign-in on purpose: the access review's own fixture is two
    // stale accounts and exactly two, and a third would quietly weaken the
    // assertion that its central number is the number actually flagged.
    db.prepare("insert into app_users (email, role, last_sign_in_at) values (?, ?, ?)")
      .run("temp@example.invalid", "analyst",
           new Date().toISOString().replace("T", " ").slice(0, 19));
  `], q);

  // Passwords, hashed the way the application hashes them. The dev sign-in
  // route bypasses all of this -- which is why every other journey is
  // unaffected by the change and journey 6 has to set them explicitly.
  setPasswordDirectly(db, "analyst@example.invalid", ANALYST_PASSWORD);
  setPasswordDirectly(db, "never@example.invalid", NEVER_PASSWORD);
  setPasswordDirectly(db, "temp@example.invalid", TEMP_PASSWORD, true);
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

  // Run 2: 25 companies of anchored, quoted values sat at 0.71-0.79, under a
  // bulk floor fixed at 0.80, so every one had to be taken by hand.
  const atDefault = await get("/review/auditor?bucket=all", analyst.cookie);
  check("the bulk floor is offered as a choice, not fixed",
        atDefault.html.includes("Bulk accept at evidence") &&
        atDefault.html.includes("threshold=0.7"));
  // React separates adjacent text with <!-- -->; read the text, not the markup.
  const said = (page) => page.html.replace(/<!-- -->/g, "");
  check("and the button says the floor it would apply",
        said(atDefault).includes("Accept ≥ 0.80 in bulk"));
  const lowered = await get("/review/auditor?bucket=all&threshold=0.7", analyst.cookie);
  check("choosing a lower floor changes what bulk accept would take",
        said(lowered).includes("Accept ≥ 0.70 in bulk"));
  // A floor nobody offered is not honoured: a URL is not a place to invent one.
  const invented = await get("/review/auditor?bucket=all&threshold=0.01", analyst.cookie);
  check("an invented floor falls back to the default",
        said(invented).includes("Accept ≥ 0.80 in bulk"));

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
        /\(\d+d ago\)/.test(dormantRow) && FLAGGED.test(dormantRow),
        dormantRow.replace(/\s+/g, " ").slice(0, 160));
  const neverRow = accountRow(access.html, "never@example.invalid");
  check("an account that has never signed in says so, and is flagged",
        /never<\/span>/.test(neverRow) && FLAGGED.test(neverRow),
        neverRow.replace(/\s+/g, " ").slice(0, 160));
  // Stamps are stored as UTC without a zone; read as local time they land in
  // the future, which is how every same-day sign-in once read "-1d ago".
  check("no sign-in is reported as being in the future",
        !/\(-\d+d ago\)/.test(access.html));
  const staleTile = access.html.match(
    /<div class="v">(\d+)<\/div><div class="l">(?:(?!<\/div>)[\s\S])*?Not seen in 90 days/);
  check("the count of accounts to review is the number actually flagged",
        staleTile?.[1] === "2", `tile reads ${staleTile?.[1] ?? "nothing"}, expected 2`);
  check("an Admin cannot deactivate themselves",
        /disabled=""[^>]*>\s*Deactivate|Deactivate\s*<\/button>/.test(access.html));

  // 6. The validation report precedes the commit, and a re-upload of an
  //    already-published period is refused by name.
  console.log("\n6. the validation report precedes the commit");
  const viewerOnUpload = await get("/upload", viewer.cookie);
  check("a Viewer is refused the upload screen", viewerOnUpload.html.includes("Not permitted"));

  // The parse is made here and read by the server, so both have to open the
  // same database: the held parse lives in upload_quarantine, not in a folder.
  const { parseUpload } = await import("../../src/lib/ingest/quarantine.ts");
  const { SqliteSql } = await import("../../src/lib/db/sqlite.ts");
  const { DatabaseSync } = await import("node:sqlite");
  const shared = new SqliteSql(new DatabaseSync(dbPath));
  const parse = await parseUpload(shared,
    new Uint8Array(readFileSync(join(ROOT, "tests", "fixtures", "synthetic_whitespace.xlsx"))),
    "synthetic_whitespace.xlsx");
  await shared.close();
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

  // Journey four: the deliverable is a clean workbook the application builds,
  // and it is a download in the application rather than a command line.
  check("the publish screen offers the export", adminPublish.html.includes("/api/export"));
  const download = await fetch(`${BASE}/api/export`, { headers: { cookie: analyst.cookie } });
  const workbook = Buffer.from(await download.arrayBuffer());
  check("an Analyst downloads the period as a workbook",
        download.status === 200 &&
        /spreadsheetml/.test(download.headers.get("content-type") ?? "") &&
        /attachment; filename="MM Whitespace .*\.xlsx"/.test(download.headers.get("content-disposition") ?? "") &&
        workbook.subarray(0, 2).toString("latin1") === "PK" && workbook.byteLength > 5000,
        `status ${download.status}, ${workbook.byteLength} bytes`);
  const csvDownload = await fetch(`${BASE}/api/export?format=csv`, { headers: { cookie: analyst.cookie } });
  const csv = await csvDownload.text();
  check("and as a flat csv, with the licence notices on it",
        csvDownload.status === 200 && csv.startsWith("# ") && csv.includes("Northco Mining Corp."));
  // The export carries unpublished values, so it is not a Viewer's to take.
  const refusedExport = await fetch(`${BASE}/api/export`, { headers: { cookie: viewer.cookie } });
  check("a Viewer is refused the export", refusedExport.status === 403);
  const anonExport = await fetch(`${BASE}/api/export`);
  check("and so is a caller with no session", anonExport.status === 401);

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

  // Run 1: review changed a company after publication and the profile, which
  // reads the published revision, kept saying the old thing without a word.
  {
    const { DatabaseSync } = await import("node:sqlite");
    const handle = new DatabaseSync(dbPath);
    const companyId = idMatch?.[1];
    const periodId = handle.prepare("select id from periods order by market_cap_as_of desc limit 1").get().id;
    const before = handle.prepare(`select value, source, evidence_state from company_period_field_values
        where period_id = ? and company_id = ? and field_key = 'website'`).get(periodId, companyId);
    const put = (value, source, state) => {
      handle.prepare(`delete from company_period_field_values
          where period_id = ? and company_id = ? and field_key = 'website'`).run(periodId, companyId);
      if (value !== undefined) {
        handle.prepare(`insert into company_period_field_values
            (period_id, company_id, field_key, value, source, evidence_state) values (?, ?, 'website', ?, ?, ?)`)
          .run(periodId, companyId, value, source, state);
      }
    };
    const asAnalyst = await get(`/companies/${companyId}`, analyst.cookie);
    check("an unchanged company carries no unpublished notice", !asAnalyst.html.includes("Not yet published"));
    put('"https://changed-in-review.example"', "manual_entry", "asserted");
    const changed = await get(`/companies/${companyId}`, analyst.cookie);
    // React separates adjacent text with <!-- -->; read the text, not the markup.
    const said = changed.html.replace(/<!-- -->/g, "");
    check("an Analyst is told what review changed since the published revision",
          said.includes("Not yet published") && /changed\s+in review: [^<]*Website/.test(said) &&
          /Publish revision \d+/.test(said),
          said.match(/Not yet published[\s\S]{0,400}/)?.[0] ?? "no notice");
    const asViewer = await get(`/companies/${companyId}`, viewer.cookie);
    check("a Viewer is not", !asViewer.html.includes("Not yet published") &&
          !asViewer.html.includes("changed-in-review"));
    put(before?.value, before?.source, before?.evidence_state);
    handle.close();
  }

  // Run 1, twice over: a value accepted, then researched again with a better
  // answer, and the row hidden from every queue because it counted as decided
  // -- with its controls hidden too, so even finding it left nothing to click.
  supersedeDecision(dbPath, "auditor", '"Ernst & Young"');
  const supersededBoard = (await get("/review", analyst.cookie)).html;
  check("the board counts values that later research disagrees with",
        supersededBoard.includes("accepted, then researched again"));
  const superseded = await get("/review/auditor?bucket=superseded", analyst.cookie);
  check("the row is listed, and says its decision has been overtaken",
        superseded.html.includes("newer research") && superseded.html.includes("Ernst &amp; Young"),
        "the superseded bucket did not open the row");
  check("and it can be taken, which a decided row otherwise cannot",
        superseded.html.includes("Take the newer research"),
        "a decided row's controls stayed hidden, so the newer value could not be accepted");

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

  // 12. docs/design/08 keeps company-major for the pursuit-preparation
  //     journey. Both axes read the same values; only the axis differs.
  console.log("\n12. the same proposals, one company across the row");
  const viewerByCompany = await get("/review/by-company", viewer.cookie);
  check("a Viewer is refused it too", viewerByCompany.html.includes("Not permitted"));

  const byCompany = await get("/review/by-company", analyst.cookie);
  check("the grid has a column per reviewable field",
        byCompany.html.includes('role="grid"') &&
        /aria-colcount="([2-9]|\d\d)"/.test(byCompany.html));
  const stops = (byCompany.html.match(/tabindex="0"/g) ?? []).length;
  check("two axes, still ONE tab stop", stops === 1, `found ${stops}`);
  check("the company cell is still the row header",
        byCompany.html.includes('role="rowheader"'));
  check("every cell names its field, value, band and state",
        /aria-label="[^"]+, evidence [a-z ]+, [a-z]+"/.test(byCompany.html));
  check("a cell with nothing proposed says so rather than being blank",
        byCompany.html.includes("nothing proposed") ||
        !byCompany.html.includes('aria-label=""'));
  // The default is field-major, and this screen says why.
  check("it points back to the field view as the place the queue lives",
        byCompany.html.includes("field view") &&
        byCompany.html.includes("reuses a single mental model"));

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

  // 6. Magic link, over HTTP. Redemption is a GET, because it is reached by
  // driving the sign-in FORM: the suite does not drive server actions, which is
  // why the decision lives in src/lib/auth/signin.ts and not in the action. So
  // the attempt is made through the library, in a subprocess, and everything
  // that follows -- the cookie, the gate, the deactivation -- is real HTTP.
  console.log("\n6. password sign-in, and the temporary password that must be changed");

  check("a wrong password is refused",
        signInDirectly(dbPath, "analyst@example.invalid", "not the password") === null);

  const sessionCookie = signInDirectly(dbPath, "analyst@example.invalid", ANALYST_PASSWORD);
  check("the right password mints a session", Boolean(sessionCookie));

  const withSession = await get("/review", sessionCookie);
  check("the session opens the review board",
        withSession.status === 200 && !withSession.html.includes("Not permitted"));

  // The throttle, over the same path a person would take. Eight wrong guesses
  // and the RIGHT password stops working -- which is the point, and also the
  // denial of service the migration's comment owns up to.
  for (let i = 0; i < 8; i += 1) signInDirectly(dbPath, "never@example.invalid", `wrong ${i}`);
  check("eight wrong guesses shut the door on the right one",
        signInDirectly(dbPath, "never@example.invalid", NEVER_PASSWORD) === null,
        "the throttle did not bite");

  // THE GATE, over HTTP. Somebody holding a password an Admin chose reaches
  // exactly one screen, and a unit test cannot show that the other twenty
  // refuse -- only a real request can.
  const tempCookie = signInDirectly(dbPath, "temp@example.invalid", TEMP_PASSWORD);
  check("a temporary password still signs in", Boolean(tempCookie));

  const gatedReview = await get("/review", tempCookie);
  check("but it reaches no review board", !gatedReview.html.includes("Your queue"),
        "a user owing a password change reached the queue");
  const gatedExport = await fetch(`${BASE}/api/export?format=csv`,
                                  { headers: { cookie: tempCookie ?? "" } });
  check("and no export", gatedExport.status === 401, `status ${gatedExport.status}`);
  const gatedPassword = await get("/password", tempCookie);
  check("the one screen it does reach is the password screen",
        gatedPassword.status === 200 && gatedPassword.html.includes("Current password"));

  changePasswordDirectly(dbPath, "temp@example.invalid", TEMP_PASSWORD, "a replacement password");
  const freed = signInDirectly(dbPath, "temp@example.invalid", "a replacement password");
  const freedReview = await get("/review", freed);
  check("once changed, the gate lifts", freedReview.html.includes("Your queue"),
        "the queue was still refused after the password was replaced");

  // Deactivation is the whole of offboarding for an application outside
  // Deloitte's estate, so it has to end a session that is ALREADY RUNNING
  // rather than only the next sign-in.
  setActive(dbPath, "analyst@example.invalid", false);
  const afterOff = await get("/review", sessionCookie);
  check("DEACTIVATION ENDS A SESSION ALREADY RUNNING",
        !afterOff.html.includes("Your queue"),
        "the deactivated analyst still reached the review board");
  setActive(dbPath, "analyst@example.invalid", true);

  // 7. A run is started, a worker drains it over HTTP, and the schedule is
  // recorded. The fixture period already has findings from the seeded review
  // queue, so the only scope left is a full re-run -- which is Admin-only.
  console.log("\n7. an enrichment run, end to end");
  const runsAsAnalyst = await get("/runs", analyst.cookie);
  check("the run screen offers a scope with its estimate",
        runsAsAnalyst.html.includes("Start a run") && runsAsAnalyst.html.includes("Estimate"));
  check("a full re-run of a period with findings is Admin-only, and the screen says so",
        runsAsAnalyst.html.includes("Admin-only"));
  const runsAsAdmin = await get("/runs", admin.cookie);
  // React separates adjacent text segments with a comment node on the server,
  // so the label and the count are matched loosely.
  check("an Admin is offered every company in the period",
        /Every company in the period[\s\S]{0,40}<b>8<\/b>/.test(runsAsAdmin.html));

  // The form posts a server action, which this suite does not drive; the
  // action's refusals are unit-tested. Start the run the way the action
  // does, then drive the worker the way the tick does: over HTTP.
  const runId = startRunDirectly(dbPath, "admin@example.invalid");
  check("a run was created for the period", Boolean(runId), "startRun threw");

  const noAuth = await fetch(`${BASE}/api/worker/drain`, { method: "POST" });
  check("the worker refuses a missing bearer", noAuth.status === 401);
  const asked = await fetch(`${BASE}/api/worker/drain`, {
    method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  check("the worker accepts the ask and answers before it drains", asked.status === 202);

  let runsHtml = "";
  for (let i = 0; i < 80; i++) {
    runsHtml = (await get("/runs", admin.cookie)).html;
    if (/<b>Completed( with errors)?<\/b>/.test(runsHtml)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check("the run finishes: two companies had recordings, six did not",
        runsHtml.includes("Completed with errors"), "the run never reached a terminal state");
  check("abandoned jobs name the reason", runsHtml.includes("cassette miss"));
  check("the worker's own record says it drained the queue", runsHtml.includes("drained the queue"));
  check("one run at a time: the start form is withdrawn while a run exists and offered again after",
        runsHtml.includes("Start a run"));

  // The scheduler calls with GET. The first twelve hours of production ticks
  // answered 405 to that, which nothing recorded.
  const tickGet = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${CRON}` } });
  check("the tick answers GET, which is what the scheduler sends", tickGet.status === 200);
  const tickBody = await tickGet.json();
  check("a tick with nothing left to do asks for no worker",
        tickBody.invokedWorker === false && tickBody.note === "nothing to do");
  const afterTick = (await get("/runs", admin.cookie)).html;
  check("the tick is recorded on the run screen even though it did nothing",
        /Ticks, last 24 h/.test(afterTick) && !afterTick.includes("none recorded"));

  /* ------------------------------ journey 8 — the pursuit workflow */

  console.log("\njourney 8 — what the practice decided to do");
  const PURSUIT_NOTE = "Partner met the CFO; audit tender expected in Q1.";
  const seeded = JSON.parse(seedPursuit(dbPath, "analyst@example.invalid", PURSUIT_NOTE));

  const pursuitList = await get("/pursuits", analyst.cookie);
  check("an Analyst sees the pursuit list",
        pursuitList.status === 200 && pursuitList.html.includes(seeded.name));
  check("with its priority and its open action",
        pursuitList.html.includes("High") && /1 open/.test(pursuitList.html));

  const pursuitPage = await get(`/pursuits/${seeded.pursuitId}`, analyst.cookie);
  check("the pursuit opens, with the note and the action on it",
        pursuitPage.html.includes(PURSUIT_NOTE) &&
        pursuitPage.html.includes("Send the fee benchmark"));
  check("and it links back to the evidence, which is the company profile",
        pursuitPage.html.includes(`/companies/${seeded.companyId}`));

  // THE ONE THAT MATTERS. Pursuit content is Deloitte internal: a Viewer is a
  // partner, and docs/design/11 keeps them out by policy rather than by
  // whether a link is drawn.
  const viewerList = await get("/pursuits", viewer.cookie);
  check("a Viewer is refused the pursuit list",
        !viewerList.html.includes(seeded.name) && /Not permitted/.test(viewerList.html));
  const viewerPursuit = await get(`/pursuits/${seeded.pursuitId}`, viewer.cookie);
  check("and refused one pursuit, without being told what is in it",
        !viewerPursuit.html.includes(PURSUIT_NOTE) && /Not permitted/.test(viewerPursuit.html));

  const viewerProfile = await get(`/companies/${seeded.companyId}`, viewer.cookie);
  check("a Viewer's company profile offers no pursuit and does not say one exists",
        !viewerProfile.html.includes("Start a pursuit") &&
        !viewerProfile.html.includes("Open the pursuit"));
  const analystProfile = await get(`/companies/${seeded.companyId}`, analyst.cookie);
  check("an Analyst's does, and it points at the one already open",
        analystProfile.html.includes("Open the pursuit"));

  // The repair for a renamed status appears only when there is something to
  // repair, and names what is stranded rather than asking the person to know.
  check("with nothing stranded, the sweep section is not on the page",
        !pursuitList.html.includes("no longer a status in use"));
  strandAction(dbPath, "Superseded");
  const stranded = await get("/pursuits", analyst.cookie);
  check("a status the vocabulary no longer knows is named, with its count",
        /One action carries .{1,12}Superseded.{1,12}, which is no longer a status in use/.test(stranded.html),
        "the sweep section did not appear");
  check("and it counts as open until it is moved",
        /1 open/.test(stranded.html));

  // A due date nothing ever mentions is not a date. The seeded action is due
  // 2026-10-01, which is past by the time this suite runs on any later clock,
  // so the assertion is on the mechanism rather than on a particular word.
  datePastDue(dbPath);
  const overdue = await get("/pursuits", analyst.cookie);
  check("an action past its date is said, on the list, not only on the action",
        /overdue/i.test(overdue.html), "nothing on /pursuits mentions it");

  // Every narrowed view is its own address, so it can be sent to somebody.
  const mine = await get(`/pursuits?owner=${analystId(dbPath)}`, analyst.cookie);
  check("a narrowed view is a URL, and the server does the narrowing",
        mine.status === 200 && mine.html.includes(seeded.name));
  const nobodys = await get("/pursuits?owner=unassigned", analyst.cookie);
  check("and it actually narrows: an unassigned filter hides an owned pursuit",
        !nobodys.html.includes(seeded.name) && /Nothing open matches that/.test(nobodys.html));
  const nonsense = await get("/pursuits?sort=nonsense", analyst.cookie);
  check("a sort nobody asked for falls back rather than failing",
        nonsense.status === 200 && nonsense.html.includes(seeded.name));

  const signedOut = await get("/pursuits", null);
  check("signed out, the pursuit list asks for a sign-in rather than rendering",
        !signedOut.html.includes(seeded.name));

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
    ["/runs (admin, after a run)", "/runs", admin.cookie],
    ["/settings (admin)", "/settings", admin.cookie],
    ["/companies/merge (analyst)", "/companies/merge", analyst.cookie],
    ["/review/by-company (analyst)", "/review/by-company", analyst.cookie],
    [`/companies/{id} (viewer)`, `/companies/${idMatch?.[1]}`, viewer.cookie],
    ["/pursuits (analyst)", "/pursuits", analyst.cookie],
    [`/pursuits/{id} (analyst)`, `/pursuits/${seeded.pursuitId}`, analyst.cookie],
    ["/pursuits (viewer, refused)", "/pursuits", viewer.cookie],
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
    // session+dev: journey 6 drives the real magic-link route, and the other
    // five mint dev sessions rather than making every run wait on an inbox.
    env: { ...process.env, MM_DATABASE: db, MM_DEV_AUTH_SECRET: SECRET,
           MM_CRON_SECRET: CRON, MM_ALLOWED_DOMAINS: "example.invalid",
           MM_AUTH: "session+dev", MM_MAIL: "log",
           // Journey 7 starts a run. Replay sends nothing anywhere.
           MM_ENRICH_MODE: "replay",
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
