# Mining Whitespace Intelligence Tool

Deloitte Canada, Mining & Metals. Design in [`docs/DESIGN.md`](docs/DESIGN.md);
decisions in [`docs/decisions/`](docs/decisions/).

**This build is a proof of concept and stores no Deloitte client information.**
The `Deloitte Tax Client` column is positively excluded at parse time and named
in the validation report as deliberately skipped, so the exclusion is visible to
a later due-diligence review rather than looking like an oversight.

## Milestone 1 — ingest is trustworthy

No AI. The point of this milestone is to prove the data is read correctly before
anything is built on top of it.

```bash
python3 -m mmparser.cli "reference/M&M - Whitespace Analysis Q3-2026.xlsx"
```

Renders the validation report: blocking findings, warnings requiring
acknowledgement, and the six proof totals, which must tie before a period may be
committed. Nothing is written anywhere.

### First, after cloning

```bash
npm run setup
```

Points git at `.githooks/`, which refuses to commit a source workbook. Git does
not enable a repository's hooks on clone, so this step is manual and is the one
thing worth not skipping — see below.

### Running the tests

```bash
python3 -m unittest discover -s tests
```

```bash
node --test 'src/**/*.test.ts'
```

The Node suite needs no dependencies — Node 24 runs TypeScript directly.

### Committing a period

```bash
python3 -m mmparser.cli "reference/M&M - Whitespace Analysis Q3-2026.xlsx" --json /tmp/period.json
node scripts/commit_period.mjs /tmp/period.json ./period.db --fresh
```

Writes companies, identifier intervals, the immutable fact snapshot, resolved
values, stage presence rows, tiers and rule-by-rule traces. Re-running it is
idempotent. On the real workbook the committed tier distribution is **242
unclassified and 17 at Tier 4** — the honest spread, against the workbook's own
single false bar of 259.

### Milestone 2 — one company enriched end to end

```bash
npm run research
```

Drives a company through the ledger — queued, claimed, researching, persisting,
completed — runs every proposed finding through the anchoring gate, scores the
evidence, and persists. **Nothing is sent anywhere.** Replay is the default and
live mode throws in this build, pending the risk and legal review under decision 1.

The recordings in `tests/cassettes/` are synthesised, not captured vendor
responses; see the README there. One deliberately contains a fabricated tax fee
that the gate quarantines while accepting the real audit fee beside it.

### Running the application

```bash
npm install
MM_DATABASE=./period.db MM_DEV_AUTH_SECRET=dev MM_CRON_SECRET=cron \
  MM_ALLOWED_DOMAINS=example.invalid npm run dev
```

It is invite-only, so add yourself to `app_users` first, then sign in:

```bash
curl -X POST localhost:3000/api/dev/signin -H 'content-type: application/json' \
  -d '{"email":"you@example.invalid"}' -c cookies.txt
```

That development sign-in is **not** magic-link authentication and refuses to run
outside development. It exists so the app can be run before a Supabase project
does.

### The publish gate

```bash
node scripts/publish_period.mjs ./period.db --publish
```

Shows coverage per chart against its floor and refuses if any blocks. An Admin
publishes anyway with `--override "reason"`, and that reason is printed on the
dashboard header.

On the real period the gate closes, correctly: stage coverage is 6.6% against a
95% floor, because 242 of 259 companies have never been researched. That is the
day-one state and the gate is right to stop.

### Exporting a period

```bash
python3 scripts/export_period.py ./period.db out.xlsx --csv out.csv
```

Writes a clean, version-controlled template — never back into the uploaded
workbook, which is an input artifact and is returned untouched. Seven sheets,
corrected proof formulas, both licence notices, and the rule trace on every tier
cell as a comment.

### The parity check

Runs the tier engine across all 259 real companies and asserts the difference
from the workbook's own computed column equals exactly the known-divergent set.
It reads the private workbook, so it never runs in CI.

```bash
python3 -m mmparser.cli "reference/M&M - Whitespace Analysis Q3-2026.xlsx" --json /tmp/period.json
node scripts/parity_check.mjs /tmp/period.json
```

### Ground-truth regression

Re-measures every figure asserted in the design document against the workbooks.
Run it after any change to a factual claim.

```bash
python3 scripts/verify_ground_truth.py --reference-dir reference
```

## Layout

