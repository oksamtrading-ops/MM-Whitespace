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
