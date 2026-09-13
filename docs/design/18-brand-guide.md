# 18 — Brand and interface guide

**One sentence:** black ground, white type, the green spent only where it proves something, and every figure set as an instrument, so a partner reads the market's whitespace off a lit map and then reads the footing that proves the map adds up.

This guide extends doc 17. It reverses one decision there, records why, and leaves every derivation on white in force for the light theme. The tokens live in `src/app/globals.css` in three layers; `scripts/check_contrast.mjs` verifies every one, in both themes, and fails the build otherwise. `/styleguide` (Admin) renders the tokens and components from the build itself, so nothing in it can drift from the product. Every Deloitte value in this guide is *[confirm]* against the brand hub until someone with access has checked it; section 16 lists them all.

## 1. Thesis and principles

**The reversal, recorded.** Doc 17 kept decision 8, light-first, and doc 16 called the alternative "a taste-and-brand decision wearing an accessibility argument." This guide makes the product dark-first with the light system kept whole as a second theme. Three reasons, in order of weight. First, the brand green passes on black (9.23:1) and fails on white (2.27:1), so on the dark ground the one colour the product is known by may carry text, lines, focus and the footing's tick, where on white it may only fill. Second, the demonstration is a partner opening a lit map of Canada, and that image does not exist on white. Third, doc 16's worry stands and is answered rather than dismissed: the dark theme is Deloitte's own black with surfaces mixed from Deloitte's own cool grey, the neutrals never leave the firm's ramp, and the light theme is one press away in the rail's foot for a partner reading the screen beside a light deck. Print always renders light.

Five principles, each with what it forbids.

1. **A chart proves itself or it is not drawn.** Every population view ends in a composition bar whose segments are the addends and whose total carries its tick; below its coverage floor a view says what it is waiting for. Forbidden: a population chart with no proof under it, a gated view that changes the layout when it opens, anything decorative that makes a gated view look complete.
2. **Evidence strength, not self-confidence.** Four ordinal bands, always as a strip, a numeral and a word. Forbidden: colour as the only carrier of a band, a continuous gradient, a wash behind a cell with no numeral in it.
3. **Green is proof, not paint.** The brand green appears where something is Deloitte's or has been verified: the full stop, Deloitte's bar, the map's fill, the footing's tick, the focus ring, an accepted value. Forbidden: green as a background, a gradient or a glow; green text on white; white text on green; a green that is not a token.
4. **Figures are instruments.** Every number that measures something is set in Archivo, tabular, and reads at a glance beside prose set in Open Sans. Forbidden: a figure in the text face, a prose number in the figure face, a KPI tile where a sentence would do.
5. **Depth is spent where a partner looks, not where an analyst works.** The map, the sign-in, dialogs and tooltips carry lift, shadow and motion; the grid, the evidence panel, tables and forms are flat and dense. Forbidden: a card on a working screen, blur over data, motion on a grid row, anything that loops.

**The one aesthetic risk.** The dashboard opens with no tile row. A sentence, a lit map and a proof bar are the first screen; the population panel arrives on scroll. Partners are used to a strip of tiles, and the product's thesis is that the headline is a sentence and the proof is a footing, so the first screen is made of exactly those two things. It is right for this product because the workbook it replaces had tiles, and the tiles were wrong.

**Acceptance.** A reviewer opens `/dashboard` in both themes and finds: no tile above the map, a proof bar under the map whose total reads `= 259 ✓`, and no green anywhere that is not the stop, a Deloitte bar, the map, a tick, a focus ring or an accepted value.

## 2. Identity

**The wordmark.** *Whitespace* in Open Sans 700 at −0.02em tracking, followed by the full stop: a circle of 0.3 cap-heights in `#86BC25`, its centre on the baseline plus 0.02em, set 0.06em after the *e*. The stop is a shape, not a character: it carries `aria-hidden` and does not translate. Clear space is the height of the *W* on every side. Minimum size is 15px in the rail and 12px anywhere else; below that the stop is drawn as a 3px dot and the word is dropped.

**The lockup.** *Whitespace.* with DELOITTE beneath in Open Sans 600, 11px, tracked 0.16em, in ink-2. It appears on sign-in, on print headers and on the export cover, and nowhere inside the product, where the wordmark stands alone at the head of the rail. The lettering is a placeholder: the brand hub's own Deloitte wordmark asset replaces it, at the hub's clear-space rule, before any external showing *[confirm the co-branding rule on the brand hub]*.

**Dark and light.** On dark the word is white; on light it is black. The stop is the same green on both. There is no reversed or one-colour version: the stop is the brand and it is always green.

**The icon family.** A black tile, radius 22% of its side, the green dot at three-quarters of the side from the top-left, radius one-sixth of the side. `src/app/icon.svg` serves the favicon; `public/brand/` carries the same drawing at 16, 32, 180 and 512, and a light-ground tile with a hairline for decks.

**The full stop in three dimensions.** A matte satin sphere in the brand green, lit from the upper left at 35° elevation, with one soft white highlight at no more than 55% opacity, the shaded side falling through `#26890D` to black, and a black contact shadow that reveals a ground plane. No gloss, no rim light, no glow. It may appear on sign-in, in empty states beside the sentence, and beside a loading skeleton. It may fade in over 400ms and drift with the hero's parallax; it never rotates, bounces or pulses. Under reduced motion, forced colours and in print it is absent or flat. The drawing is `public/brand/full-stop-3d.svg`; the brief is `public/brand/objects/01-full-stop.md`.

**Misuse.** Do not set the stop in any other colour. Do not outline it. Do not put a shadow on the flat stop. Do not set *Whitespace* in Archivo. Do not use white on green anywhere. Do not add a tagline to the lockup. Do not put the lockup on a page that also shows the rail's wordmark.

**Acceptance.** `public/brand/` contains wordmark and lockup SVGs for both grounds, the icon family, the 3D stop with its flat fallback and a README stating licence and use; the sign-in page shows the lockup and the rail shows the wordmark alone.

## 3. Colour

