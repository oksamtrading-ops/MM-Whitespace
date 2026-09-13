# Prompt — Whitespace brand and interface guide

**How to use this file.** Run it in Claude Code from the root of the MM-Whitespace repository, so the model can read the files it names. Paste everything below the rule as the first message. Where the prompt says *[confirm]*, a value must be checked against Deloitte's internal brand hub before it is treated as final; the guide must flag every such value rather than present it as settled.

Skills to have available in the session, in this order of importance: `frontend-design`, `dataviz`, `design-system`, `deloitte-voice`, `web-design-guidelines`, `accessibility-review`. If a skill is not installed, the prompt restates its load-bearing rules so nothing depends on it.

---

## Your role

You are the design lead for **Whitespace**, the Mining Whitespace Intelligence Tool built for Deloitte Canada's Mining & Metals practice. You are producing the brand and interface guide that the application will be re-skinned against before a partner demonstration in two to four weeks. Approach this as a studio known for giving every client an identity that could not be mistaken for anyone else's, with one constraint that outranks taste: **this is a Deloitte product and it must read as one at a glance.** Make deliberate, opinionated choices and take one real aesthetic risk you can justify. Do not produce a template.

The quality bar is the one Apple and Tesla hold their own software to: material that feels physical, motion that explains rather than decorates, typography that carries the personality, density that never looks busy, and nothing on screen that is not earning its place.

## Read before you design

Read these in full before writing a line of the guide. They are the ground truth; the guide extends them and must not silently contradict them.

1. `docs/design/17-visual-system.md` — the current visual system and the derivations behind it.
2. `src/app/globals.css` — the live tokens and every component style; `scripts/check_contrast.mjs` — the contrast gate the build runs.
3. `docs/design/09-dashboards-and-reporting.md` — chart-by-chart specification, coverage gating, the colour rules and everything forbidden.
4. `docs/design/08-review-workspace.md` — the triage board, the field-major grid, the evidence panel, the keyboard loop.
5. `docs/design/01-users-and-jobs.md`, `docs/design/02-scope-phases-non-goals.md`, `docs/design/16-least-confident-decisions.md`, `docs/DESIGN.md`.
6. `src/app/_ui/*.tsx`, `src/app/layout.tsx`, `src/app/icon.svg`, and one page from each role: `(viewer)/dashboard/page.tsx`, `(viewer)/companies/[id]/page.tsx`, `(analyst)/review/[field]/Grid.tsx`, `(analyst)/pursuits/page.tsx`, `signin/page.tsx`.

Then run the application locally (`npm run dev`) and look at every route in the inventory below before proposing anything. Screenshot what exists; you will be asked to show before/after.

## What the product is

Deloitte Canada's Mining & Metals practice tracks every TSX and TSXV mining company above a market-cap threshold (259 in Q3 2026: 144 TSX, 115 TSXV) and assigns each a pursuit tier. The quarterly refresh stalled at research — stage-of-operations was blank for 242 of 259 companies, so everything computed as Tier 4. Whitespace ingests the controlled workbook, enriches each company against public sources with evidence attached, routes every proposed value through human review, applies the existing tier rules unchanged, and publishes a frozen, immutable period to dashboards and back to Excel.

Three roles: **Viewer** (partners and practice leads — dashboards, company profiles, nothing unpublished), **Analyst** (upload, runs, review, publish, pursuits, export), **Admin** (access, settings, publish override with a recorded reason). Sign-in is invite-only magic link.

The product's thesis, in its own words, which the visual language must embody:

- "Refuse to draw a chart that would lie."
- "An empty chart gets ignored; a full one that is wrong gets believed."
- "Evidence strength, not self-confidence."
- "A confident answer with no source is a hallucination with good posture."
- "The worst output this system can produce is a fabricated audit fee on a partner's dashboard."
- "This build is a proof of concept and stores no Deloitte client information."

