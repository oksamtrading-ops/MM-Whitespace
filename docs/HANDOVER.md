# Handover — Mining Whitespace Intelligence Tool

> **Status at 11 September 2026:** built, deployed, and published once. Copy
> everything below the line into a new chat, or hand it to whoever picks this up.

---

I'm continuing work on the **Mining Whitespace Intelligence Tool** for Deloitte
Canada's Mining & Metals practice. The application is built, running in
production on Vercel against Supabase, and its first period has been published.
Read this before changing anything.

## Where everything is

| What | Where |
|---|---|
| Project folder | `/Users/oksam/Documents/Work Research/Opp Research` |
| Repository | `github.com/oksamtrading-ops/MM-Whitespace`, branch `main`. Pushes to `main` deploy |
| Live application | **https://mm-whitespace.vercel.app** (Vercel project `oksamtrading-ops-projects/mm-whitespace`) |
| Database | Supabase project **MM_Whitespace**, ref `djepptfxdkvmcretnogy`, `ca-central-1`, Postgres 17.6 |
| Start here | `README.md` — what is built, how to run it, and why |
| Operating it | `docs/RUNBOOK.md` — loading a period, sign-in, publishing, the database, incidents |
| Design | `docs/DESIGN.md` and `docs/design/00`–`17`. **Read section 00 first** |
| Decisions | `docs/decisions/` — all ten closed; decision 1 approved by legal on 4 September 2026 |
| Settings | `.env.example` lists every variable; `.env.local` holds local secrets and is git-ignored |
| Source workbooks | Project root and `reference/`. **Git- and Vercel-ignored: licensed, and they carry personal data** |

Design-phase briefing (private artifact):
https://claude.ai/code/artifact/3b403f16-632e-4fff-9ef3-3e33ca172270

## What the project is

The practice tracks every TSX and TSXV mining company above a market-cap
threshold and assigns each a pursuit tier. The quarterly refresh stalled at
research: stage-of-operations flags were blank for 242 of 259 companies, so
every company computed as Tier 4 and the dashboard was meaningless. This
application ingests the workbook, enriches each company against public sources
with evidence attached, routes every proposed value through human review,
applies the existing tier rules unchanged, and publishes a frozen snapshot to
the dashboards.

Owners: **Kay Ampofo** (workbook and domain) and **Samuel Owusu** (solution).

**This build is a proof of concept and stores no Deloitte client information.**
The `Deloitte Tax Client` column is excluded at parse time and named in the
validation report as deliberately skipped. Do not add it back without the
firm's own due diligence.

## What exists, and what state it is in

**Every milestone surface is built.** Upload and validation report, period
commit, enrichment runs and run status, field-major and company-major review
with keyboard-driven accept, override and flag, bulk accept with its refusals,
the publish gate and override, the dashboard, company profiles and the company
finder, identity merge, admin settings, the access review, and magic-link
sign-in. Routes: `/upload`, `/runs`, `/review`, `/review/[field]`,
`/review/by-company`, `/publish`, `/dashboard`, `/companies`,
`/companies/[id]`, `/companies/merge`, `/access`, `/settings`, `/signin`,
`/auth/verify`, `/api/cron/tick`.

**Production holds the real Q3-2026 period.** 259 companies, committed through
the real parser, **published as revision 1 on 11 September 2026 at 00:56 UTC**
by `oksamtrading@gmail.com`, through a closed gate with the reason *"I'm testing
the solution."* All 259 tiers and 3,626 values are frozen into the snapshot.
The gate was closed because research has not been run: the honest day-one
spread is **242 unclassified and 17 at Tier 4**.

**Production has no enrichment findings.** The review board on the live site is
empty. The 518 findings in the local preview are **synthetic seed data**
(`prompt_version = 'synthetic-fixture'`), invented to exercise the review
screens. They sit next to real company names, so none of them may be quoted as
a finding.

**Live enrichment is off.** `src/lib/enrich/worker.ts` refuses `mode: "live"`.
Runs replay recorded cassettes only. There is no `ANTHROPIC_API_KEY` anywhere.

**The checks are green.** 251 Node tests, 49 Python tests, the authorisation
check, the colour-contrast check, the production build, and 99 end-to-end checks.

