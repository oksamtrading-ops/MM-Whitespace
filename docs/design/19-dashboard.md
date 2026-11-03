# 19 — The dashboard

**One sentence:** one list of published companies read three ways at once — a sentence that answers, a globe that shows where the answer lives, and a memo that proves it point by point — so a partner who opens the tool knows Deloitte's place in the market before they scroll, and can present it without leaving the page.

This doc replaces doc 18 §10 (the map), amends doc 18 §1 (the tile row) and §7 (first-load motion), and leaves the rest of doc 18 in force. The code is `src/app/(viewer)/dashboard/` (`Atlas.tsx`, `Memo.tsx`, `Brief.tsx`, `Find.tsx`, `words.ts`, `offices.ts`), `src/app/_ui/Globe.tsx`, and `src/lib/publish/` (`atlas.ts`, `lens.ts`, `globe.ts`, `world.ts`, `cities.ts`). The words a partner reads aloud live in `words.ts` and `lens.ts` and are tested there, not proof-read.

## 1. What a partner opens it for

A partner in Audit & Assurance opens the dashboard with four questions, in this order: how big is the market, how much of it does Deloitte audit, how much of it does nobody know yet, and what moved. Then: where is it — where these companies dig and where they are run from. Then, on the way into a meeting: show it to me in a form I can present.

The page answers in that order: the answer at the head of the left column, the globe beside it, the memo down the column under the answer, and two actions at the end of the filter bar — **Find** (one company) and **Brief me** (the period, full-screen).

What it does not do is unchanged from doc 01: it does not decide which companies are worth pursuing, it scores nothing, and contacting anyone is out of scope. Every sentence states a count and what it is a count of.

**Acceptance.** A reviewer opening `/dashboard` reads the headline, the share of value, the unknown count and the two-year change count without scrolling, at 1440×900 and at 375×812.

## 2. The answer

**The sentence.** "Deloitte audits *N* of *M* companies", the first figure in green and the second in ink, both in Archivo at 1.9em; the scope follows in ink-2 and grows with the filters ("Tier 1 gold companies with ground in Nevada and run from British Columbia"). Under it, one sentence: the share of market value, both values, and how many have no known auditor. Under an auditor filter it adds who audits what the filter shows — "PwC audits 70 of them", "Firms other than Deloitte audit 289 of them" — unless the page has said it already; Another firm is many firms, so it never takes a singular verb.

**The proof.** The composition bar by auditor group (Deloitte, the other three of the four, national firms, regional and other firms, not yet known), its key with counts, and the total `= M ✓`; "Show the arithmetic" opens the sum. A failing proof reads `✗ expected M` in the alert colour, as doc 18 §9 requires.

**The four numbers.** Market value; audited by Deloitte, as a share of value with the share of companies under it; auditor not yet known; changed auditor in two years, "at least, of *K* with a known history". **This reverses doc 18 §1's "no tile above the map".** Each of the four is a figure with its own denominator, and the denominators are the point: a share of value beside a share of companies, and a change count beside the number research could check. Folded into the sentence they become a list nobody reads aloud. They sit under the sentence and its proof, never above them; on one column they come before the globe. The rule doc 18 §1 protected — the headline is a sentence and the proof is a footing — holds: both still come first.

**Acceptance.** The proof's total equals the sentence's *M* in every lens; the journeys assert `= N ✓`; the Deloitte figure and Deloitte's segment are the only green in the answer.

## 3. The globe (replaces doc 18 §10)

**Form.** An orthographic globe for the Americas and Canada frames, and an Equal Earth map for World, drawn as SVG paths from `d3-geo` 3.1.1 at runtime; a projection mutator morphs one into the other so a change of frame is one motion, not a cut. No WebGL, no canvas. The geometry is one TopoJSON topology in `src/lib/publish/world.ts`: Canada's provinces and territories (from `canada.ts`), the US states (us-atlas 3.0.1, public domain) and every other country (world-atlas 2.0.2 at 1:50m, Natural Earth, public domain), simplified on the sphere and keyed in the snapshot's own vocabulary ("CA:BC", "US:NV", "Mexico"). That settles doc 18 §10's deferred inset: the foreign buckets mix countries with US states, and the geometry now carries both.

