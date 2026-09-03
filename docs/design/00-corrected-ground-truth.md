# The workbook is not what the brief describes, and six of its defects change the design

Both source workbooks were read cell by cell before any design work began. Every claim in this section was measured against the files, not inferred from the brief. Where this section and the brief's appendices disagree, **this section governs** — the appendices carry inherited errors that would otherwise have been designed into the product.

Read this section before sections 4, 5, 6, 9 and 10. Each of them depends on a correction made here.

---

## The population is 144 / 115 / 0, and the "one other exchange" company does not exist

| Stated everywhere | Measured |
|---|---|
| 259 companies: 143 TSX, 115 TSXV, 1 other | 259 companies: **144 TSX, 115 TSXV, 0 other** |

Two compounding formula defects produce the wrong figure. Every tier and exchange `COUNTIF` in the proof block starts at row 7 while the data starts at row 6, so each count silently drops the first company in the matrix, AbraSilver Resource Corp. A hard-coded `+1` on the exchange "Other" line then restores the total to 259 while attributing the missing company to an exchange that has no members.

```
Exchange proof, as written:   =COUNTIF($E$7:$E$264,"0")+1     ->  1  ("Other")
Exchange proof, corrected:    =COUNTIF($E$6:$E$264,"TSX")     -> 144
                              =COUNTIF($E$6:$E$264,"TSXV")    -> 115
```

The same `+1` pattern appears on the Tier 6 count. Both are compensating hacks for one off-by-one, not arbitrary fudges.

**Design consequence.** The application computes population from a query over its own dataset and renders a proof total that must reconcile to the company count. It never reproduces these formulas. Expect "the numbers changed" to be raised as a defect on first delivery; section 10 carries the pre-written answer.

---

## Identity is positional, which is the single most dangerous property of the current file

The matrix does not join to the consolidated company list by ticker. It joins by **row position**, using a self-referential counter:

```
C6  =COUNTA(OFFSET(C$5,0,0,ROW()-ROW(C$5),))              -- a running 1..259 counter
D6  =IFERROR(VLOOKUP($C6,'B.01 Consol TSX - TSXV'!$B:$I,3,0),"Not found")
```

The matrix has **no ticker column at all**. The auditor tab joins by **company-name string** and likewise carries no ticker and no exchange; it works today only because its rows happen to be name-identical and row-aligned with the consolidated list at a constant offset of two.

Every manually researched column — the Deloitte market, the four stage flags, the tax-client flag — is therefore bound to a row ordinal. Sorting the workbook, inserting a company, or removing one silently reassigns a partner's research to a different company, with no error and no visible symptom.

**This is the strongest argument for the application, and it belongs in the conversation with the practice.** It is not a hypothetical risk; it is a property of the file as it exists.

### The available identifiers are worse than the brief assumes

| Identifier | Measured coverage | Usable? |
|---|---|---|
| `Co_ID` (TSX extract) | **0 of 181** | No — header-only placeholder |
| `Co_ID` / `PO ID` (TSXV extract) | **0 of 899** each | No — header-only placeholders |
| `Root Ticker` (both extracts) | 181 of 181, 899 of 899, unique within and across | Yes — the only key those files offer |
| `Entity ID (S&P)` (auditor tab) | **143 real numeric IDs**, 116 `"Not found"` | **Yes — and it must not be discarded** |

The entity identifier is the only stable non-ticker identifier anywhere in the corpus. It resembles the empty vendor columns closely enough that a careless reading of the "exclude empty artifacts" scope decision would sweep it away, forcing the matcher onto ticker-plus-exchange for the entire population instead of a little over half of it. Section 5 carves it out explicitly.

### Ticker plus exchange is not a stable key either

**98 rows in the TSX extract carry a venture-graduate flag.** A majority of the senior-exchange cohort has already changed exchange at least once. A composite primary key of `(ticker, exchange)` therefore reads a perfectly ordinary graduation as a company disappearing and a different company appearing — corrupting the period-comparison and tier-migration views for precisely the companies whose progression the practice most wants to track.

Identity needs an identifier table with validity intervals, not a composite key. Section 6 specifies it.

