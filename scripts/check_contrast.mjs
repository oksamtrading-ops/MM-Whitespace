/**
 * Verify every colour token against the floor it claims to clear.
 *
 * The Deloitte signature green measures 2.27:1 on white -- below the 3:1
 * non-text floor and far below the 4.5:1 text floor -- and the failure is
 * INVISIBLE TO EYE-CHECKING, because large green fills look perfectly fine. So
 * the token set is verified arithmetically rather than reviewed.
 *
 * An earlier draft of the design's own token table used one value for both text
 * and non-text and was caught by exactly this check.
 *
 *   node scripts/check_contrast.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src", "app", "globals.css");

const TEXT_FLOOR = 4.5;
const NON_TEXT_FLOOR = 3.0;

function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull a token's value out of the light-mode `:root` block. */
function lightToken(css, name) {
  const start = css.indexOf(":root {");
  const root = css.slice(start, css.indexOf("}", start));
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!match) throw new Error(`token --${name} not found in the light palette`);
  return match[1];
}

const css = readFileSync(CSS, "utf8");
const t = (name) => lightToken(css, name);

const CHECKS = [
  // --- the rule that makes this file necessary --------------------------
  { label: "brand fill on white — LARGE FILLS ONLY",
    fg: t("brand-fill"), bg: t("surface"), floor: null,
    note: "2.27:1. Not legal for text or small marks; a fill obliges a relief channel." },

  { label: "green text on the page ground", fg: t("green-text"), bg: t("ground"), floor: TEXT_FLOOR },
  { label: "green text on a surface", fg: t("green-text"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "focus ring / border (non-text)", fg: t("green-mark"), bg: t("surface"), floor: NON_TEXT_FLOOR },
  { label: "lines and small marks (non-text)", fg: t("green-line"), bg: t("surface"), floor: NON_TEXT_FLOOR },

  { label: "body ink on ground", fg: t("ink"), bg: t("ground"), floor: TEXT_FLOOR },
  { label: "body ink on surface", fg: t("ink"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "secondary ink on surface", fg: t("ink-2"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "de-emphasis grey on surface", fg: t("demote"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "caption ink on surface", fg: t("ink-3"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "caption ink on the raised surface", fg: t("ink-3"), bg: t("surface-2"), floor: TEXT_FLOOR },
  { label: "deep green text on the soft green", fg: t("green-deep"), bg: t("green-soft"), floor: TEXT_FLOOR },
  { label: "green text on the soft green is NOT legal", fg: t("green-text"), bg: t("green-soft"), floor: null,
    note: "below 4.5:1 -- text on the soft green uses --green-deep, never --green-text." },
  { label: "body ink on the soft green (marks)", fg: t("ink"), bg: t("green-soft"), floor: TEXT_FLOOR },

  { label: "alert text on its soft ground", fg: t("alert"), bg: t("alert-soft"), floor: TEXT_FLOOR },
  { label: "warning text on its soft ground", fg: t("warn"), bg: t("warn-soft"), floor: TEXT_FLOOR },

  // Polarity for tier migration, on the surface it actually renders against.
  { label: "migration: improved", fg: t("up"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "migration: declined", fg: t("down"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "migration: neutral", fg: t("neutral"), bg: t("surface"), floor: TEXT_FLOOR },

  // A chip carries BLACK text. White on the brand green is 2.27:1, and looks
  // like Deloitte marketing, which is exactly why it needs stating.
  { label: "chip label — black on brand green", fg: "#000000", bg: t("brand-fill"), floor: TEXT_FLOOR },
];

// The forbidden combination, asserted as forbidden rather than left implicit.
const FORBIDDEN = [
  { label: "white text on brand green", fg: "#FFFFFF", bg: t("brand-fill"), mustFailBelow: TEXT_FLOOR },
  { label: "brand green as text on white", fg: t("brand-fill"), bg: t("surface"), mustFailBelow: TEXT_FLOOR },
];

let failures = 0;
console.log("contrast check — light surface\n");
for (const c of CHECKS) {
  const ratio = contrast(c.fg, c.bg);
  if (c.floor === null) {
    console.log(`  note  ${c.label.padEnd(44)} ${ratio.toFixed(2)}:1`);
    if (c.note) console.log(`        ${c.note}`);
    continue;
  }
  const ok = ratio >= c.floor;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.label.padEnd(44)} ` +
              `${ratio.toFixed(2)}:1  (floor ${c.floor})`);
}

console.log("\nforbidden combinations — these MUST fail\n");
for (const f of FORBIDDEN) {
  const ratio = contrast(f.fg, f.bg);
  const correctlyForbidden = ratio < f.mustFailBelow;
  if (!correctlyForbidden) {
    failures++;
    console.log(`  FAIL  ${f.label} now passes at ${ratio.toFixed(2)}:1 — a token changed`);
  } else {
    console.log(`  ok    ${f.label.padEnd(44)} ${ratio.toFixed(2)}:1  correctly unusable`);
  }
}

// Text and non-text have DIFFERENT floors and one token cannot serve both.
const markAsText = contrast(t("green-mark"), t("surface"));
console.log("\ntext and non-text need different tokens\n");
if (markAsText >= TEXT_FLOOR) {
  failures++;
  console.log(`  FAIL  --green-mark reaches ${markAsText.toFixed(2)}:1, so the two tokens ` +
              `have been collapsed. Keep them separate.`);
} else {
  console.log(`  ok    --green-mark is ${markAsText.toFixed(2)}:1 — clears the 3:1 non-text ` +
              `floor and correctly falls short of 4.5:1, which is why green text has its own token`);
}

console.log(failures === 0
  ? "\nAll contrast obligations hold."
  : `\n${failures} contrast obligation(s) violated.`);
process.exit(failures === 0 ? 0 : 1);
