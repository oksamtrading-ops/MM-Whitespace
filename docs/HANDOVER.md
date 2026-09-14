# Handover — Mining Whitespace Intelligence Tool

> **Status at 13 September 2026.** Built, deployed, and doing the work it
> exists to do. Q3-2026 is published at **revision 8**; **33 companies
> researched** — Run 1 (5), Run 2 (25) and two batched runs (3 + 1) — for
> **US$11.6009 all in**, recorded correctly since the meter fix; **40 companies carry a tier**, 19
> audit fees carry their currency and fiscal year, and the period downloads as
> a clean workbook. The pursuit workflow is built and carries its first real
> pursuit.
>
> Everything in this note is deployed and every migration is applied. To start
> a new session, paste everything below the line into it.

---

I'm continuing work on the **Mining Whitespace Intelligence Tool** for Deloitte
Canada's Mining & Metals practice. It is built and running in production. Read
this whole note before changing anything.

## First, before any work

1. **Work only in `/Users/oksam/Documents/Work Research/Opp Research`.** If the
   session opened anywhere else, move it there first. The folder
   `~/Documents/Websites/Archieva Shipping` is a **different application** —
   never read, write, link or deploy into it for this project.
2. Use absolute paths in commands and links until the session is in that folder.
3. Read, in this order: this note, `README.md`, `docs/RUNBOOK.md`, and
   `AGENTS.md` (this project's Next.js is newer than your training data — read
   the guide in `node_modules/next/dist/docs/` before writing Next.js code).
4. Check the working tree is clean: `git status`. The only expected change is
   `next-env.d.ts`, which Next regenerates on every build; never commit it.

## What is waiting on Samuel

**1. Two findings are flagged, and they are judgements, not defects.**

- **China Gold's auditor.** Its 2026 circular says Lixin & Ethos CPA LLP was
  appointed on 26 February 2026 for Canadian reporting, and BDO continues for
  Hong Kong. The workbook says Deloitte. Three sources, three answers; the
  whitespace question is which one the practice counts.
- **Barrick's audit fee.** The table reads "Audit fees(2) $10.3" under "In
  millions of dollars" and nothing else. One pass proposed Australian
  dollars, the re-run proposed US dollars and was held because the circular
  names Canadian dollars and never US dollars. It needs someone who knows
  Barrick's reporting currency.

Both are on `/review` with the reason on the row. **Barrick's is also the open
action on its pursuit** — High priority, owned by `samowusuking@gmail.com`, due
30 September 2026 — which is the first real use of the pursuit workflow.

**2. ~~Publish revision 7~~ — done.** Revisions 7 and 8 went out on 13
September. All 178 decisions are on the dashboards: 40 companies carry a tier
(up from 21) and the auditor cross-tab reads 55.6%. Publishing took seconds
rather than revision 6's four minutes.

**3. Fifteen findings from the two batched runs are unreviewed** — eleven from
Aclara, Alkane and Allied Gold, and **four more from Elemental Royalty**, whose
run settled at 22:23 UTC on 13 September, after the section below was written.
All on `/review`. Nothing is wrong with them; nobody has looked.

**4. Kay can be let in now, and it no longer needs a domain.** Sign-in is an
email address and a password as of 14 September 2026, so nothing waits on mail
delivery — `docs/decisions/S6-PASSWORD-AUTH.md` has the reversal and its
reasoning. Two steps, both Samuel's:

1. Add `deloitte.ca` to **`allowed_email_domains` on `/settings`**. The trigger
   from `0024` reads that setting, so until it is there the insert below is
   refused, correctly.
2. Insert the row, then issue a password — on `/access` (*New password*, shown
   once) or with
   `node scripts/set_temp_password.mjs "$MM_DATABASE_URL" Kampofo@deloitte.ca`.

Kay will be made to replace it at first sign-in, so nobody keeps a working
credential for somebody else's account.

**Two things that were waiting are now done.** The live upload was confirmed
from the database side on 11 September (hash and parse matched byte for byte;
the screen should have said "Cannot be committed", because Q3-2026 was
already published). And the per-minute schedule ran a full day: **1,440 of
1,440 ticks**, recorded in `docs/decisions/S1-WORKER-SHAPE.md`.

## Where everything is

| What | Where |
|---|---|
| Project folder | `/Users/oksam/Documents/Work Research/Opp Research` |
| Repository | `github.com/oksamtrading-ops/MM-Whitespace`, branch `main`. **A push to `main` deploys production** |
| Live application | **https://mm-whitespace.vercel.app** — Vercel project `oksamtrading-ops-projects/mm-whitespace`, linked locally in `.vercel/` |
| Database | Supabase project **MM_Whitespace**, ref `djepptfxdkvmcretnogy`, region `ca-central-1`, Postgres 17.6 |
| Start here | `README.md` — what is built, how to run it, and why |
| Operating it | `docs/RUNBOOK.md` — loading a period, sign-in, publishing, incidents |
| Design | `docs/DESIGN.md` and `docs/design/00`–`18`. **Section 00 first**; doc 18 is the brand and interface guide and REVERSES doc 17's light-first decision |
| Decisions | `docs/decisions/` — all ten closed; decision 1 approved by legal on 4 September 2026. `BATCH-API.md` records why both passes batch |
| Settings | `.env.example` lists every variable; `.env.local` holds local secrets and is git-ignored |
| Source workbooks | Project root and `reference/`. **Git- and Vercel-ignored: licensed, and they carry personal data** |

Stack: Next.js 16.3.4, React 19.2.8, TypeScript 7.0.2, `pg` 8.23.0, Node 24.14.1.
Python 3.9.6 locally and 3.12 on Vercel, `openpyxl` 3.1.5. 51 commits.

Design-phase briefing (private artifact):
https://claude.ai/code/artifact/3b403f16-632e-4fff-9ef3-3e33ca172270

## How to reach each system without handling a credential

Samuel does not paste secrets into chat, and you must not ask for them.

