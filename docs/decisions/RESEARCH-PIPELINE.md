# Research runs in two passes, website first, and every answer quotes a document the application fetched

**Approved by Samuel Owusu, 11 September 2026**, with three new fields — fiscal
year-end, auditor tenure and change of auditor, SEC registrant status.
Built and tested the same day, and **switched on in production that
afternoon** after the go-ahead for Run 1. Nothing researches until a run is
started on `/runs`.

## The goal

Fill every field the workbook leaves empty — the website included — from
public records, and add what helps a pursuit decision. On the published
Q3-2026 period, that is:

| Field | Known | Missing |
|---|---|---|
| Stage of operations | 17 | 242 — the tier column's only blocker |
| Website | 98 | 161 |
| Auditor | 142 | 117 |
| Head office (location, region) | 0 | 259 |
| Audit fees, tax fees | 0 | 259 |
| Fiscal year-end, auditor since, auditor change, SEC registrant | new | 259 |

## The decision

**Two passes.** Pass 1 (identity) runs for every company: the official
website, the SEC registration, fiscal year-end, head office, and the list of
recent filings. Pass 2 (fields) runs only for a company whose website the
application trusts — the workbook's, or one an Analyst accepted from pass 1 —
and reads that company's filings for every field.

**The model discovers; the application fetches, checks and quotes; a person
accepts.** Concretely:

- The fetcher only downloads from the company's trusted domain, SEC EDGAR, and
  one investor-relations document host (`q4cdn.com`). A domain the model
  proposes is fetched only to **verify** it — its homepage, and nothing else —
  and becomes trusted only when an Analyst accepts the website.
- A downloaded document that does not name the company is discarded. The
  worst output this system can produce is a well-cited fee from the wrong
  company's filing.