**Why a globe.** Most of the population holds ground outside Canada, so a Canada-only choropleth leaves out where most of the companies dig. A whole-world map in one fixed projection shows Canada as a sliver or crops the rest. The orthographic view puts the Americas at full size with the rest of the world one turn away, and the flat whole world is one press away.

**Two maps in one frame.** *Where they dig*: each place filled by the count of companies with a property there. *Where they are run from*: one disc per head-office city, its area the count of head offices there, with a green core whose area is Deloitte's share of them; a dashed disc is a head office whose city is not recorded. The legend under the globe says which map it is.

**Fixed steps.** The fill has five steps, 1 · 2–4 · 5–9 · 10–24 · 25 or more, printed in the legend (`STEPS` and `stepOf` in `words.ts`). A step means the same count in every view and every period, so narrowing the page dims the map rather than quietly re-scaling it. A place with none takes `--globe-land`, which the contrast check holds apart from the first step on both ramps.

**Green is Deloitte's.** The ramp is green for every company and for Deloitte's; it turns grey for any set that is not Deloitte's — another firm's companies (Another firm, or a named auditor other than Deloitte) and those whose auditor is not yet known. The legend says in words whose companies the fill counts: "Companies with ground here, audited by Deloitte" — or by the firm named, by another firm, whose auditor is not yet known, or any auditor. Arcs from a head office to its ground are green only for a Deloitte client.

**The camera.** Americas, Canada and World are fixed presets. Drag turns the globe at 0.3° per pixel over the zoom; a pinch (or ctrl-wheel) zooms; a plain wheel scrolls the page, never the globe. The globe takes focus: arrows turn it, + and − zoom, and its keys are described beside it. Choosing a place or a company flies the camera to it; wider than a phone, the flight lands the target right of and above centre so the focus card in the lower left never covers it (`besideCard`), and turns less, or not at all, where turning would push the company's head office or any of its ground out of the frame. A company whose ground no one view of the globe can hold opens on the World map; one chosen from the World map turns the globe to it. A place that holds none of the companies under the lens is not a choice: clicking it changes nothing. Under reduced motion every flight is a cut.

**Labels.** The six largest places (or offices) in view are labelled with name and count, most important first. Each takes the first spot that is clear of those already placed and inside the frame's unfaded middle — under its disc, else over it — or is hidden. No two overlap and none is cut by the edge. Sizes are measured once per render, not per frame of a flight, and again when the frame changes shape or a web font arrives. A label stays hidden until it has been measured and placed, so none is ever shown where it might overlap another.

**The edges.** The frame fades into the ground over 4% at the sides and 3.5% at top and bottom, so a close view has no hard crop. On a phone the frame is 6:5 and crops its empty sides (`slice`), so the globe fills the width. The World map is wider than a phone shows, so there it is drawn smaller, to the width that is seen (`fit` in `Globe.tsx`), rather than cropped: Alaska and New Zealand stay on the page, and labels keep to the part of the frame that is seen.

**First frame.** The server renders every shape and disc in place for the camera it will open on; nothing moves when the script arrives. Labels are the exception: their size depends on the fonts the browser has, so they appear once the script has measured them, and without script the globe has none. The memo's ranked lists and the table of every place name what they would.

**Accessibility.** The globe is a focusable group with a role description and a name that says what it shows; the SVG itself is hidden from assistive technology, and its twins are the memo's ranked lists, which are keyboard-reachable and print. Forced colours map the ramp to GrayText and CanvasText and Deloitte's to Highlight. A change of filter is announced: a polite status region reads the new sentence, though not on first load. Focus is never dropped to the page: choosing a company or a place moves it to the focus card, closing the card returns it to the globe, removing a chip moves it to the chip now in that place (else to Clear all), and Clear all moves it to the Tier control.

**The budget, which reverses doc 18's 18KB.** Measured from `next build` on 1 November 2026: the dashboard's own client chunk is 207KB raw and 69.5KB gzipped. The geometry is about 35KB of that and `d3-geo` about 10KB; the rest is the dashboard's own code. The budget is **75KB gzipped for that chunk**. A change that crosses it says what it bought. Nothing checks this yet (§10).

**Acceptance.** On `/dashboard` the globe's fills never disagree with the "Where they dig" list; a label is never drawn over another or across the frame's edge; with reduced motion on, the first paint is complete and a flight is a cut.

## 4. Motion (amends doc 18 §7)