Three layers. **Primitive** tokens are Deloitte's values by name (`--dtt-*`) and the validator's derived steps (`--wsp-*`). **Semantic** tokens are what a component asks for. **Component** tokens are aliases one component owns. Every leaf is a six-digit hex; `check_contrast.mjs` follows `var()` chains and refuses anything else.

### Primitives *[confirm every Deloitte value]*

| Name | Value | Name | Value | Name | Value |
|---|---|---|---|---|---|
| `--dtt-black` | `#000000` | `--dtt-blue-1` | `#A0DCFF` | `--dtt-teal-1` | `#DDEFE8` |
| `--dtt-white` | `#FFFFFF` | `--dtt-blue-2` | `#62B5E5` | `--dtt-teal-2` | `#9DD4CF` |
| `--dtt-green` | `#86BC25` | `--dtt-blue-3` | `#00A3E0` | `--dtt-teal-3` | `#6FC2B4` |
| `--dtt-green-1` | `#E3E48D` | `--dtt-blue-4` | `#0076A8` | `--dtt-teal-4` | `#00ABAB` |
| `--dtt-green-2` | `#C4D600` | `--dtt-blue-5` | `#005587` | `--dtt-teal-5` | `#0097A9` |
| `--dtt-green-3` | `#43B02A` | `--dtt-blue-6` | `#012169` | `--dtt-teal-6` | `#007680` |
| `--dtt-green-4` | `#26890D` | `--dtt-blue-7` | `#041E42` | `--dtt-teal-7` | `#004F59` |
| `--dtt-green-6` | `#046A38` | `--dtt-grey-2` | `#D0D0CE` | `--dtt-grey-9` | `#75787B` |
| `--dtt-green-7` | `#2C5234` | `--dtt-grey-4` | `#BBBCBC` | `--dtt-grey-10` | `#63666A` |
| | | `--dtt-grey-6` | `#A7A8AA` | `--dtt-grey-11` | `#53565A` |
| | | `--dtt-grey-7` | `#97999B` | | |

Derived, and why: `#6B961E`, `#5E841A`, `#567C18`, `#476713` are the greens snapped to the 3:1 and 4.5:1 floors on white (doc 17). `#25482B` replaces green-7 as the darkest sequential step because green-6 to green-7 is 0.059 in OKLab L against a 0.06 floor. `#74777A` replaces grey-9 for de-emphasis text because grey-9 is 4.44:1. The dark surfaces `#0A0A0B`, `#111112`, `#171819`, `#1E1F20` are black mixed toward cool grey 11 at 12, 20, 28 and 36%, so no hue enters. The status colours are a reserved scale, not brand colours (doc 09); the dark set `#E8895B`, `#E2B94F`, `#6CC98F` is the light set lifted until it clears 4.5:1 on surface-3.

### Semantic, dark (the primary theme)

| Token | Value | Job | Ratio |
|---|---|---|---|
| `--ground` | `#000000` | the page | — |
| `--surface-1` | `#0A0A0B` | the grid, the evidence panel, the roster, inputs | — |
| `--surface-2` | `#111112` | tracks, header rows, hover, pills | — |
| `--surface-3` | `#171819` | dialogs, menus, tooltips, toasts | — |
| `--ink` | `#FFFFFF` | body | 21.0 on ground · 17.8 on surface-3 |
| `--ink-2` | `#D0D0CE` | secondary | 13.6 · 11.5 |
| `--ink-3` | `#A7A8AA` | captions, eyebrows | 8.8 · 7.5 |
| `--demote` | `#97999B` | de-emphasis text, grey bars | 7.4 · 6.2 |
| `--rule` | `#63666A` | hairlines | 3.6 on ground |
| `--rule-raised` | `#75787B` | a boundary that must be seen: drop zone, switch track | 4.5 on surface-1 |
| `--gridline` | `#53565A` | recessive, exempt | 2.9 |
| `--brand-fill`, `--green-line`, `--green-mark`, `--green-text`, `--focus` | `#86BC25` | fills, lines, marks, **text**, focus | 9.2 · 7.8 |
| `--green-soft` / `--green-deep` | `#15200A` / `#C4D600` | ok pills, `<mark>` and their text | 10.4 |
| `--alert`, `--down` / `--alert-soft` | `#E8895B` / `#2A1810` | conflicts, blocked, declined | 6.9 on surface-3 · 6.6 on soft |
| `--warn` / `--warn-soft` | `#E2B94F` / `#26200E` | stale, override, inherited | 9.6 · 8.7 |
| `--up` | `#6CC98F` | improved | 8.8 |
| `--neutral` | `#97999B` | unchanged | 6.2 |

### Semantic, light

Every value is doc 17's, unchanged: ground and surfaces white and `#F4F4F3`, inks `#000000` / `#53565A` / `#6A6D70`, demote `#74777A`, rule `#D0D0CE`, brand fills-only at 2.27:1, `--green-line #6B961E`, `--green-mark #5E841A`, `--green-text #567C18`, `--green-soft #E7F0D9` with `--green-deep #476713`, status `#8C3A14` / `#7E6110` / `#1F6F43` on `#F6E8E0` / `#F4EDDA`. One addition: `--rule-raised` is `#75787B` (4.44:1) so the drop zone's dashed border and the switch track are boundaries a reader can see; `#D0D0CE` stays the hairline.

### Which greens are legal for text

| | Light | Dark |
|---|---|---|
| Text | `#567C18` only; on the soft green `#476713` only | `#86BC25`; on the soft green `#C4D600` |
| Lines, small marks, focus | `#6B961E` lines, `#5E841A` focus and borders | `#86BC25` |
| Fills only | `#86BC25` | any sequential step |
| Forbidden | `#86BC25` as text; white on `#86BC25` | white on `#86BC25` |

The script asserts the two light-theme prohibitions still fail, asserts that no token name serves both a text and a non-text job, and asserts that no light-theme green is lighter than the brand.

### The four chart-colour jobs

