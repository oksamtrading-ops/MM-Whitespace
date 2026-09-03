# Detect by content, map by compound header name, and never let a re-upload delete research

## Three accepted inputs, none detected by filename

| Input | Content signature | Header row |
|---|---|---|
| Whitespace workbook | A sheet whose row 5 carries `Tier`, `#`, `Company`, `Exchange` **and** a sheet whose row 7 carries `Ticker`, `Name`, `Exchange` | 4+5, 7, 5 by tab |
| Raw issuer extract | First three rows contain the exchange copyright notice **and** a row within the first 20 contains both `Co_ID` and `Root Ticker` | Located by signature |
| Screener export (optional) | Header row containing `Identifier`, `Company Name`, `NAICS Industry Group Name` | Located by signature |

**Never detect by sheet name, sheet count, or an allowlist.** The real workbook has 13 sheets, two of them undocumented empty dividers, so a count assertion or an exact-name allowlist rejects the genuine file. Each logical tab is bound by signature and the physical name found is logged, so a renamed tab still parses.

Sheets matching no signature with no data are **skipped silently** — that is the divider case. Sheets matching no signature but containing data produce one informational line and are not ingested.

## The period date comes from the header, never the tab name

Tab names say June 2025. Every dated artifact inside says May 2026. Resolution order is strict:

1. The date captured from the market-cap header during normalisation.
2. The cover sheet's date cells, if they agree with each other.
3. The screener's own as-of note.

If (1) and (2) disagree, **block and ask**. Never fall through to the tab name.

**Wrong-period uploads block.** If the resolved as-of date matches a published period, or predates the latest published period, the commit is refused with a message naming the conflict. If the date is new but the row-set hash matches an existing period exactly, warn — same data, new date, probably a re-save.

## Header normalisation is an ordered algorithm, and order matters

Header text is dirty in five distinct ways across the extracts. Apply in exactly this sequence and unit-test each step:

1. Null or non-string → the column has no header.
2. Unicode NFKC normalise — removes non-breaking spaces and full-width punctuation.
3. Replace CRLF, LF, CR and tab with a single space.
4. Collapse whitespace runs to one space.
5. Trim. **Steps 3–5 must precede every comparison, including sentinel matching.**
6. **Capture and strip the embedded date.** Match a four-digit year or a `DD-Mon-YYYY` pattern, record it as the column's as-of date, remove the substring, re-collapse. This is where the period date in the section above comes from.
7. Casefold; remove `.`, `-`, `_`, `/` and non-alphanumerics except parentheses, currency and ampersand; re-collapse. This folds two spellings of the same concept onto one key.
8. Look the slug up in an **explicit alias table**. Both spellings of every divergent header are listed. Do not rely on edit distance.

## Mapping by header name needs a compound key

The brief says map by column name rather than position. That is right and insufficient: **four header names each appear twice** on the matrix — `Currency`, `Fees`, `Fees in CAD ` and `Fiscal Year` occur once in the audit-fee block and again in the tax-fee block. A name-keyed dictionary silently collapses audit fees onto tax fees.

The disambiguator is the group label in the row above. The key is therefore `(forward-filled group label, header)`, and a duplicate final key is a **blocking** error naming both column letters.

## The autofilter carries a threshold that is not the application's

Both extract tabs are saved with a live filter whose criterion is baked in at 200,000,000, and the filter's column index resolves to **different columns on the two tabs**.

Reading only visible rows would hard-code a $200M threshold into an application that declares the threshold a per-period parameter — so setting $50M would return 259 companies and report success.

**Read every row from the first data row to the last non-empty row and ignore the hidden flag entirely.** Parse the filter criterion separately and report it: *"This file was saved with a filter at ≥ $200,000,000. 37 TSX and 784 TSXV rows are hidden by it. This period's threshold is X; N hidden rows qualify and are included."*

## Normalisation rules

| Rule | Detail |
|---|---|
| Whitespace | Trim **before** sentinel matching, always |
| Sentinels | `"Not found"`, `"N/A"`, numeric `0`, blank → a single null carrying a distinct reason code. Numeric zero is formula-produced in the website column and is easy to miss |
| Auditor firms | Resolve through an alias table to a canonical firm. Two spellings of one Big-4 firm, and a non-Big-4 firm sitting in the Big-4 column, both fold correctly. Firm class is a property of the firm, never of the column it landed in |
| Trailing-space collisions | Folded by step 5; the six-versus-one split of one firm disappears |
| Tier | Stored as text; coerce to integer at the boundary and never compare raw |
| Ticker | Root symbol, no suffixes in the extracts. Uppercase, trim |
| Province / state | The location column mixes Canadian province codes, US state codes and full country names with no discriminator, and one two-letter code is ambiguous between a province and a US state. Resolve using the location **and** region columns together, into an ISO country plus subdivision |
| Regions | Comma-separated; split, trim, map through a controlled vocabulary with an alias layer that tolerates the spelling errors present in the source |
| Commodity flags | `Y` flags → booleans |
| **`Other Properties`** | **Free text, not a flag.** Parse as a comma-separated list and union into commodities. Coercing it to boolean would fabricate ~145 true values and discard cobalt, graphite, vanadium, antimony, tin, manganese, phosphates and titanium — none of which the flag vocabulary can express |
| Website | Split into URL and title. 45 of 143 populated values are page titles; route those to enrichment rather than storing them as URLs |
| Market cap | Full dollars with fractional cents. Store as `numeric`; the threshold parameter is stored in dollars |