| Path | What |
|---|---|
| `mmparser/` | Workbook parsing. Named `mmparser`, not `parser`, because `parser` shadows a stdlib module on Python 3.9 |
| `mmparser/textnorm.py` | The eight-step header algorithm. Order matters; each step is separately tested |
| `mmparser/aliases.py` | Explicit alias tables — headers, auditor firms, jurisdictions. Never edit distance |
| `mmparser/sentinels.py` | Six missing-value forms, including numeric zero |
| `mmparser/safety.py` | Package-part inspection, zip guards, person-data tripwire |
| `mmparser/workbook.py` | Signature-based sheet binding and compound-key column mapping |
| `mmparser/ingest.py` | Identity resolution, three-way region merge, proof totals |
| `src/lib/tiering/` | The classification engine and its 64-row truth table |
| `tests/fixtures/` | A synthesised structural derivative. The real workbook is never a fixture |
| `supabase/migrations/` | The canonical schema, in Postgres. `0003` is Postgres-only and is not applied locally |
| `src/lib/db/dialect.ts` | Mechanical Postgres→SQLite translation, so the schema under test is the schema that ships |
| `src/lib/db/commit.ts` | The period commit |
| `scripts/` | Period commit, parity check and the ground-truth regression |

## Two things that are easy to get wrong

**The real workbook cannot be a test fixture.** It carries personal data and two
third-party licences. `tests/fixtures/build_fixture.py` generates a synthetic
workbook reproducing every structural pathology — duplicated fee headers, dirty
header text, six sentinel forms, a live autofilter, a region value present in one
tab and absent from another — with fabricated companies. That file is the only
`.xlsx` the repository tracks.

**A re-upload must never delete analyst research.** Five region values exist in
the consolidated list and nowhere in the extracts. Under a naive overwrite a
re-parse nulls all five, and for two companies that flips the footprint and moves
them a tier — a tier change caused purely by re-reading the file. Region cells are
a three-way merge, and every carry-forward is warned per occurrence by name.

## The database

The migrations in `supabase/migrations/` are written in Postgres and are the
artifact that ships. There is no Postgres on this machine, so the local runtime
translates them mechanically for SQLite rather than keeping a second schema by
hand — `src/lib/db/dialect.ts` throws on any construct it cannot translate
faithfully, so an untranslated one fails at load instead of quietly changing
meaning. Roles and row-level security live in a Postgres-only migration that the
local path skips.

**Precedence is enforced by the database, not by the commit code.** The promotion
of extract values is a conditional upsert that can only ever overwrite another
extract value:

```sql
on conflict (period_id, company_id, field_key) do update
  set value = excluded.value
  where v.source = 'extract' and v.frozen_at is null
```

So an accepted finding, a manual override or a value frozen at publish survives a
re-import even if the application code is wrong. The tests assert exactly that,
because it is the invariant a refactor is most likely to break.

### Two schema decisions worth knowing

`companies` has **no `deloitte_tax_client` column.** The design specifies one;
this build stores no Deloitte client information. The Deloitte market is a
different case — it is the firm's own label on a public company and identifies no
client, so it is stored, classified `deloitte_internal`, and hidden from Viewers
by policy. That leaves the classification mechanism exercised by a live row
rather than by none, which is what a later due-diligence review needs in order to
inspect it.

`company_identifiers` uses **two partial unique indexes, not one constraint.** A
`UNIQUE` constraint treats NULLs as distinct in both dialects, so a scheme with
no exchange — `sp_entity_id`, 143 of them — would never conflict with itself and
every re-import would insert the whole set again.

## Why a commit hook rather than branch protection

GitHub branch protection and rulesets both require GitHub Pro on a private
repository, so neither is available here. The protection that matters most is
therefore local and lives in `.githooks/pre-commit`, which refuses to commit any
spreadsheet other than the synthetic fixture, anything under `reference/`, or any
unexpected large binary.

That is the right enforcement point regardless of plan. Once a licensed workbook
reaches GitHub history, removing it means rewriting history and force-pushing —
not deleting a file. The hook stops it before the commit exists.

CI backs this up rather than replacing it: the `guard` job fails the build if any
workbook other than the fixture is tracked, or has ever been committed on any
branch. That catches anything committed with `--no-verify`, or from a clone where
`npm run setup` was skipped — but it catches it *after* the push, which is why the
hook comes first.

