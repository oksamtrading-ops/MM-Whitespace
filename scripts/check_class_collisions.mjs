/**
 * A class name that already exists will silently restyle your component.
 *
 *   node scripts/check_class_collisions.mjs
 *
 * THREE TIMES NOW, and the third one shipped. The pursuit filter form was
 * written as `.filters`, which is the review screen's row of bucket chips. A
 * pursuit tag was `.tag`, which had no background at all. And the rail's
 * identity line said `.role`, which belongs to the sign-in screen's development
 * account buttons -- a three-column grid with 22px of padding and a bottom
 * border -- so the address in it was squeezed to zero pixels wide and a
 * horizontal rule appeared under it that nobody drew.
 *
 * Every one was found by a person looking at the screen. Nothing else could:
 * the markup is correct in each case, the build has no opinion, the journeys
 * assert on markup rather than on layout, and check:contrast only inspects the
 * colour pairs it is told about. This is the gate that can.
 *
 * WHAT IT CHECKS, and why this shape
 *
 * A rule whose selector is nothing but a class -- `.role { ... }` -- applies to
 * EVERY element carrying that class, anywhere, for ever. That is fine for the
 * design system, where being reusable is the point, and dangerous for anything
 * that belongs to one screen, because the second user of the name inherits a
 * layout written for the first. So:
 *
 *   A bare class rule that imposes LAYOUT must either be declared shared
 *   below, or be used by exactly one component file.
 *
 * Colour, font and cursor are not layout: two components sharing a colour is
 * not the failure. Being handed somebody else's grid is.
 *
 * The fix when this fires is almost always to rename YOUR class, not to
 * broaden the shared list. Adding a name here says "every screen may use this
 * and they will all agree about what it looks like", which is a promise.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src", "app", "globals.css");
const APP = join(ROOT, "src", "app");

/**
 * What counts as shared, derived rather than listed.
 *
 * This project already has an answer: /styleguide renders every shared
 * component FROM THE BUILD, precisely so nothing in it can drift from the
 * thing. So a class the styleguide wears is documented as shared, by the house
 * rule, and saying so twice would be two copies of one fact.
 *
 * To share a class, put it in the styleguide. That is the same sentence the
 * brand guide already says, now with a check behind it.
 */
function sharedByStyleguide(used) {
  const page = join(APP, "(admin)", "styleguide", "page.tsx");
  const shared = new Set();
  for (const [name, files] of used) {
    for (const f of files) if (join(ROOT, f) === page) shared.add(name);
  }
  return shared;
}

/**
 * Shared, but not through the styleguide, and each for a stated reason.
 *
 * Short on purpose. A name here is a promise that every screen wearing it
 * should look the same, and the honest fix for a collision is almost always to
 * rename yours instead.
 */
const EXEMPT = new Map([
  // The two review grids are deliberately one layout seen two ways -- by field
  // and by company -- and share their skeleton rather than duplicating it.
  ["ghead", "the review grids are one layout, by field and by company"],
  ["grow", "the review grids are one layout"],
  ["gcell", "the review grids are one layout"],
  ["statusline", "the review grids are one layout"],
  ["workbench", "the review grids are one layout"],
  ["val", "the review grids are one layout"],
  ["tools", "the review grids and the roster share one toolbar"],
  ["ev", "evidence reads the same wherever it is shown"],
  ["evidence", "evidence reads the same wherever it is shown"],
  // Sign-in and the password screen are deliberately one flow.
  ["signin", "the password screen is part of the sign-in flow"],
  ["lockup", "the password screen is part of the sign-in flow"],
  ["credentials", "sign-in and the password screen ask for the same kind of thing"],
  // A refusal is a refusal wherever it is raised.
  ["refusal", "a refusal reads the same whoever raises it"],
  ["actions", "the row of controls under a refusal or a form"],
  // Page furniture, worn by most screens.
  ["reading", "the reading measure, worn by every long page"],
  ["sub", "the sentence under a heading"],
  ["rail", "the right-hand rail"],
  ["withrail", "the page-with-a-rail layout"],
  ["section", "the section wrapper"],
  ["commit", "the confirm-and-commit form, worn by five screens"],
  ["steps", "a numbered list of steps"],
  ["sw", "a chart swatch"],
  ["editor", "the inline editor, in both review grids"],
  // Utilities: worn by most screens, and meaning one thing in all of them.
  ["page", "the page wrapper"],
  ["empty", "an empty state"],
  ["lede", "the sentence under a heading"],
  ["grid", "a bordered, scrolling container"],
  ["sr-only", "the screen-reader-only utility"],
]);

