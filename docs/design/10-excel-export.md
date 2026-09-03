# Export to a clean template, and do not reproduce the defects

## The decision

**Generate a clean, version-controlled template. Return the uploaded workbook untouched alongside it.**

Writing back into the uploaded file fails on both fidelity and correctness.

**Fidelity.** No available library round-trips this workbook without loss. The conditional-formatting extension is dropped on load with a warning. The three charts are backed by style and colour parts outside any library's chart model. A legacy drawing part and roughly 84 add-in defined names are collateral. One tab contains a real table object whose range must be widened by hand if the row count changes. And the workbook uses a lookup function older engines cannot evaluate, so a headless recalculation cannot verify the output.

**Correctness.** A faithful round-trip re-emits the defects the application exists to fix.

The argument to give the practice: the uploaded workbook is an **input artifact**, not a deliverable. The application is now the system of record, and a template it fully controls is the only way to guarantee the proof totals tie.

## What the export must not reproduce

Every one of these is live in the current file and would be carried forward by a faithful copy.

| Defect | Effect if reproduced |
|---|---|
| Tier and exchange counts starting one row below the data, plus a compensating `+1` | Restores a phantom other-exchange company and misfiles a real one |
| One fee total dividing by a thousand while its four siblings divide by a million | **The Deloitte audit-fee total reads a thousand times high** the moment fees are populated |
| Two totals whose ranges are shifted a row | Silent undercount |
| Auditor counts matching only one spelling of a firm | Loses a Deloitte client and both companies under the alternate spelling of another firm |
| Market table labels not matching stored values | Two of five market rows return zero |
| Broken references in the financial-metrics block and two proof cells | Reintroduces `#REF!` |
| Nine cells beginning with a formula character | Formula injection on open |

**Expect "the numbers changed" as the first defect report.** The pre-written answer: the population is 144 TSX and 115 TSXV with no third exchange, and the prior figure was produced by a counting error plus a constant that concealed it. Section 0 carries the evidence.

## Template contents

Three data sheets plus provenance, and the divider sheets the table of contents references.

| Sheet | Contents |
|---|---|
| `Cover` | Period, as-of date, threshold and operator, publication identity, **both licence notices** |
| `A - Analysis >>`, `B - Supporting Schedules >>` | Empty dividers, reproduced because the table of contents links to them |
| `A.02 Matrix` | Master table, header rows 4–5, data from row 6, corrected proof block |
| `B.01 Consol TSX - TSXV` | Header row 7, exchange-then-name order preserved |
| `B.04 Auditor & Fees` | Header row 5 |
| `Provenance` | Source file hash, parse warnings, enrichment run identity, prompt version, FX rates used |

The pursuit tab is **not** written — it is empty in the source and out of scope. The comments columns are not written. The financial-metrics block is **omitted entirely** rather than exported empty, because an empty block invites someone to reattach a broken lookup.

## Column mapping

**Matrix**, by group and header rather than by letter, since four header names repeat across the two fee blocks:

| Column | Content | Written as |
|---|---|---|
| Tier | 1–6 or `Unclassified` | **Value**, with the rule trace as a cell comment |
| # | Row ordinal | Value — presentation only, never an identity key |
| Company, Exchange, Market cap, Head office | Resolved values | Value |
| DTT Market | Enum incl. explicit foreign value | Value |
| Exploration / Development / Production / Royalty | `X` or blank | Value |
| Canada vs Abroad, Properties in Canada?, Properties Abroad? | Derived | **Formula**, corrected |
| Region columns | Comma-separated, controlled vocabulary | Value |
| Deloitte Tax Client | `Yes` / `No` / blank for not-checked | Value |
| Auditor — Big 4 / Others | Canonical firm names | Value |
| Audit and tax fee blocks | Currency, amount, CAD, fiscal year, ratio | **Values, mostly empty** — headers and formats written, no data. In-scope enrichment targets whose omission would break the client's column mapping |
| Website | URL only; titles are not written as URLs | Value |
| **PY Tier, Same?** | **Computed from the prior published snapshot** | **Value** |

The prior-tier columns are a **deliberate departure** from the empty-artifact scope cut: they are the one empty block the application can genuinely fill, and period comparison is a Phase 1 requirement whose source is the application's own snapshots. Section 15 records this for Kay's confirmation.

**Consolidated list** — the eighteen columns in source order, including the **unnamed spacer column** between the last region and the properties questions, so column letters remain stable for anyone with a downstream reference. Exchange-then-name ordering is preserved, since the source is stored as two alphabetical blocks.

**Auditor tab** — the thirteen columns in source order. The entity identifier is written where known. The comments column is not written; comments live in the decisions table with an author and a timestamp, which is the thing being replaced.

## Values versus formulas

**Values** for everything the application owns: extract-sourced fields, enriched fields, manual fields, and the tier itself. Tier is computed and unit-tested server-side; re-deriving it in a spreadsheet reintroduces the nested condition this project is removing.

**Formulas** only where the sheet should stay live for a user who edits a cell: the derived footprint trio, and the proof and count tables. Written with **corrected ranges starting at the first data row and no compensating constants.**

**Never written:** any function newer than the 2007 vocabulary. Use index-and-match rather than the modern lookup, so a headless recalculation remains viable as an automated check on the export.

## Formula injection

Nine cells in the source already begin with `@`. Analyst overrides are free text, and evidence excerpts are model-generated strings taken verbatim from third-party pages — so whoever controls an issuer's investor-relations page controls a string the application writes into a partner's spreadsheet.

**One writer helper handles every cell in every export path.** A string beginning with `=`, `+`, `-`, `@`, tab or carriage return is written as an inline string with the quote-prefix flag set. That is lossless for the legitimate `@`-prefixed date labels, unlike prefixing an apostrophe into the value itself. Control characters are stripped and string lengths capped at the writer rather than trusting the model to respect a limit.

## FX conversion

Fees convert at the rate for the period's month end. **There is no nearest-date fallback.** Where no rate exists, the CAD amount is null, the status records the reason, and the export writes a blank cell with a comment naming the missing currency and date. A silent fallback is exactly how a two-year-old rate ends up in a fee total, and the workbook's own rate table — stale by 22 months, with one empty month and one missing — is why this needs stating.

Every converted value stores the rate identifier used, so the export can prove which rate produced which figure. The workbook's rate blocks are never a conversion source.

## Flat export

A single denormalised table as CSV and XLSX: one row per company, resolved values, tier and status, footprint, evidence strength and review state per enriched field, source URLs, and period metadata. Same injection guard, same licence notices in the header.

## Licence notices travel with the artifact

The export is the redistribution event, not the server. Both notices — the exchange's for extract-derived columns and the data vendor's where screener-derived columns are present — are written to the cover sheet and into the CSV header, and appear on any printable dashboard view. "Internal use only" is a property of the artifact, and every export is audited with actor and row count so the question of who took data out is answerable.