If the repository later moves to a Deloitte-controlled organisation, or the
account moves to Pro, add server-side protection on `main` with these five
required checks and force-push and deletion disabled:

    no licensed workbook is tracked
    tier engine and period commit
    parser (3.9)
    parser (3.12)
    the fixture rebuilds from source

## The grounding gate

The worst output this system can produce is a fabricated audit fee on a partner's
dashboard, so the guard against it is mechanical rather than prompt-based: a
numeric value must appear, after normalisation, in text the application itself
retrieved from a URL the application itself fetched.

`src/lib/enrich/anchor.ts` closes the holes that a naive "check the excerpt
against the document" leaves open:

| Hole | Rule |
|---|---|
| Re-extraction drift | Verify against the byte-identical stored artifact, keyed by hash. Never re-extract at verification time |
| Unicode | Compare a versioned normalised form on both sides — ligatures, soft hyphens, non-breaking spaces inside figures, dash and quote variants |
| Tables | A fee and its label are rarely contiguous, so for numerics contiguity is dropped and a **proximity conjunction** is required instead: numeral, controlled label, and fiscal year within one window |
| Scale words | "$412" under an "in thousands" header is $412,000. The finding declares its scale and the verifier checks it against the document's own phrase |
| No text layer | A characters-per-page gate, producing a distinct state rather than a rejection |
| Language | Quebec issuers file in French, so label lists are bilingual |

Every failure is an explicit state and none is a silent drop. The distinctions
the workbook loses are kept: searched-and-found-nothing is not the same as
source-unreachable, which is not the same as never-attempted — and an
**abstention is not a hallucination**, so it has its own state and is excluded
from the rate that gates publish.

### Evidence strength, not self-confidence

A model's self-reported float is uncalibrated, incomparable across fields, and
drifts with every prompt change. Since bulk-accept keys off this number, using it
would make the highest-leverage control in the product one backed by nothing
measured.

`src/lib/enrich/evidence.ts` computes a versioned function of observable
components instead — source tier, recency against the field's cadence, anchor
strength, corroboration, extraction agreement. The self-report is stored beside
it and excluded from the threshold. The fixture demonstrates why: the fabricated
fee carries **higher** self-confidence than the real one, and lower evidence
strength.

## The fetcher

The model discovers candidate sources; **the application fetches and caches
them**; code enforces the citation. That split is the only reason a fee can be
required to cite a filing by construction rather than by prompt — but it holds
only if `src/lib/enrich/fetch.ts` refuses to fetch whatever it is pointed at.

| Control | Rule |
|---|---|
| Server-side request forgery | Private, loopback and link-local space is blocked **after DNS resolution**, and re-checked on every redirect. Checking the hostname alone is defeated by a name that resolves inward |
| Domain trust | The allowlist is derived from issuer websites **in the extract**. A domain the model proposed is never fetchable on that basis. Matching is on label boundaries, so `evil-northco.invalid` does not pass for `northco.invalid` |
| Type confusion | The type is sniffed from the bytes. Content declared `application/pdf` whose bytes are not a PDF is refused rather than parsed |
| Resource exhaustion | Byte, page-count, redirect and time caps |
| Documents | The extracted **text** is stored, keyed by the hash of the bytes received. The file itself never is, and embedded scripts are stripped before storage |

The allowlist derivation deliberately ignores non-URL website values: 45 of the
143 populated values in the real workbook are page titles, and a page title must
not widen what the fetcher will reach.

## The export

The uploaded workbook is an **input artifact, not a deliverable.** Writing back
into it fails twice over: no library round-trips its conditional-formatting
extension, charts, legacy drawing part or ~84 add-in defined names, and a
faithful copy would re-emit the very defects the application exists to fix.

So the export is a clean template the application fully controls, which is the
only way to guarantee the proof totals tie.

### What it deliberately does not reproduce

| Defect, live in the source | Effect if copied forward |
|---|---|
| Counts starting one row below the data, plus a compensating `+1` | Restores a phantom exchange and misfiles a real company |
| A footprint else-branch calling "no properties at all" *Canada only* | Files ~$146bn of market cap under a footprint those companies do not have |
| Auditor counts matching one spelling of a firm | Loses a Deloitte client and both companies under the alternate spelling |
| Broken references in the financial-metrics block | Reintroduces `#REF!` |
| Nine cells beginning with `@` | Formula injection on open |

