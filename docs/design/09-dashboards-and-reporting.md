# Compute every chart from one query, and refuse to draw one that would lie

## What the workbook's dashboard actually contains

Appendix D describes views to reproduce. Measured against the file, most are not reproducible:

| View | State | Phase 1 |
|---|---|---|
| Population analysed | Works | **Survives** — as stat tiles |
| Tier distribution | Two tables on one screen disagree | **Survives, coverage-gated** |
| Corporate office by market | **Empty**; chart points at a formula-less table | **Rebuild** |
| Producing mines by province | 11 columns, 9 headers `#REF!` | **Redefine and rename** |
| Producing mines, key jurisdictions | **Does not exist at all** | **Redefine and rename** |
| Audit and tax fees by firm | Auditor data partial; fees empty | **Split** — auditor survives, fees deferred |
| Clients by tier and market | Not a combined view; no fees | **Cut** |
| Selected targets | **Zero rows** | **Cut** |

Plus three additions: tier migration, enrichment coverage, and entrants and drop-outs.

## Two views are uncomputable as specified, and shipping them would fabricate numbers

Property location and stage are **both recorded at company level with no link between them**. "Producing mines in province X" therefore cannot be derived at any confidence: a producing company with properties in three jurisdictions does not have a producing mine in all three.

Rebuilding the view as named would count every exploration-stage property owned by a producing company as a producing mine. A partner reads "27 producing companies in British Columbia" and carries it into a pursuit conversation. The number is manufactured by the join, and nothing on screen says so. **The broken reference at least announced itself.**

**Ship them as footprint views under honest names** — "companies with properties in each province" and "…in each foreign jurisdiction" — which is computable today and true. Add property-level stage to the model so the view can be promoted later behind a flag, and ask Kay to confirm which question the original view was answering.

### The axes are recoverable from the data, though not from the headers

Twelve provinces, led by British Columbia, Ontario and Quebec. Foreign jurisdictions led by Mexico, Peru, Chile, Brazil and Argentina.

Both carry the same spelling disease as the auditor column — `Columbia` beside `Colombia`, plus several misspellings — so the axis must be built from a **controlled vocabulary with an alias map** applied at ingest, with unmapped tokens surfaced in the validation report rather than silently bucketed. Derive the axis from a distinct query over the normalised table ordered by count, so a new jurisdiction appears automatically instead of being dropped by a hardcoded list. One province appears under two spellings and must be aliased; the `OTHER` bucket holds a single company and should disappear once the vocabulary lands.

## Day one, the tier chart is degenerate in a way that looks like an answer

With stage blank for 242 of 259, the tier function returns the same value for everyone and the chart renders one full-width bar:

> **Royalty and streaming companies and processing facility owners — 259 (100%)**

Confident, well-formed, and entirely false. An empty chart gets ignored; a full one that is wrong gets believed. Tier 4 today is really two disjoint populations — 17 genuine royalty companies and 242 with no stage evidence — that the workbook's catch-all fuses.

**Three mechanisms, all required:**

1. **`Unclassified` as a displayed state.** Day one then reads Tier 4 = 17, Unclassified = 242. True, and actionable.
2. **A coverage meter in place of the chart.** Each chart declares a minimum coverage on the fields it depends on. Below it, the card renders a meter in the same footprint — no layout jump — reading *"Stage of operations: 17 of 259 researched (6.6%). Tier distribution unlocks at 80%."* with a link into the filtered review queue. This is the correct form: with one meaningful class, a meter beats a chart.
3. **A publish gate**, so a period cannot be published with a degenerate default dashboard unless an Admin records a reason that is printed on the header.

The same shape applies to fees, which are 100% absent, and to auditors, where the largest single value is "unknown" at 116 of 259.

## The foreign-HQ bucket is 53, and it must be visible

50 companies have a blank Deloitte market and three more have a country typed into the market column. The market views therefore drop 50 rows silently and mislabel three, and the total never reconciles.

53 of 259 is a fifth of the population and, being foreign-headquartered, disproportionately the large interlisted names. A partner reading the five market bars sums 206 and has no way to know 53 companies are missing.

