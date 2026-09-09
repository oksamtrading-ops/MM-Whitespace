# 17 — Visual system

**One sentence:** white ground, black type, the green spent only where it reads as the brand, and every figure that measures something set in a second face so the numbers read as instruments rather than prose.

This records the derivations doc 09 asked to have written down, so a later reviewer does not "correct" them back. The tokens live in `src/app/globals.css`; `scripts/check_contrast.mjs` verifies every one against its floor and fails the build otherwise.

## Palette

Decision 8 (light-first) stands. The ground is true white and the type is black, which is what Deloitte is on paper. The earlier green-tinted off-white was a first-draft choice, not a brand one, and it read as a template.

| Token | Value | Role | Ratio on white |
|---|---|---|---|
| `--brand-fill` | `#86BC25` | Large bar fills and the full stop in the product name | 2.27:1 — fills only; obliges a direct value label |
| `--green-line` | `#6B961E` | Gauge fills, small marks | 3.50:1 |
| `--green-mark` | `#5E841A` | Focus rings, the current-section underline, selected-row bar | 4.38:1 |
| `--green-text` | `#567C18` | The only green legal for text on white | 4.89:1 |
| `--green-soft` | `#E7F0D9` | Ground for `<mark>`, ok pills, the start-here cell | — |
| `--green-deep` | `#476713` | The only green legal for text **on the soft green** (5.55:1). `--green-text` is 4.16:1 there and fails | — |
| `--ink` / `--ink-2` / `--ink-3` | `#000000` / `#53565A` / `#6A6D70` | Body, secondary, captions | 21 / 7.4 / 5.3 |
| `--demote` | `#74777A` | De-emphasis, grey bars, below-floor gauges | 4.50:1 (not `#75787B`, 4.44) |
| `--rule` / `--surface-2` | `#D0D0CE` / `#F4F4F3` | Hairlines; header rows, tracks, skeletons | recessive |
| `--up` / `--down` / `--neutral` | `#1F6F43` / `#8C3A14` / `#74777A` | Migration polarity, always with icon and word | ≥ 4.5 |
| `--alert(-soft)` / `--warn(-soft)` | as before | Blocked gate, conflicts; stale accounts, override notice | ≥ 4.5 on their soft grounds |

The greys are Deloitte's own neutral ramp (cool grey 2 and 11). They are neutrals, not colours, and they do not extend the brand palette that doc 09 closes.

**Two things that look like Deloitte marketing and are forbidden here:** white text on the brand green (2.27:1) and the brand green as text on white. The checker asserts both still fail.

## Type

- **Open Sans** (variable) is the brand face and carries everything you read. 15px/1.5 on the dashboard, 13px in the grid. Headings 600 with −0.02em tracking. Uppercase tracked labels are reserved for column headers and the "On this page" eyebrow.
- **Archivo** (variable, width axis) carries every number that measures something: the hero figure at 85% width and 700, the ledger at 92%, bar values, the footing, evidence strength, queue counts, access counts. Dates and prose numbers stay in Open Sans. The rule is what makes figures read as instruments.
- Both are fetched at build time through `next/font` and self-hosted. Nothing is loaded at runtime. The fallback is metric-adjusted Arial (Arial Narrow for Archivo).

## Layout

A sticky 56px top bar: product name with the green stop, the sections a role may open, the period chip, who is signed in. There is no rail; three destinations do not need a sidebar, and the grid wants the width.

The dashboard reads in a single 880px measure with a scroll-following index at 1100px and above. Sections are separated by hairlines, not boxed in cards. Each section names its query in 11px mono at the right of its heading (doc 09: every chart names its query) — there for an analyst verifying a figure, invisible to a partner's eye.

## The signature: the footing

Every population chart ends with its proof line set as an auditor's foot — addends, a rule, the total under a double rule, the tick in green. Hovering a bar lights the same value in the footing. It is the product's thesis (charts that prove themselves) in the practice's own vernacular (footing a column), and it is the one place the design spends its boldness. Everything around it stays quiet.

The `= N ✓` text is rendered as one string on purpose; it is what the journeys assert.

## Gauges and meters

Coverage is a 10px track with the floor drawn as a black tick on it, so "how far to go" is read from the same line as "how far we are". Below the floor the fill is grey: a green fill would read as good news. A chart below its floor renders its gauge in the same 140px footprint, so nothing jumps when coverage crosses the line.

## Evidence in the grid

Four ordinal bands, rendered as a four-cell strip (aria-hidden), the numeral, and the band word. Low fills alert, medium fills warn, high and very high fill the green mark. The anchored value is marked inside the excerpt when it occurs there, and never invented when it does not.

## Motion

CSS only, behind `prefers-reduced-motion: no-preference`: sections rise 6px over 350ms staggered 60ms; bar rects grow from the left over 500ms; the evidence pane fades in over 140ms when the cursor moves; the current-section underline and control states transition in 150–180ms. Nothing on grid rows and nothing decorative.

## Print

The dashboard prints as a single column without the top bar and index, keeping the footings, and ends with the three licence notices from `src/lib/publish/notices.ts` — the same wording as the export, held in step by `notices.test.ts`.