| Job | Light | Dark | For |
|---|---|---|---|
| **Sequential**, one hue light→dark | `#86BC25 → #6B961E → #26890D → #046A38 → #25482B` | `#046A38 → #26890D → #43B02A → #86BC25 → #C4D600` (anchor flipped) | the map, the whitespace matrix, the tier badges, the evidence wash |
| **Categorical**, fixed order, **cap of four** | `#86BC25, #005587, #0097A9, #046A38` | `#86BC25, #A0DCFF, #0097A9` | the footprint composition, and nothing else |
| **Diverging**, two hues and a grey midpoint | `#8C3A14 · #74777A · #1F6F43` | `#E8895B · #97999B · #6CC98F` | tier migration polarity |
| **Emphasis** | brand + `--demote` | brand + `--demote` | auditor share: Deloitte accented, every other firm grey, unknown last and longest |

Validated: both ramps are monotone with every step ≥ 0.06 OKLab L apart; the light ramp's lightest step is the brand itself, which is the ceiling doc 09 set. Categorical adjacent pairs clear ΔE 18.4 (CVD) and 19.0 (normal) on light, 23.3 and 25.1 on dark. Blue beside teal fails the normal-vision floor in every Deloitte step (ΔE 9–13), so they are never adjacent, and the categorical cap is four on light and three on dark. Identity is by hue order, never by rank: a filter that changes the series count does not repaint survivors. Text never wears a series colour. Status colours are never reused for a series and always ship with an icon and a word. The dark categorical set sits lighter than the dataviz skill's own dark lightness band; the brief's three floors (CVD, normal vision, contrast) pass, and that is the standard this product holds.

**Ink inside a fill.** A numeral sitting in a heat-map cell or a tier badge is text on a fill that changes under it, so every ramp step names the ink it can carry: `--on-seq-1` to `--on-seq-5`, black or white per theme, each pair asserted at 4.5:1 by the script. Nothing else may be set on a ramp step.

**Where the categorical slots are spent.** Exactly one place: the footprint composition, whose four parts are one population and fit the four validated slots. Everywhere else is one hue, emphasis or a table, and the cap is the reason — a fifth market would have to repeat a hue, and two entities sharing a colour in one chart is a lie.

**Acceptance.** `npm run check:contrast` exits 0 and prints "All contrast obligations hold." for both themes; changing any value above to one that breaks a floor makes it exit 1.

## 4. Typography

