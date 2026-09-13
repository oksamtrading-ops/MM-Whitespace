/**
 * Verify every colour token against the floor it claims to clear, in BOTH
 * themes, and verify the chart palette's adjacent pairs.
 *
 * The Deloitte signature green measures 2.27:1 on white -- below the 3:1
 * non-text floor and far below the 4.5:1 text floor -- and the failure is
 * INVISIBLE TO EYE-CHECKING, because large green fills look perfectly fine. So
 * the token set is verified arithmetically rather than reviewed. On black the
 * same green measures 9.23:1, which is why the dark theme may set text in it
 * and the light theme may not; both facts are asserted here so neither can
 * drift.
 *
 * The script reads src/app/globals.css textually. It resolves var() references
 * so semantic tokens may point at primitives; every leaf must be a six-digit
 * hex. It fails the build on any violated floor.
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
const CVD_TARGET = 8.0;      // OKLab dE x100 under protan/deutan, adjacent pairs
const CVD_FLOOR = 6.0;       // legal only with secondary encoding
const NORMAL_FLOOR = 15.0;   // OKLab dE x100, unsimulated vision, a hard gate
const RAMP_MIN_STEP = 0.06;  // OKLab L between adjacent sequential steps

/* ------------------------------------------------------------ colour maths */

const hex2srgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h) => hex2srgb(h).map(s2lin);

