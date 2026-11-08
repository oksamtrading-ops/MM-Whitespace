# 19 — The dashboard

**One sentence:** one published revision on one screen — how the market splits by tier, where its head offices are across Canada, and which firms audit it — the same for everybody who opens it, with every figure a way into the companies behind it.

**Rewritten on 8 November 2026.** Samuel asked for "a more simple dashboard that fits on a page without scrolling", with the filters removed and the page fixed on three views: the market by tier, head offices across Canada by province and tier, and attest firms by province and tier. He approved the layout from a mock-up, kept **Brief me**, chose to let every figure open its companies in Companies, set the firm rows at the Big 4 and every firm with ten or more companies, and removed the rest. The globe dashboard of 3 November is retired: its sentence and four numbers, the filter bar, the memo, Find and Show working. The globe stays, inside Brief me only (§8).

This doc still takes the place of doc 18 §10 for the dashboard's map (§3), and no longer reverses doc 18 §1: there are no tiles. The code is `src/app/(viewer)/dashboard/` (`page.tsx`, `Board.tsx`, `Hover.tsx`, `BriefButton.tsx`, `Brief.tsx`, `words.ts`) and `src/lib/publish/board.ts`, whose counts are tested in `board.test.ts`. Brief me also uses `src/app/_ui/Globe.tsx` and `src/lib/publish/` (`atlas.ts`, `lens.ts`, `globe.ts`, `world.ts`).

## 1. What it is for

A partner opens the dashboard to see the shape of the market in one look: how it splits by tier, where it is run from, and who audits it. Then, on the way into a meeting, to present it (Brief me). To narrow it to a set of companies they go to Companies, and every figure on the dashboard takes them there already narrowed.

What it does not do is unchanged from doc 01: it does not decide which companies are worth pursuing, scores nothing, and contacting anyone is out of scope. Every figure is a count of published values and says what it counts.

**Acceptance.** At 1280×800, 1440×900 and 1280×700 the three panels fill the window under the header and the page does not scroll. Each panel sums to the population the page states.

## 2. The market by tier

Seven bars: Tiers 1 to 6 and No tier, each with its count and its share of the population, the bar scaled to the largest. Tiers 1 to 3 sit under one heading, "Producing · Tiers 1–3", with their sum. Each bar names its tier and its rule in words (`TIER_RULE` in `words.ts`). Above the bars is the population and its basis: "344 companies worth C$100M or more, as of 31 Aug 2026". The bars sum to it. Every company is counted, so the bars are green (`--seq-4`).

## 3. Head offices across Canada

**The map.** Canada's provinces and territories (`canada.ts`), each filled at the fixed steps 1 · 2–4 · 5–9 · 10–24 · 25 or more (`STEPS` and `stepOf` in `words.ts`), on the green ramp. A province with none takes `--globe-land`. Each province with head offices is labelled with its code and count, set clear of its neighbour where they would collide (`NUDGE` in `Board.tsx`). Under the map: how many are run from outside Canada. The map is hidden from assistive technology and is not in the tab order.

**The table**, the map's twin, beside it: the provinces with head offices, most first, then "Canada, no province", "Outside Canada" (every foreign head office together) and "Not on record". The columns are T1 to T6, None and Total, and every cell is filled at the same steps. The header gives how many are run from Canada, from outside it, and not on record. The rows sum to the population (`headOffices` in `board.ts`).

## 4. Attest firms, by head office and by tier

**Rows:** Deloitte first; then PwC, KPMG and EY, most first; then every other firm research named that audits ten or more companies, most first; then "Other firms", every firm under that line and a firm the filing gives but research did not name; then "Not yet known". **Columns:** head office (each province with ten or more head offices, then the rest of Canada, outside Canada and not on record), then tier (T1 to T6 and None), then the total and its share of the population. In each row the head-office cells and the tier cells each sum to the row's total, and the totals sum to the population. The two lines are parameters of `attestFirms` (`firmMin`, `provinceMin`). A firm that falls under the line folds into Other firms, and a province that does into the rest of Canada.