The financial-metrics block is **omitted entirely** rather than exported empty —
an empty block invites someone to reattach a broken lookup. The cover sheet
carries the pre-written answer to the first defect report anyone will file,
which is "the numbers changed".

### The injection guard

Nine source cells already begin with `@`, so this is an active concern with a
live example. Worse, two of the strings this application writes are
attacker-influenced: analyst overrides are free text, and evidence excerpts are
model-generated strings taken verbatim from third-party pages — so whoever
controls an issuer's investor-relations page controls a string that lands in a
partner's spreadsheet.

**Every cell in every export path goes through one writer helper.** A string
beginning with `=`, `+`, `-`, `@`, tab or carriage return is written with the
quote-prefix flag set, which is lossless — the value keeps its leading
character, unlike prefixing an apostrophe into the value itself. Control
characters are stripped and length is capped at the writer rather than trusting
the model to respect a limit. A test audits a fully generated export and fails
if any cell anywhere is left interpretable, so a column added later by a
different code path cannot silently bypass the guard.

The flat CSV is the exception that proves the rule: a CSV has no quote-prefix
flag, so there the leading character genuinely is neutralised.

### Formula vocabulary

Nothing newer than 2007 — index-and-match, never the modern lookup — so a
headless recalculation stays viable as an automated check. A test fails the
build if a modern function appears.

## Publish and the frozen snapshot

Every dashboard reads **only** the frozen snapshot. Re-deriving the effective
value of each field — override beats accepted finding beats extract — across a
dozen queries would implement the precedence rule a dozen times and let it
diverge, reintroducing by architecture the same defect as two tier tables
disagreeing on one screen.

### The gate

Publish is blocked while any default-dashboard chart sits below its coverage
floor, while unresolved conflicts remain, or while the run's fabrication rate
exceeds its ceiling. Floors are **rows in `coverage_floors`, not constants** —
engineering has no basis for setting them and the practice does.

Two subtleties the gate gets right:

- **A footprint of `none` counts as resolved.** It is the honest answer for a
  royalty company with no properties, and the fourth value the workbook never
  emitted. Counting it as unresolved would block a publish for getting something
  right. What is unresolved is a company with no property *evidence*.
- **Fee coverage has no percentage floor and never blocks.** "Found for 61 of
  259" is honest; "24%" invites the question of what the other 76% are, and the
  answer is not "no fees" but "not disclosed where we may look".

An Admin may override with a reason, which is **printed on the dashboard
header**. That printing is the point — it is what stops a stale-data warning
becoming a banner nobody reads, which is exactly what happened to the source
workbook's own `TAB NOT UPDATED` notice.

### Immutability is by construction, not by trigger

Every publish inserts into a fresh `publication_id`, and a correction after
publish is an **amendment that bumps the revision** rather than an in-place
mutation. So no code path updates a published row and there is nothing for a
trigger to defend — which also keeps the migration portable, since Postgres and
SQLite trigger syntax do not agree and a trigger would have forced a second,
drifting schema. Postgres additionally revokes update and delete.

Publishing also sets `frozen_at` on the source rows, which the commit path's
conditional upsert already respects, so a re-import cannot move a published
value even if the application code is wrong.

## The application

Next.js App Router, three roles, and one rule that shapes everything else.

### Middleware is not an authorisation boundary

Next.js middleware has a documented bypass class, and **every Server Action
compiles to an addressable endpoint whether or not the control that calls it
ever renders** — so a Viewer who can sign in could call publish. `src/proxy.ts`
does redirects and nothing security-relevant.

The real check is `assertRole` as the **first statement** of every route handler
and server action, and `npm run check:auth` fails the build when one is missing.
An endpoint that genuinely needs no role must say so out loud:

```ts
// @public-endpoint the cron tick authorises with a bearer secret instead
export async function POST(request: Request) { ... }
```

so every exception is visible rather than silent. A test plants an unguarded
handler and asserts the check fails — a check that never fails proves nothing.

### Portability is one claim

Authorisation never reads the identity provider's user table. It reads **one
claim** — the email — and resolves it against the application's own `app_users`.
Swapping providers changes the claim source and nothing else, which is what
makes the eventual move to Deloitte SSO a configuration change rather than a
rewrite. Invite-only: an email the provider would happily accept is still not a
user, and a deactivated row is not a user either — there is no leaver process
for an application outside Deloitte's estate.