- Render an explicit terminal bucket, **"Foreign HQ — no Deloitte market (53)"**, in the de-emphasis grey, always last, never sorted into the ranking.
- Render a **proof line under every population chart**: `121 + 61 + 12 + 7 + 5 + 53 = 259 ✓`, computed at query time as a passing or failing assertion. This is the one genuinely good idea in the workbook, and it is the thing that would have caught the 258-versus-259 discrepancy on its own screen.
- The country typed into the market column is a **data-entry error, not a market**. It fails ingest validation into the override queue rather than being coerced. The market field is a constrained enum including an explicit foreign value, never free text.
- Label it "no Deloitte market", not "Other" — the workbook already uses "Others" to mean three specific markets, and reusing the word would collide with a meaning partners already hold.

## Chart-by-chart form and colour

| View | Form | Colour job | Note |
|---|---|---|---|
| Population | 4 stat tiles + hero figure | none | A four-bar chart of four numbers is the one-bar-chart anti-pattern. The real headline is **Deloitte audits 17 of 259 (6.6%)** |
| Tier distribution | Horizontal bar, ordered by tier | Ordinal ramp | Tier order is meaningful, so ordinal not categorical. **Do not reproduce the pie** — five or six close segments hide exactly the disagreement that exists on that screen today |
| Office by market | Horizontal bar, sorted descending | One hue | Markets have no natural order. Do not ramp by value; that double-encodes bar length |
| Market × tier | Heatmap | Sequential | 6 × 6 exceeds any categorical palette |
| Province footprint | Horizontal bar, sorted | One hue | 12 categories is past the colour-class ceiling, which is why it is one hue with an axis |
| Key jurisdictions | Horizontal bar, top 12 + Other | One hue | |
| **Auditor share** | **Emphasis bar** — Deloitte accented, other firms grey | 1 hue + grey | The story is not who audits what; it is **how much of this market is not ours**. That is emphasis, and it is the honest form. **"Unknown" at 116 is its own bar and will be the longest** — that is the actual finding |
| Auditor × tier | Heatmap | Sequential | Gated on two coverages |
| Fees by firm | **Deferred** | | The ratio is a second measure at a different scale — never a dual axis |
| Tier migration | 6 × 6 matrix | **Polarity** | See below |
| Enrichment coverage | Meter row | Ordinal | **The only view with real data at launch — make it the landing view** |
| Entrants / drop-outs | **Table** | none | Identity plus a few numbers, read row by row |

## Tier migration is the one place a single accent genuinely fails

Movement up, unchanged and down is a **polarity** encoding: it needs two opposed hues with a neutral midpoint. Encoding direction as light-green versus dark-green reads as *magnitude*, making "moved down three tiers" look like "moved a lot" rather than "moved the wrong way".

Use the **reserved status scale**, which is a separate fixed scale rather than a categorical brand slot — so it is not an invented brand colour, and it ships with icon and label always, satisfying the colour-alone rule for free. **Record this derivation in the design system section** so a later reviewer does not "correct" it back to green.

Form is a **six-by-six matrix**, prior tier against current, with the diagonal muted so only off-diagonal movement carries ink. Not a Sankey: almost all mass sits on the diagonal, ribbon widths would be unreadable, and a matrix has a table twin for free.

Two states the brief omits. **The first period has no prior** — render a first-period empty state, not a blank grid. And **a company moving from Unclassified to tiered is research completing, not migration** — separate the two, or the first enrichment run shows 242 phantom upgrades and the view is noise on its debut.

## Entrants and drop-outs: three causes, presented separately

A company appearing or vanishing has three causes with completely different meanings, and one list presents them identically:

1. **New listings.**
2. **Crossed the threshold** — shown with the prior market cap and the percentage move.
3. **Renamed or re-identified** — resolved by identity and alias history, and **not surfaced as a movement at all**.

Two companies sit **0.85% and 0.86% above the threshold**. A 1% market move drops them out, and in a pursuit conversation "drop-out" reads as "we lost them" when nothing happened. Any company within the period's proximity band carries a marker and a tooltip saying so.

Because the threshold is a per-period parameter, **a threshold change must be distinguished from a market move** — if the parameter changed, the view says so in its header and separates parameter-driven from price-driven changes. Otherwise switching the threshold once produces hundreds of spurious entrants.

## Colour tokens, computed rather than chosen

The Deloitte signature green measures **2.27:1 on white** and **9.23:1 on black**. That is below the 3:1 non-text floor and far below the 4.5:1 text floor, so on a light surface the brand green is unusable for axis text, thin lines, focus rings and small markers — and the failure is invisible to eye-checking, because large green fills look fine.