**Colour: green is everyone's or Deloitte's, never another firm's.** Deloitte's row is on the green ramp and marked by a green rule before its name. Every other firm's is on the grey ramp (`--grey-1`…`--grey-5`). Not yet known is hatched (`--hatch-a`, `--hatch-b`), because it is research still to do, not a firm. The legend says so in words.

## 5. Every figure opens its companies

Every bar, cell, total and province is a link to `/companies` with the filters that select its companies (`companiesHref` in `board.ts`): `tier`, `hq` and `auditor`, repeated for a multi-select, in the tokens Companies already filters by. No tier is its four tokens (`unclassified`, `no_stage`, `no_property`, `conflicting`). Outside Canada is every foreign token the period uses. Other firms is each of its firms by name. `board.test.ts` round-trips every link through `parseRosterParams`. A zero in a table is not a link.

Nothing on the dashboard filters, and a query string changes nothing on it. The journeys assert both.

**The tooltip** (`Hover.tsx`) appears beside the pointer, or beside a figure the keyboard focuses. It gives what the link's name already says, in lines: the count, its share of its row and of its tier, and "Opens these companies in Companies". It is hidden from assistive technology because the link's name carries the same words. It never covers its figure, Escape dismisses it, and it goes on scroll. A province and its row light together, from the map or from the table. Without script, the page loses only this.

## 6. The header

The title and two actions, and nothing else. Samuel removed the count, the period-and-revision line and the "About revision" disclosure on 8 Nov 2026; the tier panel already states the population and its as-of date.

- **Brief me** (§7).
- **Export** for those who review. A Viewer gets **Export from Companies** instead, because `/api/export` refuses a Viewer.

**A revision published through a blocked gate** says so at the top of the page, above the panels: a warning band, "Published through a blocked gate" run together with the Admin's reason in one or two lines, for as long as the revision stands. An override nobody can see is an override nobody questions (doc 08), and the publish screen promises the reason is printed there. A revision that passed its gate shows nothing, and the board takes the height. An amendment's reason is not on the dashboard; it is kept with the revision and listed on the publish screen.

The licence notices are printed only, as before, and the AI notice is the one quiet line under the tiers.

## 7. Brief me

Opened from the header. A full-screen run of the same published numbers in a fixed order a partner can present from, each frame anchored on the as-of date. It is unfiltered on purpose: a brief that changed with whatever was last clicked could not be presented twice the same way. Five frames, as Samuel set them on 7 Nov 2026:

1. **The market**, on the Americas: the companies, their market value, and where they operate, each company in exactly one row from its published footprint — operations in Canada only, abroad only, in Canada and abroad, and no operations on record — so the four rows sum to the companies.
2. **Who audits them**, with no map: Deloitte, PwC, KPMG and EY by name, every other firm, named in the research or not, as "Other firms", and the auditor not yet known on its own row; companies and market value per row, summing to the period.
3. **Where they operate**, on the world map: companies with ground in each country, a province folded into Canada and a state into the United States (the whole country lit at its own step), and ground the globe cannot draw still counted by the country its words name. The eight countries with the most are shown.
4. **Operations in Canada**, on Canada: the same by province and territory, only Canada lit.
5. **Tiers by head office**, on Canada: each tier, and no tier, by the province of the head office, with how many are run from outside Canada or cannot be placed.

Frames 3 and 4 split each place's companies by stage — producing (Tiers 1–3), development (5), exploration (6), and royalty or no tier — from the company's tier, because stage is published per company, not per property: a producer counts as producing wherever it holds ground, including where it only explores. Each says so. No frame but the auditors' names Deloitte or marks a Deloitte row. The frames on Deloitte's share of the globe, who audits the most, head-office cities, what moved, the prior period and the facts were removed on 7 Nov 2026, and the memo that also carried them went with the globe dashboard on 8 Nov 2026.