The dashboard's real headline is a sentence, not a KPI tile: **"Deloitte audits 17 of 259."** The one idea kept from the source workbook is the **proof line** — every population chart foots to its total (`121 + 61 + 12 + 7 + 5 + 53 = 259 ✓`). The auditor's footing is the product's signature and it stays.

### Domain vocabulary the guide must design for

Tier 1–6 (grouped 5-and-6 on the dashboard) and **Unclassified** as an honest state; stage of operations (exploration, development, production, royalty/streaming — tri-state, blank means *not researched*); footprint (Canada only / Abroad / Canada & Abroad / none); Deloitte market (five markets plus "no Deloitte market", never "Other"); evidence strength in four ordinal bands, shown as numeral + band word, never colour alone; source tiers `[T1]…`; anchoring gate and quarantine; conflict (extract vs AI proposal — a decision, not a warning); accept / override / flag; bulk accept with a floor selector; period, snapshot, revision; coverage floor and the publish gate; tier migration with polarity (up / down / neutral, always icon + word); entrants and drop-outs with a proximity band; pursuits with priority, status and outcome.

### Route inventory (all built and live)

`/signin`, `/dashboard`, `/companies`, `/companies/[id]`, `/companies/merge`, `/upload`, `/upload/[id]`, `/runs`, `/review`, `/review/[field]`, `/review/by-company`, `/publish`, `/pursuits`, `/pursuits/[id]`, `/access`, `/settings`, plus error, not-found, loading and refusal states.

## What exists and must be kept

The current system is a credible, contrast-verified editorial baseline. It reads like a well-set financial report. The guide **extends** it; it does not start over. Keep, and design around:

- **The mark.** The word *Whitespace* followed by a green full stop (`.stop`, `#86BC25`), and the favicon (black rounded tile, green dot lower-right). The dot is the brand.
- **The two faces.** Open Sans for everything you read; Archivo (variable, width axis) for every figure that measures something — condensed at display size, full width in tables, always tabular. Dates and prose numbers stay in Open Sans. This rule is what makes figures read as instruments.
- **The footing** (auditor's proof line, hover lights the addend), the **ledger line** (four figures in a row, not four cards), the **hero sentence**, the **coverage meter** that stands in for a gated chart in the same footprint, and the **evidence strip** (four cells + numeral + word).
- **The accessibility floor** already enforced: 4.5:1 text, 3:1 non-text, 44px targets, roving-tabindex grid, live regions, `prefers-reduced-motion`, a full print stylesheet, and the two forbidden pairs (white text on brand green; brand green as text on white) that `check_contrast.mjs` asserts still fail.
- **The forbidden list from doc 09:** pies, Sankeys, dual axes, colour-only encoding, hard-coded axis lists, any green ramp step lighter than the brand green on a light ground, "Other" as a label for a Deloitte market, and charts drawn below their coverage floor.

## Decisions already taken for this guide — do not reopen them

1. **Dark-first, light available.** The primary theme is a black ground with Deloitte green; the light theme (the current white system) remains a first-class citizen for print, export and users who prefer it. Both themes are designed, not flipped: every dark token is its own step, validated against the dark surface. This reverses decision 8 in doc 17 and resolves the open question in doc 16; record the reversal and its reasons in the guide. Doc 16's worry stands and the guide must answer it: partners will see this beside light Deloitte decks and paper, so the dark theme must read as Deloitte's black-and-green, not as a generic dark dashboard, and the light theme must be one toggle away for a partner who prefers it.
2. **Deloitte secondary palette is permitted** for data series and status. The guide uses Deloitte's own accessible secondary colours for categorical and sequential encodings rather than inventing hues. Candidate values below are from the publicly circulated Deloitte specification and are *[confirm]* until checked on the brand hub — the guide must carry the flag on every one of them.
3. **Keep and refine the full stop.** No new symbol, no rename. The guide adds a proper lockup, clear-space and sizing rules, a 3D rendering of the dot for hero and loading moments, and a Deloitte co-branding rule.
4. **The map is the hero.** A province/territory and key-jurisdiction footprint map becomes the dashboard's opening view and a signature brand asset, with a 2D choropleth as the canonical form and a 3D/tilted variant for hero and demo moments. Bars remain as the accessible twin and the print form. This is the one place the "no 3D charts" rule in doc 09 is relaxed, and only under the conditions in the map section below.
5. **Viewer and Analyst experiences are optimised equally.** One system, applied end to end before the demo. The dashboard, the company profile, the triage board and the review grid all get the full treatment.
6. **"3D" means four things, layered by context**, and the guide must define each precisely: (a) *depth in the interface* — surface tiers, elevation, material, blur, lighting, parallax on the hero only; (b) *rendered objects* — a small family of 3D-rendered brand objects (the full stop as a physical object first; then subject-drawn objects such as a core sample, an ore body, a claim grid) used on sign-in, empty states, loading and section heroes, never inside a working grid; (c) *3D data views* — the map only, never bars, never tiers as extruded blocks; (d) *demo moments* — sign-in, first load, the transition from map to table. The working screens — grid, evidence panel, forms, tables — stay flat, dense and instrument-like. Depth is spent where a partner looks, not where an analyst works.

## Non-negotiables the guide must state and the tokens must satisfy

- **Deloitte colour discipline.** Green `#86BC25` is the brand; on the light theme it appears only as large fills and the full stop (2.27:1 — it obliges a direct value label or a table twin). On a dark ground it passes (9.23:1 on black, 7.66:1 on doc 09's dark surface) and may carry text and lines; the guide says exactly where. Black, white and the cool-grey ramp are the neutrals. No warm cream, no off-brand accent, no gradients that introduce a hue Deloitte does not own. Every colour token is a six-digit hex that `check_contrast.mjs` can parse.
- **Every colour pair used for text meets 4.5:1 and every non-text mark meets 3:1 in both themes**, and the check script is extended to prove it for the dark palette as well. Add a categorical-palette check (adjacent-pair colour-vision separation; OKLab ΔE×100 ≥ 8 target, ≥ 6 only with secondary encoding; normal-vision floor ≥ 15) or document the exact procedure the team runs before a series colour ships. Status colours (good / warning / serious / critical) are reserved, never reused for a series, and always ship with an icon and a word.
- **Identity by hue order, never by rank.** Categorical hues are assigned in fixed order; a filter that changes the series count must not repaint survivors. Sequential is one hue light→dark; diverging is two hues with a neutral grey midpoint; migration polarity uses the reserved status pair, never light/dark green.
- **Text wears text tokens, never the series colour.** Values, labels and legends stay in ink; a coloured mark beside them carries identity.
- **Honesty is a visual rule.** A chart below its coverage floor renders a meter in the same footprint — no layout jump. Inherited values are visibly inherited with their age. Unknown is a visible bar. Unclassified is a state. Nothing decorative may make a gated view look complete.
- **No Deloitte client information appears in any asset, screenshot or example** — including the brand guide's own illustrations. Use the synthetic fixture (`tests/fixtures/synthetic_whitespace.xlsx`) or invented companies.
- **No invented figures.** Where the guide needs a number it does not have (a Deloitte brand value, a device statistic), it inserts a *[confirm]* placeholder and lists every placeholder in a closing table.
- **Performance is part of fidelity.** Fonts stay self-hosted through `next/font`; no runtime font fetch. 3D assets have a budget (state it — for example, ≤ 300 KB per rendered object as compressed WebP/AVIF with a 2× variant, and a hard cap for any WebGL scene) and every 3D element has a flat fallback for `prefers-reduced-motion`, low-power devices, print and forced-colours mode. The dashboard must remain interactive within a stated LCP budget on a mid-range laptop over VPN.

## Deliverables

Produce all of the following, in this order, as files in the repository. Where a file already exists, edit it in place rather than creating a parallel version.

### 1. `docs/design/18-brand-guide.md` — the guide

Written in the voice of the existing design docs: sentence-style headings that state a point, decision before rationale, Deloitte's tone (get to the point; think like the audience; never be neutral; edit ruthlessly). Open with a one-sentence thesis in the style of doc 17's opener. Sections, each ending with an acceptance criterion a reviewer can test:

1. **Thesis and principles.** Five principles at most, each one sentence plus one paragraph of what it forbids. They must be derived from the product's own thesis (evidence, proof, refusal to lie) and from the practice's vernacular (footing, ledger, audit trail), not from generic "clean and modern" language. Say what the one aesthetic risk is and why it is right for this product.
2. **Identity.** The wordmark and full stop: construction, proportions, clear space, minimum sizes, the lockup with "Deloitte." *[confirm the co-branding rule on the brand hub]*, the dark and light versions, the favicon and app-icon family, the 3D full stop (material, lighting, allowed angles, where it may appear), and misuse examples. Provide the SVGs.
3. **Colour.** Three layers: *primitive* (every Deloitte value with its name), *semantic* (ground, surface-1/2/3, ink-1/2/3, rule, brand, brand-text, focus, status, polarity), and *component* aliases. Both themes as full tables with contrast ratios against their own surfaces. Then the four chart-colour jobs — categorical order, sequential hue, diverging pair, status — with the validated hex steps, what each is for, and the auditor-share "Deloitte accented, others grey" rule. State plainly which greens are legal for text in each theme and which are fills only.
4. **Typography.** Open Sans and Archivo roles restated, then a **named type scale** replacing the nineteen ad-hoc sizes in `globals.css` — display, headline, title, body, label, caption, figure-xl/lg/md/sm — with size, line-height, weight, tracking, width axis and the fluid `clamp()` rule for display sizes. Tabular figures everywhere a number can change. Uppercase tracked labels reserved for column headers and eyebrows.
5. **Space, shape and layout.** A spacing scale (4-based), radius scale, the 56px top bar, the 880px measure, the rail, the workbench split, breakpoints as tokens, the grid's density rules (row height, cell padding, sticky header), and the full-width "all companies" table the demo needs — its density, its column system, its sort/filter affordances, its sticky first column.
6. **Depth and material.** The surface tier model (how many levels, what sits on each), the elevation scale as shadow *and* border *and* tonal-lift definitions for both themes, blur and glass rules (where allowed, where forbidden — never over data), lighting direction, and the parallax rule (hero only, ≤ 8px, off under reduced motion). Show the dashboard header, a dialog, the evidence panel and a tooltip on each tier.
7. **Motion.** A duration scale and easing set as tokens; the choreography of first load (top bar → hero → sections rise → bars grow → footing ticks), the map-to-table transition, number count-ups for the hero figure only, hover and press micro-interactions for every interactive component, the evidence-panel cross-fade, skeleton-to-content, and what happens under `prefers-reduced-motion`. The rule: motion explains a change of state; nothing on grid rows; nothing loops.
8. **Iconography.** A single icon set (choose one open-source set with a licence compatible with internal Deloitte use, state it), stroke weight and optical size, the mapping of every glyph currently drawn with Unicode (▲ ▼ ● ○ ✓ ✗ ↗ →) to a named icon, and the rule that an icon never appears without a text label except in a toolbar with a tooltip.
9. **Data visualisation.** For every chart in doc 09 — population, tier distribution, office by market, market × tier, province footprint, key jurisdictions, auditor share, auditor × tier, tier migration, enrichment coverage, entrants/drop-outs — give the form, the colour job, the mark spec (bar thickness, 2px surface gap, rounded data-ends, ≥ 8px markers), the label rule, the hover/tooltip spec, the legend rule, the table twin and the coverage-meter state, in both themes. Thin marks, recessive grid, selective direct labels.
10. **The map.** Canonical 2D choropleth of provinces and territories with the key-jurisdictions inset (a controlled vocabulary with its alias map lives in the code — use it, do not hard-code a list); a sequential single-hue encoding for count of companies with properties; hover reveals the count and a link to the filtered table; the footing sits under the map like any population chart; the bars remain as the accessible twin, keyboard-reachable, and are what prints. The 3D/tilted variant: when it appears (dashboard hero on first load and the demo), how it is lit, how far it tilts, how it collapses to 2D on scroll or interaction, its reduced-motion fallback, and the hard rule that no value is encoded by height or extrusion alone — the 3D form only ever re-presents the same choropleth. Name the rendering approach (SVG with CSS transforms vs a WebGL layer) and its budget.
11. **3D objects.** The object family, the rendering brief for each (material, palette, lighting, camera), file formats and sizes, where each may appear, and the flat fallback. First object is the full stop; the rest are drawn from the subject's world.
12. **Components.** For every component in `src/app/_ui` and every pattern in `globals.css` — top bar, nav, period chip, skip link, facts, ledger, hero, section, bars, footing, gauge, meter, notice, pills and tags, tables, matrix, review grid, evidence strip, evidence panel, diff, buttons, filters, find, status line, queue tiles, gate list, dialogs, forms, direction cards, drop zone, skeletons, refusal, empty, sign-in, statebar, trace, verdict — document variants, sizes, every state (default, hover, focus-visible, active/pressed, selected, disabled, loading, error), tokens used, keyboard and screen-reader behaviour, and a do/don't pair. Add the components the current build lacks: tooltip, toast, segmented control, switch, tabs, breadcrumb, dropdown/menu, command palette (the `/` find already exists — grow it), progress for publish, and a proper loading state for buttons.
13. **Voice in the interface.** The copy rules the product already follows — plain verbs, sentence case, actions keep their name through the flow ("Publish" → "Published"), errors say what happened and what to do, empty states invite action, counts and percentages together ("Found for 61 of 259") — plus a glossary of the product's terms and the words never to use.
14. **Accessibility and print.** WCAG 2.1 AA as the floor; what the grid does at 200% zoom; focus indicators; forced-colours mode; the print stylesheet for the dark theme (it prints light); the export workbook's treatment as the paper form of the brand.
15. **Application plan.** A sequenced list of changes to make the live application match the guide, ordered so the demo path (sign-in → dashboard hero map → all-companies table → company profile → review grid) is finished first, with an estimate of effort per step and the checks (`npm run check:contrast`, `npm run e2e`, the journeys' `= N ✓` assertions) that must still pass after each.
16. **Open questions and placeholders.** Every *[confirm]* value in one table with an owner (Samuel, Kay, brand hub).

### 2. Tokens

Refactor `src/app/globals.css` so `:root` holds a three-layer token system (primitive → semantic → component) with `[data-theme="dark"]` and `[data-theme="light"]` blocks and a `prefers-color-scheme` default, plus new scales for space, radius, type, elevation, z-index, duration, easing and breakpoints. Remove every off-token literal (`#EAEAE8`, `#222`, `#fff`, the rgba shadows). Keep every class name that the journeys and tests reference. `html { color-scheme }` follows the theme; `viewport.themeColor` follows the theme.

### 3. Contrast and palette checks

Extend `scripts/check_contrast.mjs` to parse both theme blocks, keep every existing assertion, add the dark-theme pairs, keep the two forbidden pairs failing on light, add the rule that no single token serves both text and non-text floors, and add the categorical adjacent-pair check for the chart palette. `npm run check:contrast` must exit 0 on the delivered tokens and must fail if any *[confirm]* value is later changed to one that breaks a floor.

### 4. Living style guide

A route `/styleguide` (Admin-only, behind the existing role gate) or a static `docs/design/brand/index.html` that renders every token, the type scale, both themes side by side with a toggle, every component in every state, every chart form with its footing and its meter state, the map in 2D and 3D, the object family, and the motion choreography with a "play" control. It is built from the real tokens and components, not screenshots, so it cannot drift.

### 5. Assets

`public/brand/` with the wordmark and lockup SVGs (dark and light), the favicon family, the 3D full stop renders (with the flat SVG fallback), rendering briefs for the remaining objects as markdown, and a `README.md` stating licence and usage.

## Process

Work in two passes and show your plan before you build.

**Pass one — plan.** After reading everything, write a compact design plan: the thesis sentence; the palette as named hex values for both themes; the type scale; the layout concept for the dashboard, the all-companies table, the company profile and the review grid as one-sentence descriptions with ASCII wireframes; the signature (name the one element this product will be remembered by — the footing and the map both compete for it; decide, and make everything else quieter); the 3D strategy in one paragraph; the motion choreography in one paragraph. Then critique the plan against the brief: a near-black ground with a single acid-green accent is one of the three looks AI-generated design defaults to, and this brief asks for exactly that — so the plan must show what makes it *Deloitte's* and *mining's* and *this product's* rather than the default: the neutral ramp, the two faces, the footing, the map, the material of the objects, the way green is rationed. Name what you changed after the critique and why. Show the plan, wait for approval.

**Pass two — build.** Deliver the files in the order above. After the tokens land, run `npm run check:contrast`, `npm test` and `npm run e2e` and report the results. Take screenshots of every route in both themes and place before/after pairs in `docs/design/brand/screens/`. Critique your own output once more against the "AI default" test and against Chanel's rule — take a look and remove one accessory — and record what you removed.

Ask me before deciding any of these: the exact Deloitte co-branding lockup; whether the 3D map uses WebGL or CSS transforms; the icon set; any change to a class name or DOM structure that a test asserts; anything that would touch the tier engine, the publish gate or the export.

## Reference values — all *[confirm]*

Candidate Deloitte secondary values from the publicly circulated specification, for the guide to validate and snap to passing steps. Names in brackets are the spec's; treat every value as a placeholder until confirmed on the brand hub, and say so in the guide. Do not use any that fail the checks.

- Green: `#E3E48D` [1], `#C4D600` [2], `#43B02A` [3], `#26890D` [4], `#86BC25` [brand], `#046A38` [6], `#2C5234` [7]
- Blue: `#A0DCFF` [1], `#62B5E5` [2], `#00A3E0` [3], `#0076A8` [4], `#005587` [5], `#012169` [6], `#041E42` [7]
- Teal: `#DDEFE8` [1], `#9DD4CF` [2], `#6FC2B4` [3], `#00ABAB` [4], `#0097A9` [5], `#007680` [6], `#004F59` [7]
- Cool grey: `#D0D0CE` [2], `#BBBCBC` [4], `#A7A8AA` [6], `#97999B` [7], `#75787B` [9], `#63666A` [10], `#53565A` [11]; black `#000000`; white `#FFFFFF`

Note that the current light tokens already deviate from the spec where the spec fails a floor (`#74777A` instead of `#75787B` for 4.50:1). Keep that habit: brand values are inputs to the validator, not outputs.

## What good looks like

A partner opens the dashboard and sees, in one screen, a lit map of Canada in Deloitte green on black that tells them where the practice's whitespace is, a sentence that says how much of the market is not Deloitte's, and a footing that proves the numbers add up. They scroll and the map settles into a flat, dense, sortable table of all 259 companies. They open a company and get tier, rule trace, footprint, auditor and evidence in one screen with no scrolling. An analyst, the same afternoon, opens the review grid and nothing about the new depth or motion has slowed the keyboard loop by a single keystroke. Nothing on any screen is a colour Deloitte does not own, and every colour on every screen has passed a script, not an eye.