## A re-upload must never delete analyst research

Five region values exist in the consolidated list and nowhere in the extracts. Under a naive precedence rule a re-upload nulls all five, and for two companies that flips the footprint and moves them a tier — **a tier change caused purely by re-parsing**.

Region cells are therefore a **three-way merge**, not an overwrite:

```
extract_value | prior_period_accepted_value | current_value
```

- Extract populated → the extract value is promoted, but only over a value whose source is itself `extract`.
- **Extract silent, prior value present → carry forward**, mark the provenance as analyst-retained, and warn per occurrence naming the company and the value.
- Only an explicit Analyst clear removes a value.

Ingest must distinguish three states that a naive parser conflates: **column absent from the file**, **cell blank**, and **cell equal to a sentinel**. Only the second and third assert absence. The first asserts nothing and must leave the prior value standing.

## Identity resolution: three ladders, not one rule

**Extract → company.** `ticker_root + exchange` only. This resolves 259 of 259 against the consolidated list, so a miss is a **blocking error**, not an invitation to fuzzy-match. The vendor identifier columns are empty and are ignored.

**Workbook internal joins.** Rebuild both on identity rather than trusting the file's own joins. Resolve matrix rows through the positional counter **once**, immediately attach the ticker, then re-key everything to it. Assert the counter is strictly sequential with no gaps before trusting it at all. For the auditor tab, join on the entity identifier where present — **143 of 259 rows carry a real one** — and on normalised name otherwise, routing any row that resolves to zero or several companies into the manual-merge queue rather than dropping it.

**Screener → company**, ordered, first hit wins, each tier recording its match method:

1. Canonical root plus mapped venue suffix. Strip the trailing inactive-instrument marker **only if** the stripped root matches and the unstripped one does not — an unconditional strip would corrupt legitimate share-class tickers.
2. Canonical root ignoring venue. This catches the nine companies whose identifier encodes a US or Hong Kong primary listing. Record the venue mismatch as **information**, not an error.
3. Normalised name: NFKC, casefold, ampersand expanded, punctuation stripped, legal suffixes removed. Run the punctuation strip before any edit-distance work, since a trailing period explains most near-misses.
4. Token-set similarity above a threshold → **manual-merge queue**, never auto-accepted.
5. No match → recorded as a count. The screener is a secondary input; its non-matches never block a commit.

Accepted merges persist as alias rows against the stable company identifier, so a confirmed pairing sticks rather than being re-asked every quarter.

## Companies change exchange, so identity cannot be a composite key

98 extract rows carry a venture-graduate flag. Treating `(ticker, exchange)` as a primary key reads an ordinary graduation as a drop-out plus a new entrant, corrupting exactly the migration view the practice cares about. Identifiers are rows with validity intervals; a graduation closes one interval and opens another against the **same** company. Section 6 gives the schema.

## The validation report

One screen before commit, three sections. Nothing is written until the Analyst confirms.

**Blocking** — ambiguous or duplicate header key; a required column unresolved after alias lookup; period date unresolvable or contradictory; period date colliding with a published period; matrix counter not sequential; an extract row whose identity fails to resolve; duplicate identity within one tab; a tier value outside the valid set after coercion.

**Warning, acknowledgement required** — rows hidden by the source filter, with the criterion; region values carried forward, listed by company; auditor values normalised, with a before-and-after diff; website values that are titles rather than URLs; screener non-matches in both directions and every venue mismatch; companies with no properties in any region column; columns present in the file but not ingested, **with their non-empty cell counts**, so a newly typed comment is never silently dropped.

**Proof totals**, shown as expected against actual and required to tie:

1. Extract rows at or above threshold = consolidated row count.
2. Consolidated = matrix = auditor tab row count.
3. Tier counts sum to the population, with no compensating constant.
4. Exchange counts sum to the population, and the exchange set is a subset of the known vocabulary.
5. Auditor counts across all normalised firms plus unknown = the population. The workbook's own equivalent reconciles only 138 of 259; the report must show the gap rather than call it balanced.
6. Cover date = header-derived date = declared period date.
7. Screener row count against its own cached figure, with the cached figure labelled stale where it disagrees.

## Personal data is handled at the storage boundary, before parsing

Both files carry personal data, so this is not a matter of skipping one sheet. The full control is specified in section 11; the ingestion-side obligations are:

- The upload lands in short-lived quarantine, never in durable storage.
- Parse first, persist normalised rows, then **delete the original bytes**. Do not archive the upload.
- Strip comments, drawings, embedded media and document properties before any sheet is read.
- Detect a person-data sheet by signature and **block the commit with an explicit message**, so an Analyst who did not realise what they uploaded finds out.
- Never extract the embedded screenshots.

## Parse in Python, in the worker, not in the request path

`openpyxl` in the background worker, for one decisive reason: it is the only candidate that exposes the **autofilter criterion** the validation report needs. The JavaScript libraries surface the filter range but not its operator and value.

Measured on the real 13-sheet workbook: both load passes complete in **under one second**, roughly ten times inside the budget, so correctness rather than speed is the constraint. Upload writes to quarantine and enqueues a parse job; the interface polls. This also removes parsing from the function time limit entirely.

**State plainly in the export section**: this library cannot preserve the workbook's charts, conditional-formatting extension or legacy drawing parts on a round-trip. That is accepted, because the export target is a clean template and the original is returned untouched.