| Use | Light surface | Ratio | Dark surface | Ratio |
|---|---|---|---|---|
| Large bar / area fill | `#86BC25` | 2.27:1 — **warn, relief required** | `#86BC25` | 7.66:1 ✓ |
| Lines, markers, small marks | `#6B961E` | 3.50:1 ✓ | `#86BC25` | 7.66:1 ✓ |
| Focus ring, borders (non-text, 3:1 floor) | `#5E841A` | 4.38:1 ✓ | `#86BC25` | 7.66:1 ✓ |
| **Green text** (4.5:1 floor) | **`#567C18`** | **4.89:1 ✓** | `#86BC25` | 7.66:1 ✓ |
| Label on a green chip | `#000000` on `#86BC25` | 9.23:1 ✓ | — | — |
| De-emphasis | `#75787B` | 4.44:1 ✓ | — | — |
| Gridlines (recessive, exempt) | `#BBBCBC` | 1.90:1 | — | — |

Note that **text and non-text have different floors**, and one token cannot serve both: the focus-ring green clears the 3:1 non-text floor comfortably but falls short of the 4.5:1 text floor, so green text needs its own darker token. An earlier draft of this table used one value for both and was caught by the verification script in section 12.

Two rules to state explicitly, because both are easy to get wrong: **white text on a green chip is forbidden** at 2.27:1 — chips carry black text, even though white-on-green looks like Deloitte marketing. And the fill warning is **not dismissable**: any green fill on white obliges a relief channel, meaning visible direct value labels or the table twin.

Note the inversion: **the brand green is compliant on dark and non-compliant on light.** A dark-first dashboard resolves most of this, and section 15 puts it to the practice as a real option rather than assuming light mode.

The palette is corroborated from public brand references as Pantone 368, but the authoritative token must still be confirmed against Deloitte's internal brand hub before implementation. Do not add brand colours beyond those given.

## Confidence heat-mapping must not be colour alone

Evidence strength is the signal an Analyst uses to allocate attention across 2,590 values. Colour-only encoding loses it entirely in greyscale, in forced-colours mode, and for a large fraction of readers.

**Bin to four ordinal bands, not a continuous gradient**, with the bins defined by the **decision boundaries** — nobody acts differently at 0.71 versus 0.74; they act differently above and below the accept threshold, which is rendered as a visible rule on the legend. Triple-encode: a validated one-hue ramp as cell wash, the **numeric value in the cell** in a text colour, and a **band label** in the accessible name.

One constraint worth stating once in the design-system section: because the brand green is the lightest legal step of a light-mode ramp, **anything lighter than it fails the light-end floor**. That bounds every green ramp in the product.

## Meeting the one-second budget

Every dashboard aggregate needs the *effective* value of each field, where an override beats an accepted finding beats the extract. Re-deriving that in a dozen queries would implement the rule a dozen times and let it diverge — reintroducing, by architecture, the same defect as two tier tables disagreeing on one screen.

**Publish writes a resolved snapshot** (section 5). Every dashboard query is then a single-table group-by over roughly 259 rows: trivially under a second, and flat as periods accumulate. Publish also precomputes the proof totals, the per-field coverage and evidence aggregates, the two cross-tabs, and the migration matrix against the prior published period.

Two exceptions. **The review workspace reads live data by definition** and sits outside this budget; it needs pagination and virtualisation instead. And **the entrants view cannot be fully materialised**, because an alias merge can retroactively change identity — so a merge invalidates and recomputes the affected comparison rows, rather than leaving a renamed company appearing as both a drop-out and an entrant forever.

## Query sketches

```sql
-- Tier distribution with proof, from the frozen snapshot
select coalesce(t.tier::text, t.status) as band, count(*) as n,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from published_period_values v
join tiers t using (company_id)
where v.publication_id = $1
group by 1 order by 1;

-- Office by market, with the foreign bucket made explicit
select coalesce(nullif(dtt_market,''), 'Foreign HQ — no Deloitte market') as market,
       count(*) as n
from published_period_values
where publication_id = $1 and field_key = 'dtt_market'
group by 1 order by (market like 'Foreign%'), n desc;

-- Province footprint, over the normalised jurisdiction table
select j.subdivision_code as province, count(distinct j.company_id) as companies
from published_company_jurisdictions j
where j.publication_id = $1 and j.country_code = 'CA'
group by 1 order by 2 desc;
```

Every chart names its query in the implementation, and no chart series ever points at a second table that could disagree with the first — which is exactly how the workbook ends up with two contradictory tier figures on one screen.
