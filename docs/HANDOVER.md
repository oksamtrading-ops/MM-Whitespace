# Handover prompt — Mining Whitespace Intelligence Tool

> Copy everything below the line into a new chat.

---

I'm continuing work on the **Mining Whitespace Intelligence Tool** for Deloitte Canada's Mining & Metals practice. A previous session completed the design document. Read this before doing anything.

## Where things are

Working directory: `/Users/oksam/Documents/Work Research/Opp Research`

| Path | What |
|---|---|
| `docs/DESIGN.md` | Index + executive summary |
| `docs/design/00-16*.md` | 17 sections, ~29,000 words. **Section 00 first** — later sections depend on it |
| `scripts/verify_ground_truth.py` | Re-measures every figure in the doc against the workbooks. Currently **54/54 passing**. Run it after any factual edit |
| `reference/` | The two source workbooks. **Git-ignored** |
| `MM_Whitespace_App_Design_Doc_Prompt.md` | The original brief. **Its appendices contain errors — see below** |

Published briefing (private artifact): https://claude.ai/code/artifact/3b403f16-632e-4fff-9ef3-3e33ca172270
To update it, pass that URL as `url` to the Artifact tool. Publishing without it creates a duplicate.

Environment: Node 24, pnpm, Vercel CLI, authenticated GitHub CLI, Python 3.9 + openpyxl. **No Supabase CLI, no `ANTHROPIC_API_KEY`.** One Supabase org exists with a single inactive project. Repo is `git init`-ed with nothing committed yet.

## What the project is

The practice tracks every TSX/TSXV mining company above a market-cap threshold in an Excel workbook and assigns each a pursuit tier. The quarterly refresh stalls at manual research: stage-of-operations flags are blank for 242 of 259 companies, so every company computes as Tier 4 and the dashboard is broken. Kay Ampofo (workbook owner) and Samuel Owusu (solution owner) agreed to build a web app that ingests the workbook, enriches each company with Claude over public sources, routes every AI value through human review, applies the existing tier rules, and publishes dashboards plus an Excel round-trip.

Stack is fixed: Next.js App Router + TypeScript, Supabase, Vercel, Claude API. Roles Admin/Analyst/Viewer. Must be portable to Deloitte Azure with SSO as a configuration change.

## Critical: do not trust the brief's appendices

Both workbooks were read cell by cell. Where the brief and these disagree, **these govern**. All verified by the script.

- **Population is 144 TSX / 115 TSXV / 0 other**, not 143/115/1. Count formulas start one row below the data; a hard-coded `+1` invents a phantom other-exchange company.
- **The matrix joins by row position, not ticker** — it has no ticker column. The auditor tab joins by company name. All manual research is bound to row ordinals.
- **Stage is tri-state.** Blank means *not researched*, not false. Four booleans make `Unclassified` underivable.
- **12 companies have no region values**, all royalty/streaming; the workbook files them "Canada only" — ~$146B of market cap under a footprint they don't have. `footprint = none` is the fix. Separately 17 carry the royalty flag, so **5 royalty companies do have properties** — the two conditions are independent.
- **Both raw-extract vendor ID columns are empty** (0/181, 0/899). But the auditor tab's Entity ID **is not** — 143 real IDs. Don't sweep it into the empty-artifact scope cut.
- **98 rows carry a venture-graduate flag**, so ticker+exchange can't be a primary key. Identifiers need validity intervals.
- **11 distinct auditor values, not 9**; six missing-value sentinels including **numeric zero**; trim before sentinel matching.
- **Both files carry personal data and two different licences.** The primary workbook has cell comments by a named employee. Parse before persist; the real workbook **cannot be a test fixture**.
- **Deloitte green `#86BC25` is 2.27:1 on white** — fails WCAG. Separate tokens for text (`#567C18`) and non-text (`#5E841A`, `#6B961E`).
- Tier rules themselves are **correct as written** — verified formula-for-formula. Only the inputs change.

## Decisions already made

- Postgres job ledger + stateless Node worker; cron tick split from work; leases with heartbeat renewal.
- **Batch API** for enrichment — halves cost, removes the deadline problem.
- Hybrid enrichment: model discovers sources, **app fetches and caches**, code enforces the citation.
- One resolved-value table; precedence enforced in the database, not app code.
- Publish freezes an immutable snapshot; all dashboards read only that.
- Export to a **clean template**, not the uploaded workbook.
- **SEDAR+ is legally excluded** — its terms forbid automated *and manual* scraping and also forbid storing the data in a database, which reaches the app's own cache. Issuer-hosted documents first. Fees sequenced **last**.
- Scope: nothing empty in the source workbooks is designed in. But fee *fields*, pursuit *tables*, period comparison and the Entity ID all stay.

## Blocking open questions (9 of 16)

Full list in `docs/design/15-open-questions.md`. The gating one:

**Do risk and legal accept licensed extracts plus internal client flags in a non-Deloitte cloud, with prompts going to Anthropic?** Owner Samuel. No engineering mitigation, longest lead time, blocks everything. A refusal at milestone four would be fatal.

Others blocking Phase 1: SEDAR+ storage restriction accepted as read; whether `Unclassified` may be displayed; confirming the recovered province/jurisdiction axes; the Entity ID carve-out; cutting the client cross-tab; dark-first dashboard; threshold operator; coverage floors.

## What I want to do next

<!-- Replace this section with your actual ask. Likely candidates: -->

- Take the open questions to Kay and Samuel, and revise the design from their answers, **or**
- Start Milestone 1 (ingestion + validation report + tier truth table, no AI yet — this de-risks most and costs least), **or**
- Run the six week-one spikes in `docs/design/14-delivery-plan.md`.

## Working notes

- No application code has been written. The design document specifies schema, contracts, prompt structure and diagrams only.
- Don't commit the workbooks — `.gitignore` covers `reference/` and `*.xlsx`.
- Run `python3 scripts/verify_ground_truth.py --reference-dir reference` after any change to factual claims.
- The document uses sentence-style headings that state a point, decision before rationale, Deloitte voice. Keep that if you extend it.
