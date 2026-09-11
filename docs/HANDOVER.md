# Handover — Mining Whitespace Intelligence Tool

> **Status at 11 September 2026.** Built, deployed, published once, ingests a
> workbook in production, and researches live: Run 1 (five companies, $2.26)
> is done and its findings wait in review. To start a new session, paste
> everything below the line into it.

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

## Two things are waiting on Samuel

**1. The live upload is confirmed from the database side.** Samuel uploaded
`M&M - Whitespace Analysis Q3-2026.xlsx` on 11 September 2026 at 02:08 UTC.
The quarantine row's hash matched the local workbook byte for byte, and its
parse matched a local parse on every one of 7,091 values (the only difference
is Postgres printing 13 whole-number market caps without a `.0`). Nothing else
changed: still 1 publication, 259 companies, 3,626 frozen values. The one
thing unconfirmed is what the screen said at the end — the expected text is
**"Cannot be committed"**, because Q3-2026 is already published.

**2. Read a day of ticks.** The worker is deployed (commit `549475f`),
migrations `0013`/`0014` are applied and recorded, and the S1 probe lived its
full 240 s on production. What is left of S1 is a day of the per-minute
schedule — the first twelve minutes were twelve of twelve. After 12 September
2026 02:40 UTC:

```sql
select count(*) from cron_ticks where ticked_at > now() - interval '24 hours';  -- expect 1,440
```

`/runs` shows the same number in its rail. Record it in
`docs/decisions/S1-WORKER-SHAPE.md`.

**Kay could not sign in.** `Kampofo@deloitte.ca` was refused at 00:38 UTC on
11 September because only `gmail.com` is allowed, and Resend can only deliver
to `oksamtrading@gmail.com` until a domain is verified (item 6). Kay can only
get in through a Gmail address inserted into `app_users`. Tell Kay the refusal
was expected and not a fault.

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
`/signin`, `/auth/verify`, `/api/cron/tick`, and the Python function
`/api/parse`.

**Production holds the real Q3-2026 period.** 259 companies, **published as
revision 1 on 11 September 2026 at 00:56 UTC** by `oksamtrading@gmail.com`
through a closed gate, reason *"I'm testing the solution."* All 259 tiers and
3,626 values are frozen. The honest day-one spread is **242 unclassified and 17
at Tier 4**, because research has not been run.

**Production has no enrichment findings**, so its review board is empty. The
findings in a local preview are **synthetic seed data**
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

**Checks:** 311 Node tests, 54 Python tests, the authorisation check, the
colour-contrast check, the build, and 113 end-to-end checks.

```bash
npm test && npm run check:auth && npm run check:contrast && npm run build && npm run e2e
```

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

**`/Users/oksam` is itself a git repository**, with the Archieva folder inside
it. Never run `git add -A` outside this project's folder.

## What is left, in order

1. ~~Confirm the live upload~~ — done from the database side (the section
   near the top); ask Samuel what the screen said.
2. **Research in production — plumbing done and deployed.** The worker, the
   tick fix, the start-run screen and the S1 decision are built and measured
   (see "What exists"). Left: read a day of `cron_ticks` (the section near
   the top). Research itself waits on item 3.
3. **Live enrichment — on, and Run 1 is done.** S3 is done (Scale tier,
   `WORKER_SLOTS` stays 4; results in `docs/decisions/S3-ACCOUNT-LIMITS.md`).
   The two-pass pipeline and Run 1's results are in
   `docs/decisions/RESEARCH-PIPELINE.md`: AEM, WDO, ELE, NOU and RDS, $2.26
   across three runs, pass 1 $0.25 a company and pass 2 $0.10–0.12. The start
   form now estimates per pass from those figures. Run 1 found every fee held
   by three defects in the anchoring check, since fixed. Left, in order:
   - **Samuel reviews Run 1** on `/review`: websites and EDGAR values from
     pass 1, fields from pass 2. Elemental's head office really is Littleton,
     Colorado; there is no reject, so Override or Flag anything wrong.
     Nouveau Monde's head office conflicts: EDGAR's L'Ange-Gardien (accepted)
     against its own AIF's Saint-Michel-des-Saints (pending).
   - **Then publish revision 2.** A company page reads the published revision,
     for everyone, so nothing accepted shows until then; an Analyst or Admin
     sees a "Not yet published" notice naming what changed. *Done, 11
     September 2026.*
   - **Correct Radisson and publish revision 3.** Revision 2 has Radisson at
     Tier 4 as a royalty company on a quote that never mentions a royalty
     (RESEARCH-PIPELINE.md, "After revision 2"). Override its stage in review
     as "exploration + development" (Tier 5). Re-research the fees first if
     they should carry currency and year: pass 2, every eligible company,
     tickers AEM, ELE, NOU, WDO, about US$0.60.
   - **Re-run the fees**, if Samuel wants them: pass 2, "every eligible
     company", tickers AEM, ELE, NOU, WDO, about $0.60. Findings are not
     re-checked in place; a new run makes new ones.
   - **Run 2: 25 companies**, then all 259 (about $95 synchronously), then the
     **Batch API** at half price — not built: the ledger has an
     `awaiting_batch` state and nothing submits or polls.
   - A per-company cost on each job, so the estimate can use a p95.
4. **Excel export in the app.** It is only a Python command (`npm run
   export`); it needs a download, and on Vercel the same Python-function
   approach as the parser.
5. **Retention on Postgres.** `scripts/retention.mjs` works on SQLite only, so
   nothing sweeps production: expired parses, sign-in links and sessions are
   hidden by their expiry but not deleted. (`cron_ticks` prunes itself to a
   week; `worker_runs` is a few rows a day and has no rule yet.)
6. **Mail:** buy and verify a domain for this application (Samuel's decision
   and money), then set `MM_MAIL_FROM`; **rotate the Resend key**, which was
   pasted into a chat once.
7. **The remaining spikes:** S2 (fee disclosure coverage on five companies)
   and S4 (open the generated export in Excel).
8. **The pursuit data model** — a Phase 1 commitment in doc 02, not built.
9. **Hardening:** a monotonic column on `review_decisions` (today
   `decisionStamp()` carries the order); the domain allowlist as a database
   trigger (doc 11; enforced in code because the portable migrations forbid
   triggers); Deloitte SSO and `MM_ALLOWED_DOMAINS=deloitte.ca` when the pilot
   moves to Deloitte addresses.
10. **Tidy-ups:** an empty tracked file named `--` at the repository root.

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