### The cron tick does almost nothing

A cron firing every minute at a function that runs several hundred seconds
produces roughly a dozen concurrently live workers; if each applies its own
concurrency limit, actual concurrency is the product of the two. So the tick
asks two questions — is there work, is a slot free — and returns. Because it does
no work itself, a leaked secret only causes a no-op invocation. The secret is
compared in constant time, a **missing** header is rejected rather than allowed,
and an unset server secret fails closed.

### Colour

Decision 8, applied: the brand green `#86BC25` appears only in large fills. Text
uses `#567C18` and focus rings `#5E841A`, because 2.27:1 on white is below both
the text and non-text floors and the failure is invisible to eye-checking.

## The review grid

259 companies by roughly ten enriched fields is about **2,590 decisions per
period**. A company-by-field grid charges the Analyst a context switch on every
cell; judging one field **down a column** reuses a single mental model. That is
the difference between a two-hour review and a two-day one — and a two-day
review means the period never gets published, which is the bottleneck this
product exists to remove.

So the Analyst lands on a triage board and picks a batch. Every number on it is
a link that opens the grid pre-filtered; nobody faces 2,590 undifferentiated
cells. Rows are sorted by **evidence ascending**, so the worst work comes first
and the tail is bulk-acceptable.

### What bulk accept refuses

Seven refusals, as a pure function, each with a test:

| Refused | Why |
|---|---|
| Fees, at any evidence level | The guarantee is that a fee cites a filing. A threshold is not a citation check |
| Any extract-versus-AI conflict | High confidence in a wrong answer is exactly the failure this creates |
| Any already-overridden value | Overrides are never overwritten; this is where that invariant would break |
| Stage flags without a typed opt-in | Stage determines tier and tier is the deliverable |
| Anything with zero sources | A confident answer with no source is a hallucination with good posture |
| Anything the anchoring gate quarantined | Its excerpt did not verify against the document |
| Anything below the threshold | — |

Bulk accept is **always scoped to one field**; passing candidates from another
throws. There is no accept-everything control anywhere in the product. The fee
exclusion reads `bulk_acceptable` from the field catalogue, so it is data rather
than a special case in the interface.

### Decisions are rows

Undo is therefore an **insert, not a delete** — the original decision stays on
the record and the trail is append-only. Each decision binds to the
`finding_attempt` it judged, without which an override silently re-binds to a
later proposal and the trail no longer records what the Analyst actually saw. A
flag without a reason and an override without a value are both refused **by the
database**, not by the form.

### Accessibility

This is the screen where a WCAG 2.1 AA claim will actually fail, so the
obligations are specific and verifiable in the rendered markup:

- **One tab stop with a roving index** — 109 rows render one `tabindex="0"` and
  108 at `-1`, never 2,590 tab stops
- The company cell is the **row header**, so every announcement is anchored to a
  company
- Each cell's accessible name carries value, evidence band and review state:
  `"Auditor, Deloitte, evidence medium, unreviewed"`
- Evidence is **never colour alone** — four ordinal bands, the numeric value in
  the cell, and the band word beside it
- A **polite live region** announces each decision and its consequence
- The evidence panel is a labelled `<section>` referenced by `aria-describedby`
  from the focused cell — **not a tooltip**, because tooltips are unreachable by
  keyboard and must never gate a value
- Single unmodified letters are suppressed while focus sits in a text input, or
  an Analyst typing an override fires three actions mid-word
- Touch targets at least 44×44; focus rings use the darkened green, never the
  brand green at 2.27:1

### Driving it

```bash
node scripts/seed_review_fixture.mjs ./period.db
```

Seeds a **synthetic** queue so the grid can be exercised — these are not model
outputs, and every row carries `prompt_version = 'synthetic-fixture'` so it is
distinguishable from a real proposal in a query.

## Dashboard views

Two rules shape all of them.

**Refuse to draw a chart that would lie.** With stage blank for 242 of 259 the
tier function returns one value for everyone and the chart renders a single
full-width bar: confident, well-formed, entirely false. An empty chart gets
ignored; a full one that is wrong gets believed. So a chart below its coverage
floor renders a **meter in the same footprint** — no layout jump — reading
*"Stage of operations: 17 of 259 researched (6.6%). This view unlocks at 95%."*
with a link into the filtered review queue. On the real period the tier chart
and the auditor chart are both meters today, and they are right to be.

