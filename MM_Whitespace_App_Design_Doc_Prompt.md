# Claude Code Prompt — Design Document for the Mining Whitespace Intelligence Application

> **How to use this file.** Create a new repo folder, copy `MM  Whitespace Analysis Q32026.xlsx` and `Canada Mining Company Screen 4302026.xlsx` into `./reference/`, drop this file in the root, then open Claude Code and paste the block under **"Prompt"**. The appendices are the ground truth I extracted from the workbooks — Claude Code should read them and the workbooks themselves rather than guess at the structure.

---

## Prompt

You are acting as a senior solution architect and product engineer. Your task in this session is to produce a **complete design document** for a web application called the **Mining Whitespace Intelligence Tool** — not to write application code yet. Work in plan mode. Read every file referenced below before writing. Where this brief is silent, make a recommendation, state it as an assumption, and list it in the Open Questions section — do not silently pick.

### 1. Context

Deloitte Canada's Mining & Metals (M&M) tax and advisory practice maintains an Excel workbook, `reference/MM  Whitespace Analysis Q32026.xlsx`, that lists every mining company listed on the TSX or TSXV with a quoted market value ≥ CAD $200M (259 companies as of the current version: 143 TSX, 115 TSXV, 1 other). For each company the workbook records exchange, market cap, head-office location, Deloitte market, property locations by world region, stage of operations, auditor, audit and tax fees, and whether the company is already a Deloitte tax client. A nested-IF formula assigns each company to one of six pursuit **tiers**, and a dashboard tab summarizes the population by tier, market, auditor and jurisdiction. A hidden "Selected Targets" tab captures the shortlist and pursuit notes.

The workbook is refreshed manually each quarter (see the `Instructions` tab): pull the TSX/TSXV mining issuer lists, paste into tabs B.02/B.03, filter to ≥ $200M, update B.01, update auditor and fee data from Avantis/SEDAR+, then research each company's stage and footprint and fix the Matrix. That research step is the bottleneck. In the current file, the stage flags (Exploration / Development / Production / Royalty-Streaming) are blank for 242 of 259 companies, every company therefore defaults to Tier 4, the audit- and tax-fee columns are entirely empty, and the Dashboard tab is marked "TAB NOT UPDATED" with several `#REF!` errors.

A second source, `reference/Canada Mining Company Screen 4302026.xlsx`, is an LSEG Workspace screener export of 1,497 Canadian-headquartered mining companies (RIC identifier, name, NAICS group, market cap, province; 41 rows flagged "Recorded as lead"). It is a broader universe than the TSX extract and uses different name conventions (e.g. "Agnico Eagle Mines Ltd" vs "Agnico Eagle Mines Limited"), so it must be matched by ticker and fuzzy name.

The meeting between Kay Ampofo (workbook owner) and Samuel Owusu (solution owner) decided: build a web application that accepts an uploaded source file, automatically researches and classifies each company using AI against public sources, fills the blank fields, applies the existing tier logic, produces a consolidated dataset, and provides dashboards. Enrichment and classification come first; dashboards second. The source file stays a controlled, periodically uploaded file — no live market-data feeds.

### 2. Decisions already made (treat as constraints)