```bash
npm test && npm run check:contrast && npm run build && npm run e2e
```

## Running it locally

The local runtime is SQLite; production is Postgres. One interface,
`src/lib/db/sql.ts`, sits in front of both, and nothing else in the application
knows which it is talking to.

```bash
python3 -m mmparser.cli "M&M - Whitespace Analysis Q3-2026.xlsx" --json /tmp/period.json
node scripts/commit_period.mjs /tmp/period.json ./period.db --fresh
node scripts/seed_review_fixture.mjs ./period.db      # SYNTHETIC findings, for the review screens
node scripts/publish_period.mjs ./period.db --publish --override "local baseline"
MM_DATABASE=./period.db MM_AUTH=dev MM_DEV_AUTH_SECRET=local npx next dev
```

`MM_AUTH=dev` puts three one-click accounts on `/signin`. Insert them first:
`admin@`, `analyst@` and `viewer@example.invalid` in `app_users`.

## Production, and what it depends on

| Setting in Vercel | Value | Note |
|---|---|---|
| `MM_DATABASE_URL` | Supabase **session pooler** string | Marked **Sensitive**: it cannot be read back, including by `vercel env pull` |
| `MM_AUTH` | `session` | Magic link |
| `MM_MAIL` / `MM_RESEND_KEY` / `MM_MAIL_FROM` | `resend` / key / `Whitespace <onboarding@resend.dev>` | |
| `MM_ALLOWED_DOMAINS` | `gmail.com` | Gmail for the pilot; see below |
| `MM_PUBLIC_URL` | `https://mm-whitespace.vercel.app` | The origin written into sign-in links |
| `MM_CRON_SECRET`, `CRON_SECRET` | same value | The hourly tick in `vercel.json` |

**Only one inbox can sign in today.** The Resend account belongs to
`oksamtrading@gmail.com` and has no verified sending domain, so Resend delivers
only from `onboarding@resend.dev` and only to that address. Both
`oksamtrading@gmail.com` and `samowusuking@gmail.com` are Admins in
`app_users`; only the first can receive a link.

**With `gmail.com` allowed, the roster is the whole gate.** Sign-in is
invite-only, so an address with no row in `app_users` is not a user whatever
the mail provider says. Invite by inserting:

```sql
insert into app_users (email, role) values ('someone@example.com', 'analyst');
```

## Do not trust the brief's appendices

Both workbooks were read cell by cell, and every figure below is re-measured by
`python3 scripts/verify_ground_truth.py --reference-dir reference`. Where the
brief and these disagree, these govern.

- **The population is 144 TSX / 115 TSXV / 0 other**, not 143/115/1.
- **The matrix joins by row position, not ticker**, so sorting the workbook
  silently reassigns a partner's research to another company.
- **Stage is tri-state.** Blank means *not researched*, not false.
- **12 companies have no region values**, all royalty or streaming; the workbook
  files them "Canada only". `footprint = none` is the fix.
- **Deloitte green `#86BC25` is 2.27:1 on white** and fails for text. Text uses
  `#567C18`; `scripts/check_contrast.mjs` enforces every token.
- **The tier rules are correct as written.** Only their inputs change.

## Decisions already made

- Postgres job ledger and a stateless worker; the cron tick enqueues and does
  no work itself.
- Batch API for enrichment. The model discovers sources; **the application
  fetches, caches and anchors the citation**, and a value it cannot trace to a
  document it retrieved is quarantined.
- **SEDAR+ is legally excluded** — its terms forbid automated and manual
  scraping and storing its data. Issuer-hosted documents first; fees last.
- Publish freezes an immutable snapshot; dashboards read only that.
- Authorisation is `requireRole` as the first statement of every action and
  route (`npm run check:auth` fails the build otherwise). Middleware redirects
  and is not a boundary. Row-level security underneath is defence in depth.
- **Sign-in is magic link, and sessions are rows**, because doc 11 requires them
  revocable. Deactivating an account on `/access` ends its live sessions.
  Neither auth table stores a token, only its SHA-256. Deloitte SSO replaces one
  function, `sessionClaimSource`, and nothing else.

## Things that will cost you an afternoon if you do not know them