### Alias history cannot be bootstrapped

The brief offers Barrick Gold becoming Barrick Mining as the worked rename example. The string "Barrick Gold" **appears nowhere in either workbook** — every tab already carries the post-rename name. There is no rename history to import. Aliases are seeded instead from the cross-source name variants that do exist, and accrue forward from the first period.

---

## Cross-source matching, measured rather than assumed

The LSEG screen is described as a broader universe to be matched by ticker and fuzzy name. Measured behaviour:

| Match strategy | Result |
|---|---|
| Exact company-name equality | **2 of 259** |
| Normalised name (case, punctuation, legal suffixes) | Works; a trailing period alone explains most near-misses |
| Ticker root + venue suffix | 207 of 259 |
| No match by any strategy | **43 of 259** |

Only 32 of those 43 are foreign-headquartered, so the screen's country filter does not account for the remainder. Nine companies match by name but not by ticker because the LSEG identifier encodes the company's **primary** listing venue, which for eight of them is a US or Hong Kong exchange rather than the Canadian one.

**The screen is not a superset.** It omits 43 companies the practice already tracks, and it contains above-threshold rows that are not mining companies at all. The Phase 2 "universe expansion" is therefore a reconciliation of two differently-shaped populations, not a widening of one — which changes both its value and its cost.

A further trap: **71 identifiers carry an `h` inactive-instrument marker appended to the root**. Splitting on the dot never matches them. But stripping a trailing lowercase letter unconditionally would corrupt at least two legitimate share-class tickers, so the rule must be conditional. Section 5 specifies the ladder.

---

## Missing values take six forms, and one of them is a number

| Marker | Where |
|---|---|
| `"Not found"` | 116 rows across the auditor columns |
| `"N/A"` | Auditor columns |
| **Numeric `0`** | Website column, produced by the lookup formula's own fallback rather than by source data |
| Blank / `None` | Throughout |
| `"Deloitte "`, `"Other "` (trailing space) | Auditor column |
| `"Grant Thornton "` (trailing space) | Auditor "others" column |

**Trimming must run before sentinel matching**, or `"Not found "` survives as a distinct value.

The auditor column holds **11 distinct values, not the 9 the brief lists**. It adds `"EY (Ernst & Young)"` — a second spelling of a firm already present as `"Ernst & Young"` — and `"MNP"`, a non-Big-4 firm sitting in the Big-4 column. The trailing-space collision the brief misses is the damaging one: `"Grant Thornton "` appears six times against `"Grant Thornton"` once, so any grouping reports a single firm twice.

45 of the 143 populated website values are page titles rather than URLs. Tier values are stored as **text** strings, and the two proof tables disagree on whether tier keys are text or numbers.

---

## Stage is tri-state, and modelling it as four booleans makes "Unclassified" underivable

The stage columns use an `"X"` presence marker. Blank means **not researched**, not "false".

| State | Count |
|---|---|
| No stage marker at all | **242 of 259** |
| Royalty/streaming marker only | 17 |
| Exploration, development or production marker | **0** |

Four booleans collapse all 242 unresearched companies into the identical input a company would have if an analyst had affirmatively confirmed it was pre-exploration. Agnico Eagle — a producer with properties in Nunavut, Ontario and Finland — and a dormant shell arrive at the classifier indistinguishable.

`Unclassified` cannot be derived from the values. It can only be derived from **evidence state**, which a boolean schema does not carry. Sections 6 and 7 model stage as presence rows plus an explicit evidence state.

---

## Twelve companies have no properties anywhere, and the workbook calls them Canadian

Exactly **12** companies have no value in any of the eight region columns. Verified on both the matrix and the consolidated list. All twelve are royalty and streaming companies:

> Altius, Ecora, Elemental, Franco-Nevada, Metalla, OR Royalties, Orogen, Triple Flag, Uranium Royalty, Vizsla Royalties, Vox, Wheaton Precious Metals

The footprint formula's else-branch assigns every one of them **"Canada only"**:

```
U6  =IF(AND(V6="Yes",W6="Yes"),"Canada & Abroad",
       IF(AND(V6="No",W6="Yes"),"Abroad","Canada only"))
```