1. **Canonical input** is the full Whitespace workbook (all tabs). The app must also accept a raw TSX/TSXV issuer extract (the B.02/B.03 shape) and, as a secondary/optional input, the LSEG screen export. Detect which one was uploaded.
2. **Enrichment engine**: Anthropic Claude API with web search / web fetch, restricted to public sources — company websites, SEDAR+ filings (AIF, MD&A, financial statements, management information circulars for audit-fee disclosure), NI 43-101 technical reports, press releases, exchange profile pages. Avantis and any Deloitte-internal system are **out of scope for automation**; those fields stay manually entered.
3. **Stack**: Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Storage, Row Level Security) deployed on Vercel. Background enrichment jobs must survive Vercel function time limits — propose the mechanism (e.g. Supabase Edge Functions / queue table + cron, Vercel background functions, or Inngest/Trigger.dev) and justify it.
4. **Hosting model**: cloud-hosted pilot for a small group of Deloitte users outside Deloitte infrastructure. Email/password or magic-link login. Named users with roles **Admin / Analyst / Viewer**. Design so a later move to Deloitte Azure with SSO is a configuration change, not a rewrite.
5. **Human-in-the-loop review**: every AI-enriched value carries a confidence score, the source URLs and the supporting excerpt. An Analyst accepts, overrides or flags each value (or bulk-accepts above a threshold) before the period is **published** to the dashboard. Overrides are never overwritten by a later enrichment run.
6. **Versioned periods**: each upload creates a period snapshot. The app shows prior-period tier vs current tier ("PY Tier" / "Same?" in the workbook), new entrants and drop-outs, and lets a new period inherit accepted values from the prior one so research is incremental.
7. **Pursuit workflow (Selected Targets)** — CRM activity, LCSP, FY tax NSR, pursuit priority, notes, action items, owner — is **Phase 2** but must be in the data model and the information architecture now.
8. **Excel export** back into the workbook's own layout (A.02 Matrix columns, B.01, B.04) so the existing workbook and its formulas keep working, plus a flat CSV/XLSX of the consolidated dataset.
9. **Market-cap threshold** is a per-period parameter (default CAD $200M). Note the workbook is internally inconsistent — Cover says ≥ $200M, Dashboard labels say ≥ $50M — the parameter resolves this.
10. **Visual design**: Deloitte styling — Deloitte signature green (#86BC25) on black/white with cool greys, Open Sans or the closest web-safe equivalent, restrained data-dense layouts. Confirm exact tokens against Deloitte's brand site before implementation; do not invent a palette.

### 3. What the design document must contain

Produce `docs/DESIGN.md` (split into `docs/design/*.md` if it exceeds ~2,500 lines) with these sections. Use sentence-style headings that state the point. Lead each section with the decision, then the rationale. Prefer tables and diagrams (Mermaid) over prose where structure helps.

1. **Executive summary** — situation, complication, resolution in under 200 words.
2. **Users and jobs to be done** — Admin, Analyst (runs uploads, reviews enrichment), Viewer (partners/practice leads consuming dashboards). Include the quarterly refresh journey end-to-end and the "prep for a pursuit conversation" journey.
3. **Scope, phases and non-goals** — Phase 1: ingestion, enrichment, review, tiering, core dashboard, export. Phase 2: pursuit workflow, period comparison views, LSEG universe expansion. Explicit non-goals (no live market data, no Avantis/CRM integration, no automated outreach).
4. **System architecture** — component diagram, request flows for upload → parse → enrich → review → publish → dashboard/export, background-job design, failure handling and retries, idempotency (re-running enrichment must not duplicate or clobber accepted values).
5. **Ingestion and parsing specification** — for each accepted file type: how to detect it, where the header row is (it is *not* row 1 — see Appendix A), column-name-based (not position-based) mapping, normalization rules (trim, case, "Deloitte " with trailing space, "PWC" vs "PwC", "Not found"/"N/A" sentinels, ticker roots, province codes), validation report shown to the user before commit, and how companies are matched across uploads and sources (ticker + exchange as primary key, fuzzy name as fallback with a manual-merge UI).
6. **Domain model and Supabase schema** — DDL-level detail: `periods`, `companies` (stable identity across periods), `company_period_facts` (raw extract values), `enrichment_runs`, `enrichment_findings` (field, proposed value, confidence, sources[], excerpt, model, prompt version), `review_decisions`, `tiers` (computed, with rule-trace), `auditors`, `fx_rates`, `users`/`roles`, and the Phase-2 `pursuits` tables. Show RLS policies per role. Show which columns are *extract-sourced*, *AI-enriched*, *manually entered*, or *derived*.
7. **Enrichment pipeline design** — this is the core of the product; be thorough:
   - Per-company research agent: inputs (name, ticker, exchange, website if known, HQ, existing region columns), the ordered list of sources to consult, the exact fields it must return and their allowed values (Appendix B), a strict JSON output schema with per-field confidence (0–1), source URL(s), and a ≤ 300-character evidence excerpt.
   - Fields to enrich, in priority order: (a) stage of operations — Exploration / Development / Production / Royalty-Streaming, multi-select, with the reasoning that a company can be Production *and* Development; (b) validation/completion of property locations by region (the extract already provides these — the agent confirms, and proposes additions with evidence); (c) principal commodities; (d) auditor name and Big-4 classification; (e) audit fees and tax fees paid to the auditor, currency and fiscal year, from the management information circular / proxy; (f) company website; (g) a two-sentence company summary. Note that "Deloitte Tax Client" is internal knowledge and is manual-only.
   - Prompt design: system prompt, tool definitions, few-shot examples drawn from real workbook rows, guardrails against hallucinated fees (must cite a filing), handling of companies with foreign HQ, dual listings, and recent name changes (e.g. Barrick Gold → Barrick Mining).
   - Throughput and cost: batching, concurrency limits, caching of fetched pages per period, estimated tokens and dollars per company and per 260-company period, model choice per step (cheaper model for extraction, stronger model for classification), and a re-run policy (only re-research fields that are unreviewed or older than N days).
   - Observability: per-run logs, per-field acceptance rates, and a way to replay a single company.
8. **Classification engine** — implement the tier rules in Appendix C as a pure, unit-tested function with a rule trace ("Tier 3 because Production = X and footprint = Abroad"). Flag the workbook's silent Tier-4 catch-all: propose an explicit **Unclassified** state for companies with no stage evidence and ask Kay to confirm. Also flag that a company with *no* properties in any region column computes as "Canada only" under the workbook formula.
9. **Review workspace UX** — table of companies × enriched fields with confidence heat-mapping, filters (unreviewed, low confidence, tier changed vs prior period, conflicts between extract and AI), side panel with sources and excerpt, keyboard-driven accept/override, bulk actions, audit trail of who changed what. Wireframes as Mermaid or ASCII are fine.
10. **Dashboard and reporting** — reproduce every view on the A.01 Dashboard tab (Appendix D) and improve on it: population counts with proof totals, tier distribution, head office by Deloitte market, producing mines by Canadian province and by key jurisdiction, auditor share and fee totals by firm, Deloitte clients by tier × market, tier migration vs prior period. Specify each chart's data query. Follow data-visualization leading practice (single accent palette, no 3-D, labelled axes, accessible contrast).
11. **Excel export specification** — column-for-column mapping to A.02 Matrix, B.01 and B.04 (Appendix A), which cells are values vs formulas, and how FX conversion to CAD is applied using the `fx_rates` table.
12. **Security, privacy and compliance** — data classification (public company data plus Deloitte-internal client flags and pursuit notes), RLS, secrets handling, TSX data licence note (the extract carries a TSX Inc. copyright/no-redistribution notice — the app is internal use only), API-key and cost controls, audit logging, data retention.
13. **Non-functional requirements** — upload of a 300-row workbook parses in < 10 s; a full-period enrichment completes within a stated target; dashboard queries < 1 s; browser support; accessibility to WCAG 2.1 AA.
14. **Testing strategy** — golden-file tests for the parser using the real workbook, unit tests for the tier function against Appendix C truth table, contract tests for the enrichment JSON schema, evaluation set of ~25 hand-labelled companies to measure enrichment precision per field, Playwright end-to-end for upload → review → publish → export.
15. **Delivery plan** — milestones for Phase 1 with what is demonstrable at each, suggested repo structure, environment setup (Supabase project, Vercel, Anthropic API key), and a RAID log.
16. **Open questions** — each tagged with an owner (Kay, Samuel, engineering) and whether it blocks Phase 1.

### 4. Working instructions

- Read `reference/MM  Whitespace Analysis Q32026.xlsx` with openpyxl (or the `xlsx` skill if available) **before** writing. Confirm the facts in the appendices against the file and note any discrepancy.
- Read `reference/Canada Mining Company Screen 4302026.xlsx` and confirm the header row and identifier format.
- If these skills are available in your environment, apply them: `vercel-react-best-practices` (Next.js patterns), `frontend-design` and `web-design-guidelines` (UI), `dataviz` (charts), `webapp-testing` (Playwright), `xlsx` (parsing/export), `deloitte-voice` (document tone). If they are not available, proceed without them.
- Ask me clarifying questions **before** drafting only if a decision materially changes the architecture; otherwise record assumptions and continue.
- Do not write application code in this session. Pseudo-code, schema DDL, JSON schemas, prompt drafts and Mermaid diagrams are expected.
- Finish by summarizing the five design decisions you are least confident about.

---

## Appendix A — Source workbook structure (verified against the file)

### `MM  Whitespace Analysis Q32026.xlsx`

| Tab | State | Purpose | Notes |
|---|---|---|---|
| Cover | visible | Title, "Last updated on August 7, 2026", table of contents | Data as of May 31, 2026 |
| Instructions | visible | Manual quarterly refresh steps | Sources: tsx.com mining sector profile; Capital IQ M&M dashboard; Avantis audit-fee search (Deloitte login); SEDAR |
| A.01 Dashboard | visible | Summary tables + 3 charts (2 bar, 1 pie) | Marked "TAB NOT UPDATED"; several `#REF!` |
| A.02 Matrix | visible | Master analysis table, rows 6–264 (259 companies), proofs and lookup tables rows 270–313 | Header rows 4–5; data starts row 6 |
| A.03 Selected Targets | **hidden** | Shortlist / pursuit tracker | Columns: Company, Tier, Market cap, Auditor, Tax Fees, Producing Properties, Recent CRM Activity, LCSP, FY25 Tax NSR, Pursuit Priority, Notes (group discussion), Action Items |
| B.01 Consol TSX - TSXV | visible | Consolidated list ≥ $200M, rows 8–266 | Header row 7 |
| B.02 TSX MM Issuers June 2025 | visible | Raw TSX extract (181 rows) | **Header row 10**; TSX copyright notice rows 1–3 |
| B.03 TSXV MM Issuers June 2025 | visible | Raw TSXV extract (899 rows) | **Header row 10**; column layout differs from B.02 |
| B.04 Auditor & Fees | visible | Auditor + fee capture, rows 6–264 | Header row 5 |
| `__snloffice`, `_CIQHiddenCacheSheet` | very hidden | Capital IQ add-in caches | Ignore |

**A.02 Matrix columns (row 5 headers, groups in row 4):**

| Col | Header | Source | Notes |
|---|---|---|---|
| B | Tier | formula | See Appendix C |
| C | # | formula | Row index, joins to B.01 col B |
| D | Company | VLOOKUP B.01 | |
| E | Exchange | VLOOKUP B.01 | TSX / TSXV; proof table also lists NYSE, SHSE, AIM, ASX, NASDAQCM, NYSEAM, OTCQB, OTCQX, OTCPK, BVC, LSE, TSE, BOVESPA |
| F | Marketcap (in CAD) | VLOOKUP B.01 | Range in file: 201.7M – 126.9B |
| H–K | Total Revenue, Net Income, Total Assets, Period Ended (USD thousands) | broken `#REF!` VLOOKUPs | Formerly Capital IQ; treat as optional Phase-2 enrichment |
| M | Head Office | VLOOKUP B.01 | Province code or country |
| N | DTT Market | manual | Mapping: BC→British Columbia; ON→Ontario; QC→Quebec & NCR; AB, SK→Prairies Region; NS, NL→Atlantic; foreign HQ→blank (except "Chile" typed once) |
| P, Q, R, S | Exploration, Development, Production, Royalty / Streaming | **manual "X"** | Blank for 242/259 rows; only S has 17 X's |
| U | Canada vs Abroad | formula | `Canada & Abroad` if V=Yes and W=Yes; `Abroad` if V=No and W=Yes; else `Canada only` |
| V | Properties in Canada? | formula | Yes if AB non-empty |
| W | Properties Abroad? | formula | Yes if any of Y, Z, AA, AC, AD, AE, AF non-empty |
| Y–AF | AFRICA, ASIA, AUS/NZ/PNG, CANADA, LATIN AMERICA, OTHER, UK/EUROPE, USA | values from TSX extract | Comma-separated countries, or province/state codes for CANADA and USA (e.g. "NU, ON"; "AK, NV, SD") |
| AI | Deloitte Tax Client Yes / No | manual | Filled for 29 rows (28 Yes, 1 No) — internal knowledge |
| AK | Auditor – Big 4 Firms | XLOOKUP B.04 | Values seen: Deloitte, PwC, KPMG, Ernst & Young, Other, "Other " (trailing space), "Deloitte " (trailing space), Not found, N/A |
| AL | Auditor – Others | XLOOKUP B.04 | Firm name when AK = Other (Davidson & Company, MNP, Grant Thornton, Crowe MacKay, BDO, Zeifmans, D+H Group…) or 0 |
| AN–AQ | Audit fees: Currency, Fees, Fees in CAD, Fiscal Year | manual | **All empty** |
| AS–AW | Tax fees paid to audit firm: Currency, Fees, Fees in CAD, Fiscal Year, Ratio | manual | **All empty** |
| AY | Company's Website | XLOOKUP B.04 | Sometimes a page title rather than a URL |
| BA | Comments | manual | empty |
| BC, BD | PY Tier, Same? | manual | empty — intended period comparison |

**Proof / lookup tables at the bottom of A.02:** stage counts (row 273), auditor counts and fee sums by firm (rows 273–279, note `COUNTIF(...,"PWC")` is case-insensitive), FX rates (rows 273–284: USD, AUD, EUR, GBP → CAD, Bank of Canada month-end rates), tier counts (rows 287–293 — includes a hard-coded `+1` fudge on Tier 6), exchange counts (rows 288–305), auditor × tier matrix (rows 293–302), Deloitte clients and fees by market (rows 307–313).

**B.01 columns (header row 7):** #, Ticker, Name, Exchange, Market Capitalization (CAD $), HO Location, HO Region, Royalty / Streaming (Y/N), AFRICA, ASIA, AUS/NZ/PNG, CANADA, LATIN AMERICA, OTHER, UK/EUROPE, USA, Properties in Canada?, Properties Abroad?

**B.02 TSX extract columns (header row 10):** Co_ID, Exchange, Name, Root Ticker, Market Cap (C$) 31-May-2026, O/S Shares, Sector, Sub Sector, HQ Location, HQ Region, Listing Type, Listing Date (yyyymmdd integer), Interlisted I, Interlisted II, Trading on OTC, TSX Venture Grad, Former CPC, S&P/TSX Index, 2025 TSX30, USA City, Asia Region, Volume YTD, Value (C$) YTD, Number of Trades YTD, Number of Months of Trading Data, then region columns AFRICA, ASIA, AUS/NZ/PNG, CANADA, LATIN AMERICA, OTHER, UK/EUROPE, USA, then commodity flags (Y): Oil and Gas, Gold, Silver, Copper, Nickel, Diamond, Molybdenum, Platinum/PGM, Iron, Lead, Zinc, Rare Earths, Potash, Lithium, Uranium, Coal, Tungsten, Base & Precious Metals, Royalty Streaming, Other Properties.

**B.03 TSXV extract columns (header row 10):** same family but with an extra `PO ID` column after Co_ID, `Interlisted` (single), `CPC/Former CPC`, `S&P/TSX Venture Composite Index`, `2026 Venture 50` — so every column after Name is shifted; map by header name, never by letter. The market-cap header embeds the as-of date ("Market Cap (C$)\n31-May-2026") — parse the date out of it and use it as the period's as-of date.

**B.04 columns (header row 5):** #, Company, Entity ID (S&P), Big 4 Firms, Others, Audit_Currency, Audit_Fees, Audit_Fiscal Year, Tax_Currency, Tax_Fees, Tax_Fiscal Year, Website, Comments / Issues. Entity ID and auditor are "Not found" for 116 of 259 rows; fee columns empty for all rows; Website filled for 143.

### `Canada Mining Company Screen 4302026.xlsx`

| Tab | Purpose |
|---|---|
| Screen Parameters | Two embedded LSEG Workspace screenshots. Screen 1: Country of HQ = Canada AND NAICS Industry Group ∈ {Coal Mining, Metal Ore Mining, Nonmetallic Mineral Mining and Quarrying} AND Market Cap ≥ 0 → 1,378. Screen 2: TRBC Economic Sector = Basic Materials AND TRBC Industry ∈ {Diversified Mining, Gold, Specialty Mining & Metals, Mining Support Services & Equipment, Non-Gold Precious Metals & Minerals, Iron & Steel, Aluminum…} AND Country = Canada → 1,414. Union = 1,497 unique. Currency CAD. As of 2026-04-30. |
| Mining Screen | Header row 4. Columns: Identifier (RIC, e.g. `AEM.TO`, `ABX.TO`, `.V` = TSXV, `.CD` = CSE, `.PK` = OTC), Company Name, Country of Headquarters, NAICS Industry Group Name, Market Cap, HQ Address State Province (upper-case full name), Column1 ("Recorded as lead" on 41 rows). Side tables: total count and count by province. 1,455 rows have a numeric market cap; 227 are ≥ $200M; 458 ≥ $50M. |
| Sheet1 | Unrelated Calgary/Edmonton client event tracker — ignore. |

---

## Appendix B — Enrichment field dictionary (allowed values)

| Field | Type | Allowed values / format | Source hierarchy |
|---|---|---|---|
| stage_exploration, stage_development, stage_production, stage_royalty_streaming | boolean each (multi-select) | true/false | AIF "Description of Business", MD&A, latest NI 43-101, corporate website "Projects/Operations" page, TSX "Royalty Streaming" flag |
| properties_by_region | map of region → list | Regions exactly: AFRICA, ASIA, AUS/NZ/PNG, CANADA, LATIN AMERICA, OTHER, UK/EUROPE, USA. Values: country names; for CANADA and USA use 2-letter province/state codes | TSX extract first (authoritative), then AIF/website to confirm or add |
| footprint | derived enum | Canada only / Abroad / Canada & Abroad / None | derived from properties_by_region |
| commodities | list | from the TSX commodity flag vocabulary in Appendix A | TSX extract, then website |
| auditor_name, auditor_big4 | string, enum | Deloitte / PwC / KPMG / EY / Other / Unknown | Most recent audited financial statements or AIF |
| audit_fees, audit_fees_currency, audit_fees_fiscal_year | number, ISO-4217, integer | | Management information circular / proxy "Audit Committee" or "External Auditor Service Fees" section; AIF Appendix; U.S. 10-K/40-F for interlisted |
| tax_fees (paid to auditor), currency, fiscal_year | number, ISO-4217, integer | | same section as above |
| website | URL | | TSX profile page, search |
| summary | string ≤ 400 chars | | website / AIF |
| hq_city, hq_country | string | | TSX extract first |
| confidence (per field) | number 0–1 | | model self-assessment plus source-quality rubric (regulatory filing > company site > news > other) |
| sources (per field) | list of {url, title, retrieved_at} | | |
| evidence_excerpt (per field) | string ≤ 300 chars | verbatim quote | |

Manual-only fields (never AI-populated): deloitte_tax_client, dtt_market override, comments, all pursuit fields.

---

## Appendix C — Tier classification rules (from A.02 Matrix column B)

```
inputs: production (bool), development (bool), exploration (bool), royalty (bool),
        footprint ∈ {Canada & Abroad, Canada only, Abroad}

if production and footprint == "Canada & Abroad": tier = 1   # Production in Canada and abroad
elif production and footprint == "Canada only":   tier = 2   # Production in Canada only
elif production and footprint == "Abroad":        tier = 3   # Production abroad only
elif royalty:                                     tier = 4   # Royalty / streaming and processing-facility owners
elif development and not production:              tier = 5   # Development stage
elif exploration and not production and not development: tier = 6   # Exploration stage
else:                                             tier = 4   # workbook catch-all — propose "Unclassified" instead
```

Footprint derivation: `propsCanada = CANADA column non-empty`; `propsAbroad = any of AFRICA, ASIA, AUS/NZ/PNG, LATIN AMERICA, OTHER, UK/EUROPE, USA non-empty`; `Canada & Abroad` if both, `Abroad` if only abroad, otherwise `Canada only` (which also catches companies with no properties at all — flag this).

Dashboard tier labels: Tier 1 "Production in Canada and Abroad"; Tier 2 "Production in Canada Only"; Tier 3 "Production abroad only (no producing properties in Canada)"; Tier 4 "Royalty and streaming companies and processing facility owners"; Tier 5 "Development / exploration stage" (the Dashboard collapses Matrix tiers 5 and 6; the Selected Targets tab lists five tiers). The design should keep six tiers in the model and let the dashboard group 5+6.

Truth-table cases the unit tests must cover: production+Canada&Abroad→1; production+Canada only→2; production+Abroad→3; royalty only→4; royalty+production+Canada only→2 (production wins); development only→5; development+exploration→5; exploration only→6; nothing→Unclassified (workbook: 4); production with no regions→2 under the workbook formula (flag).

---

## Appendix D — Dashboard views to reproduce (A.01)

| View | Definition in workbook |
|---|---|
| Population analyzed | Count TSX issuers, TSXV issuers, foreign/other-exchange issuers with significant Canadian presence, total; proof that total = Matrix row count |
| Tier distribution | Count and % of population per tier; proof that % sums to 100 |
| Corporate office location by market | Companies by DTT Market (Ontario, British Columbia, Others* = Quebec & NCR, Atlantic, Prairies), cross-tabbed by tier |
| Producing mines by Canadian province | Count of companies with producing properties per province (BC, ON, QC, SK, MB, NU, NL, YT, NB, NS, AB, NT) — broken `#REF!` in file |
| Producing mines in key jurisdictions | Same idea for key foreign jurisdictions (USA, Mexico, Chile, Peru, Brazil, Argentina, West Africa, Australia…) — broken in file |
| Audit and tax fees by firm | For Deloitte, PwC, KPMG, EY, Others: number of companies audited, audit fees, tax fees, total, tax/audit ratio (CAD millions) |
| Clients by tier and market | Deloitte audit clients cross-tabbed by tier × DTT market, with fees |
| Selected targets | Shortlist from A.03 |

Add for the app: tier migration vs prior period (Sankey or matrix), enrichment coverage/confidence per field, and new entrants / drop-outs since last period.

---

## Appendix E — Known defects and quirks in the current workbook (the app should fix, not replicate)

1. Stage flags blank for 242/259 rows → all tiers = 4; dashboard "TAB NOT UPDATED".
2. `#REF!` formulas: Matrix H–K (Capital IQ financials), Dashboard producing-mines tables, proof cells O294/R306, Dashboard M38.
3. Inconsistent sentinels and whitespace: "Deloitte " / "Other " trailing spaces; "Not found", "N/A", 0 used interchangeably for missing auditor.
4. Website column sometimes holds a page title instead of a URL.
5. Market-cap threshold stated as $200M (Cover, B.01) and $50M (Dashboard labels).
6. Tier-count proof uses a hard-coded `+1` on Tier 6; exchange "Other" count uses `COUNTIF(...,"0")+1`.
7. Foreign-HQ companies (Australia, UK, US states, Chile…) have no DTT Market and drop out of market views.
8. Dashboard lists 5 tiers; Matrix computes 6.
9. Company names differ across sources (TSX vs LSEG vs Avantis), and companies rename (Barrick Gold → Barrick Mining) — identity must be ticker-based with alias history.
10. Deloitte-client flag populated for 29 rows only; there is no "not checked" vs "No" distinction.