function relativeLuminance(hex) {
  const [r, g, b] = lin(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const oklabL = (h) => oklabFromLin(lin(h))[0];

// Machado, Oliveira & Fernandes (2009) dichromacy transforms at severity 1.0,
// applied in linear RGB. The thresholds above are calibrated to this model.
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};
function simulate(h, kind) {
  const [r, g, b] = lin(h), M = MACHADO[kind];
  const clamp = (c) => Math.max(0, Math.min(1, c));
  return [0, 1, 2].map((i) => clamp(M[i][0] * r + M[i][1] * g + M[i][2] * b));
}
export function deltaE(h1, h2, kind = null) {
  const a = oklabFromLin(kind ? simulate(h1, kind) : lin(h1));
  const b = oklabFromLin(kind ? simulate(h2, kind) : lin(h2));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* -------------------------------------------------------------- the CSS */

const css = readFileSync(CSS, "utf8");

/** The declarations inside the first block whose selector matches. */
function block(selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no block for ${selector}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unterminated block for ${selector}`);
}

function declarations(body) {
  const out = new Map();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const primitives = declarations(block(":root {"));
const themes = {
  dark: new Map([...primitives, ...declarations(block(':root, [data-theme="dark"] {'))]),
  light: new Map([...primitives, ...declarations(block(':root, [data-theme="dark"] {')),
                  ...declarations(block(':root[data-theme="light"], [data-theme="light"] {'))]),
};

/** Resolve a token in a theme to a six-digit hex, following var() chains. */
function resolve(theme, name, seen = new Set()) {
  const raw = themes[theme].get(name);
  if (raw === undefined) throw new Error(`token --${name} not found in the ${theme} theme`);
  if (seen.has(name)) throw new Error(`token --${name} refers to itself`);
  seen.add(name);
  const ref = raw.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(theme, ref[1], seen);
  // A colour token is a six-digit hex and nothing else: not rgb(), not an
  // eight-digit hex whose first six digits would parse as a different colour.
  const hex = raw.match(/^#([0-9A-Fa-f]{6})$/);
  if (!hex) throw new Error(`token --${name} in the ${theme} theme is "${raw}", not a six-digit hex`);
  return `#${hex[1].toUpperCase()}`;
}

/* ----------------------------------------------------------- the checks */

const COMMON = (t) => [
  { label: "green text on the page ground", fg: t("green-text"), bg: t("ground"), floor: TEXT_FLOOR },
  { label: "green text on surface-1", fg: t("green-text"), bg: t("surface-1"), floor: TEXT_FLOOR },
  { label: "green text on surface-3", fg: t("green-text"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "focus ring (non-text) on ground", fg: t("focus"), bg: t("ground"), floor: NON_TEXT_FLOOR },
  { label: "focus ring (non-text) on surface-3", fg: t("focus"), bg: t("surface-3"), floor: NON_TEXT_FLOOR },
  { label: "border / underline (non-text)", fg: t("green-mark"), bg: t("surface"), floor: NON_TEXT_FLOOR },
  { label: "lines and small marks (non-text)", fg: t("green-line"), bg: t("surface"), floor: NON_TEXT_FLOOR },
  { label: "small marks on surface-2 (gauge track)", fg: t("green-line"), bg: t("surface-2"), floor: NON_TEXT_FLOOR },

  { label: "body ink on ground", fg: t("ink"), bg: t("ground"), floor: TEXT_FLOOR },
  { label: "body ink on surface-3", fg: t("ink"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "secondary ink on surface-3", fg: t("ink-2"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "de-emphasis grey on surface-3", fg: t("demote"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "de-emphasis grey on the page ground", fg: t("demote"), bg: t("ground"), floor: TEXT_FLOOR },
  { label: "caption ink on surface-3", fg: t("ink-3"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "caption ink on the raised surface", fg: t("ink-3"), bg: t("surface-2"), floor: TEXT_FLOOR },
  { label: "deep green text on the soft green", fg: t("green-deep"), bg: t("green-soft"), floor: TEXT_FLOOR },
  { label: "body ink on the soft green (marks)", fg: t("ink"), bg: t("green-soft"), floor: TEXT_FLOOR },
  { label: "text on the primary button", fg: t("btn-primary-ink"), bg: t("btn-primary-bg"), floor: TEXT_FLOOR },
  { label: "text on the hovered primary button", fg: t("btn-primary-ink"), bg: t("btn-primary-hover"), floor: TEXT_FLOOR },
  { label: "text on the skip link", fg: t("skip-ink"), bg: t("skip-bg"), floor: TEXT_FLOOR },
  { label: "the raised rule (drop zone, switch track) is a boundary", fg: t("rule-raised"), bg: t("surface-1"), floor: NON_TEXT_FLOOR },

  { label: "alert text on its soft ground", fg: t("alert"), bg: t("alert-soft"), floor: TEXT_FLOOR },
  { label: "alert text on surface-3", fg: t("alert"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "warning text on its soft ground", fg: t("warn"), bg: t("warn-soft"), floor: TEXT_FLOOR },
  { label: "warning text on surface-3", fg: t("warn"), bg: t("surface-3"), floor: TEXT_FLOOR },
  { label: "tag text on the raised surface", fg: t("ink-2"), bg: t("surface-2"), floor: TEXT_FLOOR },

  { label: "migration: improved", fg: t("up"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "migration: declined", fg: t("down"), bg: t("surface"), floor: TEXT_FLOOR },
  { label: "migration: neutral", fg: t("neutral"), bg: t("surface"), floor: TEXT_FLOOR },

  // A chip carries BLACK text in both themes. White on the brand green is
  // 2.27:1 and looks like Deloitte marketing, which is exactly why it needs stating.
  { label: "chip label — black on brand green", fg: "#000000", bg: t("brand-fill"), floor: TEXT_FLOOR },
];

// Text and non-text carry DIFFERENT floors. No token name serves both jobs,
// whatever its value in a given theme.
const TEXT_TOKENS = ["ink", "ink-2", "ink-3", "demote", "green-text", "green-deep", "alert", "warn", "up", "down", "neutral"];
const NON_TEXT_TOKENS = ["green-line", "green-mark", "focus", "rule", "rule-raised", "gridline", "brand-fill"];

let failures = 0;
const ok = (cond, line) => { if (!cond) failures++; console.log(`  ${cond ? "ok  " : "FAIL"}  ${line}`); };
const note = (line) => console.log(`  note  ${line}`);

for (const theme of ["light", "dark"]) {
  const t = (name) => resolve(theme, name);
  console.log(`\ncontrast check — ${theme} theme\n`);
  const brand = contrast(t("brand-fill"), t("surface"));
  if (theme === "light") {
    note(`brand fill on white — LARGE FILLS ONLY ${brand.toFixed(2)}:1. Not legal for text or small marks; a fill obliges a relief channel.`);
  } else {
    ok(brand >= TEXT_FLOOR, `brand green on the dark ground ${brand.toFixed(2)}:1 — legal for text, lines and focus here (floor ${TEXT_FLOOR})`);
    ok(contrast(t("brand-fill"), t("surface-3")) >= TEXT_FLOOR,
       `brand green on surface-3 ${contrast(t("brand-fill"), t("surface-3")).toFixed(2)}:1 (floor ${TEXT_FLOOR})`);
  }
  for (const c of COMMON(t)) {
    const ratio = contrast(c.fg, c.bg);
    ok(ratio >= c.floor, `${c.label.padEnd(52)} ${ratio.toFixed(2)}:1  (floor ${c.floor})`);
  }
  if (theme === "light") {
    const soft = contrast(t("green-text"), t("green-soft"));
    note(`green text on the soft green is NOT legal ${soft.toFixed(2)}:1 — text on the soft green uses --green-deep, never --green-text.`);
  }
}

// The forbidden combinations on the LIGHT theme, asserted as forbidden rather
// than left implicit. A token change that made either pass would be a defect.
console.log("\nforbidden combinations on light — these MUST fail\n");
{
  const t = (name) => resolve("light", name);
  for (const f of [
    { label: "white text on brand green", fg: "#FFFFFF", bg: t("brand-fill") },
    { label: "brand green as text on white", fg: t("brand-fill"), bg: t("surface") },
  ]) {
    const ratio = contrast(f.fg, f.bg);
    ok(ratio < TEXT_FLOOR, `${f.label.padEnd(52)} ${ratio.toFixed(2)}:1  correctly unusable`);
  }
  // Light-mode green ramps are bounded above by the brand: any step lighter
  // than it fails the light-end floor (docs/design/09).
  const brandL = relativeLuminance(t("brand-fill"));
  for (const k of ["seq-1", "seq-2", "seq-3", "seq-4", "seq-5", "green-line", "green-mark", "green-text"]) {
    ok(relativeLuminance(t(k)) <= brandL + 1e-9, `--${k} is no lighter than the brand green on white`);
  }
}

console.log("\ntext and non-text need different tokens\n");
{
  const shared = TEXT_TOKENS.filter((n) => NON_TEXT_TOKENS.includes(n));
  ok(shared.length === 0, `no token name carries both a text and a non-text job${shared.length ? `: ${shared.join(", ")}` : ""}`);
  const markAsText = contrast(resolve("light", "green-mark"), resolve("light", "surface"));
  ok(markAsText < TEXT_FLOOR,
     `--green-mark (light) is ${markAsText.toFixed(2)}:1 — clears 3:1 and correctly falls short of 4.5:1, so green text keeps its own token`);
}

/* --------------------------------------------------------- chart colour */

console.log("\nsequential ramps — one hue, monotone, stepped\n");
for (const theme of ["light", "dark"]) {
  const steps = ["seq-1", "seq-2", "seq-3", "seq-4", "seq-5"].map((k) => resolve(theme, k));
  const L = steps.map(oklabL);
  // Light reads light->dark; dark flips its anchor and reads dark->light.
  const dir = theme === "light" ? -1 : 1;
  const gaps = L.slice(1).map((l, i) => dir * (l - L[i]));
  ok(gaps.every((g) => g >= RAMP_MIN_STEP),
     `${theme}: every adjacent step differs by >= ${RAMP_MIN_STEP} OKLab L (${gaps.map((g) => g.toFixed(3)).join(", ")})`);
  const surface = resolve(theme, "surface");
  const light = theme === "light" ? steps[0] : steps[4];
  const dark = theme === "light" ? steps[4] : steps[0];
  note(`${theme}: lightest step ${light} ${contrast(light, surface).toFixed(2)}:1, darkest ${dark} ${contrast(dark, surface).toFixed(2)}:1 on the surface`);
}

console.log("\ncategorical palette — adjacent pairs, CVD and normal vision\n");
for (const theme of ["light", "dark"]) {
  const slots = [];
  for (let i = 1; i <= 8; i++) { if (themes[theme].has(`cat-${i}`)) slots.push(resolve(theme, `cat-${i}`)); else break; }
  const surface = resolve(theme, "surface");
  note(`${theme}: ${slots.length} slots in fixed order: ${slots.join(", ")}`);
  for (let i = 0; i + 1 < slots.length; i++) {
    const [a, b] = [slots[i], slots[i + 1]];
    const cvd = Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));
    const normal = deltaE(a, b);
    ok(normal >= NORMAL_FLOOR, `${theme} slots ${i + 1}-${i + 2}: normal-vision dE ${normal.toFixed(1)} (floor ${NORMAL_FLOOR})`);
    if (cvd >= CVD_TARGET) ok(true, `${theme} slots ${i + 1}-${i + 2}: CVD dE ${cvd.toFixed(1)} (target ${CVD_TARGET})`);
    else if (cvd >= CVD_FLOOR) note(`${theme} slots ${i + 1}-${i + 2}: CVD dE ${cvd.toFixed(1)} — floor band, legal ONLY with secondary encoding`);
    else ok(false, `${theme} slots ${i + 1}-${i + 2}: CVD dE ${cvd.toFixed(1)} below the ${CVD_FLOOR} floor`);
  }
  for (const s of slots) {
    const c = contrast(s, surface);
    if (c < NON_TEXT_FLOOR) note(`${theme}: ${s} is ${c.toFixed(2)}:1 on the surface — relief required (direct labels or the table twin); not dismissable`);
  }
}

console.log(failures === 0
  ? "\nAll contrast obligations hold."
  : `\n${failures} contrast obligation(s) violated.`);
process.exit(failures === 0 ? 0 : 1);