- **Supabase:** use the Supabase MCP connector with `project_id:
  "djepptfxdkvmcretnogy"` (`execute_sql`, `list_tables`, `get_project`). It logs
  in as `postgres`, which owns the tables and so bypasses row-level security.
  It cannot `set role` to the application roles — see the traps below.
- **Vercel:** the CLI is logged in as `oksamtrading-ops` and the project is
  linked. `npx vercel env ls`, `npx vercel deploy --prod`, `npx vercel logs
  --environment production --no-branch --no-follow`.
- **The production database URL cannot be read back.** `MM_DATABASE_URL` is a
  *Sensitive* variable in Vercel; `vercel env pull` returns it empty. That is
  correct. To run application code against production from the command line,
  Samuel runs it with the URL in their own shell, e.g.
  `MM_DATABASE_URL='…' node scripts/publish_period.mjs …`.
- **Secrets in commands:** read them from `.env.local` into a shell variable
  and pass the variable, so the value never appears in a command or a
  transcript.
- **Outward actions need Samuel's explicit yes each time:** sending email,
  buying anything, accepting terms, and pushing when not asked to.

## What the project is

The practice tracks every TSX and TSXV mining company above a market-cap
threshold and assigns each a pursuit tier. The quarterly refresh stalled at
research: stage-of-operations flags were blank for 242 of 259 companies, so
every company computed as Tier 4. This application ingests the workbook,
enriches each company against public sources with evidence attached, routes
every proposed value through human review, applies the existing tier rules
unchanged, and publishes a frozen snapshot to the dashboards.

Owners: **Kay Ampofo** (workbook and domain) and **Samuel Owusu** (solution).

**This build is a proof of concept and stores no Deloitte client information.**
The `Deloitte Tax Client` column is excluded at parse time. Do not add it back
without the firm's own due diligence.

## What exists, and what state it is in

**Every milestone screen is built.** Upload and validation report, period
commit, run status, field-major and company-major review with keyboard accept,
override and flag, bulk accept, the publish gate and override, the dashboard,
company profiles and finder, identity merge, admin settings, the access review,
and password sign-in. Routes: `/upload`, `/upload/[id]`, `/runs`, `/review`,
`/review/[field]`, `/review/by-company`, `/publish`, `/dashboard`,
`/companies`, `/companies/[id]`, `/companies/merge`, `/pursuits`,
`/pursuits/[id]`, `/access`, `/settings`, `/styleguide`,
`/signin`, `/password`, `/api/cron/tick`, `/api/export` (the workbook
download), and two Python functions, `/api/parse` and `/api/workbook`.

**Production holds the real Q3-2026 period, published at revision 6.** 259
companies, first published 11 September 2026 and amended five times since,
each through the blocked gate with a reason — the gate is blocked because
coverage floors need most of the period researched, and 30 companies are.

**Production holds real research.** 30 companies across Run 1 (AEM, WDO, ELE,
NOU, RDS) and Run 2 (the 25 largest unresearched: ABX, WPM, CCO, FNV, K, NTR,
TECK, FM, LUN, PAAS, AGI, LUG, EDV, IVN, CDE, HBM, EQX, IMG, AG, ELD, CS,
CGG, NXE, GMIN, DPM). **US$10.94 spent in total.** 239 standing review
decisions, **40 companies tiered**, 19 audit fees with currency and fiscal
year. Of the 25 largest unresearched companies, **Deloitte audits four** —
Wheaton, Pan American, HudBay, First Majestic — and the rest are whitespace.

A local preview's findings are **synthetic seed data**
(`prompt_version = 'synthetic-fixture'`) sitting next to real company names;
never quote one as a finding.

**Ingestion works in production** (as of commit `38ee8da`). Upload posts the
workbook to `api/parse.py`, a Vercel Python function running the unchanged
parser; the parsed result waits in `upload_quarantine` for an hour between the
validation report and the commit; the workbook itself is discarded inside the
request. Proven: the function's payload for the synthetic workbook is identical
to the local parse. Not yet proven: an upload through the live screen (above).

**The worker exists and the tick works (commit `549475f`, deployed 11
September 2026).** Spike S1 found that the
scheduler calls the tick with `GET` and the route answered `POST` only, so
**every production tick since deployment returned 405** and nothing recorded
it. Now: the tick answers both, writes a `cron_ticks` row every minute even
when idle, and asks one worker over HTTP; `POST /api/worker/drain` answers 202
and drains after the response for up to `maxDuration = 300`, records itself
in `worker_runs`, and chains a successor when work remains; `/runs` has a
"Start a run" form whose refusals live in `src/lib/enrich/start.ts`; and
`scripts/worker.mjs` runs the same drain as a local process. The decision and
its measurements are in `docs/decisions/S1-WORKER-SHAPE.md`.

**Live research is built and tested, and switched off** (approved 11
September 2026; `docs/decisions/RESEARCH-PIPELINE.md`). Two passes, website
first: pass 1 finds and verifies the website, reads SEC EDGAR for registrant
status, fiscal year-end and head office, and lists the filings; pass 2 reads
those filings from the trusted domain and EDGAR for every field, with a
verbatim quote the anchoring gate re-checks. Three new fields: fiscal
year-end, auditor since, auditor change (24 months), SEC registrant
(migration `0015`). Code: `src/lib/enrich/live.ts` (orchestration),
`edgar.ts`, `transport.ts` (real network, DNS-rebinding guard), `pdf.ts`
(unpdf). Tests drive both passes end to end with a fake vendor and fake
network, including a fabricated fee that the gate rejects.