On first paint the places light in the order of how many companies hold ground there, 28ms apart from 250ms, once. A company's arcs draw out from its head office over 700ms, 70ms apart. Camera flights ease between frames and stop. The map no longer tilts in; the tilted variant is retired with the flat choropleth. Nothing loops, and under reduced motion nothing fills, draws or flies.

## 5. The filters

**One bar under the header,** held there while the memo scrolls (wider than 860px): Tier, Auditor (All · Deloitte · Another firm · Not yet known), Commodity and Size, then **Find** (⌘K, Ctrl+K or /) and **Brief me**. A place or a head office is picked from the globe or the memo. The filters in use show as chips on a row of their own beneath the controls, each removing itself, with Clear all, so choosing one never moves Find and Brief me. Whatever the page scrolls to or focuses lands below the bar: the page's scroll padding is the header's height plus the bar's, which the bar measures as it wraps (`--lens-h`).

**Another firm** is a company audited by a named firm that is not Deloitte. A company whose auditor is not yet known is neither Deloitte's nor another firm's, and is counted apart.

**The URL is the state.** `tier`, `firm=deloitte|another`, `auditor`, `commodity`, `prop`, `hq`, `band`, `map=hq` and `view=canada|world`, with defaults omitted. Places travel as the Companies page writes them (`CANADA:ON`, `CA:BC`), so a link carries the view, and "Open in Companies" carries as much of it as Companies can filter by. Companies cannot filter by size. Its own whitespace filter keeps the unknowns, so "Another firm" is written there as the firms themselves. Unclassified is written as the four tier values Companies files an unclassified company under (`unclassified`, `no_stage`, `no_property`, `conflicting`), and a head office as every spelling of its region that the period's companies use; with nothing under the lens there is no link. Anything the period does not recognise is dropped, not guessed. Back and Forward restore the view the address bar names, and the Dashboard link opens it unfiltered. The page writes the address only when the reader changes the view; a view it takes from the address is never written back, so the page and the router cannot chase each other.

**Acceptance.** `words.test.ts` round-trips every filter, the map and the frame through the URL, and drops what it does not recognise.

## 6. The memo

Numbered points down the left column, each a lead sentence with its counts, a chart or table that proves itself, and a twin: **Where they dig · Who audits them · Where they are run from · By size · What moved · Since** *the prior period* **· Facts worth knowing · When their years end · Audit fees on record · Basis of preparation**. Picking a row filters the page and flies the globe. By size is a matrix of market-value band by auditor group, a real table with row and column headers. What moved is a ledger of changes of auditor — company and date, from, to — in the two years to the as-of date. Facts worth knowing are five published facts, each a count of companies out of those research could check; none is a score and none is combined with another. Dates are written out by hand (`dayLabel`), so the server and the browser print the same day.

**Working.** Each point's header names the published fields it is counted from, as doc 09 asks of every figure. They show with Show working, which is on by default for those who review and off for Viewers; the choice is kept in a cookie the server reads, so the page arrives as it was left.

**Ties.** Where two or more share the most, the sentence names them all, with "each"; a rank shared with another is "joint" ("joint 4th by companies"). The brief words its ties the same way.

**Dates that are only a year or a month.** What moved counts such a change only when the whole of that year or month lies in the two years; one that straddles either edge is counted apart and said, so the count stays a floor.

**The prior period** is read at its newest revision, its tiers included, so an amendment to it moves every figure of the comparison together. The change in value is over the companies in both periods with a market value both times. A move between a named firm and another firm research did not name is counted as a change of auditor only when the named firm is one of the four; otherwise the two may be the same firm, and the point says how many such pairs it left out.

## 7. Brief me

A full-screen run of the same published numbers in a fixed order a partner can present from — the market, Deloitte's share, the world, Canada, who audits them, where they are run from, what moved, since the prior period when there is one, and the facts — each frame anchored on the as-of date and flying the globe to its own camera. It is unfiltered on purpose: a brief that changed with whatever was last clicked could not be presented twice the same way. ← and → move, Home and End go to the first and last frames, B blacks the screen, T shows the frame as a table, Esc leaves. The keys work wherever focus is while the brief is open; every move lifts a black screen, and Tab does nothing on one. The end buttons stay focusable and say they are unavailable, so a key pressed on one does nothing. Every frame's numbers are also its table, and its words are the memo's: the same ties, the same count of where companies dig, the cities the globe draws. `words.test.ts` holds every frame to doc 01 word by word: no opportunity, target, should, pursue, recommend or prioritise, and no "Other" as a label.

