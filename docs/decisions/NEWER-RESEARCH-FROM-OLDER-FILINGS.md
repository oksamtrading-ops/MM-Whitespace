# Newer research means a newer filing, not just a newer finding

**Decision, 20 October 2026.** Each stored document records the latest fiscal
year it says it reports on, read from its own text when it is fetched
(migration `0035`, `src/lib/enrich/reportson.ts`). On the review screens, a
finding that disagrees with an accepted value is offered as **Newer research**
only if its document reports on the same year or a later one than the document
behind the accept. A later finding from a document that reports on an earlier
year goes to a new tab, **Older filing**. It is shown with both years and the
reason, and it is not offered. When either document does not say what year it
reports on, nothing changes.

## What went wrong

"Newer research" (`newerThanDecision` in `src/lib/review/queue.ts`) meant a
finding *created* after the accept that proposes something different. Creation
is when a run read the document, not when the document was written.

- **13 September 2026.** Samuel accepted China Gold's auditor change ("changed
  26 June 2025, from Deloitte Touche Tohmatsu") and auditor since (2026). They
  came from the 2026 information circular and the FY2025 AIF, which record
  Deloitte retiring, BDO's appointment for Hong Kong and Lixin & Ethos's for
  Canada.
- **13 October.** The trial re-run (`3924fe88`) fetched China Gold's **2022**
  circular, which says "Deloitte Touche Tohmatsu was first appointed as
  auditors of the Company on April 1, 2010". It proposed "no change" and
  "since 2010".
- **18 October.** Both findings were newer, so both were offered on Newer
  research. Both were taken (decisions 326 and 327), and revisions 10 and 11
  published China Gold as unchanged since 2010.

Nothing on the screen said which document was older. The excerpt was a true
sentence from a real filing, and the anchoring gate was right to pass it: the
gate checks that a quote is in the document, not that the document is current.

## What a document says about its own age

Measured on the 320 documents in production on 20 October 2026:

| Signal | Covers | Problem |
|---|---|---|
| `retrieved_at` | all | When it was fetched. The cause of the bug, not a fix |
| EDGAR accession number (`…/000119312526079253/`: filed in 2026) | 175 SEC filings | Issuer documents have none |
| A year in the URL | 87 of 115 issuer documents | Sometimes the fiscal year, sometimes the upload month; China Gold's stale circular has none |
| The latest full date in the first 6,000 characters | 129 of 175 SEC, 91 of 115 issuer | Lags the filing year by one in 38 SEC filings, whose opening shows only the year end; forward dates fool it |
| **The latest period that "ended"** ("year ended December 31, 2025", "three months ended…", "year ended 30 June 2025", "l'exercice clos le…") | most of both | None found that matter, see below |

The last is what a filing states about itself: the fiscal year it reports on.
It reads the same way in a 40-F exhibit, an issuer's AIF, a circular and an
annual report, so two documents are never compared by different methods. Only
"ended" counts, in the past tense, because forward-looking dates ("by December
31, 2027") are common. A year after the day the document was fetched is ignored.

**Against history**, measured on 20 October 2026 by running the module's three
patterns as Postgres regular expressions over production. That measurement
capped each year at the year the document was fetched; the code caps at the
day, which only ever discards a period that had not yet ended:

- **Coverage:** 246 of the 320 documents state a year: 158 of 175 SEC filings,
  85 of 115 issuer documents, and none of the 30 EDGAR profiles, which state no
  period.
- **Demotions:** of the later findings that disagreed with an accepted value,
  five come from a document reporting on an earlier year:
  - China Gold's `auditor_change` and `auditor_since` (2021 against 2026);
  - China Gold's stage, the Development tick taken on 18 October, from the
    2024 AIF (2024 against 2025);
  - Radisson's and Wesdome's stage proposals (2023 against 2025).
- **Everything else stands as newer research.** For example, NMG's 2025 filing
  corrects its 2024 AIF (2025 > 2024) and stays offered.

## The choices inside it

- **Strictly earlier, by year.** Two documents reporting on the same year are
  not ordered. A circular and an AIF for FY2025 can disagree, and the reviewer
  should see that disagreement as newer research, as before.
- **Unknown demotes nothing.** A wrong demotion would hide a real correction. A
  missed demotion leaves the row as it always was, waiting for a person.
- **Shown, never dropped.** The Older filing tab lists each such row with its
  two years and the sentence why. The accepted value stands, and the row draws
  no buttons, as every decided row does. To use the older value after all,
  undo the accept and decide again. Nothing a run found disappears; the review
  trail stays append-only.
- **Read once, at fetch.** The year is a column on `documents`, written by
  `storeDocument` (and by the replay path in `persist`). It is not re-read from
  the full text on every review page, where a few hundred long filings would
  be megabytes per load. `reports_on_version` records which reading produced
  it, so a null year means "does not say", not "never read". Bumping
  `REPORTS_ON_VERSION` makes the backfill read every document again.

## To put it in production

1. Apply `0035` (two `add column if not exists`), through the Supabase
   connector or `node scripts/migrate.mjs "$MM_DATABASE_URL"`, and record it in
   `schema_migrations`.
2. Deploy. New documents get their year from then on.
3. Read the 320 stored documents: `node scripts/backfill_reports_on.mjs
   "$MM_DATABASE_URL"`, from Samuel's shell. Until it runs they count as
   unknown, which demotes nothing: the screens behave exactly as before.

## Not done

- **What was already taken from older filings is not corrected by this.** Those
  are standing accepts: China Gold's auditor change and tenure (decisions 326
  and 327, one ⌘Z on each field) and its Development tick (decision 322, which
  the stage field's Undo reaches only after Lundin's 324 and Kinross's 323).
  Undo them and publish a revision.
- **A first accept does not check the year.** An undecided row has no earlier
  accept to compare with, so two undecided findings from documents of
  different years are still ranked as before: state, source, evidence, newest.
- **Stage rows** use the same rule. They were already compared by their stages
  rather than their stored form, and a stage proposal from an older filing is
  demoted like any other.
