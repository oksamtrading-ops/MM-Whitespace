/**
 * Fail the build if any route handler or server action does not begin with an
 * authorisation check.
 *
 * This exists because middleware is not an authorisation boundary: every Server
 * Action compiles to an addressable endpoint whether or not the control that
 * calls it ever renders, so a Viewer who can sign in could call publish. A
 * convention would not survive six months; a check that fails the build will.
 *
 * An endpoint that genuinely needs no role must say so out loud:
 *
 *     // @public-endpoint the cron tick authorises with a bearer secret instead
 *     export async function POST(request) { ... }
 *
 * which makes every exception visible and reviewable rather than silent.
 *
 *   node scripts/check_role_assertions.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Scans the repository by default; an explicit root makes the checker itself
// testable, which matters because a check that never fails proves nothing.
const ROOT = process.argv[2]
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const GUARDS = ["requireRole", "assertRole", "authoriseCron"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files whose exports are addressable endpoints. */
function isGuarded(file, source) {
  if (/[/\\]app[/\\].*route\.tsx?$/.test(file)) return true;
  return /^\s*["']use server["']/m.test(source);
}

const EXPORT_FN = /^[ \t]*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm;

function findings() {
  const problems = [];
  for (const file of walk(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    if (!isGuarded(file, source)) continue;

    const isRoute = /[/\\]app[/\\].*route\.tsx?$/.test(file);
    for (const match of source.matchAll(EXPORT_FN)) {
      const name = match[1];
      if (isRoute && !HTTP_METHODS.has(name)) continue;

      // An explicit, documented exception on the preceding lines.
      const before = source.slice(0, match.index);
      const preceding = before.split("\n").slice(-4).join("\n");
      if (/@public-endpoint/.test(preceding)) continue;

      // The body up to the first statement terminator.
      const bodyStart = source.indexOf("{", match.index + match[0].length - 1);
      const body = source.slice(bodyStart + 1, bodyStart + 600);
      const firstStatement = body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"))[0] ?? "";

      if (!GUARDS.some((g) => firstStatement.includes(g))) {
        problems.push({
          file: relative(ROOT, file),
          name,
          got: firstStatement.slice(0, 70) || "(empty body)",
        });
      }
    }
  }
  return problems;
}

const problems = findings();
if (problems.length === 0) {
  console.log("auth check: every route handler and server action begins with an authorisation check.");
  process.exit(0);
}

console.error("auth check FAILED - these endpoints do not begin with an authorisation check:\n");
for (const p of problems) {
  console.error(`  ${p.file}  ->  ${p.name}()`);
  console.error(`      first statement: ${p.got}`);
}
console.error(
  "\n  Every route handler and server action must call assertRole (or authoriseCron) as its\n" +
  "  FIRST statement. Middleware does not count: a Server Action is addressable whether or\n" +
  "  not its control renders. If an endpoint genuinely needs no role, mark it:\n" +
  "      // @public-endpoint <why>",
);
process.exit(1);
