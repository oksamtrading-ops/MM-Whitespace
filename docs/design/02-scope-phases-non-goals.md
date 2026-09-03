# Phase 1 makes the tier column trustworthy; everything else waits

## The phase boundary follows the bottleneck

Phase 1 exists to make one column correct: **tier**. Every capability that serves it is in; everything else waits. That is a narrower scope than "reproduce the workbook", and it is narrower deliberately, because the tier column is blank-equivalent today for 242 of 259 companies and nothing else in the workbook matters until it is not.

| | Phase 1 | Phase 2 |
|---|---|---|
| Ingestion, parsing, validation report | Yes | — |
| Identity resolution and manual merge | Yes | — |
| Enrichment: stage, regions, commodities, auditor, website, summary | Yes | — |
| Enrichment: audit and tax fees | **Fields and review only; automated population deferred** | Automated population |
| Human review, override, publish gate | Yes | — |
| Tier engine with rule trace and `Unclassified` | Yes | — |
| Core dashboards with coverage gating | Yes | — |
| Period comparison, entrants and drop-outs | Yes | — |
| Excel export and flat export | Yes | — |
| Pursuit workflow (activity, priority, notes, owners) | **Data model and access policy only** | Full workflow and interface |
| LSEG universe expansion | — | Yes |
| Property-level stage, producing-mine views | — | Yes |
| Financial metrics (revenue, net income, assets) | — | Yes |

## Enrichment priority order, and why fees come last

The brief's Appendix B lists fees third. They should be last, for four reasons that emerged from measuring the sources rather than from preference:

1. **Fees do not feed the tier logic.** Appendix C consumes stage and footprint only. Fee enrichment contributes nothing to the output that unblocks the dashboard.
2. **There is no baseline.** Every other field has partial ground truth in the extract — regions throughout, auditor for 143 rows, website for 143. Fee columns are empty for all 259 rows, so there is nothing to validate against and no way to detect regression between runs.
3. **The sources are the weakest and the stakes the highest.** A fabricated audit fee in front of a partner preparing a pursuit conversation is the worst output this system can produce.
4. **The primary source is legally excluded.** See below.

The order is therefore: **stage flags** — the actual complaint, 242 of 259 rows, and the only thing that unblocks tier — then **region validation**, then **auditor**, then website, commodities and summary, then **fees**.

## SEDAR+ is excluded on legal grounds, and the exclusion is broader than "cannot automate"

The filing aggregator that Appendix B names as the primary source for fee disclosure is unavailable to this application. Its terms of use prohibit automated **and manual** scraping, and separately condition permitted use on not storing the public information in a database. That second clause reaches the application's own document cache and evidence excerpts, so the obvious mitigation — an Analyst downloading a filing and uploading it — lands in the same restriction.

Two technical justifications that circulated during design are **wrong**, and are recorded here so nobody later "fixes" this the wrong way:

- The site's robots file does not block general crawlers. It names five search-engine bots.
- The JavaScript-rendering limitation is a property of one retrieval tool, not of the platform. A browser-based tool would render the page.

Neither observation matters, because the exclusion is legal rather than technical.

**The mitigation.** Filings are posted on essentially every reporting issuer's own investor-relations site, where the issuer's terms govern and the domain is one the fetcher already handles. Fee sourcing asks for an **issuer-hosted URL first**, falls back to the US filing system for the subset of issuers actually registered there, and falls back last to an Analyst-supplied document.

One caution on that middle path: trading on a US over-the-counter venue generally does **not** make a Canadian issuer a filer there. Of the venue spellings present in the extract, only three are registrant venues. The reachable subset is materially smaller than the 110 interlisted companies, and the design commits to fee coverage as **a floor with a named count**, never as a percentage of the population.

## Explicit non-goals

- **No live market data.** The source file remains a controlled, periodically uploaded artifact. Market capitalisation is as-of the extract date and is never refreshed between uploads.
- **No integration with Avantis, the CRM, or any Deloitte-internal system.** Fields sourced from them stay manually entered.
- **No automated outreach.** The application identifies and evidences opportunities; contacting anyone is out of scope permanently.
- **No headless-browser retrieval of the filing aggregator**, under any circumstances. Stated as a non-goal rather than a limitation so it survives a future performance conversation.
- **No reproduction of the workbook's arithmetic defects.** The export carries correct values. Section 10 records the expected "the numbers changed" question.
- **No public sharing.** No share links, no public dashboards. Both source licences restrict redistribution and the export is the artifact that leaves the building.

## What the empty-artifact scope decision removes, and what it does not

The client decision is that nothing empty in the source workbooks is designed into the application. Applied precisely:

**Removed** — the pursuit tracker's parser branch and its 19-row template; the two comments columns; the fee **source** columns' ingest path; the prior-tier columns' ingest path; the two empty divider sheets as data; the two empty vendor identifier columns.

**Not removed**, and each of these would be dropped by a careless reading:

| Kept | Why |
|---|---|
| Fee **fields**, review interface, export columns | Required outputs under Appendix B and the export contract. Only the ingest path goes |
| Pursuit **tables** in the data model | Required by constraint 7. They ship empty and still need access policies, because a table with no interface is reachable through the data API |
| Period comparison | Required by constraint 6. Its source is the application's own snapshots, not the empty prior-tier columns |
| The auditor tab's entity identifier | **Not empty** — 143 real IDs. Resembles the empty vendor columns; must be carved out explicitly |
| Divider sheets on **export** | The workbook's table of contents references them. Not modelled as data ≠ not written |

The cut removes perhaps a few days of work. Its most significant consequence is a cost, not a saving: with no fee source data there is **no golden fixture for fee parsing**, so hand-labelled fees from real filings become the sole truth source, and that labelling is real analyst effort that section 14 schedules explicitly.

Parser behaviour on an empty artifact: **skip silently** where emptiness is structural, **warn once** where it defeats a design assumption, **never fail**.
