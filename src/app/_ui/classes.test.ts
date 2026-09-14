import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHECK = join(ROOT, "scripts", "check_class_collisions.mjs");

function run(): { failed: boolean; output: string } {
  try {
    return { failed: false, output: execFileSync("node", [CHECK], { cwd: ROOT, encoding: "utf8" }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { failed: true, output: String(e.stderr ?? "") + String(e.stdout ?? "") };
  }
}

/** Edit a file, run the check, put it back whatever happens. */
function withEdit(file: string, edit: (src: string) => string): { failed: boolean; output: string } {
  const full = join(ROOT, file);
  const backup = `${full}.classcheck-backup`;
  copyFileSync(full, backup);
  try {
    writeFileSync(full, edit(readFileSync(full, "utf8")));
    return run();
  } finally {
    copyFileSync(backup, full);
    execFileSync("rm", ["-f", backup]);
  }
}

test("the class check passes on the real application", () => {
  const { failed, output } = run();
  assert.equal(failed, false, output);
  assert.match(output, /no bare layout rule is worn by two components/);
});

test("it catches the collision that shipped: the rail wearing .role", () => {
  // The rail's identity line said `.role`, which the sign-in screen's
  // development account buttons already own as a three-column grid with 22px of
  // padding and a bottom border. The address in it measured zero pixels wide
  // and a horizontal rule appeared under it that nobody drew. Nothing failed:
  // the markup was right, and only the question of which rule won was wrong.
  const { failed, output } = withEdit(
    "src/app/_ui/Sidebar.tsx", (s) => s.replace('className="whorole"', 'className="role"'));
  assert.equal(failed, true, "a class collision must fail the check");
  assert.match(output, /\.role/);
  assert.match(output, /grid-template-columns/, "and name the layout it was handed");
  assert.match(output, /Sidebar\.tsx/);
  assert.match(output, /SignInButtons\.tsx/, "and name both wearers, not just the new one");
});

test("and the first time this trap sprang: the pursuit form wearing .filters", () => {
  // `.filters` is the review screen's row of bucket chips. The pursuit filter
  // form was written with the same name and inherited a layout meant for
  // something else.
  const { failed, output } = withEdit(
    "src/app/(analyst)/pursuits/Filters.tsx",
    (s) => s.replace('className="narrowing"', 'className="filters"'));
  assert.equal(failed, true);
  assert.match(output, /\.filters/);
  assert.match(output, /pursuits\/Filters\.tsx/);
});

test("a colour is not a collision", () => {
  // Two components sharing a colour is not the failure this looks for. Being
  // handed somebody else's grid is. A check that fired on colour would be
  // silenced inside a week, and then it would catch nothing at all.
  const { failed } = withEdit(
    "src/app/globals.css",
    (s) => `${s}\n.acolouronlyclass { color: var(--ink-3); font-weight: 600; }\n`);
  assert.equal(failed, false, "a bare rule that sets no layout is not a trap");
});