← and → move, Home and End go to the first and last frames, B blacks the screen, T shows the frame as a table, Esc leaves. The keys work wherever focus is while the brief is open; every move lifts a black screen, and Tab does nothing on one. The end buttons stay focusable and say they are unavailable, so a key pressed on one does nothing. Every frame's numbers are also its table; a table of many figures scrolls in place with its first column held, so the brief never scrolls sideways at 320px. `words.test.ts` holds every frame to doc 01 word by word: no opportunity, target, should, pursue, recommend or prioritise, and no "Other" as a label except "Other firms", which Samuel asked for by name.

## 8. The globe, in Brief me

Brief me's frames draw on `Globe.tsx`: an orthographic globe for the Americas and Canada frames and an Equal Earth map for the world, as SVG paths from `d3-geo` 3.1.1, with one TopoJSON topology in `world.ts` (Canada's provinces and territories, the US states from us-atlas 3.0.1, and every other country from world-atlas 2.0.2 at 1:50m, all public domain) keyed in the snapshot's own vocabulary. In a brief it does not turn, take focus or take a click. Places fill at the same fixed steps as the dashboard's map, with green for every company. The frame fades into the ground at its edges. Forced colours map the ramp to GrayText and CanvasText.

## 9. Layout, phone and print

**Wider than 1100px:** two columns, 30 to 70. The tiers fill the left, with the AI notice under them. Head offices take the top right (41%) and the firms the bottom right (59%). The page is a column the window's height under the header, and the board takes what the override notice, when there is one, leaves, so the page does not scroll. The firm table's rows share out the height: 22px at 1280×800, 27px at 1440×900, 19px at 1280×700, and about 3px less each with the override notice. Under 760px tall the frames tighten, and with the notice the tier bars do too, so 1280×700 still fits. Under 560px of board the page scrolls rather than squeeze further. **1100px and under:** one column (tiers, head offices, firms, then the AI notice), and the page scrolls. The map is at most 320px tall. Table rows are 28px, and a table too wide for its column scrolls in place with its row names held. **640px and under:** a long row name wraps in a narrower column. **The page never scrolls sideways, down to 320px:** the words kept for screen readers inside a scrolling table are positioned within its scroller, because otherwise they widen the page. **Print:** one column, without the tooltip.

## 10. Tokens and checks

**No new tokens.** The green ramp `--seq-1`…`--seq-5` and its inks, the grey ramp `--grey-1`…`--grey-5` and its inks, `--hatch-a` and `--hatch-b`, `--globe-land` for a province with none, and `--globe-halo` behind a map label. Every rule is named `db-`, so `check_class_collisions.mjs` has nothing to share.

**Tests.** `board.test.ts`: the tiers sum, the head offices' order and sums, foreign head offices gathered as Outside Canada, the firm rows' order and lines, and every link read back by Companies. The journeys: the three panels, each summing to the population, figures that open Companies, nothing that filters, a query string that changes nothing, and no Deloitte market on a Viewer's page.

**Open items.** Show working went with the memo. The cookie it set still hides the field keys in `.section .key` on other pages (`layout.tsx`), and nothing on screen now changes it: it is on for those who review and off for Viewers. Brief me's code, the globe and its geometry with it, is loaded with the page rather than when Brief me is first pressed, and no check holds a size budget for it. Five components the old dashboard drew (`Bars`, `Donut`, `Heatmap`, `TierLadder`, `FootprintMap`) are used only by `/styleguide`.

## 11. Considered and not taken

**Keeping the filters.** Samuel asked for a fixed dashboard. Companies is where a reader narrows, and every figure here opens it narrowed.

**A treemap or sunburst for the tiers.** Bars on one baseline read exactly; areas and angles do not, and seven parts is a list.

**City discs for head offices.** The question is by province, and a disc's area is harder to read than a filled step with its count printed.

**A row for every firm.** There are more than sixty, and they do not fit on one screen. Samuel chose the Big 4 and the firms with ten or more, with the rest as Other firms.

**The globe on the dashboard.** It answered where companies dig, which is not one of the three questions. It remains in Brief me.

**Scores, rankings and pursuits.** Out of scope permanently (doc 01).
