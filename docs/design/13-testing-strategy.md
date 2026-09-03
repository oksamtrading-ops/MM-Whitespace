# The real workbook cannot be a fixture, and the upstream cannot be called in CI

Two constraints shape everything below, and both are easy to discover too late.

**The real workbook cannot be committed.** It carries a no-redistribution notice, a named employee in its cell comments, and a named last modifier. That will be discovered the day someone stages the reference folder. Fixtures are therefore **synthesised structural derivatives** — real shape, fake values — generated once by a documented script run locally against the private file, then committed. The real workbook lives in a private bucket and is exercised by a nightly job outside continuous integration.

**The upstream is paid and non-deterministic.** Calling it in the pipeline spends real money and produces flaky assertions.

## Golden-file parser fixtures

| Fixture | Asserts |
|---|---|
| `whitespace_full_v1.xlsx` — 12 data rows, all 13 sheets including both very-hidden caches, both dividers, the hidden tab | Type detected by signature; header rows located; **the dividers, caches and hidden tab never appear in output**; comments and document properties stripped |
| `tsx_extract_only.xlsx` — copyright rows, header row 10 | Notice rows skipped rather than parsed as data; columns mapped **by name**; commodity flags become booleans |
| `tsxv_extract_only.xlsx` — with the extra identifier column and the collapsed interlisting column | **Identical logical output to the TSX fixture despite the non-uniform column shift.** This is the test that proves name-based mapping |
| `duplicate_headers.xlsx` — the four repeated fee-block header names | Compound group-plus-header key resolves; a genuine duplicate blocks with both column letters named |
| `header_date_variants.xlsx` | Period date parsed from a newline-separated header, a space-separated one, and **blocked** when absent — never silently null |
| `autofilter_threshold.xlsx` | **All rows read regardless of hidden state**; the filter criterion reported; the application's own threshold applied |
| `region_carry_forward.xlsx` | A value present in the prior period and absent from the extract is **carried forward, not nulled**, and warned per company |
| `normalisation.xlsx` | Trailing spaces folded; both spellings of one firm folded; the non-Big-4 firm in the Big-4 column reclassified; the four sentinels including **numeric zero** all become null with distinct reason codes; region lists split; page titles routed away from the URL field |
| `screener.xlsx` — including a synthetic person-data sheet | Venue suffixes mapped; the inactive-instrument marker stripped **conditionally**; **the person-data sheet is absent from output because it was never read** |
| `formula_injection.xlsx` | Company name, summary, excerpt and override each beginning with an interpretable character all round-trip quote-prefixed, with no formula outside the allowlisted cells |
| `zip_bomb.xlsx`, `macro.xlsm`, `external_link.xlsx`, `entity_probe.xlsx` | Rejected with a typed reason **before any sheet is read** |
| `perf_1600_rows.xlsx` | p95 ≤ 8 s, peak memory ≤ 512 MB |

Cross-cutting assertion on every fixture: no output value begins with an interpretable character without its quote-prefix marker, and the validation report enumerates ignored sheets and columns **with their non-empty cell counts**.

## Tier truth table

The function is total over 16 stage combinations by 4 footprints by 3 evidence states. **Enumerate all 64 stage-footprint pairs** in a table-driven test, asserting tier, status, **the trace**, and a divergence flag. Section 7 lists the cases including the three that deliberately diverge from the workbook.

A property test asserts the function never throws, always returns a trace, and always returns either a tier in range or an unclassified status.

A **parity test** runs the function across all 259 real rows and asserts the difference from the workbook's own column equals exactly the known-divergent set. It runs nightly against the private file, never in the pipeline.

## Enrichment contract tests

The schema is defined once and both the TypeScript types and the schema handed to the model derive from it, so the two cannot drift.

A corpus of at least 30 **recorded real responses**, captured during the week-one spike and committed, deliberately including bad ones: a missing evidence field; an out-of-range value; an over-length excerpt; empty sources on a fee; a non-HTTPS URL; a region outside the vocabulary; a malformed currency; a fee as a comma-separated string; JSON truncated at the token limit; a tool-use block where content was expected; and **a well-formed response whose fee does not appear in the source text**.

Every rejection must produce a typed error and a **quarantined finding row** — never a thrown 500 and never a silent drop. Assert the job ends with errors and the company shows as research-incomplete in review.

## Calling a paid upstream without spending in CI