## 8. Find

⌘K, Ctrl+K or / opens a search over the period's companies by name and ticker (not while Brief me is open). Choosing one closes the search, flies the globe to its ground and head office, draws its arcs, and opens its card — auditor, market value, tier, run from, ground in, and the way to its profile — with focus on it. A company whose ground the globe cannot show at once opens on the World map.

## 9. Layout, phone and print

**Wide (1180px and up):** a story map. The answer and the memo run down the left (at least 440px), and the globe is held on the right under the header and the filter bar while they scroll past it. **One column:** the answer, the globe, the memo. **760px and under:** the focus card moves from over the globe to under it. **640px and under:** the header's actions keep their icons and drop their words (screen readers still hear them); the filter bar reads as a form; each row of choices spans the column in equal parts, wrapping a long label; the as-of date takes its own line; a compact gauge puts its name and figures on one line and its bar under them; a key and its value share the line in shares and wrap; table cells tighten so a three-column ledger fits 360px. **The page never scrolls sideways, down to 320px** (WCAG 1.4.10): a table too wide for its column scrolls in place, inside the memo, and a label that could poke past an edge opens inward even while it is hidden, because an invisible box still widens the page. Words kept for screen readers inside a table that scrolls are positioned within its scroller, for the same reason. Checked at 320, 360, 375, 390 and 414 with every disclosure open. **Print:** light; no filter bar, tools or close buttons; the globe at 72% width, centred, then the memo; the focus card flat.

**Depth stays where doc 18 §6 puts it.** The focus card is on the tooltip tier — opaque surface-3, lift and `--shadow-2` — and nothing on the dashboard blurs what is under it; the filter bar is solid ground.

## 10. Tokens and checks

**New tokens**, both themes: `--globe-lit`, `--globe-dark`, `--globe-land`, `--globe-edge`, `--globe-grid`, `--globe-rim`, `--globe-air`, `--globe-halo` and `--disc`; and the grey ramp `--grey-1`…`--grey-5` with `--on-grey-1`…`--on-grey-5`, the same five steps as the green ramp with no hue.

**`check_contrast.mjs`** now verifies the grey ramp (adjacent steps differ by the ramp's minimum OKLab step, and each step's ink clears the text floor on it) and the globe (an empty place stays apart from the first step of either ramp; a disc's rim and green core clear the non-text floor on land and on sea; a label and its count clear the text floor on their halo). **`check_class_collisions.mjs`** exempts `map-switch`, the labelled tier dropdown the journeys find by name. Every other dashboard rule is scoped under the dashboard's own names.

**Open items.** Nothing enforces the 75KB budget yet. The firm classes are incomplete (RSM and De Visser Gray among them), so the "regional and other" count will move when they are classified. The coverage floors are read live rather than frozen at publication. Drilling through to Companies can show draft values that the snapshot does not. Merged companies are not followed through their chains. The views migration counts as research completed. Three production companies carry a city that contradicts their region. The publisher's email shows in Basis of preparation. Each publication froze its tier migration (`snapshot.ts`) against whichever prior revision was newest when it was published; after an amendment to the prior period, the Since point, which reads the newest, can disagree with that frozen matrix. On a phone the size matrix and the table of every place scroll sideways in place, with nothing to say there is more to the right; at 320px the auditor-change ledger and the fees table do too. Five components the old dashboard drew — `Bars`, `Donut`, `Heatmap`, `TierLadder` and `FootprintMap` — are now used only by `/styleguide`, which doc 18 §9 says must not document what the product no longer uses; they are retired from it, or brought back into the product, in a follow-up, and the globe joins the styleguide then.

## 11. Considered and not taken

**A flat Equal Earth map with no runtime `d3-geo`,** pre-projected to fixed paths. A review panel preferred it: lighter, with nothing to compute in the browser. It was not taken because at the scale that shows the whole world Canada is a sliver, and flying to a company becomes a pan rather than a turn. It survives as the World frame.

**A WebGL globe.** Heavier, with no server-rendered first frame, no print, and a harder road to forced colours. Not taken.

**Scores, rankings and pursuits.** Out of scope permanently (doc 01). The facts are counts, the memo is counts, and the brief is counts.
