# Research runs in two passes, website first, and every answer quotes a document the application fetched

**Approved by Samuel Owusu, 11 September 2026**, with three new fields — fiscal
year-end, auditor tenure and change of auditor, SEC registrant status.
Built and tested the same day; **not yet run live** (`LIVE_ENABLED` is false
in the build until the go-ahead for Run 1).

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
windows. The design's estimate of roughly $0.25 a company a pass stands until
Run 1 measures it; every run records its real cost per job.

## Rollout

1. Run 1: five companies, pass 1 then pass 2 — two with a website, two
   without, one US-listed, one royalty company, one French-language filer.
2. Run 2: 25 companies. Run 3: all 259, then the Batch API at half price.

## Before Run 1

- `MM_SEC_CONTACT` in Vercel (a contact email EDGAR requires).
- `LIVE_ENABLED = true` in `src/lib/enrich/worker.ts`, and `MM_ENRICH_MODE=live`
  in Vercel.
- Confirmation from whoever approved decision 1 that its scope covers the model
  searching the web and the application downloading issuer sites and EDGAR.
- Migrations `0015` applied to Supabase.

## Deliberately not in this build

- **Property regions and commodities** are not re-extracted: the workbook has
  them for 247 and 254 companies, and re-extraction would put a conflict in
  front of an Analyst for every difference in spelling.
- **The fees route with API citations** (docs/design/06) is not separate yet:
  fees are extracted with the other fields and held to the proximity anchor,
  never bulk-accepted. The citations route is the hardening that follows.
- **The Batch API.** Synchronous calls until Run 3.