/** Properties that make one element wear another's shape. */
const LAYOUT = /^(display|position|grid|grid-[\w-]+|flex|flex-[\w-]+|float|clear|padding|padding-[\w-]+|margin|margin-[\w-]+|width|min-width|max-width|height|min-height|max-height|border|border-[\w-]+|gap|row-gap|column-gap|columns|inset|top|right|bottom|left|transform|overflow|overflow-[\w-]+)$/;

/** globals.css with comments removed, so a commented-out rule is not a rule. */
function stylesheet() {
  return readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every rule as { selectors, body }. Brace-counted rather than split, so an
 * @media block's contents are walked and its wrapper is not mistaken for one.
 */
function rules(css) {
  const found = [];
  let depth = 0, selStart = 0, bodyStart = -1, sel = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      depth += 1;
      if (depth === 1) { sel = css.slice(selStart, i).trim(); bodyStart = i + 1; }
      else if (depth === 2 && sel.startsWith("@")) { selStart = i + 1; }
      continue;
    }
    if (ch !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      if (bodyStart >= 0 && !sel.startsWith("@")) {
        found.push({ selectors: sel, body: css.slice(bodyStart, i) });
      }
      selStart = i + 1; bodyStart = -1;
    } else if (depth === 1) {
      // A rule nested inside @media: its selector ran from the last boundary.
      const inner = css.lastIndexOf("{", i);
      const openAt = css.lastIndexOf("}", inner) + 1;
      const innerSel = css.slice(Math.max(openAt, selStart), inner).trim();
      if (innerSel && !innerSel.startsWith("@")) {
        found.push({ selectors: innerSel, body: css.slice(inner + 1, i) });
      }
      selStart = i + 1;
    }
  }
  return found;
}

/** Does this selector target an element by class alone, with no ancestor? */
function bareClass(selector) {
  const s = selector.trim();
  // `.x`, `.x:hover`, `.x.y`, `.x::before` -- but not `.a .b`, `nav .x`, `.a>.b`.
  const m = /^\.([a-z][\w-]*)((?:[.:][\w-()[\]="'-]+)*)$/i.exec(s);
  return m ? m[1] : null;
}

function layoutProps(body) {
  const out = new Set();
  for (const decl of body.split(";")) {
    const prop = decl.split(":")[0]?.trim().toLowerCase();
    if (prop && LAYOUT.test(prop)) out.add(prop);
  }
  return out;
}

/** Every className string in the app, by the file that writes it. */
function classUsage() {
  const used = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) continue;
      const src = readFileSync(full, "utf8");
      const file = relative(ROOT, full);
      // className="a b", className={`a ${x}`}, className={"a"} -- the literal
      // parts only. A class assembled entirely at runtime is not checkable
      // here, and saying so is better than pretending otherwise.
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
        const literal = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
        for (const name of literal.split(/\s+/).filter(Boolean)) {
          if (!used.has(name)) used.set(name, new Set());
          used.get(name).add(file);
        }
      }
    }
  };
  walk(APP);
  return used;
}

const css = stylesheet();
const used = classUsage();
const SHARED = sharedByStyleguide(used);
const offenders = [];

for (const { selectors, body } of rules(css)) {
  for (const selector of selectors.split(",")) {
    const name = bareClass(selector);
    if (!name || SHARED.has(name) || EXEMPT.has(name)) continue;
    const props = layoutProps(body);
    if (props.size === 0) continue;
    const wearers = used.get(name);
    if (!wearers || wearers.size < 2) continue;
    offenders.push({ name, props: [...props].sort(), wearers: [...wearers].sort() });
  }
}

// One line per class, however many rules declared it.
const byName = new Map();
for (const o of offenders) {
  const prev = byName.get(o.name);
  if (prev) for (const p of o.props) prev.props.add(p);
  else byName.set(o.name, { props: new Set(o.props), wearers: o.wearers });
}

if (byName.size === 0) {
  console.log(
    "class check: no bare layout rule is worn by two components that did not agree to share it.");
  process.exit(0);
}

console.error(
  "class collision — a bare rule imposes layout on every element with the name,\n" +
  "and these names are worn by more than one component:\n");
for (const [name, { props, wearers }] of [...byName].sort()) {
  console.error(`  .${name}  sets ${[...props].sort().join(", ")}`);
  for (const w of wearers) console.error(`      ${w}`);
  console.error("");
}
console.error(
  "Rename yours -- that is the fix nearly every time. If the name really is\n" +
  "shared, put the component in /styleguide, which is how this project says so,\n" +
  "or add it to EXEMPT here with the reason. Both are promises, not escapes.");
process.exit(1);
