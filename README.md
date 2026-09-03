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

### Running the tests

```bash
python3 -m unittest discover -s tests
```

```bash
node --test 'src/**/*.test.ts'
```

The Node suite needs no dependencies — Node 24 runs TypeScript directly.

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
| `scripts/` | Parity check and the ground-truth regression |

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