**Every population chart carries a proof line**, computed at query time as a
passing or failing assertion:

```
121 + 61 + 12 + 7 + 5 + 53 = 259 ✓
```

This is the one genuinely good idea in the source workbook, and it is the thing
that would have caught the 258-versus-259 discrepancy on its own screen.

### Views that are named for what they compute

`producing mines by province` is **not** rebuilt. Property location and stage are
both recorded at company level with no link between them, so "producing mines in
province X" cannot be derived at any confidence — a producing company with
properties in three jurisdictions does not have a producing mine in all three.
Rebuilding it as named would count every exploration-stage property owned by a
producing company as a producing mine, and nothing on screen would say so. **The
broken reference at least announced itself.** It ships as *"Companies with
properties in each province or territory"*, which is computable today and true.

### Three things the views get right that the workbook does not

**The foreign-HQ bucket is visible.** 53 of 259 companies have no Deloitte market
and are disproportionately the large interlisted names. They render as an
explicit terminal bucket in the de-emphasis grey, always last, never sorted into
the ranking — and labelled "no Deloitte market", not "Other", because the
workbook already uses "Others" for three specific markets.

**Auditor share is an emphasis encoding**, not a categorical palette. The story
is not who audits what; it is how much of this market is not ours. *"Unknown"
is its own bar and is the longest* — that is the finding, not a gap to tidy away.

**Research completing is not migration.** A company moving from Unclassified to
tiered has had research done, not migrated. Counting it as movement would show
242 phantom upgrades on the view's debut. The first period renders an empty
state rather than a blank grid.

### Colour

Direction in the migration matrix uses a **separate fixed polarity scale**, not
the brand green: encoding direction as light-green against dark-green reads as
*magnitude*, making "moved down three tiers" look like "moved a lot" rather than
"moved the wrong way". It ships with an icon and a label always.

A green fill on white obliges a **relief channel**, so every bar carries a
visible direct value label. Chips are black on green, never white — white on the
brand green is 2.27:1.

## Hardening

### Colour is verified, not reviewed

The brand green measures 2.27:1 on white, and **the failure is invisible to
eye-checking** because large green fills look perfectly fine. So every token is
checked arithmetically against the floor it claims to clear:

```bash
npm run check:contrast
```

It also asserts the *forbidden* combinations still fail — white on the brand
green, and the brand green as text — so a well-meaning token change cannot
quietly make them legal. It found a real error on its first run: the design's own
token table listed the de-emphasis grey `#75787B` at "4.44:1 ✓", but 4.44 is
below the 4.5 text floor. Corrected to `#74777A` at 4.50:1, in the CSS and in the
design document.

### Five journeys, six routes

```bash
npm run e2e
```

Boots a real server against a database built by the real pipeline — parse,
commit, seed, publish — and behaves like a person: a Viewer signs in and reads
the dashboard, is refused the review workspace, an Analyst opens the grid, an
Analyst is refused the access review, and the cron endpoint rejects a missing
header, a wrong token and accepts the right one. It then asserts the named
accessibility obligations on six routes. 30 checks.

### Access review

There is **no leaver process** for an application outside Deloitte's own estate,
so `/access` shows every account with its last sign-in, flags anything unseen for
90 days or never used, and deactivates in one click. An Admin cannot deactivate
themselves — it is the single action that could lock every Admin out of the
screen at once. Every change is audited with actor and target.

### Retention

```bash
npm run retention -- ./period.db          # dry run
npm run retention -- ./period.db --apply --export-audit ./audit.jsonl
```

**It exits non-zero while any rule has no named owner**, because an unowned
retention rule is one nobody will notice failing. Two rules refuse outright
rather than doing damage: the audit log will not be trimmed without an export
path, since it is the one artifact that answers who published what; and expired
document *text* is cleared while the row is kept, because deleting the row would
orphan a finding's anchor and make an accepted value unverifiable after the fact.

### Runbook

[`docs/RUNBOOK.md`](docs/RUNBOOK.md) covers a stalled run, a spend halt, and a
changed source column — each with a diagnosis to run, a fix to apply, and a
"what not to do" that is the plausible wrong move.