Open Sans is the brand face and carries everything you read. Archivo, variable with its width axis, carries every figure that measures something, always tabular. Dates and prose numbers stay in Open Sans. Both are self-hosted through `next/font`; nothing is fetched at runtime; the fallbacks are metric-adjusted Arial and Arial Narrow. *[confirm Open Sans as the firm's corporate face]*

The named scale replaces nineteen ad-hoc sizes. Nothing outside it is legal.

| Name | Face | Size / line | Weight · width · tracking | Class |
|---|---|---|---|---|
| display | Open Sans | `clamp(32px, 2.2vw + 20px, 44px)` / 1.1 | 300 · −0.02em | `.t-display`, `.hero` |
| headline | Open Sans | 28 / 1.15 | 600 · −0.02em | `h1`, `.t-headline` |
| title | Open Sans | 20 / 1.2 | 600 · −0.015em | `h2`, `.t-title` |
| subtitle | Open Sans | 17 / 1.4 | 600 | `h3` in the evidence panel, `.t-subtitle` |
| body | Open Sans | 15 / 1.5 | 400 | `body`, `.t-body` |
| body-sm | Open Sans | 13 / 1.5 | 400 | the grid, `.meta`, `.t-body-sm` |
| caption | Open Sans | 12 / 1.4 | 400 | band words, hints, `.t-caption` |
| label | Open Sans | 11 / 1 | 600 · uppercase · .08em | eyebrows, column headers only: `.k`, `.eyebrow`, `.t-label` |
| figure-xl | Archivo | `clamp(48px, 4.5vw + 16px, 72px)` / .95 | 700 · wdth 85 · −0.02em | `.fig-xl` |
| figure-lg | Archivo | 28 / 1 | 600 · wdth 92 | `.fig-lg` |
| figure-md | Archivo | 17 / 1.2 | 600 · wdth 100 | `.fig-md` |
| figure | Archivo | 15 | 600 | `.fig` |
| figure-sm | Archivo | 13 | 500 | `.fig-sm` |
| mono | system mono | 11 | | query keys, rule ids |

Uppercase tracked labels are reserved for column headers and eyebrows. Tabular figures everywhere a number can change. The display and figure-xl sizes are fluid so the hero sentence holds one line from 1100px up and wraps once below.

**Acceptance.** `grep -c "font-size: [0-9]" src/app/globals.css` finds no size that is not one of the fourteen; the styleguide's type section shows each with its class.

## 5. Space, shape and layout

Spacing is 4-based: `--space-1` to `--space-10` are 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Radii: `0` for tables, `2` for marks, `4` for rows, `6` for controls, `10` for panels, pill for pills and chips. Breakpoints as tokens: 640, 860, 1100, 1240 (`--bp-*`, repeated in the media queries because CSS cannot read them there).

**The shell is a left rail and a page header. There is no top bar** — a bar plus a header is two horizontal bands before any content. The rail is 208px expanded and 56px collapsed, sticky at full height, and its collapsed state is a cookie so the server renders it at the width the reader chose and it does not jump on first paint. It holds ten destinations in three groups: **Product** (Dashboard, Companies, Pursuits), **Period** (Upload, Runs, Review, Publish) and **Admin** (Access, Settings, Styleguide). A Viewer sees the first group only, and the rail is two rows tall. Its foot carries the period, the theme control and the account. Below 860px it collapses to icons and stays there.

The page header is one 60px sticky band: a back link where the page is inside another, the title, an optional count pill, the period line, and the page's actions on the right. Every route has one. It is also where **show working** lives, the control that reveals each section's query key; it is on by default for anyone who can review and off for a Viewer. It never hides a footing.

The reading measure is 880px with the 232px right rail at 1100px and above; that rail folds above the reading column below that, and it carries what the page is *about* — period facts, provenance, the in-page index — while the left rail carries where you can go. The workbench splits the grid from the evidence panel at 1100px. Grid rows are 44px with 16px cell padding and a sticky 36px header; the roster is denser at 36px rows with 12px padding.

**The all-companies table** (`/companies`, the `.roster`) is full width, 259 rows, no pagination. Columns in this order: Company (sticky, row header), Ticker, Exchange, Tier, Stage, Footprint, Deloitte market, Auditor, Market cap. Every header sorts on click and announces `aria-sort`; the find box takes `/`; "Whitespace only" is a pressed button; `?province=BC` narrows to companies with a property there, which is where the map's hover link lands. Stage is derived from the published tier, never from live stage rows, so a Viewer cannot see a stage that is not yet published. Market cap is the compact Canadian figure in Archivo, right-aligned.

**Tables have one anatomy and three densities.** Rows are 36px and middle-aligned by default, 30px compact, 44px roomy; a cell holding prose, a form or a disclosure takes `.wrap` and grows. The header is a quiet band — 12px medium in secondary ink on surface-2 — because a column name should not out-weigh the data under it; the old 11px uppercase at .08em tracking over a solid ink rule did. Numbers are Archivo, tabular, right-aligned, always. The action column is right-aligned, tight, and holds a 28px control that fits inside its own row. Every header cell carries a `scope`.

**Acceptance.** At 1440px the roster shows all its columns without a horizontal scrollbar; at 1024px the first column and the header stay put while the rest scrolls. No control in a table row is taller than the row.

## 6. Depth and material

Four tiers. **Ground** and **surface-1** are where work happens and carry no shadow: the page, the grid, the evidence panel, the roster, inputs. **Surface-2** is tracks, header rows, hover and pills. **Surface-3** is the only tier with a shadow and a lift, and it is reserved for dialogs, menus, tooltips and toasts. On light the tiers are white, white, `#F4F4F3`, white; on dark they are the black-to-cool-grey mixes, so the lift is tonal before it is anything else.

Elevation is defined three ways at once. **Border:** every tier boundary is a hairline in `--rule`. **Shadow:** none on tiers 0–2; `--shadow-2` (0 8px 24px) on menus, tooltips and toasts; `--shadow-3` (0 24px 64px) on dialogs; the shadow ink is black at 18% on light and 60% on dark. **Tonal lift:** on dark, surface-3 carries `--lift`, a linear gradient of white at 6% from the upper left to nothing at 55%, which is the one place light has a direction; on light, `--lift` is none.

Blur is legal on a dialog backdrop (6px) and nowhere else. Never over data. Lighting comes from the upper left, in the lift, in the orb and in the object briefs. Parallax is the hero map only, at most 8px, off under reduced motion. The dashboard header, a dialog, the evidence panel and a tooltip on their tiers are shown in the styleguide's depth section.

**Acceptance.** No `box-shadow` or `backdrop-filter` in `globals.css` applies to anything but `dialog`, `.menu`, `.tooltip`, `.toast` and the styleguide's tier sample.

## 7. Motion

Durations `--dur-1` to `--dur-5` are 120, 180, 260, 400, 600ms. Two easings: `--ease-out` for entrances and `--ease-in-out` for state changes. Everything is behind `prefers-reduced-motion: no-preference`.

**First load.** The rail and the page header are in place. The hero sentence rises 6px over 400ms. The map tilts in and its provinces fill in count order, 40ms apart, from 200ms. The footing's addends fade in in order, 60ms apart, and the total rises last with the green tick. Then the sections rise in the existing 60ms stagger and the bars grow from the left over 600ms. **Map to table.** The map settles from its tilt to flat over 600ms on the first scroll or touch; the rest of the page does not move. **Count-up** is the hero figure only, and only on the dashboard. **Hover and press.** Every control transitions background and colour in 120–180ms and presses down 1px. **The evidence panel** cross-fades in 120ms as the cursor moves. **Skeleton to content** dissolves in 180ms. **Under reduced motion** nothing enters, grows, tilts or turns; the button's loading ring is a static ring.

The rule: motion explains a change of state. Nothing on grid rows. Nothing loops.

**Acceptance.** With reduced motion on, `/dashboard` renders the map flat and complete on first paint, and the styleguide's play control changes nothing.

## 8. Iconography

**Seventy-three glyphs from Lucide 1.45.0 (ISC), vendored.** They live in `src/app/_ui/Icon.tsx` as path data, about 11 KB, with the licence at `public/brand/LICENSE-lucide.txt`. Not a dependency: the product self-hosts its faces through `next/font` for the same reason, and `lucide-react` unpacks to 35 MB to deliver the same paths. Add an icon by copying its path data from the same version; never draw one.

Stroke 1.75 at 12–17px optical size, `currentColor`, decorative by default — the word beside it carries the meaning, so the glyph is hidden from assistive technology. An icon never appears without a text label, **except** in a toolbar or the collapsed rail, where it carries a tooltip and an accessible name.

**The four severities are reserved and mean nothing else.**

| Icon | Means | Where |
|---|---|---|
| `circle-check` | passed, accepted, active | the ok callout, a met floor, an active account |
| `triangle-alert` | warning | the warn callout, an override, a stale account |
| `octagon-alert` | blocked, refused | the danger callout, a gate blocker |
| `info` | information | the info callout |

The rest of the vocabulary, by job: **review** — `check` accept, `pencil` override, `flag` flag, `git-compare` conflict, `search-x` no evidence, `shield-off` quarantined, `history` inherited or superseded, `list-checks` bulk accept, `undo-2` undo, `eye` show working, `keyboard` shortcuts. **The domain** — `gauge` coverage, `layers` tier, `map` footprint, `map-pin` jurisdiction, `landmark` auditor, `building-2` company, `crosshair` pursuit, `pickaxe` stage, `mountain` production, `hard-hat` development, `gem` commodities, `coins` royalty, `banknote` fees. **Data and actions** — `scroll-text` evidence, `quote` excerpt, `external-link` an outside source, `lock` frozen, `database` the population, `download` export, `file-spreadsheet` the workbook, `badge-check` publish, `upload` upload, `play` run, `octagon-x` halted, `user-x` deactivate, `users` access, `clock-alert` stale, `settings`, `palette`. **Direction** — `trending-up` improved, `trending-down` declined, `minus` unchanged; polarity still ships with its word.

The Unicode marks the build used to draw — ▲ ▼ ● ○ ✓ ✗ ↗ → ← — are gone from the interface. Two survive on purpose: the footing's `= N ✓` is one string the journeys assert, and an arrow inside prose ("Tier 6 → Tier 5") is typography, not an icon.

**Acceptance.** `/styleguide` lists the vocabulary with its names; no icon in the product is the only carrier of a state; `grep` finds no ▲▼●○✗↗ in `src/app` outside the footing.

## 9. Data visualisation

Marks: bars 14px thick with 2px rounded data-ends and a 2px surface gap between neighbours; lines 2px; markers ≥ 8px; gridlines a hairline in `--gridline`, recessive. Labels: the value at the tip of every bar, in ink, never in the series colour; selective direct labels elsewhere; a legend only for two or more series. Hover: the row lights (`--surface-2`) and its addend lights in the footing; on the map the province strokes in ink and the readout names it. Every chart has a table twin (the footing is one; the roster is another) and a coverage-meter state in the same footprint.

| View | Form | Colour job | Label rule | Twin and gate |
|---|---|---|---|---|
| Population | the hero sentence and the stat row | none | figure-lg in a panel | — |
| Footprint | **composition bar** — four parts of one population, drawn as one bar | categorical, the only place the slots are spent | a key naming every part with its count and share | the bar is its own proof |
| Tier distribution | bars above the floor; **tier ladder** below it | ordinal badge ramp | value at the tip, or the basis and "awaiting stage" | the ladder states the refusal and the real basis |
| Office by market | **dot plot** — one dot for the market, one for Deloitte's book | brand + grey | count at the tip; "n ours · x%", or "no client here" | mono composition proof |
| **Whitespace matrix** | **heat map**, market-cap band × incumbent auditor | sequential in named percentage steps | count and share in every cell, in the step's ink | a real table with row and column headers; the research gap is hatched and outside the ramp |
| Province footprint | the map, and bars sorted | sequential on the map, one hue on the bars | code and count on the map; value at the tip | the bars are the twin; caption says counts do not sum |
| Key jurisdictions | horizontal bars, top 12 and a grey remainder | one hue | value at the tip | — |
| Auditor share | **a donut pair** — by value and by count — over the emphasis bars | brand + grey; the gap hatched | the share in the hole, the figures under it | emphasis composition proof; the coverage meter sits under it |
| Auditor × tier | heat map | sequential | count and share in every cell | table; gated on two floors |
| Tier migration | a table of moves with polarity | diverging (status pair) | icon and word in every row | first-period empty state |
| Enrichment coverage | gauges with the floor as a tick | ordinal: green above the floor, grey below | percentage and "n of N" | — |
| Entrants and drop-outs | a table | none | proximity band marked with a word | — |

**The proof is drawn, not written.** `121 + 61 + 12 + 7 + 5 + 53 = 259 ✓` is the right guarantee and the wrong object: an arithmetic string under every chart reads as a footnote nobody checks, and the dashboard carried four of them. The same assertion is now a **composition bar** whose segments *are* the addends — they sum to the width by construction, so the eye verifies the total the way the arithmetic did. The total still carries its tick as one text node, the arithmetic is one press away under "show the arithmetic", and the whole sum is the bar's accessible name. Nothing about the guarantee is weaker: a failing proof still reads `✗ expected N` in the same place, in the alert colour.

**Two cross-tabs read the snapshot directly** rather than the precomputed aggregates. The whitespace matrix and market penetration are one pass over a single publication's rows, which costs nothing and means an already-published revision grows these views without being republished. They read `published_period_values` and nothing else, so they are as frozen as the rest of the page.

**Where a donut is legal.** Two or three parts, a large difference between them, and a hole big enough to carry the headline. Doc 09 banned pies for the *tier distribution* — five or six near-equal segments where the whole point was that two tables disagreed — and that ban holds for that chart, for the six Deloitte markets, and for anything else with near-equal parts. The auditor pair is the other shape: ours, everyone else's, and the part nobody has looked at yet. **The third slice is what makes it honest below the auditor floor**: the research gap is drawn as a gap, hatched and named, so no reader can mistake unresearched for held by somebody else. The coverage meter still sits underneath, and the cross-tab of auditor against tier is still shut.

**Green means Deloitte and nothing else**, so every competing firm is drawn in the de-emphasis grey wherever firms appear together. A four-firm colour set was tested against the palette and cannot be had: no single fixed set of four Deloitte values clears 3:1 on both a white and a black ground, and once green is reserved the palette has only two hue families left — blue and teal — for three competitors. Per-theme steps would solve the contrast half and not the arithmetic half. *[decision: leave the competitors grey, or give up the rule and let one firm take a green step]*

**Two components were retired with these forms.** `Ledger` gave way to the panel and stat row, and `Footing` — the arithmetic proof line under every chart — gave way to the composition bar. Both are in the history; neither is in the styleguide, because a styleguide that documents what the build no longer uses is the drift it exists to prevent.

**A treemap was built for the hero and withdrawn.** Area sized by market capitalisation put the argument on one screen, and it was removed on 13 September because the map is the image this product is remembered by and two full-width pictures above the fold is one too many. The component is in the history at `b435ce4` if the decision is ever reopened; the market-cap figures it drew are all in the roster.

**A heat map's steps are named, never stretched.** A linear five-way split of 0–100% puts almost every cell in the first two steps while 117 auditors are unresearched, and silently stretching the scale to fill the ramp would make a 12% cell look like a 40% one. The steps are fixed percentages and the legend prints them.

Forbidden, from doc 09 and unchanged: pies, Sankeys, dual axes, colour-only encoding, hard-coded axis lists, any green ramp step lighter than the brand on a light ground, "Other" as the label for a Deloitte market, a chart drawn below its coverage floor, and 3D anywhere but the map.

**Acceptance.** Every population view on the dashboard ends in a composition bar whose total reads `= N ✓`, and every gated view says what it is waiting for; the journeys assert the first.

## 10. The map

The canonical form is a 2D choropleth of the thirteen provinces and territories, drawn from `src/lib/publish/canada.ts`: MIT-licensed geometry projected to a Lambert conformal conic (Statistics Canada's parallels, 49 and 77), simplified to 18KB of paths. The fill is a bin of the count of companies with a property there on the sequential ramp; provinces with none take surface-2. Keys are folded through `src/lib/publish/jurisdictions.ts`, the TypeScript mirror of `mmparser/aliases.py`, and a test fails if the two drift; the axis is still derived from the snapshot's buckets, never a list. Hover names the province and its count and offers "See them →", which opens the roster narrowed to that province. The bars twin (the "Provinces and territories" section) is the accessible, keyboard-reachable and printed form, so the SVG is hidden from assistive technology.

The footing under the map is the footprint proof, `Canada only + both + abroad + none = 259 ✓`, because a province counts a company once per province and the provinces do not sum to the population; the caption says so in one sentence.

**The tilted variant** appears on the dashboard hero on first load. It is the same SVG under a CSS perspective of 1400px and `rotateX(22deg)`, with at most 8px of parallax on pointer movement. It settles to flat over 600ms on the first scroll past 40px or the first pointer-down. Under reduced motion, in print and in forced colours it is flat from the start. No value is encoded by height or extrusion; the tilt only re-presents the flat choropleth. The rendering approach is SVG with CSS transforms, no WebGL, no canvas; the budget is the 18KB of geometry and nothing else.

The key-jurisdictions inset is deferred: the foreign buckets today mix countries with US states (Nevada, Alaska, Arizona and Idaho appear beside Mexico and Peru), so an inset would draw a vocabulary the parser has not settled. The foreign bars stay as they are and the inset lands when the vocabulary does.

**Acceptance.** On `/dashboard`, the map's fills change with the province bars' values and never disagree with them; the map's footing reads the same total as the footprint section's.

## 11. Rendered objects

Four objects, each with a brief in `public/brand/objects/`: the full stop (rendered, `full-stop-3d.svg` and its raster exports), a split drill core, a claim grid and an ore body (briefs only; nothing ships until it passes the budget). Every brief states material, palette, lighting, camera, allowed angles, where it may appear and the flat fallback. Palettes never leave black, white, the cool greys and the green ramp. Formats: WebP or AVIF at 1× and 2×, at most 300KB each; the claim grid is SVG under 12KB. Where: sign-in, empty states, loading states, the runs page while a run is in progress. Never inside a grid, table, form, chart or dialog. Fallback: the flat SVG under reduced motion, forced colours and print.

**Acceptance.** No image under `public/brand/` exceeds 300KB; every object referenced by the product has a flat fallback in the same directory.

## 12. Components

Every component in `src/app/_ui` and every pattern in `globals.css`, with its states. Hover, focus-visible, active and disabled are the browser's to show; the styleguide renders the rest.

| Component | Variants and sizes | States that change its look | Tokens | Keyboard and screen reader | Do / don't |
|---|---|---|---|---|---|
| Rail `.sidebar` | expanded 208px / collapsed 56px | hover, current, collapsed | sidebar-bg, surface-2, sidebar-active, green-mark | one labelled `nav` per group; `aria-current="page"`; collapsed items keep their label as the accessible name and gain a tooltip | Do keep the collapse in a cookie. Don't hide a group behind a disclosure |
| Page header `.pagehead` | with back, count, meta, actions | sticky | pagehead-bg, rule, surface-2 | the `h1` for the route | Do give every route one. Don't put a second bar above it |
| Period, in the rail's foot | published / draft dot | — | green-line, warn | text with an `sr-only` expansion when collapsed | Don't repeat the revision here; that is the header's |
| Theme control `.railbtn` | Dark → Light → System | hover | ink-3 → ink | one button; the label names the current state and the next | Don't make it icon-only without a label |
| Callout `.callout` | info / ok / warn / danger | live (`role="status"`) | the tone's edge, soft ground and reserved icon | title then body; `role="status"` only when it reports something the reader just did | Do let the icon and the word carry the tone together. Don't use colour alone |
| Panel `.panel` | with icon, title, right slot, bare | — | rule-raised, surface-1, surface-2 | a labelled `section` | Do put loose figures in one. Don't give it a shadow |
| Stat row `.statrow` | quiet items, linked items | hover on a linked cell | rule, figure-lg, ink-3 | plain text | Do keep the cells equal. Don't let one orphan on a row |
| Skip link `.skip` | — | focus | skip-bg, skip-ink | first tab stop | — |
| Facts `.facts` | inline / rail | — | ink-3 label, ink value | a `<dl>` | Don't set a fact as a sentence |
| Hero `.hero` | dashboard | count-up once | display, figure-xl, the stop | a `<p>`, the stop hidden | Don't put a second stop on a page |
| Section `.section` | with query key | — | rule, mono | `aria-labelledby` its h2 | Don't box it |
| Bars `.bars` | grey / gap / accent / terminal | row hover | brand-fill, demote, surface-2 | each bar `role="img"` with a name | Don't colour by value, and don't put a proof inside the chart |
| Proof `.composition` | identity / emphasis / mono | the arithmetic disclosed | cat slots or brand + grey; ink, alert | a `role="img"` naming every part and the sum; `= N ✓` stays one string | Don't spend the categorical slots where the parts outnumber them |
| Gauge `.gauge` | below / warn / over / compact | — | green-line, demote, warn, alert | `role="img"` naming percent and floor | Don't fill below the floor in green |
| Meter `.meter` | — | — | figure-md | text with a link into review | Don't let it change the footprint |

| Pills `.pill`, tags `.tag` | ok / no / warn / quiet / conflict / done / retired | — | soft grounds and their text | text | Don't rely on the colour: the word is the state |
| Tables | one anatomy; `.t-compact` 30px, default 36px, `.t-roomy` 44px; `.roster`, `.matrix`, `.provenance`, `.accounts` | row hover, sorted header, sticky header and first column | surface-1, surface-2, rule, rule-raised | `th scope` on every header, `aria-sort` on a sortable one, a row header per row | Do right-align every number and middle-align every row. Don't zebra-stripe, and don't put a 44px control in a 36px row |
| Review grid `.grid` | field-major / company-major | selected row, decided row, focused cell | surface-1, surface-2, green-mark | one tab stop, roving index, live region | Don't animate rows |
| Evidence strip `.ev` | four bands | — | green-mark, warn, alert | strip hidden; numeral and word visible | Don't show a strip without its numeral |
| Evidence panel `.evidence` | with diff / editor / flag | cross-fade | surface-1, rule | a labelled region referenced by `aria-describedby` | Don't make it a tooltip |
| Diff `.diff` | — | — | rule, surface-1 | two named cells | Don't pre-select |
| Buttons `.btn` | primary / default / secondary / quiet / danger; 44px `lg`, 36px default, 28px `sm`, `icon-only` square | hover, active (1px press), pressed, disabled, loading | brand-fill and on-brand for primary; btn-bg, rule-raised, alert-edge | `aria-pressed` on a toggle, `aria-busy` and a kept label when loading, an `aria-label` when icon-only | Do use danger for the one control that takes something away. Don't style an action as a text link, and don't change width while loading |
| Filters `.filters` | chips with counts | current | ink, on-ink | links with `aria-current` | — |
| Find `.find` | in tools, in the palette | — | input-bg, rule | labelled, `/` focuses it | — |
| Status line `.statusline` | — | announcement | ink-2 | `aria-live="polite"` | — |
| Queue tiles `.queue` | linked / not / start-here | hover | surface-2, green-soft | each count is a link | Don't render a zero tile inline |
| Gate list `.gatelist` | ok / no | — | green-text, alert | marks hidden, words visible | — |
| Dialogs `dialog` | bulk, keys, palette | open | surface-3, shadow-3, backdrop | `showModal`, labelled, Esc cancels | Don't add a suppress-this option |
| Forms `.commit`, `.desk`, `.narrowing` | fields, units, checks, direction cards | focus (green-mark border), error notice | input-bg, rule, green-mark | labels for every control | Don't put a label inside the field |
| Drop zone `.drop` | over | hover, focus-within | rule-raised, green-mark | a label around the input | — |
| Skeletons `.sk` | dashboard, board, grid | pulse | surface-2 | `aria-busy` | Don't skeleton the map's shape as a card |
| Refusal `.refusal`, empty `.empty` | with action | — | ink-2 | an h1 and one action | Don't apologise |
| Sign-in `.signin` | magic link, dev roles | pending | lockup, orb | one field and one button | — |
| State bar `.statebar` | eight states | — | brand-fill, green-line, warn, alert, demote | labelled | — |
| Trace `.trace` | fired / not | — | green-mark, ink-3 | fired state in sr-only text | — |
| Verdict `.verdict` | tier / unclassified | — | figure-lg | a sentence | — |
| **Tooltip** `.tip > .bubble` | on the collapsed rail and icon-only controls | visible on hover and focus-within | surface-3, shadow-2 | `role="tooltip"`; never the only carrier of a value | Don't put a control inside |
| **Toast** `.toast` | default / alert / warn | — | surface-3, green-mark | `role="status"`, one at a time, bottom left | Don't stack more than one |
| **Segmented** `.segmented` | 2–4 words | pressed | ink, on-ink | `aria-pressed` buttons or `aria-current` links | Don't use for more than four |
| **Switch** `.switch` | — | checked, disabled | rule-raised, green-mark | `role="switch"` with the word beside it | Don't use for anything that saves on change without saying so |
| **Tabs** `.tabs` | — | selected | green-mark | `role="tablist"`, arrow keys | Don't tab a page that scrolls |
| **Breadcrumb** `.breadcrumb` | — | current | ink-3, ink | an `<ol>` | Don't exceed three levels |
| **Menu** `.menu` | — | open, item hover | surface-3, shadow-2, surface-hover | `role="menu"`, arrows move, Esc closes | Don't put destructive items first |
| **Command palette** `.palette` | the `/` find, grown | selected result | surface-3 | a dialog with a listbox | Don't replace the nav with it |
| **Progress** `.progress` | stepped | done / now / fail | green-line, alert | a labelled track with the stage in words | Don't use it for anything under a second |
| **Button loading** `.btn.loading` | — | — | ink-3, ink | `aria-busy`; label stays in the DOM | Don't swap the label for a spinner |

**Acceptance.** `/styleguide` renders every row above with the listed states, and the six new components appear there before they appear in a screen.

## 13. Voice in the interface

Plain verbs, sentence case, no filler. An action keeps its name through the flow: **Publish** → **Publishing…** → **Published**. Errors say what happened and what to do: "That sign-in link cannot be used. Links last fifteen minutes and work once — ask for another below." Empty states invite action: "Find a company and open its profile to start one." Counts and percentages travel together: "Found for 61 of 259 (23.6%)". Headings state a point. Nothing apologises.

**Glossary.** *Period* — one quarterly refresh; *snapshot* — the frozen, published form of it; *revision* — one publication of a period; *tier* 1–6 and *Unclassified* as a state; *stage* — exploration, development, production, royalty/streaming, tri-state; *footprint* — Canada only, abroad only, Canada and abroad, none; *Deloitte market* — five markets, or "no Deloitte market"; *evidence strength* — four bands, low to very high; *source tier* [T1]…; *anchoring gate* and *quarantine*; *conflict* — the extract and the AI disagree, a decision not a warning; *accept / override / flag*; *bulk accept* with a floor; *coverage floor* and the *publish gate*; *migration* with polarity; *entrants* and *drop-outs* with a *proximity band*; *pursuit* with priority, status and outcome; *footing* — the proof line; *whitespace* — a company Deloitte does not audit.

**Never.** "Other" for a market. "Confidence" for evidence strength. "Best practice", "leverage", "journey", "holistic". "Oops", "sorry", "please try again". "N/A" (write what is true: "not researched", "not known", "none"). Exclamation marks.

**Acceptance.** No string in `src/app` contains "Oops", "N/A" or "Other" as a market label.

## 14. Accessibility and print

WCAG 2.1 AA is the floor. Text 4.5:1 and non-text 3:1 in both themes, by script. **Targets: 44px where the obligation applies.** WCAG 2.1's 44px rule is AAA, not AA, and a 44px control in a 36px table row is the defect it produced here; so a button is 36px tall on a fine pointer and 28px in a table row, and a pseudo-element expands every button's target to 44px under `@media (pointer: coarse)`, which is where a thumb actually needs it. One tab stop with a roving index in the grid; a polite live region for every decision; the evidence panel a labelled region, never a tooltip. Focus indicators are 2px in `--focus` with 2px offset, which is the darkened green on light and the brand on dark. At 200% zoom the grid scrolls horizontally under the data-table exception while the toolbar and filters reflow; the roster does the same. Forced-colours mode: bars, gauges, the state bar and the map keep `forced-color-adjust: none` and take `CanvasText` and `GrayText`, the selected row takes a `Highlight` outline, the orb disappears. Reduced motion: section 7.

Print always renders light: the `@media print` block restates the light tokens on the root, removes the rail, the header's actions, the map's readout and the toasts, flattens the tilt, opens the bars twin, keeps every footing, and ends with the three licence notices. The export workbook is the paper form of the brand: the same wordmark on its cover *[confirm the lockup]*, the same footings on every population sheet, Open Sans throughout, figures right-aligned and tabular, and no colour on any cell but the brand green on the cover's stop.

**Acceptance.** `npm run e2e` reports no serious findings on every route; printing `/dashboard` from the dark theme produces a light page with the footings.

## 15. Application plan

Ordered so the demonstration path is finished first. Effort is in engineer-days for one person who knows the codebase. After every step: `npm run check:contrast`, `npm test`, and `npm run e2e:isolated` with its `= N ✓` assertions.

| # | Step | Effort | Done in this pass |
|---|---|---|---|
| 1 | Tokens in three layers, both themes, the switch, `color-scheme` and `themeColor` following the theme | 1.5 | ✓ |
| 2 | The contrast gate for both themes, the ramp and categorical checks | 0.5 | ✓ |
| 3 | Sign-in: the lockup and the orb | 0.5 | ✓ |
| 4 | Dashboard hero: the map, its tilt, its readout and its footing; provinces folded through the vocabulary | 2 | ✓ |
| 5 | The all-companies roster: nine columns, sort, find, whitespace, province narrowing | 1 | ✓ |
| 6 | Company profile: evidence at a glance beside the trace | 0.5 | ✓ |
| 7 | Review grid: surface-1, dense rows, the panel on its tier; keyboard loop untouched | 0.5 | ✓ (tokens only) |
| 8 | The living styleguide | 1 | ✓ |
| 9 | Brand assets and the object briefs | 0.5 | ✓ |
| 10 | Before/after screenshots in both themes | 0.5 | ✓ |
| 11 | Vendor the icon set and swap every Unicode glyph (section 8) | 0.5 | ✓ |
| 12 | The button system: five variants, three sizes, the green primary | 0.5 | ✓ |
| 13 | Status callouts, replacing `.notice` in ~30 places | 0.5 | ✓ |
| 14 | The table system: one anatomy, three densities, `scope`, the aligned action column | 1 | ✓ |
| 15 | Panels and the stat row, for every loose figure | 0.5 | ✓ |
| 16 | The shell: the left rail, the page header on all seventeen routes, no top bar | 2 | ✓ |
| 17 | Section rhythm, section icons, "show working" | 0.5 | ✓ |
| 18 | Fix the zero-count queue tile's inline collapse | 0.1 | ✓ |
| 19 | Wire the toast to the decision announcer and the publish progress to the publish job | 1 | — |
| 20 | Grow the `/` find into the command palette (companies, fields, sections) | 1 | — |
| 21 | The hero figure's count-up | 0.25 | — |
| 22 | Render the drill core, claim grid and ore body to the briefs; place them in the empty states | 2 (plus a renderer) | — |
| 23 | The key-jurisdictions inset, once the foreign vocabulary separates countries from states | 1 | — |
| 24 | Fold the export's cover and sheets onto the brand (section 14) | 1 | — |
| 25 | Drill-down links from every bar into the filtered roster, and one "since last period" empty state | 1 | — |
| 26 | The composition bar, the whitespace matrix and the tier ladder | 1.5 | ✓ |
| 27 | The auditor donut pair and the market dot plot | 1 | ✓ |

**Acceptance.** Steps 1–18 are in the tree; `npm run check:contrast`, `npm test` and `npm run e2e:isolated` pass on it.

## 16. Open questions and placeholders

| Placeholder | Where | Owner |
|---|---|---|
| Every Deloitte secondary value (greens 1–7, blues 1–7, teals 1–7, cool greys 2–11) | sections 3, `globals.css` primitives | brand hub |
| The co-branding rule and the Deloitte wordmark asset for the lockup | sections 2, 14; sign-in; `public/brand/lockup-*.svg` | brand hub, then Samuel |
| House guidance on dark grounds for internal tools | section 1 | brand hub |
| Open Sans as the firm's corporate face | section 4 | brand hub |
| The demonstration laptop and its VPN, for a measured LCP budget (the target is interactive within 2.5s; unmeasured) | section 6 | Samuel |
| Whether the practice wants the province narrowing on the roster to read "property in" or "head office in" | sections 5, 10 | Kay |
| Which question the original "producing mines by province" view answered, before any inset is drawn | section 10 | Kay |

## What was removed after the second look

Chanel's rule, applied once at the end: the lit gradient panel behind the hero map. It was meant to be the one place light has a direction; on screen it read as a rounded card behind the map, which is the accessory this guide forbids on a working screen and the first thing the AI-default test flags. The map now sits on the ground, and the lift survives only on surface-3 where a dialog needs to come forward.
