# Handover — Mining Whitespace Intelligence Tool

> **Status at 13 September 2026.** Built, deployed, and doing the work it
> exists to do. Q3-2026 is published at **revision 8**; **30 companies
> researched** across Run 1 (5) and Run 2 (25) for **US$10.94 all in**;
> **40 companies carry a tier**, 19 audit fees carry their currency and
> fiscal year, and the period downloads as a clean workbook.
>
> **Q3-2026 is published at revision 8**, and everything below is deployed.
> To start a new session, paste everything below the line into it.

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

Both are on `/review` with the reason on the row.

**2. ~~Publish revision 7~~ — done.** Revisions 7 and 8 went out on 13
September. All 178 decisions are on the dashboards: 40 companies carry a tier
(up from 21) and the auditor cross-tab reads 55.6%. Publishing took seconds
rather than revision 6's four minutes.

**3. Kay still cannot sign in.** `Kampofo@deloitte.ca` was refused because
only `gmail.com` is allowed, and Resend can only deliver to
`oksamtrading@gmail.com` until a domain is verified (item 6 in what is left).
Kay can only get in through a Gmail address inserted into `app_users`. The
refusal is expected, not a fault.

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
| Design | `docs/DESIGN.md` and `docs/design/00`–`17`. **Section 00 first** |
| Decisions | `docs/decisions/` — all ten closed; decision 1 approved by legal on 4 September 2026 |
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
and magic-link sign-in. Routes: `/upload`, `/upload/[id]`, `/runs`, `/review`,
`/review/[field]`, `/review/by-company`, `/publish`, `/dashboard`,
`/companies`, `/companies/[id]`, `/companies/merge`, `/access`, `/settings`,
`/signin`, `/auth/verify`, `/api/cron/tick`, `/api/export` (the workbook
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

**Checks:** 363 Node tests, 72 Python tests, the authorisation check, the
colour-contrast check, the build, and 128 end-to-end checks.

```bash
npm test && npm run check:auth && npm run check:contrast && npm run build && npm run e2e:isolated
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

**Built on 13 September 2026**, after the handover above was written. All four
are committed; none is deployed until someone pushes.

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
  of 13 September's four corrections never surfaced and had to be overridden
  by hand. The pick moved out of the SQL into `queue.pickFinding`, because it
  depends on the standing decision and a correlated subquery cannot see it.
- **The field grid's shortcuts agree with its buttons.** A decided row drew no
  controls but still answered `A`, `O` and `F`. One predicate, `canAct`.
- **Publishing is seconds, not minutes.** 3,918 round trips down to **39**,
  measured: values and tiers go in chunks (`sql.insertMany`), and the prior
  period's tiers are one read into a map. Nothing local would ever have caught
  it — on SQLite both versions take 17 ms, because there is no round trip to
  pay for.
- **Retention runs on Postgres**, and calls the application's own sweeps
  rather than re-writing their SQL. `pg_smoke` runs every rule as a dry run.
  It still has to be called by something (item 6 below).
- **The Batch API is built and off.** See item 2 below and
  `docs/decisions/BATCH-API.md`. Migrations `0016` and `0017` ARE applied to
  Supabase; only `MM_ENRICH_BATCH` is still unset.
- **The publish gate stopped counting decided fields as conflicts.** Its
  message said "no adjudication" and its query never looked at the decisions,
  so all 13 of Run 2's EDGAR-versus-filing disagreements were reported for
  ever — every one of them decided by hand on 13 September. Revision 7 went out
  through a blocker that was not real; revision 8 corrects its header. The test
  that should have caught it was named for the distinction it never made.

## Production settings

| Vercel variable (Production) | Value | Note |
|---|---|---|
| `MM_DATABASE_URL` | Supabase **transaction pooler** string, port 6543 (since 11 September 2026) | **Sensitive**, unreadable. Host `aws-1-ca-central-1.pooler.supabase.com`, user `postgres.djepptfxdkvmcretnogy` |
| `MM_AUTH` | `session` | Magic link |
| `MM_MAIL`, `MM_RESEND_KEY`, `MM_MAIL_FROM` | `resend`, key, `Whitespace <onboarding@resend.dev>` | |
| `MM_ALLOWED_DOMAINS` | `gmail.com` | Gmail for the pilot |
| `MM_PUBLIC_URL` | `https://mm-whitespace.vercel.app` | Written into sign-in links |
| `MM_PARSE_SECRET` | shared secret | The Node app and `api/parse.py` both read it |
| `MM_CRON_SECRET`, `CRON_SECRET` | same value | The per-minute tick in `vercel.json`, and the worker endpoint |
| `MM_ENRICH_MODE` | `live` | Set 11 September 2026. Never `replay` in production: it would abandon every real company |
| `MM_ENRICH_BATCH` | **not set** | `1` sends each pass's model call to the Batch API at half price. Apply migrations `0016`/`0017` first. Never been run against the real Batch API |
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
MM_DATABASE=./period.db MM_AUTH=dev MM_DEV_AUTH_SECRET=local MM_MAIL=log npx next dev
```

`MM_AUTH=dev` puts three one-click accounts on `/signin`. `MM_MAIL=log` prints
sign-in links to the server log instead of sending them. **One `next dev` per
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
- **Sign-in is magic link and sessions are rows**, because doc 11 requires them
  revocable; deactivating an account on `/access` ends its live sessions. Auth
  tables store only SHA-256 hashes. Deloitte SSO replaces one function,
  `sessionClaimSource`.
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
   ~~Run 1~~, ~~the Excel export~~, ~~Run 2~~ — all done. What follows is the
   work that has not been done.

2. **Switch the Batch API on, in that order.** It is **built and off**
   (`MM_ENRICH_BATCH=1`; `docs/decisions/BATCH-API.md`). Before the flag goes
   on: apply migrations `0016` and `0017` to Supabase, and set the variable in
   Vercel. **Nothing in it has run against the real Batch API** — the tests
   drive a fake one, which proves our two paths agree, not that the vendor
   behaves as documented. So the first real use is a handful of companies with
   `/runs` watched, not Run 3.

3. **Run 3: the remaining 229 companies.** About **US$80** live, or **US$40**
   batched, at Run 2's measured rate (US$0.31 a company: pass 1 US$0.22, pass 2
   US$0.10). Start it from `/runs`; the start form estimates per pass.

4. **Mail:** buy and verify a domain for this application (Samuel's decision
   and money), then set `MM_MAIL_FROM`; **rotate the Resend key**, which was
   pasted into a chat once. This is what unblocks Kay.

5. **Schedule retention.** The job now runs on either engine
   (`node scripts/retention.mjs "$MM_DATABASE_URL" --apply`), but nothing calls
   it, so production still sweeps nothing. Putting it on a timer is a decision
   about deleting production data automatically, not a port. (`cron_ticks`
   prunes itself to a week; `worker_runs` is a few rows a day and has no rule
   yet.)

6. **The remaining spikes:** S2 (fee disclosure coverage on five companies)
   and S4 (open the generated export in Excel).

7. **The pursuit data model** — a Phase 1 commitment in doc 02, not built.

8. **Hardening:** a monotonic column on `review_decisions` (today
    `decisionStamp()` carries the order); the domain allowlist as a database
    trigger (doc 11; enforced in code because the portable migrations forbid
    triggers); Deloitte SSO and `MM_ALLOWED_DOMAINS=deloitte.ca` when the
   pilot moves to Deloitte addresses. The live pipeline also records the
   replay pipeline's `PROMPT_VERSION` rather than its own.

9. **Tidy-ups:** an empty tracked file named `--` at the repository root.

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