**Live research is ON in production** (11 September 2026, Samuel's go-ahead
after confirming decision 1's scope, the key's workspace, and the exposed
key's deletion): `LIVE_ENABLED = true`, and `MM_ENRICH_MODE=live`,
`ANTHROPIC_API_KEY` and `MM_SEC_CONTACT` are set in Vercel. **Nothing
researches until someone starts a run on `/runs`**, and every result is a
proposal for review. To stop it everywhere at once, set `LIVE_ENABLED` back
to false and push, or remove `MM_ENRICH_MODE` and redeploy. Never set
`MM_ENRICH_MODE=replay` in production: no recording exists for a real
company, so every job would be abandoned.

**Review now reaches the tier** (`src/lib/review/resolve.ts`). Accepting a
stage re-runs the classifier; undo restores the file's value; decisions amend
a published period's working values (the published revision never moves).
Before this, none of the three was true.

**Checks:** 446 Node tests, 72 Python tests, the authorisation check, the
class-collision check, the colour-contrast check, the build, and 153 end-to-end
checks.

```bash
npm test && npm run check:auth && npm run check:classes && npm run check:contrast && npm run build && npm run e2e:isolated
```

**Built on 12–13 September 2026**, all deployed:

- **The export is a download in the app** — *Publish → Take it away as a
  workbook*, `.xlsx` or flat `.csv`, Analyst and Admin only, every download in
  the audit log. Built by `api/workbook.py` from a payload
  `src/lib/export/period.ts` reads; locally by a `python3` subprocess. It
  carries the WORKING period, not the frozen revision — the snapshot has no
  stage rows and the matrix needs them, which is also why a Viewer may not
  have it.
- **The workbook is presentable.** Currency written into every amount
  (C$8,052,000, US$517,116) with the fiscal year; fee columns populated; no
  empty tabs (the source's two dividers are gone, replaced by Contents); one
  treatment on every data sheet — header rule, banded rows, filters, frozen
  panes, print setup; tier filled by tier with its rule as a cell comment.
- **A Summary sheet**: how much of the population Deloitte does not audit,
  the tier and footprint split, the largest companies the firm does not
  audit, and what research is still missing. Counts are live formulas over
  the matrix; the ranking is values.
- **Review: "accepted, then researched again."** A decided value that later
  research DISAGREES with gets its own bucket and a row tag, and can be taken
  from there ("Take the newer research"). Comparison is against the resolved
  value, and the stage compares by its stages.
- **Review: the bulk floor is chosen, not fixed** — 0.60, 0.70, 0.75, 0.80,
  0.90 on the field grid. The floor is one condition of seven; fees,
  conflicts, overrides, unanchored values, sourceless values and stage flags
  are still refused whatever it says.
- **Fees carry currency and fiscal year** (`{amount, currency, fiscal_year}`),
  and the gate checks the currency where the document states one, holds a
  currency the document never names, reads the labels filings really use
  ("Audit Services", "Tax-Related Fees"), matches comma-grouped numerals, and
  reads "(C$ thousands)" as a scale.
- **A stage quote must name the stage that decides the tier** (production,
  then royalty/streaming, then development, then exploration), or the finding
  is held for a person.

**Built on 13 September 2026**, after the handover above was written.
Everything below is committed, pushed and deployed, and every migration is
applied to Supabase.

**Q3-2026 moved to revision 8.** Revision 7 published the 178 decisions from
that morning — 40 companies carry a tier, up from 21 — and revision 8 corrected
its header, which had claimed 13 conflicts were unadjudicated when all 13 had
been decided. Both went through the blocked gate with a reason, and both took
seconds.

*Research*

- **EDGAR's profile is no longer the last word.** Its stored address and
  fiscal year-end are attributes the filer maintains, not statements a filing
  makes, and they go stale while the filings stay current — three wrong values
  reached review in Run 2 that way. They are secondary evidence of unknown age
  now, and for those fields the review queue lets the issuer's own filing win
  outright. One list, `src/lib/enrich/sources.ts`, decides both. **Deliberate
  consequence:** an EDGAR fiscal year-end no longer clears the bulk-accept
  floor on its own, so roughly 110 interlisted companies need a person there.
- **A correction now reaches the reviewer.** Where a decision stands, the row
  offers the NEWEST proposal the decision never saw, not the strongest — two
  of that morning's four corrections never surfaced and had to be overridden
  by hand. The pick moved out of the SQL into `queue.pickFinding`, because it
  depends on the standing decision and a correlated subquery cannot see it.
- **The field grid's shortcuts agree with its buttons.** A decided row drew no
  controls but still answered `A`, `O` and `F`. One predicate, `canAct`.
- **The Batch API is built and OFF.** Both passes turn out to be one request
  each — Run 2 measured it — so batching halves Run 3. Nothing in it has met
  the real Batch API. See item 2 and `docs/decisions/BATCH-API.md`.

*Publishing*

- **Seconds, not minutes.** 3,918 round trips down to **39**, measured: values
  and tiers go in chunks (`sql.insertMany`), and the prior period's tiers are
  one read into a map. Nothing local would ever have caught it — on SQLite both
  versions take 17 ms, because there is no round trip to pay for.
- **The gate stopped counting decided fields as conflicts.** Its message said
  "no adjudication" and its query never looked at the decisions, so all 13 of
  Run 2's EDGAR-versus-filing disagreements were reported for ever. No amount
  of review could have cleared it. The test that should have caught it was
  named for the distinction it never made.

*Retention*

- **It runs on Postgres**, and calls the application's own sweeps rather than
  re-writing their SQL. `pg_smoke` runs every rule as a dry run. It still has
  to be called by something (item 5).

*Pursuits — the Phase 1 data model AND the Phase 2 workflow*

- **Three tables, empty and policied** (`0018`/`0019`), and **without doc 05's
  `lcsp` and `fy_tax_nsr`** — a person's name and Deloitte's revenue from a
  client. Doc 05 is annotated where it specifies them, so the schema and the
  document disagree on the record rather than by accident.
- **The workflow**: `/pursuits`, `/pursuits/[id]`, and "Start a pursuit" on a
  company profile, which is the screen with the evidence on it. Analyst and
  Admin only — a partner is a Viewer, and doc 11 keeps the Viewer out in policy
  rather than in interface logic.
- **A pursuit's own words must never reach a prompt** (doc 06). A canary test
  pushes one through `publicRow` and `buildPrompt`; it was watched failing
  against a planted leak. The egress scan is the second line.
- **Priorities, action statuses and outcomes are settings**, so an Admin
  changes them on `/settings` without a deployment. A star marks a status that
  CLOSES an action, so finished and abandoned stop counting as open without
  pretending to be the same thing. A term retired from a list is shown as
  retired and never rewritten — and `/pursuits` then offers to sweep every row
  carrying it, in one act with one audit line.
- **A pursuit closes with an outcome** and can be reopened; closure is its own
  table, so closing, reopening and closing again is a history. Open actions
  never block a close: a pursuit is often lost with work outstanding.
- **An action carries its own status, owner and due date**, all three
  changeable after it is made — handing work over must not have to look like
  abandoning it. `patchAction` is the one place that writes an action.
- **Due dates are surfaced.** `/pursuits` counts overdue and due-this-week,
  marks the row and tags the action. A due date is a calendar day (not late on
  the day it is due); a closed action's date is history; a closed pursuit
  reports nothing overdue.
- **The list narrows** by company, owner, priority and what is due, and sorts
  four ways. A plain GET form, so every narrowed view is a URL somebody can be
  sent. The counts above it always describe every open pursuit, never the
  narrowed set.
- **A company merge takes its pursuits with it**, and both survive when both
  companies had one.

*Four guards added because something got past*

- **Every table a migration creates must have row-level security**
  (`commit.test.ts`). 0008's lesson as an invariant. It caught `pursuit_closures`
  the same afternoon.
- **The settings screen and its save action share one list of keys.** They kept
  two, and two pursuit vocabularies rendered as fields that saved nothing —
  "Nothing changed" — which is the decorative screen that module's own note
  warns about.
- **A nullable `date` column translates to TEXT.** The dialect rule wanted
  whitespace before the comma, so `due_date date,` kept SQLite's NUMERIC
  affinity while every other timestamp here is text.
- **`.tag` has a background**, and the pair is under `check:contrast`. It had
  none at all, so every pursuit tag rendered bare — the contrast check only
  verifies pairs it is told about.

**The Batch API is ON in production and proven end to end.**
`MM_ENRICH_BATCH=1` is set and deployed. A three-company smoke run took the
whole path against the real vendor — submit, a real `msgbatch` id, the tick
counting an open batch as work, the poll, the download, the resume, findings
persisted — in about five minutes:

| | |
|---|---|
| Run | `b5d3d9c3-0718-4f13-b5ac-1f6369054c1f`, completed |
| Batch | `msgbatch_01XBFem1wZ5u884GRwpsnNtC`, settled, 3 of 3 succeeded |
| Companies | Aclara (ARA), Alkane (ALK), Allied Gold (AAUC) |
| Cost | **US$0.4836** — recorded as US$0.3936 before item 2's fix, against a US$0.45 estimate |
| Findings | **11, waiting in `/review`, nobody has reviewed them** |

**A second batched run followed**, and is not described anywhere below: run
`4ba5d7d7-8a6a-46a1-b223-aca18a85ad7a`, batch
`msgbatch_01JiP5Mmo4fh7zYkdTCEZBJP`, settled, **one company — Elemental
Royalty, which Run 1 had already researched** — **four findings, unreviewed**,
US$0.1747 (recorded as US$0.1447). It is why the totals above say 33 companies
and not 30.

`/runs` says "Batched" and quotes the batched price. The EDGAR profile fields
all scored **0.585**, below the bulk-accept floor — the demotion above, working
on real data.

**EDGAR's address casing, found by that run.** It returned Alkane's head office
as "Perth, Wa": EDGAR shouts, and title-casing "PERTH, WA" whole turns the
state into a word. Each comma-separated segment is now cased on its own and a
segment of two or three letters keeps its case. The same test caught
"ST. JOHN'S" becoming "St. John'S", which the old rule had always done. **The
finding already in review still reads "Perth, Wa"** — it is a proposal with its
evidence anchored to the record it came from, so a reviewer overrides it rather
than anyone rewriting a stored value.

**Built on 14 September 2026 — sign-in is an email address and a password.**
Written but **NOT yet applied to production**: the migrations are files, the
cutover has not run, and the deployed application still mails links until it
does. `docs/decisions/S6-PASSWORD-AUTH.md` is the record; doc 11 is amended.

- **Why:** a mailed link is only as available as the mail behind it, and the
  pilot's sender reaches one inbox — so the practice's own workbook owner could
  not sign in. Passwords remove mail from the auth path entirely.
- **`scrypt` from `node:crypto`, no dependency**, at `ln=15` — deliberately
  under the published floor, because every concurrent verify allocates its full
  working set on an unauthenticated endpoint and 128 MB a request is a way to
  take the whole deployment down. The reasoning is in the decision record; do
  not raise it without reading that first.
- **The hash is in `auth_passwords`, not on `app_users`**, under 0010's grants.
  `must_change_password` is on `app_users`, because a boolean is not a
  credential.
- **The gate is thrown by `assertRole`** as a subclass of `Unauthenticated`, so
  all 16 page catch blocks and the route handlers already render it correctly
  with no file edited. A redirect could not work: `redirect()` throws
  `NEXT_REDIRECT` and those same catches would swallow it.
- **`AppUser.mustChangePassword` is required, not optional**, so the compiler
  names both construction sites — `resolveUser` and `userForSession`. Optional,
  a miss reads as `undefined`, which is falsy, and everybody already signed in
  walks through.

Three things this turned up that were not about passwords at all:

- **`npm run e2e:isolated` could not see a deletion.** It builds a worktree at
  `HEAD` and rsynced over it **without `--delete`**, so a deleted file survived
  and kept being served — journey 6 passed against `/auth/verify` after that
  route was removed. Fixed.
- **A form field's border was below the non-text floor on dark** (1.54:1
  against 3), because `check:contrast` was never told to look at one.
  `--input-border` is `--rule-raised` now and the pair is checked.
- **`app_users.email` is unique case-sensitively** while every lookup lowercases
  it, so a case-variant pair is insertable. Harmless with links; with passwords
  it is two credentials for one person. `0029` closes it — and **can fail on
  real data**, so run the duplicate check in the cutover first.

**The cutover has not run. Steps 1-3 are Samuel's** and are in
`docs/decisions/S6-PASSWORD-AUTH.md`; the short form is: check for duplicate
addresses, migrate, seed both admins with `scripts/set_temp_password.mjs` while
the OLD sign-in still works, then deploy. Nothing is dropped and no variable is
removed, so rollback is a redeploy.

**Built on 13 September 2026, evening — the brand and interface.** A separate
session, 143 files, on `main` and deployed. `docs/design/18-brand-guide.md` is
the record; it extends doc 17 and **reverses its light-first decision**.

- **The product is dark-first**, with the light system kept whole as a second
  theme and one press away in the rail's foot. The reason is measured, not
  taste: the brand green passes on black at **9.23:1** and fails on white at
  **2.27:1**, so on the dark ground green may carry text, lines and focus,
  where on white it may only fill. Print always renders light.
- **A left rail**, new UI primitives (`Sidebar`, `Panel`, `PageHeader`, `Orb`,
  `TierLadder`, `WorkingToggle`) and about 1,700 lines of `globals.css`.
- **`/styleguide` (Admin)** renders the tokens and components from the build
  itself, so nothing in it can drift from the product. When you remove a
  component, remove it there too — the last commit of the evening was exactly
  that debt being paid.
- **The dashboard's charts changed shape.** Auditor share is now two donuts,
  by value and by count, with the research gap drawn as a hatched slice rather
  than hidden — Deloitte holds 14.6% of the money and 6.6% of the companies.
  Market penetration is a dot plot, where the rule between two dots is the
  whitespace. A treemap hero was built and then **withdrawn**: the map is the
  image the product is remembered by, and two full-width pictures above the
  fold is one too many. It is at `b435ce4` if that is reopened.
- **One open decision, recorded rather than worked around.** No fixed set of
  four competitor colours clears 3:1 on both a white and a black ground once
  green is reserved for Deloitte, so competitors are steps of grey. Doc 18
  section 16 also lists every Deloitte brand value still marked *[confirm]*
  against the brand hub.

## Production settings

| Vercel variable (Production) | Value | Note |
|---|---|---|
| `MM_DATABASE_URL` | Supabase **transaction pooler** string, port 6543 (since 11 September 2026) | **Sensitive**, unreadable. Host `aws-1-ca-central-1.pooler.supabase.com`, user `postgres.djepptfxdkvmcretnogy` |
| `MM_AUTH` | `session` | Email and password since 14 September 2026 |
| `MM_MAIL`, `MM_RESEND_KEY`, `MM_MAIL_FROM` | `resend`, key, `Whitespace <onboarding@resend.dev>` | **No longer used by sign-in.** Kept set; `mail.ts` has no caller until something needs to send |
| `MM_ALLOWED_DOMAINS` | `gmail.com` | Gmail for the pilot |
| `MM_PUBLIC_URL` | `https://mm-whitespace.vercel.app` | **How the tick reaches the worker** (`src/lib/enrich/kick.ts`). It used to be the origin in a sign-in link too; deleting it as dead magic-link config breaks enrichment |
| `MM_PARSE_SECRET` | shared secret | The Node app and `api/parse.py` both read it |
| `MM_CRON_SECRET`, `CRON_SECRET` | same value | The per-minute tick in `vercel.json`, and the worker endpoint |
| `MM_ENRICH_MODE` | `live` | Set 11 September 2026. Never `replay` in production: it would abandon every real company |
| `MM_ENRICH_BATCH` | `1` | **Set 13 September 2026 and proven end to end** — two real batches have settled. Sends each pass's model call to the Batch API, where the TOKENS are half price and the web searches are not. Migrations `0016`/`0017` are applied |
| `ANTHROPIC_API_KEY` | model key | **Sensitive**, added 11 September 2026, from workspace `mm-whitespace-prod` (`wrkspc_01W9ytyaac9BqDzPzLkxNAKT`) with a $100/month limit. Unused until `LIVE_ENABLED` is true |
| `MM_SEC_CONTACT` | contact email | **Sensitive**, set 11 September 2026. SEC EDGAR's required User-Agent contact. Live mode refuses to start without it |

**No variable is set for Preview deployments.** The CLI refused to add a
preview variable without a git branch. Previews are behind Vercel's login, and
uploads on them fail closed as "not configured". A *protection bypass token*
exists on the project (created by `vercel curl`); Vercel exposes it to
deployments as `VERCEL_AUTOMATION_BYPASS_SECRET`.

**Sign-in reaches one inbox today.** The Resend account behind `MM_RESEND_KEY`
belongs to `oksamtrading@gmail.com` and has no verified domain, so it delivers
only from `onboarding@resend.dev` and only to that address. Admins in
`app_users`: `oksamtrading@gmail.com`, `samowusuking@gmail.com`. With
`gmail.com` allowed, the roster is the whole gate — invite by inserting a row:

```sql
insert into app_users (email, role) values ('someone@example.com', 'analyst');
```

**Do not use `archievashipping.com`** for this application's mail. It is the
client domain of the other application, verified in a *different* Resend
account.

## Running it locally

```bash
python3 -m mmparser.cli "M&M - Whitespace Analysis Q3-2026.xlsx" --json /tmp/period.json
node scripts/commit_period.mjs /tmp/period.json ./period.db --fresh
node scripts/seed_review_fixture.mjs ./period.db    # SYNTHETIC findings, for the review screens
node scripts/publish_period.mjs ./period.db --publish --override "local baseline"
```

Insert `admin@`, `analyst@` and `viewer@example.invalid` into `app_users`, then:

```bash
MM_DATABASE=./period.db MM_AUTH=dev MM_DEV_AUTH_SECRET=local npx next dev
```

`MM_AUTH=dev` puts three one-click accounts on `/signin`, and that path skips
passwords entirely — so seeded local accounts need none, and
`must_change_password` must stay false on them or the whole local suite lands
on the password screen. **One `next dev` per
project** — `pkill -f "next dev"` before starting another; the end-to-end
suite needs the project to itself. In the Claude desktop app the browser pane
reads its launch config from a different folder, so start the server with Bash
and open the pane by URL.

## Do not trust the brief's appendices

Both workbooks were read cell by cell; `python3 scripts/verify_ground_truth.py
--reference-dir reference` re-measures every figure. Where the brief and these
disagree, these govern.

- **The population is 144 TSX / 115 TSXV / 0 other**, not 143/115/1.
- **The matrix joins by row position, not ticker** — sorting the workbook
  silently reassigns a partner's research.
- **Stage is tri-state.** Blank means *not researched*, not false.
- **12 companies have no region values**, all royalty or streaming;
  `footprint = none` is the fix.
- **Deloitte green `#86BC25` fails for text** on white; text uses `#567C18`.
- **The tier rules are correct as written.** Only their inputs change.

## Decisions already made

- Postgres job ledger and a stateless worker; the cron tick enqueues only.
- Batch API for enrichment; the application fetches, caches and anchors each
  citation, and a value it cannot trace to a document it retrieved is quarantined.
- **SEDAR+ is legally excluded.** Issuer-hosted documents first; fees last.
- Publish freezes an immutable snapshot; dashboards read only that.
- Authorisation is `requireRole(...)` as the first statement of every action and
  route; `npm run check:auth` fails the build otherwise. Middleware is not a
  boundary. Row-level security underneath is defence in depth.
- **Sign-in is an email address and a password** since 14 September 2026,
  reversing doc 11's magic-link-only assumption because the mail behind it
  reached one inbox and Kay could not sign in at all
  (`docs/decisions/S6-PASSWORD-AUTH.md`). **Sessions are rows, and that is
  unchanged**, because doc 11 requires them revocable; deactivating an account
  on `/access` still ends its live sessions. `auth_sessions` holds the SHA-256
  of a random token; `auth_passwords` holds a salted scrypt digest, in its own
  table under 0010's grants. Deloitte SSO still replaces one function,
  `sessionClaimSource`, and remains the destination.
- **One database interface, two engines.** `src/lib/db/sql.ts`: SQLite locally
  and in tests, Postgres in production. `MM_DATABASE_URL` (or `DATABASE_URL` /
  `POSTGRES_URL`) selects Postgres.
- **One parser.** The same Python parser runs locally and, on Vercel, as
  `api/parse.py`. `to_payload()` in `mmparser/cli.py` builds its output for both.

## Traps that each cost real time

**Transactions only through `db.tx(async (db) => …)`.** A bare
`db.exec("begin")` works on SQLite and silently does not on a Postgres pool.
A test scans for it.

**SQL must run on both engines as written.** No `rowid` (use `returning id`).
No `current_timestamp` for ordering — on Postgres it is the transaction's start
time; use `decisionStamp()` for "now, in order" and `formatStamp()` for any
other time, from `src/lib/db/stamp.ts`. Never pass a future time to
`decisionStamp()`. No `max()` over `jsonb` (cast to text). Qualify the column
in `on conflict … do update set n = table.n + excluded.n`. Booleans are
`true`/`false`.

**Postgres answers in SQLite's shapes** — text for jsonb and timestamps,
numbers for numeric and `count(*)`, 1/0 for booleans — because of the type
parsers in `src/lib/db/postgres.ts`. `npm run pg:smoke` checks this.

**Supabase: use the transaction pooler (port 6543), not
`db.djepptfxdkvmcretnogy.supabase.co`** — the direct host is IPv6-only and
Vercel cannot resolve it. The session pooler (5432) admits only 15 clients:
on 11 September 2026 warm Vercel instances held all 15 idle and every page
that read the database failed with `EMAXCONNSESSION`. Since then each
instance's pool holds at most 4 connections, closes them after 5 idle
seconds, and is attached with `attachDatabasePool`
(`src/lib/db/postgres.ts`); and `MM_DATABASE_URL` points at port 6543, where
a client past the limit waits instead of failing. Nothing in the app needs a
session: the only role switch is `set local role`, inside a transaction.

**Supabase's certificate is private.** It chains to *Supabase Root 2021 CA*,
embedded in `src/lib/db/supabase_ca.ts` with its provenance; a test pins the
fingerprint. Never turn verification off.

**A changed Vercel variable needs a new deployment.**

**The scheduler calls the tick with `GET`.** A route that exports `POST` only
answers 405 to every tick, and nothing tells you. `cron_ticks` on `/runs` is
the check; the S1 record has the story.

**A client component cannot import a module that reaches `node:fs`.** The
build fails deep inside Turbopack with "does not support external modules".
Constants a form needs live in a module with no node imports
(`src/lib/enrich/scope.ts` is the example).

**The browser redirect must be relative.** `NextResponse.redirect()` builds an
absolute URL from `request.url`, which can name a different host from the one
that set the cookie, silently dropping the session.

**The Supabase connector cannot `set role`** to `app_viewer`, `app_analyst` or
`enrichment_worker` (PostgreSQL 16 split SET from ADMIN). The S5 script
(`scripts/s5_access_model.sql`) refuses to run rather than report false
passes; grant the roles `with set true` for the run and revoke them after.

**Floating promises are invisible to the type checker.** After any change that
makes a function async, look for calls whose result is dropped, assigned
without `await`, passed to `assert`, or wrapped in `assert.throws`.

**A Python function and a route handler of the same name are one URL, and the
function wins.** The export builder shipped as `api/export.py` beside the
application's own `/api/export` route, so every download answered
`{"error": "unauthorized"}` from a function that never saw the request.
Nothing local catches it — there is no function host here, so the route
answers and the tests pass. It is now `api/workbook.py`, and
`src/lib/python/endpoint.test.ts` fails the build if any `api/*.py` ever
shares a name with a route again.

**EDGAR is not the last word.** Its stored address and `fiscalYearEnd` go
stale while the issuer's own filing is current, and EDGAR outranks the filing
in evidence scoring. Three wrong values reached review this way in Run 2.

**A CSS class that already exists will silently restyle your component.** The
pursuit filter form was written as `.filters`, which is the review screen's row
of bucket chips and styles its links as chips. It inherited a layout meant for
something else and NOTHING failed: the build has no opinion, and
`check:contrast` only verifies the colour pairs it is told about, so a class
with no background at all (`.tag`, until today) passes it too. Grep
`globals.css` for a class name before using it, and add the pair when you add a
colour.

**It has now happened three times, and the third one shipped and was live for
months.** The rail's identity line used `.role` for the word "admin" — and the
sign-in screen's development account buttons already own `.role`, defining it
as a three-column grid with 22px of padding and a bottom border. So the rail
inherited all of it: **the address was squeezed to zero width**, the role sat
alone in a full-width cell, and a horizontal rule appeared under it that nobody
drew. It read as a heading for a section that was not there, which is exactly
how it was reported. Nothing failed — the markup was correct the whole time,
and the defect was purely in which rule won. It is `.whorole` now.

Every one of the three was found by a person looking at the screen, never by a
check — so there is one now. **`npm run check:classes`** refuses a bare class
rule that imposes layout and is worn by two components that did not agree to
share it. Both historical collisions are replanted as tests and watched failing.

Two things about its shape, because the first two attempts were worse. It only
looks at LAYOUT: two components sharing a colour is not the failure, and a check
that fired on colour would be silenced inside a week. And **what counts as
shared is derived from `/styleguide`** rather than listed — a class the
styleguide wears is documented as shared, which is the rule this project already
had. To share a class, put the component in the styleguide. `EXEMPT` in the
script holds the handful that are shared some other way, each with its reason.

It is a static check and cannot see intent: two screens that both want the same
grid look exactly like a collision. What it does catch is the second wearer of a
name somebody else already owns, which is all three of these.

**`node --test` strips types, it does not compile them.** A TypeScript
parameter property (`constructor(private readonly x = 1) {}`) passes both `tsc`
and `tsx` and then fails the whole suite with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Assign the field in the body.

**A second `next dev` blocks the end-to-end suite** with "the server did not
start" and nothing else. `npm run e2e:isolated` runs the journeys in a detached
worktree with its own `node_modules`, so a preview someone else is using stays
up; prefer it to `npm run e2e`.

**`/Users/oksam` is itself a git repository**, with the Archieva folder inside
it. Never run `git add -A` outside this project's folder.

## What is left, in order

1. ~~Confirm the live upload~~, ~~read a day of ticks~~ (1,440 of 1,440),
   ~~Run 1~~, ~~the Excel export~~, ~~Run 2~~, ~~publish revision 7~~,
   ~~the pursuit data model~~, ~~the Phase 2 pursuit workflow~~ — all done.
   What follows is the work that has not been done.

   Two things from the pursuit work a later session should not undo: **doc 05's
   `lcsp` and `fy_tax_nsr` are deliberately not built**, and both doc 05 and
   migration `0018` say so; and **a pursuit's own words must never reach a
   prompt**, which `pursuit.test.ts` holds.

2. ~~**Settle what a batched web search costs, before Run 3.**~~ **Done, and
   the suspicion was right — searches are NOT discounted.** Anthropic's web
   search documentation says it outright: "Web search tool calls through the
   Messages Batches API are priced the same as those in regular Messages API
   requests." The discount is documented on tokens, and it stops there. No
   console lookup was needed.

   `Meter.add` had applied the rate to the whole cost, search charge included,
   so **both batched runs recorded less than they cost**: run
   `b5d3d9c3` charged nine cents for eighteen searches instead of eighteen
   (**US$0.3936 recorded, US$0.4836 true**) and run `4ba5d7d7` three cents
   instead of six (**US$0.1447 recorded, US$0.1747 true**). The rate now
   multiplies the tokens only. The pre-flight estimate had the same flaw and is
   split the same way, from a measurement rather than an assumption: across 75
   real jobs, **pass 1 makes exactly six searches for every company** (34 jobs,
   204 searches, no exceptions) and **pass 2 makes none at all** — it reads
   filings rather than searching — so the flat half was only ever wrong on
   pass 1. Two tests hold it, both watched failing against the replanted bug.

   **The US$0.12 recorded low has since been corrected** (14 September 2026,
   on Samuel's instruction): `b5d3d9c3` now reads **US$0.4836** and `4ba5d7d7`
   **US$0.1747**, and the run total is **US$11.6009**. Both corrections are in
   `audit_log` as `enrichment_spend_corrected` and
   `enrichment_prompt_version_backfilled`, each with its reason and the commit
   that fixed the code.

3. **Run 3: the remaining 229 companies.** **US$41.22 batched** for pass 1
   (US$68.70 live) — not the US$34 quoted before item 2 was settled, because
   229 companies × six undiscounted searches is US$13.74 that no discount
   touches. Pass 2's 75 eligible companies are US$5.63, and genuinely half,
   since pass 2 never searches. Start it from `/runs`, which states the batched
   price. **Item 2 is done, so nothing blocks this.**

   Worth knowing before it runs: the Batches API **throttles web search per
   organisation**, so a batch with ~1,374 searches in it may take longer to
   settle than the five minutes the three-company smoke run took. That is
   throttling, not a stall — check `enrichment_batches` before treating it as
   one.

4. **Mail: no longer blocking anybody, and smaller than it was.** It used to
   be what stood between Kay and an account; sign-in is a password now and
   needs no mail at all, so buying and verifying a domain is whenever somebody
   wants the application to send something. **Rotating the Resend key still
   stands on its own** — it was pasted into a chat once — and is worth doing
   whether or not the domain is ever bought.

5. **Schedule retention.** The job now runs on either engine
   (`node scripts/retention.mjs "$MM_DATABASE_URL" --apply`), but nothing calls
   it, so production still sweeps nothing. Putting it on a timer is a decision
   about deleting production data automatically, not a port. (`cron_ticks`
   prunes itself to a week; `worker_runs` is a few rows a day and has no rule
   yet.)

6. **The remaining spikes:** S2 (fee disclosure coverage on five companies)
   and S4 (open the generated export in Excel).

7. **Hardening: all done except Deloitte SSO**, which waits with
   `MM_ALLOWED_DOMAINS=deloitte.ca` on the pilot moving to Deloitte addresses,
   which waits on the mail decision. It is one seam, `sessionClaimSource`.

   ~~A monotonic column on `review_decisions`; today `decisionStamp()` carries
   the order.~~ **Done 14 September 2026** (`0025`, `0026`, both applied).
   `seq` is now the order, and `order by decided_at desc, id desc` became
   `order by seq desc` at all five query sites — one key instead of two.
   `decided_at` stays as the time a person decided, no longer load-bearing, so
   **a clock correction can no longer reorder an audit trail**; a test holds
   that.

   **The recorded reason was out of date.** The note in `decide.ts` blamed
   decisions sharing `decided_at` inside one transaction on Postgres, which
   stopped being true when `recordDecision` started using `decisionStamp()` —
   production carries 240 decisions and 240 distinct stamps, no ties, bulk
   accepts included. The real hazard is narrower: `decisionStamp()`'s
   high-water mark is a module-level variable, so it is monotonic **per
   process**, and production runs many concurrent instances. This closed while
   still theoretical; nothing needed repairing.

   The backfill was checked against the old ordering before the unique index
   went on: **240 rows, numbered 1–240, zero disagreements** with
   `(decided_at, id)`. History is preserved as the system understood it, not
   restated.

   Two things a later session should not undo. **`seq` is `not null` on
   Postgres** (`0026`) because `order by seq desc` puts **NULLS FIRST** there —
   a row without one would read as the newest decision for ever, which is the
   exact silent wrongness the column exists to end. And **`0025` must stay
   idempotent**: adoption cannot recognise a migration that creates no table,
   so it re-runs on a database predating the ledger. SQLite has no
   `ADD COLUMN IF NOT EXISTS`, so `applySchema` asks the question itself.

   ~~The domain allowlist as a database trigger; enforced in code because the
   portable migrations forbid triggers.~~ **Done 14 September 2026, and the
   stated reason was wrong.** Nothing forbade it: `isPostgresOnly()` already
   made SQLite skip files it cannot run, which is how five migrations of roles,
   grants and policies already ship — the list of Postgres-only constructs
   simply had no pattern for a trigger. Migration `0024` adds the trigger on
   `app_users`, **applied to Supabase and proven against it**: `deloitte.ca`
   refused, a malformed address refused, a `gmail.com` address admitted, and —
   the case worth checking — **deactivating someone still works**, because the
   trigger fires on `insert or update of email` and not on the `is_active`
   write that `/access` makes.

   Two comments in the source claimed the database was already enforcing this.
   It was not. Both now describe what is actually there.

   The list moved to the `allowed_email_domains` setting, because a trigger
   cannot read `MM_ALLOWED_DOMAINS`. It is seeded with `gmail.com`, which is
   what production already ran on, so nothing changed behaviour on the day it
   landed. **It is on `/settings` now**, so an Admin can add `deloitte.ca`
   without a deployment — and that, not a code change, is what will let Kay in
   once the mail domain is sorted. `MM_ALLOWED_DOMAINS` survives only as the
   fallback for a database that has not had `0024`: failing closed in the
   interface would refuse every sign-in including the Admin's, with no way in
   to fix it. The trigger fails closed instead, where the worst case is that
   nobody new can be invited until one value is set.

   ~~The live pipeline records the replay pipeline's `PROMPT_VERSION`.~~
   **Fixed 13 September 2026.** A live prompt is two halves — prompt.ts's
   stable prefix and live.ts's `DISCOVERY_RULES` / `EXTRACTION_RULES` — and
   only the prefix was versioned, so editing the rules moved no version
   anywhere and the record could not date a change. `LIVE_RULES_VERSION` now
   sits beside the rules it describes and `promptVersionFor(mode)` composes
   the two, so a live finding records `2026-09-04.1+live.2026-09-13.1` and a
   replay finding is untouched. Two tests hold it, both watched failing: one
   on the composer, one on the wiring in `worker.ts`, which was the half that
   was actually wrong.

   **The backfill is done** (14 September 2026, 01:05 UTC, before Run 3). All
   **462 findings and all 11 runs** now read
   `2026-09-04.1+live.2026-09-13.1`, one value across the whole population —
   every run was `mode=live` and the rules had not changed, so the stamp
   describes them accurately rather than asserting anything new.
   `scripts/correct_prompt_version_and_batch_spend.sql` records what was done
   and why; it is guarded, so running it again reports `UPDATE 0`.

8. ~~**Tidy-ups:** an empty tracked file named `--` at the repository root.~~
   **Done** — removed 13 September 2026. Zero bytes, referenced by nothing,
   committed by accident in `ec8092c`.

## Working conventions

- Commit messages explain *why*, end with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, and Samuel usually
  asks for "commit and push" explicitly. Pushing `main` deploys production.
- Migrations in `supabase/migrations/` are canonical Postgres; SQLite is
  translated by `src/lib/db/dialect.ts`. Postgres-only files (roles, grants,
  row-level security) are skipped locally. Apply new ones to Supabase with the
  connector and record them in `schema_migrations`, or with
  `node scripts/migrate.mjs "$MM_DATABASE_URL"`.
- Run `python3 scripts/verify_ground_truth.py --reference-dir reference` after
  any change to a factual claim. Never commit a workbook; `npm run setup`
  enables the hook that refuses one.
- Before trusting a check, make it fail once: plant the bug and watch it catch it.
- Documents use sentence-style headings that state a point, decision before
  rationale, in Deloitte's voice.