**Transactions go through `db.tx(async (db) => …)` and nothing else.** A bare
`db.exec("begin")` works on SQLite and silently does not against a Postgres
pool, where begin, each statement and commit can land on different
connections. That shipped once, in publish, commit and merge, and was caught
before the first production publish. A test scans for it.

**SQL must run on both dialects as written.** No `rowid` (Postgres has none —
use `returning id`). No `current_timestamp` for ordering (on Postgres it is the
transaction's start time; use `decisionStamp()` from `src/lib/db/stamp.ts`, and
`formatStamp()` for any other time). No `max()` over `jsonb` (cast to text).
Qualify the column in `on conflict … do update set n = table.n + excluded.n`.
Booleans are `true`/`false`, never `1`/`0`.

**Values come back from Postgres in SQLite's shapes** — text for jsonb and
timestamps, numbers for numeric and `count(*)`, 1/0 for booleans — because the
type parsers in `src/lib/db/postgres.ts` make them. `npm run pg:smoke` checks
this against a real database.

**Supabase needs the session pooler, not the direct host.**
`db.djepptfxdkvmcretnogy.supabase.co` is IPv6-only and Vercel cannot resolve
it. The pooler username is `postgres.djepptfxdkvmcretnogy`, not `postgres`.

**Supabase's certificate is not publicly trusted.** Its chain ends at *Supabase
Root 2021 CA*. That root is embedded in `src/lib/db/supabase_ca.ts` with its
provenance, and a test pins its fingerprint. Do not turn verification off.

**A changed environment variable needs a redeploy.** Vercel applies variables at
build time. Adding one and waiting changes nothing.

**One `next dev` per project.** A stale one blocks every other, including the
end-to-end suite. `pkill -f "next dev"` before starting another.

**The Supabase connector logs in as `postgres`, which cannot `set role`** to the
application roles (PostgreSQL 16 separated SET from ADMIN). The S5 access-model
script now refuses to run rather than report false passes; grant the roles
`with set true` for the run and revoke them after.

**Never paste a secret into a chat.** The Resend key was pasted once and must
be rotated. Secrets live in Vercel and in `.env.local`, nowhere else.

## What is left, in order

1. **Verify a sending domain in Resend** and set `MM_MAIL_FROM` to it. Until
   then nobody but `oksamtrading@gmail.com` can sign in.
2. **Rotate the Resend key** — in Resend, then in Vercel and `.env.local`.
3. **Turn on Deployment Protection** for preview URLs (Vercel → Settings), as
   doc 11 requires.
4. **Enable live enrichment.** Decision 1 is approved; what remains is an
   Anthropic API key and spike **S3** (confirm the account tier, set spend
   limits, exercise both spend-limit errors). Then remove the refusal in
   `worker.ts`.
5. **The remaining spikes:** **S1** (worker cadence and cron on the real plan —
   the hourly tick is a placeholder), **S2** (fee disclosure coverage on five
   sampled companies), **S4** (open the generated export in Excel).
6. **The pursuit data model.** Doc 02 puts "data model and access policy only"
   in Phase 1; it is not built.
7. **A monotonic column on `review_decisions`.** `decisionStamp()` carries the
   order today; a sequence would make it structural.
8. **Move to Deloitte addresses** when the pilot does: set `MM_ALLOWED_DOMAINS`
   back to `deloitte.ca`, and replace `sessionClaimSource` with SSO when that
   is ready. Doc 11 also asks for the domain allowlist in a database trigger;
   the portable migrations forbid triggers, so it is enforced in code.
9. **Tidy-ups:** an empty file named `--` is tracked at the repository root;
   `next-env.d.ts` changes on every build and should not be committed.

## Working conventions

- Run `python3 scripts/verify_ground_truth.py --reference-dir reference` after
  any change to a factual claim.
- Never commit a workbook. `npm run setup` enables the hook that refuses one.
- Migrations in `supabase/migrations/` are canonical Postgres. SQLite is
  translated from them by `src/lib/db/dialect.ts`, which throws on anything it
  cannot translate faithfully. Postgres-only files are skipped locally.
- `node scripts/migrate.mjs "$MM_DATABASE_URL"` brings Postgres up to date;
  `node scripts/migrate.mjs ./period.db` does the same for SQLite.
- The documents use sentence-style headings that state a point, decision
  before rationale, in Deloitte's voice. Keep that if you extend them.