- EDGAR answers SEC registrant status, fiscal year-end and head office with no
  model involved: the application finds the CIK in EDGAR's own ticker list
  (or takes the model's proposal), fetches the record, and requires the name on
  it to match.
- Extraction reads windows of each filing around what every field needs, and
  must quote each answer verbatim. The anchoring gate re-checks every quote
  against the stored document; a figure that is not there — a fabricated fee —
  is rejected and counted in the rate that gates publish.
- SEDAR+ is blocked in the search tool and on every allowlist (decision 1).

## What was fixed on the way

Building this found five defects that would each have made research go
nowhere or go wrong, all now fixed and tested:

1. **Accepting a researched stage never recalculated the tier.** Tiers were
   computed once, at commit.
2. **Undo left the accepted value in place**, so a withdrawn value would have
   been published.
3. **Decisions could not amend a published period.** The freeze meant for
   re-imports also blocked review; with Q3-2026 published, every accepted
   finding would have been dropped silently.
4. **Neither real spend-limit error would have halted a run** (S3).
5. **A short web page was marked as a scanned document** by a rule meant for
   PDFs, which would have refused every terse homepage.

## Cost

Measured prices (11 September 2026): Opus 5 $5/$25 per million tokens,
Sonnet 5 $2/$10, web search $10 per 1,000 searches. Discovery runs on Opus 5
with up to six searches; extraction on Sonnet 5 over about 25,000 tokens of
windows.

**Measured on Run 1:** pass 1 costs **$0.25** a company and pass 2 **$0.10–0.12**,
so a company researched end to end costs about $0.36. The start form now
estimates each pass separately at the measured mean plus about 20% ($0.30 and
$0.15, `src/lib/enrich/scope.ts`). At that rate all 259 companies cost about
$95 synchronously, inside the design's $65–115. Spend is recorded per run,
not per company, so there is no per-company p95 yet.

## Rollout

1. Run 1: five companies, pass 1 then pass 2 — two with a website, two
   without, one US-listed, one royalty company, one French-language filer.
2. Run 2: 25 companies. Run 3: all 259, then the Batch API at half price.

## Before Run 1 — all done, 11 September 2026

- `MM_SEC_CONTACT` set in Vercel.
- `LIVE_ENABLED = true` in `src/lib/enrich/worker.ts`; `MM_ENRICH_MODE=live` in Vercel.
- Samuel confirmed decision 1's scope covers the model searching the web and
  the application downloading issuer sites and EDGAR.
- Migration `0015` applied to Supabase.
- Run 1's five: AEM, WDO, ELE, NOU, RDS.

## Run 1 — 11 September 2026: the research worked, and the fee check did not

Five companies, $2.26 in all, across three runs that completed. Two more were
halted by the organisation's spend limit before spending anything (S3).

| Run | Pass | Companies | Cost | Findings | Proposed |
|---|---|---|---|---|---|
| `c00ee419` | 1 — identity | AEM, WDO, ELE, NOU, RDS | $1.25 | 16 | 14 |
| `f6ccf163` | 2 — fields | the same five | $0.59 | 45 | 18 |
| `039cc2c9` | 2 — fields, again after fixes | AEM, WDO, ELE, NOU | $0.42 | 36 | 26 |

**What it found that the workbook did not have.** Wesdome changed auditor
from Grant Thornton to Ernst & Young. Elemental Altus's head office is
Littleton, Colorado — from EDGAR, and confirmed by its own 40-F. On the second
pass 2, every non-fee field for the four companies came back proposed.

**Every fee was held.** Of eight fee findings on the second pass 2, four were
right and held only because of three defects in `src/lib/enrich/anchor.ts`,
now fixed and tested against the production passages:

1. **No comma-grouped figure could ever anchor.** The claimed value was reduced
   to digits (`517116`) and looked for in text that still read `517,116`. Every
   fee of $1,000 or more printed with a separator was held — which is every
   fee. The check now takes separators out of the document's numerals too: a
   comma, or the no-break and thin spaces French filings group digits with,
   between exactly three digits. An ordinary space does not count, so two
   table cells stay two numbers, and a decimal point stops a match.
2. **"(C$ thousands)" was not read as a scale.** Agnico Eagle's table used it;
   only "in thousands" and "(000s)" were known. The check now reads a currency
   before the word, "thousands of … dollars", and "(C$000s)" — and still not
   "(thousands of ounces)".
3. **The scale in force was the first one found, not the nearest.** A table in
   millions above a fee table in thousands would have read the fees as
   millions. The nearest heading above the figure now wins.

Against the stored documents, Agnico ($8,052,000 audit, $382,000 tax) and
Elemental (US$517,116 audit) now anchor, and so does Nouveau Monde's $353,190
if claimed for fiscal 2024 — the only AIF found was 2024's, and its table has
no 2025 column. The other four stay held, correctly:

- **Wesdome's audit fee** is right but unprovable by the check: its PDF's text
  layer fuses footnote markers onto figures, and `$610,6283` ($610,628, note 3)
  cannot be told from $6,106,283. Note 3 splits the fee between Grant Thornton
  ($163,882) and Ernst & Young ($446,746) — the auditor change, in the numbers.
- **Elemental's and Nouveau Monde's tax fees** are nil, printed "nil" and "-".
  The check anchors figures, not words for zero.
- **Wesdome's tax fee** was an abstention.

**A limit worth knowing.** The check requires the figure, a fee label and the
claimed year within 400 characters of each other. In a table with a column
per year, both years sit in that window, so it does not prove the figure came
from the claimed year's column. Review is where that is caught; the excerpt
on each finding shows the row.

## After revision 2 — what Run 1's review exposed, and what changed

**Radisson was published as a royalty company.** Its stage finding set
royalty/streaming true on a quote that said only "an exploration and
development project". The gate checked the quote was real, not that it
supported the flags, and royalty outranks development, so Tier 4 went out in
revision 2. Two changes:

- **The quote must name the stage that decides the tier** — production, then
  royalty or streaming, then development, then exploration, in English or
  French. Otherwise the finding is held for a person (`anchor_mismatch`), never
  bulk-accepted. Only the deciding stage is checked: Agnico's quote about
  production need not also mention exploration. The prompt now says the same.
- **Overrides are read as the field's value, never stored as typed text.**
  The override box starts from the displayed value; a stage edited to
  "exploration + development" used to be stored as that string, which tiering
  reads as no stage at all. `src/lib/format/fields.ts` formats and parses every
  field, the round trip is tested for each, and text that cannot be read is
  refused with how to write it.

**Fees now carry their currency and fiscal year** —
`{amount, currency, fiscal_year}`, shown as "C$8,052,000 (FY2025)" or
"US$517,116". The model already reported both and the application dropped
them. The gate now checks the currency where the document states one (the
figure's own prefix, or a heading such as "(C$ thousands)"), and ignores a
currency merely mentioned nearby. Fees accepted before this read
"(currency not recorded)" until re-researched.

**Money says which dollar everywhere:** C$ for market caps and the dashboard
threshold, US$ for research spend and budgets (the vendor bills in USD).

## Deliberately not in this build

- **Property regions and commodities** are not re-extracted: the workbook has
  them for 247 and 254 companies, and re-extraction would put a conflict in
  front of an Analyst for every difference in spelling.
- **The fees route with API citations** (docs/design/06) is not separate yet:
  fees are extracted with the other fields and held to the proximity anchor,
  never bulk-accepted. The citations route is the hardening that follows.
- **The Batch API.** Synchronous calls until Run 3.