The else-branch swallows both "properties in Canada, none abroad" and "no properties at all". So the workbook asserts a Canadian mining footprint for Wheaton Precious Metals and Franco-Nevada — roughly **$146 billion of market capitalisation** filed under a footprint neither company has.

This is not an edge case to flag. It is the structurally correct state for an entire business model, and the fourth footprint value that Appendix B already declares — `None` — is simply never produced by the workbook. Section 7 implements it.

**Two conditions, not one.** 17 companies carry the royalty flag while only 12 lack properties, so **five royalty companies do have properties**. "No stage evidence" and "no property evidence" are independent and need separate flags; a shortcut assuming royalty implies no properties breaks on those five, which include Versamet Royalties and Labrador Iron Ore Royalty.

---

## Fee disclosures are filing-scoped, not period-scoped

Every fee column in the workbook is empty across all 259 rows, so there is no data to contradict — but the shape matters for the schema.

A fee disclosure carries a fiscal year end that varies by issuer and is **re-collected unchanged each quarter**. Storing fees against a period duplicates a filing-scoped fact four times a year, makes "did the fee change?" unanswerable because the same figure appears in four periods, and leaves the tax-to-audit ratio undefined when the two fees come from different years. Section 6 gives fees their own table keyed by company and fiscal year end.

---

## The dashboard is less recoverable than the brief assumes

| View | Actual state |
|---|---|
| Producing mines in key jurisdictions | **Does not exist.** No table, not even a broken one. No jurisdiction list to reproduce |
| Producing mines by Canadian province | 11 columns wide, **9 of 11 header cells reduced to `#REF!`**. Two province labels survive |
| Corporate office by market | **Empty.** Its chart points at a different table whose body contains no formulas |
| Clients by tier and market | Not a combined view; the two dimensions live in separate tables and neither carries fees |
| Tier distribution | **Two tables on one screen disagree** |

The tier disagreement is the instructive one. The pie chart is fed from the fudged proof block and plots Tier 4 = 258 with a phantom Tier 6 = 1, while the table directly above it plots Tier 4 = 259 and no Tier 6. Both are on screen simultaneously. Neither is right.

Cross-tabs fail on **string mismatch, not missing data**. Column headers typed as `"EY"` and `"Others"` never match the stored `"Ernst & Young"` and `"Other"`, so those columns are hard zeros and 46 companies vanish from the auditor cross-tab. The market cross-tab repeats the defect with `"Quebec and NCR"` and `"Prairie Region"` typed against stored `"Quebec & NCR"` and `"Prairies Region"` — so two of five market rows in the Deloitte-clients table can only ever return zero.

**The province and jurisdiction lists are recoverable from the data**, even though the headers are not: twelve provinces led by British Columbia, Ontario and Quebec, and foreign jurisdictions led by Mexico, Peru and Chile. Both carry the same spelling disease as the auditor column — `Columbia` beside `Colombia`, plus several misspellings — so both need a controlled vocabulary with an alias map. Section 10 specifies the axes and section 15 asks Kay to confirm them.

---

## The raw extracts are neither raw nor complete

- **An active autofilter hides sub-threshold rows.** A reader taking visible rows gets 144 and 115, not the 181 and 899 the brief cites. The filter criterion is baked into the file as `greaterThanOrEqual 200000000`, and its column index resolves to **different columns on the two tabs**.
- Both tabs carry a Deloitte-added summary block above the header row and appended region and commodity columns that are not part of the exchange download.
- **Header text is dirty in five distinct ways**: embedded newlines; one tab's market-data headers carrying both leading and trailing spaces the other lacks; five headers embedding the as-of date; three shared concepts spelled differently across tabs; and a market-cap header containing a newline.
- **The column shift is not a uniform offset.** It runs +1, then 0, then −1, because the TSXV tab drops one column and collapses another. The brief's stated mechanism is wrong; only header-name mapping works.
- **`Other Properties` is free text, not a flag.** Coercing it to boolean would fabricate roughly 145 true values and discard the only source for cobalt, graphite, vanadium, antimony, tin, manganese, phosphates and titanium — none of which appear in any other column, and none of which the brief's 20-item commodity vocabulary can express.
- Tab names say June 2025; every dated artifact inside says May 2026. **The period must be parsed from the market-cap header.**

