# Mining Whitespace Intelligence Tool — design document

**Status:** draft for review · **Date:** 2 September 2026
**Owners:** Kay Ampofo (workbook and domain) · Samuel Owusu (solution)

---

## Executive summary

Deloitte Canada's Mining & Metals practice maintains a workbook of every TSX and TSXV mining company above a market-cap threshold, assigning each a pursuit tier. **The quarterly refresh has stalled at one step: research.** Stage-of-operations flags are blank for 242 of 259 companies, so every company computes as Tier 4, every fee column is empty, and the dashboard is marked not updated with several broken references. The workbook's own instructions do not document the research step at all — the numbering skips it.

**The complication is worse than a stale file.** Reading the workbook cell by cell surfaced defects that would have been designed into any faithful replacement. The population is 144 TSX and 115 TSXV with **no third exchange** — the widely quoted "one other" is a phantom created by count formulas starting one row below the data and a constant that concealed the gap. More seriously, the matrix joins to its company list **by row position rather than by ticker**, so sorting the file silently reassigns a partner's research to a different company. And the footprint formula files roughly **$146 billion of royalty-company market capitalisation** as having a Canadian mining footprint that those companies do not have.

**The resolution is an application that makes the research step a review step.** It ingests the controlled source file, enriches each company against public sources with evidence attached, routes every proposed value through human acceptance, applies the existing tier rules unchanged, and publishes a frozen, immutable period to dashboards and back to Excel. Identity is ticker-based with alias history. Every AI value carries its sources and a verified excerpt, and a fee that cannot be traced to a filing the application itself retrieved is quarantined rather than shown.

**The tier rules themselves are correct and are implemented as written.** What changes is their inputs: stage becomes tri-state so "not researched" stops masquerading as "no", footprint gains the fourth value the source declares but never produces, and unclassified becomes an honest state rather than a silent Tier 4.

---

## How to read this document

| # | Section | Read it for |
|---|---|---|
| **[00](design/00-corrected-ground-truth.md)** | **Corrected ground truth** | **Start here.** What the files actually contain, and the six defects that change the design |
| [01](design/01-users-and-jobs.md) | Users and jobs to be done | Roles, the two journeys, the bottleneck |
| [02](design/02-scope-phases-non-goals.md) | Scope, phases and non-goals | What ships in Phase 1, and why fees are last |
| [03](design/03-system-architecture.md) | System architecture | Job ledger, batch enrichment, failure handling, idempotency |
| [04](design/04-ingestion-and-parsing.md) | Ingestion and parsing | Detection, header normalisation, identity ladders, validation report |
| [05](design/05-domain-model-and-schema.md) | Domain model and schema | DDL, the resolved-value table, access policies, audit |
| [06](design/06-enrichment-pipeline.md) | Enrichment pipeline | Routes, prompts, caching, the anchoring gate, evidence strength, cost |
| [07](design/07-classification-engine.md) | Classification engine | Tier rules, the two guards, truth table |
| [08](design/08-review-workspace.md) | Review workspace | Triage board, field-major review, keyboard loop, bulk-accept refusals |
| [09](design/09-dashboards-and-reporting.md) | Dashboards and reporting | Which views survive, coverage gating, colour tokens, queries |
| [10](design/10-excel-export.md) | Excel export | Template, column mapping, defects not to reproduce |
| [11](design/11-security-privacy-compliance.md) | Security, privacy, compliance | Personal data, licences, authorisation, cost as a control |
| [12](design/12-non-functional-requirements.md) | Non-functional requirements | Measurable replacements for four untestable targets |
| [13](design/13-testing-strategy.md) | Testing strategy | Fixtures, truth table, cassettes, the evaluation set |
| [14](design/14-delivery-plan.md) | Delivery plan | Six spikes, seven milestones, repository shape, RAID |
| [15](design/15-open-questions.md) | Open questions | Sixteen questions with owners and blocking status |
| [16](design/16-least-confident-decisions.md) | Least-confident decisions | The five I would most like challenged |
| [17](design/17-visual-system.md) | Visual system | Palette on white, the two faces, the footing, gauges, motion, print |
| [18](design/18-brand-guide.md) | Brand and interface guide | Dark-first with light available, the map as hero, the footing as signature, tokens in three layers, every component and chart, the application plan |

---

## Decisions at a glance

| Decision | Choice |
|---|---|
| Identity | Ticker-based identifiers **with validity intervals**, not a composite key — 98 rows show an exchange change |
| Background jobs | Postgres job ledger, stateless worker, tick split from work |
| Enrichment transport | **Batch API** — halves cost and removes the deadline problem |
| Enrichment shape | Model discovers sources; **the application fetches and caches**; code enforces the citation |
| Fee sourcing | Issuer-hosted documents first; the filing aggregator is **legally excluded** |
| Tier engine | Appendix C unchanged, plus two evidence guards and `footprint = none` |
| Effective values | One resolved table; precedence enforced in the database, not application code |
| Publish | Freezes an immutable snapshot; all dashboards read only that |
| Export | **Clean template**, not the uploaded workbook; defects not reproduced |
| Uploads | **Parse before persist**; raw bytes deleted, never archived |

---

## What this document does not do

It specifies no application code. Schema, JSON contracts, prompt structure, pseudo-code and diagrams are here; implementation is not.

It also does not settle sixteen open questions, of which **nine block Phase 1**. The first — whether risk and legal permit this hosting arrangement at all — has the longest lead time and no engineering mitigation, and should be opened on day one.

---

## A note on the source files

The two workbooks are **not committed to this repository.** Both carry third-party licence restrictions and embedded personal data: each records a named last modifier, the whitespace workbook contains cell comments authored by a named employee, and the screener export contains a sheet of named partners, client contacts and free-text notes on client responses. Section 11 sets out the handling; section 13 explains why test fixtures are synthesised rather than copied.