- **One port.** Nothing outside the client module imports the vendor SDK. The job state machine, schema validation, grounding gate, ledger and retry logic are all tested against a fake.
- **Three modes** — live, record, replay — with **replay as the pipeline default**. Cassettes store the request hash, full response, usage and stop reason.
- **The cassette key includes the prompt version**, so a prompt change invalidates cassettes and forces a deliberate re-record rather than silently testing yesterday's prompt.
- **A network guard** installs an interceptor that throws on any egress to the vendor host, so a missing cassette fails loudly instead of quietly spending money.
- **Fail the build if an API key is present** in the test environment. Only the nightly evaluation job holds one, against a separate budget-capped workspace.
- **Synthetic failure cassettes** cost nothing and cover what live testing cannot schedule: the tier spend cap as a 429, **the self-set spend limit as a 400**, an overloaded response, a connection reset mid-stream, truncated JSON, a tool loop that never terminates, and a refusal returned as a success.

Assertion discipline: never assert on model prose. Assert on schema validity, routing decisions, ledger state, retry counts and run state. Quality is judged only by the evaluation set, which is not a merge gate.

## The evaluation set is stratified, and it is not a precision estimate

Random sampling would yield almost no royalty companies, almost no foreign-headquartered ones, and essentially no fee case with obtainable ground truth. At 25 companies the interval on a per-field estimate is roughly ±20 points, so **any headline accuracy number is noise** — the design must say so before someone reports one.

| n | Stratum | Tests |
|---|---|---|
| 4 | Large producers registered in the US | The control that should be perfect; the only cheap fee ground truth |
| 4 | Mid-cap producers, Canada-only, not US-registered | The modal Tier 1–2 case |
| 4 | Venture juniors, exploration only, not interlisted | The modal hard case — most of the venture cohort |
| 3 | Production **and** development simultaneously | The multi-select the tier logic depends on |
| 3 | Royalty: two without properties, one **with** | `footprint = none`, and the five-company exception |
| 2 | Foreign HQ with Canadian properties | The blank-market case |
| 2 | Recent rename or ticker change | Identity and alias handling |
| **2** | **Known-negative fee controls** — the right answer is "no retrievable disclosure" | **The only measurement of the fabrication rate**, which is what the whole guard exists for |
| 1 | French-language filer | Bilingual label lists |

Per-field gates:

| Field | Metric | Gate |
|---|---|---|
| Stage flags | Exact-set match, plus per-flag recall | Set match ≥ 0.80; **production recall ≥ 0.95** — a missed producer moves a company several tiers and is the most consequential error the system can make |
| Regions | Jaccard against gold, macro-averaged | ≥ 0.90 |
| Commodities | Jaccard | ≥ 0.85 |
| Auditor | Accuracy, abstention counted separately | ≥ 0.95 on answered |
| **Fees** | **Coverage and precision reported separately**; correct only if amount, currency and fiscal year are all right | Precision ≥ 0.98. **Coverage is measured, not targeted** — it is the number that decides whether fee dashboards are deliverable |
| Website | Registrable-domain match | ≥ 0.95 |
| Summary | Analyst rubric on a sample | Mean ≥ 4 of 5 |
| **Evidence calibration** | Accepted rate by decile | Monotone, with the top decile above the accept threshold. **Bulk-accept ships only after this passes**, and the default threshold is read off the curve |

Two labellers on the fee cases, with the disagreement rate recorded — if humans disagree a fifth of the time, no model target above that is meaningful. **Freeze the set before prompt tuning** and draw a second held-out sample for the acceptance gate, or the tuning overfits. Any per-stratum cell of two or three is an anecdote, not a statistic.

Runs nightly and on prompt-version change, never on a pull request.

## End-to-end journeys

Five, headless, two engines. **Sessions are minted in setup rather than driving the sign-in email**, or every run depends on an inbox.

1. **Upload, validate, commit** — assert the report's counts, ignored sheets and zero errors; worker disabled, jobs asserted queued.
2. **Review loop** — filter to low evidence, accept three by keyboard only, override one with a reason, assert counters and audit rows.
3. **Publish gate** — attempt with unresolved findings and get the specific block; resolve and publish; assert dashboard totals equal a SQL fixture. This one test covers the gate, the snapshot and the rollup.
4. **Export** — download, open in-process, assert column order and that the injected cell is quote-prefixed.
5. **Authorisation negative** — as a Viewer: controls absent, a direct publish call returns forbidden, and the middleware-bypass header still returns forbidden.

Not worth their maintenance: chart pixel comparison, a browser test per file variant (that belongs at the parser layer where it runs in milliseconds), a third engine, and anything that waits on a real enrichment run.

## What the scope cut changes in the test surface

It removes roughly one fixture, one export mapping block and the vendor-identifier merge path. It does **not** remove: the fee fields, which still need export and review coverage but now have **no golden fixture**, so hand-labelled fees are the sole truth source; the negative assertions that empty artifacts are skipped, since not ingesting something is a behaviour; or the access-policy tests on the empty pursuit tables, which are reachable through the data API despite having no interface.