### The extract is authoritative but incomplete

Five region values exist in the consolidated list and **nowhere in the extracts**, hand-added by the analyst:

| Ticker | Company | Column | Extract | Consolidated list |
|---|---|---|---|---|
| RML | Rusoro Mining | LATIN AMERICA | blank | Venezuela |
| SLG | San Lorenzo Gold | LATIN AMERICA | blank | Chile |
| CAMB | Cambria Gold Mines | CANADA | blank | BC |
| DBG | Doubleview Gold | CANADA | blank | BC |
| SCMI | Selkirk Copper Mines | CANADA | blank | YT |

For Rusoro and San Lorenzo, dropping the value flips the properties-abroad test, which flips the footprint from Abroad to Canada only, which moves them **from Tier 3 to Tier 2** once stage flags are enriched. A tier change on named companies, caused purely by re-parsing the source.

Appendix B's instruction to treat the extract as authoritative for regions is therefore unsafe as written. Section 5 specifies a three-way merge that carries analyst values forward.

---

## Both files carry personal data and third-party licences

Verified by reading the package parts directly, not inferred:

| Property | Whitespace workbook | LSEG screen |
|---|---|---|
| `dc:creator` | **TSX Group Inc.** | **Refinitiv** |
| `cp:lastModifiedBy` | Ampofo, Kay | Ampofo, Kay |
| Cell comments | **3, authored by a named employee** | none |
| Embedded media | — | 2 PNG screenshots of a vendor terminal |
| Macros / external links | none | none |
| Zip inflation | 1.01 MB → **8.86 MB (8.7×)**, incl. a 6.02 MB drawing part | 0.74 MB → 1.42 MB |

The LSEG file's third sheet holds named partners, named client relationship owners, and free-text notes recording individuals' responses to outreach.

Three consequences the brief does not draw:

1. **There are two licences, not one.** The brief names the exchange restriction only.
2. **Personal data is in the primary file too**, so excluding the obviously irrelevant sheet in the second file does not close the exposure.
3. **The real workbook cannot be committed as a test fixture.** Section 13 builds fixtures as synthesised structural derivatives instead.

**Nine cells already begin with `@`**, a character Excel interprets as a formula. Formula injection on export is therefore an active concern with a live example, not a theoretical one.

---

## Smaller corrections

- **13 sheets, not 10.** Two visible, empty divider sheets appear in no appendix. Any sheet-name allowlist or sheet-count assertion rejects the real file.
- **The Instructions tab documents no research step.** Its steps are numbered 1, 2, 3, 5 — step 4 is missing entirely. The work the brief calls the bottleneck is undocumented tribal knowledge, which is precisely why the stage columns are blank.
- **The workbook links the retired `sedar.com`**, not SEDAR+. Any source list inherited from it points at a decommissioned host.
- **FX is stale and structurally ambiguous.** Two disjoint blocks: March–July 2024 with currency labels, and August 2024–December 2025 whose currency identity is **positional only**. September 2024 has a header but no values ("Bank holiday - No rate"); October 2024 is absent. Nothing is within 22 months of the May 2026 data date.
- **The threshold is stated three ways and the operator is ambiguous** — "in excess of" $200M on the cover, "≥ CAD $200M" on the consolidated list, $50M on the dashboard labels. Today both readings yield 259, since the smallest company is $201,701,608. But Generation Mining and Greenland Resources sit **0.85% and 0.86% above the line**, so a normal market move flips them and registers as a drop-out.
- **53 of 259 companies (20%) have a foreign head office** and therefore no Deloitte market, dropping a fifth of the population out of every market view. The brief records the country typed into the market column as happening once; it happens three times.
- **The pursuit tracker is an empty template.** Zero companies, zero pursuit rows, and its tier legend rows are themselves hidden inside the hidden sheet. The application inherits no free-text analyst knowledge whatsoever.
