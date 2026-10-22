# Handover — Market Assessment Tool

> **Status at 22 October 2026.** **Q4-2026 is published as revision 4**
> (17:47 UTC, through a blocked gate, 5,496 values). It adds one value:
> Teck's **ERP change**, "Implementing". The ERP change is a new pass-2 field
> (`eef3fc9`, migration `0036`, rules `2026-10-22.1`). It records whether a
> filing says the company is selecting, implementing or has recently
> completed a new ERP system, named or not. That matters because filings
> almost never name the system: the incumbent ERP was asked for 248 of the
> 266 Q4 companies and named for one, Cameco. Pass-2 run `c4c761ec` read the
> 20 largest TSX companies for it (US$3.60) and found Teck alone. October's
> recorded research spend is US$128.31 across thirteen runs. Everything on
> `main` is deployed; migrations are applied through `0036`; the code last
> changed at `eef3fc9`. See "Done on 22 October 2026".
>
> **21 October, evening:** **Q4-2026 was published as revision
> 3** (19:27 UTC, through a blocked gate, 5,495 values). Audit-fee coverage is
> **47.0%** (125 of 266), up from 34.2% at revision 1 that morning. Two
> code changes made pass 2 find fees it had missed: the fee table is kept
> when a filing is long, the filing the exchange's rules put the fees in is
> read first, a company's former names are its own, current filings come
> before stale ones, and a 10-K filer's proxy statement is read (`40812f7`,
> `7aaf0f8`). A third lets a flagged row take newer research from a later
> filing (`1cd38e0`). Fourteen former names were added to `company_aliases`.
> Three pass-2 runs (US$29.58) and a fee review against every source table
> fed revisions 2 (17:49 UTC, 60 fees) and 3 (8 audit fees). October's
> recorded research spend is US$124.70 across twelve runs. Everything on
> `main` is deployed; the code last changed at `1cd38e0`. See "Done on
> 21 October 2026, afternoon".
>
> **That morning:** **Q4-2026 was published as revision 1**
> (12:58 UTC, through a blocked gate, 5,426 values): pass 2 ran on 20 October
> (`706429e0`, US$27.01), its two failures were fixed (`1e0fe9a`) and re-run
> (`f3d65dbd`, US$0.28), and every pass-2 row was reviewed against its source
> on 21 October (decisions 626 to 2743). Tiers resolve for 245 of 266; the 21
> companies with no documents read are unclassified (item 1). The review grid
> now redraws in about 3 seconds instead of 12 to 20 (`119c84b`). October's
> recorded research spend is US$95.12 across nine runs. Everything on `main`
> is deployed; the code last changed at `119c84b`.
>
> **As at 20 October:** the product is the **Market Assessment
> Tool** (formerly the Mining Whitespace Intelligence Tool), live at
> https://mm-whitespace.vercel.app. Releases A, B and C, built for the
> client's requests, have been deployed since 12 October. Since then, also
> on `main` and deployed:
>
> - the batch fix; Viewers no longer receive the Deloitte market; runs are
>   immediate (batching off); pass 1 is back on Opus after a cheaper Sonnet
>   trial failed; Pursuits removed (their tables kept); a tier dropdown on the
>   dashboard map; commodities in the companies table and in pass 2;
> - **next quarter from TSX's list** (17 October, migration `0033`): an
>   upload of TSX's "List of Mining Companies on TSX & TSXV" rolls the last
>   published period forward;
> - **six more pass-2 fields** (17 October, migration `0034`): revenue, net
>   income, total assets, audit-related and all-other fees, reporting currency;
> - **`/publish` lists what an amendment changes** (20 October), and asks for
>   a ticked confirmation when it changes nothing;
> - **"Newer research" no longer offers findings from older filings**
>   (20 October, migration `0035`): they go to an "Older filing" tab. Every
>   stored document has been read for its year;
> - **a run's "not yet done" counts research carried from an earlier quarter**
>   (20 October, `a701126`);
> - **an EDGAR record is no longer taken for an SEC registration**
>   (20 October, `a523198`): Form D, depositary and takeover filings and a
>   Form 15 deregistration all read as "not a registrant".
>
> **Q3-2026 is finished at revision 12** (20 October, 20:00 UTC): China Gold's
> auditor and Alkane's head office corrected, eight checked values added, and
> 45 of 259 companies tiered. **Q4-2026 (2026-08-31) is the working period**:
> committed from TSX's list on 20 October with 266 companies. Viewers keep
> Q3 until Q4 is published. **Pass 1 of Run 3 is done and reviewed for SEC
> registration and websites. Pass 2 is next** (item 2). October's recorded
> research spend is US$67.83 across seven runs.
>
> Everything on `main` is deployed; migrations are applied through `0035`.
> The code last changed at `a523198` (20 October). To start a new session,
> paste everything below the line.

---

I'm continuing work on the **Market Assessment Tool** (formerly the Mining
Whitespace Intelligence Tool) for Deloitte Canada's Mining & Metals practice.
It is built and running in production. Read this whole note before changing
anything.

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
5. Everything is on `main` except one branch. The local branches
   `publish-diff`, `newer-research-dates`, `fix-sec-registrant`,
   `fix/review-page-one-load`, `fix-pass2-failures`, `fix/pass2-fee-search`,
   `fix/pass2-fee-search-2`, `fix/review-flagged-newer`,
   `docs/handover-21-oct-evening`, `feat/erp-change-signal` and
   `claude/nostalgic-austin-62bc1b` (the scope rule, with its worktree in
   `.claude/worktrees/`) are merged and can be deleted.
   **`claude/cool-sinoussi-fb57b1` (`be511a7`) is not merged**: it fixes the
   three review-screen defects in item 2 and waits on Samuel's decision.
   Since `eef3fc9` it conflicts with `main` in one file,
   `src/app/(analyst)/review/by-company/CompanyGrid.tsx`: the branch moves the
   override hint into its own block, and `main` added an ERP change line to
   the old one. Take the branch's block and add the `erp_change` line to it.
   Run the checks on the merge before pushing.

## What is waiting on Samuel

In order. Item 1 is what Q4 revision 4 left open.

**1. What Q4 revision 4 left open.** Revisions 1 to 3 were published on
21 October and revision 4 on 22 October, each through a blocked gate with
its basis on the dashboard header. Revision 4's three blocks, the same as
revision 3's:
- **Tier distribution 92.1%** (245 of 266; floor 95%). 21 companies have no
  stage evidence decided, so they are unclassified: Amapá, Cadillac,
  Chesapeake, Copper Fox, Copper Giant, Discovery Silver, FireFly, Luca,
  Magna, Mega Uranium, Montage, Nevgold, PMET, Predictive Discovery, Revival,
  Rusoro, Sandfire America, Snowline, Southern Cross, Tudor and Westgold.
  (Revision 1's header named Lara instead of Rusoro; the list above is the
  gate's own count, checked again on 22 October.) Their stage and auditor were researched by hand on
  21 October (`reference/q4-unread-companies-research.json`, git-ignored: 37
  stages and 49 auditors, each with its source; those for companies that
  had a finding were entered as overrides), but **the review screens cannot enter
  a value for a company with no finding**: the field grid lists only
  findings, and the by-company grid's empty cells ("—") take no keys. A
  small code change (an override on an empty cell) would let a later
  revision tier them; it is on the unmerged branch in item 2.
- **Fabrication rate 2.8%**: 128 unsupported of 4,652 assessed findings
  (ceiling 2.0%; 2.3% of 3,280 at revision 1, 2.8% of 4,375 at revision 3,
  raised by the 21 October afternoon runs and run `c4c761ec`). Review cannot
  lower it. No unsupported finding was accepted; Vox's auditor change was
  quarantined but right, and was entered as an override, and quarantined fee
  rows were entered by hand only where the amount was checked in the filing.
- **19 fields with two proposals and no adjudication**, all from the
  21 October afternoon re-research: 14 commodity lists (Apollo Silver, Ecora,
  Energy Fuels, Erdene, First Mining, First Quantum, Franco-Nevada, Jaguar,
  Liberty, Osisko Gold Group, Silver Mountain, Talamore, Titan, Ucore); head
  office for Magna (Dowling or Sudbury), Osisko Gold Group and Rio2 (Toronto
  or Vancouver); region for Bunker Hill (two spellings of Idaho) and Rio2.
  Run `c4c761ec` added a third commodity list for Franco-Nevada and First
  Quantum, and no new conflict. Their values stand as in revision 1.
  Deciding a row clears it.

Also open, each recorded as a flag with its reason on `/review`:
- **China Gold's auditor** (and its auditor-since): Deloitte retired at the
  26 June 2025 AGM; BDO Limited audits the Hong Kong reporting and Lixin &
  Ethos the Canadian since 26 February 2026. Practice's call.
- **Helius, Mkango and Silver Mountain auditors**: no annual statements could
  be read to confirm them (Silver Mountain's FY2025 statements are on SEDAR+
  only, which Decision 1 rules out).
- **Atha and King Copper auditor change**: no appointment date found, so the
  24-month window cannot be settled. **Freegold and OceanaGold auditor-since**:
  the year is not established.
- **61 stale fee and financial rows**: tables two or more fiscal years old
  (38 fee rows, 23 financial rows, including Founders, Regulus and Silver
  Mountain, whose FY2025 has closed but whose annual figure was not read,
  and Highlander's fifteen-month and LunR's stub periods). Flagged, not
  published. Eleven of the fee rows were flagged on 21 October afternoon
  (Eloro, Erdene, Imperial, Meridian). Since `1cd38e0` a flagged row is
  offered again only when research reads a later filing than the flagged one.
- **31 quarantined "Nil" fee rows** from the 21 October afternoon runs were
  left undecided, as the morning's review left its own: accepting a zero the
  quote does not print is a judgement call.
- **Two duplicate company records**, offered for a merge since the former
  names went in: Osisko Development Corp. (ODV) is Osisko Gold Group, and
  Fuerte Metals Corporation (FMT) is Talamore Mining. The old records are in
  Q3 only, so Q4 counts nothing twice, but their Q3 history is not linked to
  the Q4 companies. Merging is Samuel's call, on `/companies/merge` ("Possible duplicates").
- **Unreviewed research from the 21 October afternoon runs**, for 108
  companies: every pass-2 field except the fees (the four fee types were
  reviewed for runs `be17897a` and `ee293a9a`, the audit fee alone for
  `965a1edc`). Corrections to decided rows show on each field's "Newer
  research" tab. China Gold's auditor tenure there proposes 2025 from a 2024
  report; the stored 2026 is right, so leave it.
- **Unreviewed research from run `c4c761ec`** (22 October), for the 20
  largest TSX companies: 237 proposals besides Teck's ERP change, plus 5
  unsupported and 34 not anchored. Of the 237:
  - **175 repeat the stored value.**
  - **25 are for a field with no value yet.**
  - **16 are stage proposals** that differ only in form, because the stored
    stage is a summary.
  - **21 differ:**
    - 12 commodity lists;
    - FY2025 fees replacing FY2024 for Ivanhoe (audit, audit-related) and
      Pan American (audit, audit-related, tax);
    - Lundin Gold's FY2025 total assets;
    - Barrick's FY2025 net income, US$4,993M against the stored US$7,154M
      (check which line of the statement each is);
    - China Gold's auditor tenure (2010) and auditor change (none). Both
      contradict what was established on 21 October; leave them.
- **103 commodities conflicts** and 4 head office region conflicts (Bunker
  Hill, Energy Fuels, GoldQuest, Marimaca) were left undecided, so TSX's
  values stand.
- **10 fiscal year-end and 10 head office rows** from EDGAR registrant
  profiles alone (evidence 0.585), for unread companies, were left
  undecided: EDGAR profiles can be years stale.
- **113 SEC registrant abstentions** were left blank, as decided on
  20 October. No publish floor reads the field.

**2. Three review-screen defects found on 21 October**, fixed on the
unmerged branch `claude/cool-sinoussi-fb57b1` (`be511a7`, "a value where
nothing was proposed, stage in bulk, and an honest bulk message"), which
waits on Samuel's decision to merge:
- **Stage cannot be bulk-accepted.** The dialog asks for `STAGE` typed, but
  `confirmationText` counts without `stageOptIn`, so it offers "Accept 0
  values" and the button stays disabled. Stage was accepted one row at a time.
- **"Bulk accept cancelled" after a bulk accept that succeeded** (auditor,
  148 rows, all saved).
- **No value can be entered for a company with no finding** (item 1).

A fourth, found that afternoon, is fixed and deployed (`1cd38e0`): a flagged
row could not take newer research, so Entree's and Marimaca's FY2025 fees,
found after their FY2022 and FY2023 tables were flagged as stale, could not
be entered from either screen.

**3. Things an agent did on Samuel's behalf on 20–22 October** that
Samuel should know: one research agent sent Samuel's email address to SEC
EDGAR once as its User-Agent (EDGAR asks for a contact); a source link
opened a file-save dialog in the browser (nothing was saved); and the review
page wrote to the OS clipboard during a synthetic keypress. On 21 October
afternoon, with Samuel's approval each time: 14 former names were inserted
into `company_aliases`; three pass-2 runs were started from `/runs`; and
revisions 2 and 3 were published. One mistake: the grid filter "Alamos" also
matched Minera Alamos, and decision 2748 accepted its abstention, storing an
empty audit fee. It was undone with the three newer audit-fee decisions
(2752–2755) and those three redone. The undo leaves an empty audit-fee row
for Minera Alamos, published blank in revisions 2 and 3, as it was blank in
revision 1. On 22 October, with Samuel's approval each time:
- migration `0036` was applied to production through the Supabase connector
  and recorded in `schema_migrations`;
- `eef3fc9` was pushed to `main`;
- run `c4c761ec` was started from `/runs`;
- Teck's ERP change was accepted (decision 2831);
- revision 4 was published.

**4. `npm run pg:smoke` from Samuel's own terminal**, never yet run against
this code. First load the address without echoing it:

```bash
read -rs MM_DATABASE_URL && export MM_DATABASE_URL
```

**Never type the address after `!` in a Claude session**: that lands it in
the transcript, and it runs in a different shell, without the variable.

**5. The second Admin cannot sign in.**
`hasaleem@r8dius.ca` (Hasan Saleem) was invited as Admin on 25 September and
set a password on 1 October.
- **2 October:** four `bad password` refusals.
- **9 October:** two refusals as **`hasaleem@deloitte.ca`**, reason `not on the
  roster`. Hasan is now signing in with a Deloitte address that has no account.
- **19 October: tried again**, seven refusals as `hasaleem@deloitte.ca` (`not on
  the roster`) and one `bad password` on `hasaleem@r8dius.ca`. One more failure
  inside fifteen minutes on one address throttles it.
- **20 October:** no attempts.

The fix is Samuel's choice:
- invite `hasaleem@deloitte.ca` as Admin on `/access` and deactivate the
  R8dius account, or
- issue the R8dius account a new password and tell Hasan which address to use.

The client's email of 9 October asked Hasan to check in with Samuel. Hasan is
still trying, so this is now the item most likely to be noticed.

**6. Confirm the AI notice's wording with the practice.** It is a draft, in one
constant (`AI_NOTICE`, in `src/lib/publish/notices.ts` and `mmparser/export.py`,
held in step by `notices.test.ts`):

> *Some of the information in this tool is researched with the help of
> artificial intelligence. A person reviews every researched value before it is
> published, and each one shows the source it came from. It can still be
> incomplete or wrong, so check the source before you rely on it.*

It must stay generic, because more than one AI tool may be used, and a test
refuses any tool or vendor name in it. Since revision 9, "each one shows the
source" is true on screen.

**The roster, as at 20 October 2026** (read the live state from `/access`):

| Address | Role | State |
|---|---|---|
| `oksamtrading@gmail.com` | Admin | settled, last in 20 Oct |
| `hasaleem@r8dius.ca` | Admin | **cannot sign in** (item 5); last in 1 Oct |
| `Kampofo@deloitte.ca` | Analyst | settled, **uses it unaided**: ran Lucara on 25 Sep, exported the workbook, undid Barrick's stage on 19 Oct; last in 19 Oct |
| `samowusuking@gmail.com` | Analyst | settled, last in 14 Sep |
| `saowusu@deloitte.ca` | Viewer | settled, last in 14 Sep |
| `rodcamara@deloitte.ca` | Viewer | invited 13 Oct, **not signed in yet** |

`allowed_email_domains` is `gmail.com, deloitte.ca, r8dius.ca`. Samuel added
`r8dius.ca` on `/settings` on 25 September, one minute before the invite.

## Where everything is

| What | Where |
|---|---|
| Project folder | `/Users/oksam/Documents/Work Research/Opp Research` |
| Repository | `github.com/oksamtrading-ops/MM-Whitespace`, branch `main`. **A push to `main` deploys production** — on 12 October Vercel took about six minutes to start one build, and failed another with `git_info_fail` (see the traps), so check `npx vercel ls` before concluding anything |
| Live application | **https://mm-whitespace.vercel.app** — Vercel project `oksamtrading-ops-projects/mm-whitespace`, linked locally in `.vercel/`. Not renamed; that is outward-facing and a separate decision |
| Database | Supabase project **MM_Whitespace**, ref `djepptfxdkvmcretnogy`, region `ca-central-1`, Postgres 17.6 |
| The client's requests | An email after a client conversation, 9 October 2026, read from a screenshot. See "Built on 9–12 October" |
| The plan B and C were built to | `~/.claude/plans/review-the-request-in-eager-noodle.md` (local only, approved by Samuel) |
| Start here | `README.md` — what is built, how to run it, and why |
| Operating it | `docs/RUNBOOK.md` — loading a period, sign-in, publishing, incidents |
| Design | `docs/DESIGN.md` and `docs/design/00`–`18`. **Section 00 first**. Two documents reverse earlier ones and say so: doc 18 reverses doc 17's light-first decision, and doc 11's authentication section reverses its own magic-link-only rule |
| Decisions | `docs/decisions/` — all ten closed; decision 1 approved by legal on 4 September 2026. `BATCH-API.md` records why both passes batch; **`S6-PASSWORD-AUTH.md` records why sign-in is a password, and what that gave up** |
| Settings | `.env.example` lists every variable; `.env.local` holds local secrets and is git-ignored |
| Source workbooks | Project root and `reference/`. **Git- and Vercel-ignored: licensed, and they carry personal data** |

Stack: Next.js 16.3.4, React 19.2.8, TypeScript 7.0.2, `pg` 8.23.0, Node 24.14.1.
Python 3.9.6 locally and 3.12 on Vercel, `openpyxl` 3.1.5. The code last changed at `eef3fc9`.

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
without the firm's own due diligence. The same rule is why an Incumbent ERP
override must cite a public page (Release C): an ERP known from an engagement
is client information.

## What exists, and what state it is in

### Done on 22 October 2026 — the ERP change field, run `c4c761ec`, revision 4

**Why the incumbent ERP is blank.** It was researched: pass 2 has asked for
it since Release C (12 October), ran for 248 of the 266 Q4 companies, and
by 21 October had written 353 ERP findings. But a filing names an ERP vendor only when a system
change touches internal control over financial reporting. One named a
system: Cameco, SAP S/4HANA. By a keyword grouping of their reasons, about
250 of the 352 abstentions say the documents contain nothing about an ERP.

**The options paper**, `reference/erp-research-options.md` (git-ignored,
drafted for Samuel and Kay), sets out five ways to research the ERP beyond
filings:
- **A.** A change field read from what pass 2 already reads.
- **B.** Search the company's own site and EDGAR full-text search: no new
  source, and about US$5 to pilot on 20 TSX companies.
- **C.** Analyst research, entered through the existing sourced override.
- **D.** Third-party pages: vendor case studies, newswires, job boards.
- **E.** Licensed technographic data.

D and E need legal review first. LinkedIn, engagement knowledge and SEDAR+
are ruled out. The paper recommends:
- building A now;
- piloting B;
- using C for the top of the pursuit list;
- taking D and E to legal only if B cannot reach enough.

What was done:
- **`eef3fc9`** (deployed): the `erp_change` field, option A.
  - **The value is `{status, year}`.** The status is selecting,
    implementing, or completed within the 24 months before the period date
    (`formatErpChange`: "Implementing (2026)"). The year is the go-live or
    completion year the passage gives.
  - **The excerpt must mention an ERP and a change word**
    (`describesErpChange` in `live.ts`), or the finding becomes an
    abstention. A risk factor, a director's past role and a system merely
    in use do not count. The rules version is `2026-10-22.1`.
  - **It is a pass-2 group marked `required: false`** (`scope.ts`). It is
    collected whenever pass 2 runs but does not decide whether a company's
    pass 2 is done (`requiredGroups` in `start.ts`). Without that, every
    company carried from earlier research would read "not yet done".
  - **An override must cite a public page**, as for the incumbent ERP
    (`SOURCED_OVERRIDES`): "Implementing 2026 https://…".
  - **It is never bulk-accepted** and is re-researched after 365 days.
  - **"ERP change" is a column** in the companies table and the export,
    after Incumbent ERP.
- **Migration `0036`** (applied 16:06 UTC with `execute_sql`, recorded in
  `schema_migrations`): the `field_catalog` row. It creates no table, so it
  is written to be safe to replay.
- **Run `c4c761ec`** covered the 20 largest TSX companies by market cap
  (AEM, ABX, WPM, FNV, CCO, K, NTR, TECK, FM, LUN, PAAS, LUG, AGI, EQX, EDV,
  CDE, CGG, HBM, IVN, ELD). It ran 16:22–16:33 UTC and cost US$3.60 against
  a quoted US$6.00, which is US$0.18 a company.
  - **One ERP change: Teck, Implementing.** It comes from the audit
    committee's report in Teck's 2026 management proxy circular (EDGAR
    exhibit 99.1), which "reviewed matters related to the selection and
    implementation of a new enterprise resource planning system". No year is
    given, and the passage covers selection too. It was accepted as
    Implementing (decision 2831). It is the one the options paper predicted
    from Q4's abstention reasons.
  - **19 abstentions.** For the 18 besides Cameco, no document the run cited
    mentions an ERP at all. The check covers cited documents only, not every
    page read.
  - **Cameco abstained by the 24-month rule.** Its April 2024 SAP S/4HANA
    go-live is 28 months before the period date (31 August 2026). Measured
    from its fiscal year-end (31 December 2025) it would be 20 months, and
    would count. That is a choice about the rule, left as written; the named
    system is already accepted as Cameco's incumbent ERP.
  - **The run re-researched every pass-2 field** for the 20. What it found
    is unreviewed (item 1).
- **Revision 4** (17:47 UTC, 5,496 values): Teck's ERP change alone.
  Compared value by value, every other value, all 242 chart aggregates and
  every tier are as in revision 3. The override reason is revision 3's, with
  4,652 assessed findings and the 22 October research. The amendment reason
  quotes Teck's circular.

### Done on 21 October 2026, afternoon — fees: three fixes, three runs, revisions 2 and 3

Revision 1 published audit fees for 91 of 266 companies (34.2%). Of the 138
that abstained in pass 2, 60 were TSX and 78 TSXV, and there were four causes:
- **The fee table was cut.** `windowsOf` kept the windows in document order
  up to 30,000 characters, and the fee table comes late in an AIF or
  circular: 19 of the 27 TSX companies holding a current filing with the
  table never had it shown.
- **The wrong filing first.** Every company read its circular first, but
  under NI 52-110 only a venture issuer prints its fees there (Form
  52-110F2); any other issuer prints them in its AIF (52-110F1), and its
  circular refers the reader there.
- **No such filing in the list.** For 55 of the 78 TSXV abstentions, pass 1
  had found no circular, AIF or SEC annual report from 2024 on, and pass 2
  read only pass 1's list.
- **A former name read as someone else.** The name check knew only the
  canonical name: 76 documents were refused in Q4 pass 2, most of them the
  company's own under an earlier name.

What was done, in order:
- **`6df5506` and `40812f7`** (deployed): the fee windows are chosen right
  after the cover, densest first, in a 9,000-character reserve, and printed
  in document order; a later document is capped at what the request has left
  rather than cut. TSX companies read the AIF and SEC annual report first,
  TSXV the circular (`kindPriority`). When pass 1's list has no current
  filing of that kind, pass 2 makes one more discovery call asking for it
  (`FEE_SEARCH`; rules version `2026-10-21.1`). `namesCompany` also accepts
  the company's aliases, as whole words. The start form quotes pass 2 at
  $0.30 a company.
- **Former names**: 14 rows in `company_aliases` (`alias_type` `former`,
  `source` `research`) for 13 companies, e.g. Pampa Metals (Andina Copper),
  Ascot Resources (Cambria), Osisko Development (Osisko Gold Group), Fuerte
  Metals and Atacama Copper (Talamore), Treasury Metals (NexGold). Each was
  checked as a rename, not an acquisition. `reference/former-names-2026-10-21.sql`
  (git-ignored) holds the rows, the sources, and what was left out
  (acquisitions such as Signal Gold and Dolly Varden; names last used before
  2024). `name_normalized` is `normName` from `src/lib/db/commit.ts`.
- **Trial `be17897a`** (10 companies, US$2.92): audit fees for First Quantum,
  Platinum Group, Talamore (from Fuerte's AIF, under the old name) and
  Fireweed.
- **TSX run `ee293a9a`** (75 companies, US$18.05): 24 fees proposed (16 for
  FY2024 on), 6 quarantined, 45 none. The fee windows and the reading order
  found a current fee for 11 of the 26 companies whose list already held a
  current AIF or SEC annual report, at $0.13 each. The second search ran for
  49 companies at $0.30 each, and supplied the filing for only four fees
  (Entree, Magna, China Gold, and Imperial's stale one). Six of the eight
  stale fees came from old AIFs and two from old circulars: with kind ranked
  before age, an old AIF was read ahead of any current filing of another
  kind.
- **`7aaf0f8`** (deployed): `readingOrder` reads current filings (fiscal
  year no earlier than the one before the period's) before stale ones, then
  by kind; filings linked from an index page join that order instead of
  going first (Andina had read four 2023 filings that way). The second
  search runs only where pass 1 listed a filing of the fee kind, from an
  earlier year or on a host pass 2 cannot read: of the 56 companies searched
  again, the 28 with no such filing found no fee by it (US$8.70). A 10-K
  filer's latest DEF 14A is listed beside the 10-K, and pass 2 asks EDGAR
  for it when an older list lacks it (`edgarProxy`).
- **The fee review** (decisions 2744–2822): 114 fee findings from the first
  two runs, each checked against its fee table for amount, currency, scale
  and year. 43 accepted; 17 quarantined rows overridden with the checked
  amount (OceanaGold's four in US dollars, not the proposed Canadian); 11
  flagged as stale; 31 quarantined "Nil" rows and the rest left. FY2024 and
  later accepted, FY2023 and earlier flagged, as in the morning's review.
- **`1cd38e0`** (deployed): a flagged row is offered newer research when the
  proposal reads a filing reporting on a later year than the flagged one.
  Entree's and Marimaca's three FY2025 fees were then entered (2820–2822).
- **Revision 2** (17:49 UTC, 5,487 values): 60 fees for 26 companies, and
  nothing else changed. Audit fees 44.0%.
- **Run `965a1edc`** (32 companies: 23 TSXV with a circular in view or a
  second search due, the 8 stale-fee TSX companies, International Tower
  Hill; US$8.61): 8 current audit fees. International Tower Hill's came from
  its DEF 14A, Titan's and Torex's FY2025 fees replaced stale-flagged FY2022
  tables, and Osisko Gold Group's came from its 40-F under its former name.
  Silver Storm's came from a circular, and Amarc's, Colonial Coal's and
  NorthIsle's were quarantined and checked. The five that found only stale
  tables again stayed quiet behind their flags.
- **Revision 3** (19:27 UTC, 5,495 values): those 8 audit fees (decisions
  2823–2830), and nothing else changed. Audit fees **47.0%** (125 of 266).

Still missing a fee: 141 companies. Most of the TSXV gap is circulars that
are on SEDAR+ only: 66 of the TSXV companies without a fee have never had a
circular or SEC annual report in pass 1's list, so the second search skips
them by design.

### Done on 20–21 October 2026 — pass 2, its review, Q4 revision 1

- **The 8 quarantined websites** (decisions 618–625): Chesapeake, GoldQuest,
  Mega Uranium, Westgold and Cadillac accepted; Amapá, Mkango and Predictive
  Discovery overridden to their own sites.
- **Pass 2, run `706429e0`** (20 October, US$60 budget, US$47.88 estimate):
  264 of 266 jobs, US$27.01. Triple Flag failed on a NUL byte in a filing
  and enCore on the output-token cap. **`1e0fe9a`** strips NUL from extracted
  text, raises extraction `max_tokens` to 24,000, and stops the review board
  counting an abstention as both "no evidence" and "quarantined". Re-run
  `f3d65dbd` (US$0.28) completed both.
- **The review, 21 October** (decisions 626–2743: 1,050 bulk accepts, 801
  single accepts, 192 overrides, 73 flags, 2 undos). The approach: sample
  the 0.75+ rows against their quotes, write a brief
  (`reference/review-brief-q4-pass2.md`, git-ignored), research every
  doubtful row in filings, and only then decide. Rules applied:
  - stage: development needs a PFS/FS, construction, permits towards it or
    a restart being prepared; a PEA or resource alone is exploration;
  - auditor: the firm engaged at the period date (31 August 2026); "since"
    and "change" kept consistent with it;
  - fees: summed across firms when two billed one year (Champion, Integra,
    Solaris, Vizsla Silver, Vox);
  - net income: the total for the year, not the attributable line (Barrick,
    Energy Fuels, Meridian);
  - stale data: one fiscal year old accepted, two or more flagged.

  Every auditor where pass 2 proposed a different firm from Q3 (24) was
  checked against the FY2025 audit report or AIF before the bulk accept.
- **`119c84b`, the review grid's redraw** (deployed 21 October). The page
  called `fieldRows` eight times per render — once for the grid and once for
  each filter count — and each call reads every candidate in the period. A
  decision took 12 to 20 seconds to redraw and some redraws timed out ("This
  page could not be drawn"). It now loads once and narrows in memory
  (`inBucket` in `src/lib/review/queue.ts`); a redraw takes about 3 seconds.
- **Q4 revision 1** (12:58 UTC): 5,426 values; auditor cross-tab 93.6%,
  footprint and jurisdiction 95.5%, fees 34.2%, tiers 92.1%. The header
  states the basis, including the 21 unread companies by name.

### Done on 20 October 2026 — Q3 finished, Q4 rolled forward, pass 1

- **Revision 12 of Q3** (20:00 UTC) froze 4,082 values and 92 stage rows; 45
  of 259 companies are tiered. Before it: one undo each on China Gold's
  auditor change and tenure; on `/review/head_office_location`, the undos,
  Alkane overridden to Perth, and Almonty, Osisko Metals and Allied Gold
  accepted again; and eight values accepted after a check in the stored
  filings: Almonty's audit fee, tax fee and stage (Tier 3), and nil tax fees
  for Equinox, Ivanhoe (FY2024), NexGen, Santacruz and Versamet. `/publish`
  listed exactly those 12 changes. Its header states the basis: *"Coverage
  floors are not met: 45 of 259 companies are tiered and Run 3 has not
  happened…"*.
- **The document backfill ran through the Supabase connector**, at Samuel's
  request, not from the script: `reportsOn`'s three patterns rebuilt in one
  SQL statement, written as `reports_on_version` `sql-1`. 246 of 320
  documents dated, as the script predicted. Documents stored since are read
  as they are stored (version `1`): 605 in all, 262 dated, none unread.
- **Q4-2026 (2026-08-31)** was committed from TSX's list at 20:18 UTC: 266
  companies at or above C$200M, 242 continuing, 24 new and 17 leaving,
  matching the local check of 17 October.
- **The scope rule** (`a701126`, deployed). A run's "Not yet done" now leaves
  out a company whose research is settled in review in an earlier quarter
  and carried here, by field group (`FIELD_GROUPS` in
  `src/lib/enrich/scope.ts`). A group counts as researched when any of its
  fields is, and pass 2 counts only when both of its halves are.
- **Run 3, pass 1.** Discovery runs on Opus (`ROUTE_CONFIG` in
  `src/lib/enrich/client.ts`). The run's `model` column shows the worker's
  default, `claude-sonnet-5`, whichever routes ran, so do not read it as the
  model used.

  | Run | Companies | Budget | Spend |
  |---|---|---|---|
  | `8cf391a5`, the 24 newcomers | 24 | US$8 | US$4.94 |
  | `cb37f9bb`, the rest not yet done | 205 | US$65 | US$43.00 |
  | `59d28e75`, the corrective re-run for SEC registration | 58 | US$20 | US$12.14 |

  The 229 cost US$0.21 a company. The other 37 were covered by research
  carried from Q3. Samuel first asked for US$50 on the second run; the form
  refused it against its US$61.50 estimate, which overshot the spend by
  43%.
- **The SEC registrant fix** (`a523198`, deployed), then the corrective re-run
  and the review in item 1. See the trap *An EDGAR record is not a
  registration*.

### Built on 9–12 October 2026 — the client's requests

**Release B, how it was finished (12 October).** Migrations `0030`/`0031`
applied and verified; code pushed; then:

- **The head-office backfill ran through the Supabase connector, not Samuel's
  shell**, on his instruction — the logic of `scripts/backfill_head_office.mjs`
  with its guards rebuilt in one SQL transaction (revision must be 8; every one
  of 259 market caps equal to the committed fact). It wrote 259 facts and 234
  values, and left the 25 research and review values alone. Audited as
  `head_office_backfilled`, with the workbook's hash.
- **"Québec" became "Quebec".** Research had copied French filings' spelling
  for G Mining, Nouveau Monde and Radisson; Samuel decided the stored value
  uses the workbook's spelling. Corrected before revision 9, source and
  citation unchanged (audited as `head_office_spelling_normalised`), and
  Release C's `canonicalRegion` keeps it so for research, review and undo. The
  finding's QUOTE keeps the filing's spelling: it is the citation.
- **Revision 9** froze 4,030 values, all cited (211 to a filing, 7 searches that
  found nothing, 7 review entries, 3,028 to the workbook, 777 to the rules),
  76 stage rows and 259 head offices.
- **Four head offices disagree with the workbook** and are worth a reviewer's
  eye — research stands, but one of the two sources is stale: China Gold
  (research BC, workbook China), First Quantum (Ontario / BC), G Mining
  (Quebec / BC), Lundin Mining (BC / Ontario).

An email after a client conversation, 9 October 2026, asked for six things.
Samuel first excluded the sixth (*remove the Pursuit section*), then had it
done on 13 October (see *Pursuits removed* below). The other five, and two
instructions of his own, are built:

| # | Request | Where | State |
|---|---|---|---|
| 1 | A landing page with a disclaimer that results are generated by AI | Release A | **deployed 12 Oct** |
| 2 | Rename "Whitespace" to Market Assessment Tool | Release A | **deployed 12 Oct** |
| 3 | Company table: Audit Fees, Mine Lifecycle, Incumbent ERP; Company HQ in place of Deloitte market | B (C for ERP) | **deployed 12 Oct**; revision 9 published; ERP values arrive with C's re-run |
| 4 | Filters on Tier, HQ, Stage, Mine Lifecycle, Auditor, Footprint, property location; search reaching the company page | B | **deployed 12 Oct** |
| 5 | Multi-select filters, and an Excel export of the filtered table | B | **deployed 12 Oct** |
| — | Samuel: the disclaimer names no AI tool | A | deployed |
| — | Samuel: every screen cites its sources; publish always copies the evidence | B | **live since revision 9** |

**Decisions taken with Samuel**
- **Mine Lifecycle is Stage of Operations.** The four stage flags appear as tick
  columns, as the workbook's A.02 Matrix draws them, so "Stage" and "Mine
  Lifecycle" are one filter.
- **Company HQ** is the workbook's Head Office column.
- **The filtered export is open to every role.** It carries only the published
  snapshot a Viewer can already read.
- **ERP is research plus override.**

**Release A (deployed).**
- **Landing page.** `src/app/page.tsx` renders instead of redirecting. Every
  sign-in already ended at `/`, so everybody passes the notice; there is no
  acknowledgement gate.
- **Routing.** "Continue" goes wherever `homeFor()` (`src/lib/auth/home.ts`)
  says, and the sign-in screen asks the same function.
- **The notice.** `AiNotice` (`src/app/_ui/AiNotice.tsx`) renders it as a
  callout on the landing page and as one quiet line on the dashboard, the
  companies table and the company page. The dashboard's licence notices are
  print-only, which is why it needed its own component. Both exports carry it.
- **The rename touches the product name only.** "Whitespace" as the domain term
  (companies Deloitte does not audit) stays, and so do the workbook's own name,
  the fixture file, the repository, the Vercel project and the URL.
- **The injection fix** (see the traps) shipped here too.

**Release B (deployed 12 October; revision 9 published the same day).**
- **One pure module for screen and export.** `src/lib/profile/roster.ts` (no
  node imports) holds the row, the filter, its URL form, the sort and their
  words. The client table and `/api/companies/export` both narrow through it,
  so a download never holds rows the screen did not show.
- **The URL is the state** (`?tier=2&hq=CA:ON&stage=production`), and the page
  parses it on the server. The map's old `?province=` link still works.
- **Columns:**
  - Stage (the one that decided the tier)
  - four Stage of Operations ticks
  - Footprint
  - **Company HQ** (short, as the workbook writes it: "ON", "Chile", "Toronto, ON")
  - Auditor
  - **Audit fees**
  - **Incumbent ERP**
  - Market cap
- **Deloitte market is gone from the table**, and from the export.
- **New controls.**
  - **MultiSelect** (`src/app/_ui/MultiSelect.tsx`) uses native `<details>` and
    real checkboxes. It is in `/styleguide`.
  - **Search** also matches every public company-page value that has no
    column, and says which one matched.
- **Citations (`src/lib/profile/citations.ts`).** A working value never
  recorded which finding produced it. The chain runs value → standing decision
  → finding → quote and documents. The resolver walks it once per period, in
  four queries, using a batched form of review's own "which decision stands"
  rule; a test pins the two together.
  - **Six kinds:** the filing and its passage; a search that found nothing,
    with the reason given; a reviewer's override and the source it cites; the
    workbook; an earlier period; the rules.
  - **Publish freezes all six** into the snapshot columns that existed and were
    never written. It refuses (`PublishUncited`, not an Admin override) a
    researched value with neither a quote nor a document.
  - **The company page** shows a citation on every value and anchors each row
    (`#v-<field>`), and the table's researched cells link there.
- **Stage rows are frozen with each revision** (0030/0031). Before, the table
  could only infer the stage from the tier.
  - Display is tri-state: a tick, a "?" where research is unsettled, and one
    "Not researched" cell, never four blank "noes".
  - **Revisions 1–8 froze no stage rows and no citations**, and are not
    back-filled. A revision's citations are the marker that it also froze stage
    rows (`carriesStages`), because zero stage rows cannot tell "nobody
    researched" from "not recorded".
- **Company HQ for all 259.** The parser now reads B.01 "HO Location" against
  "HO Region", cross-checked with the matrix "Head Office", and writes
  `head_office_region` the way EDGAR and research do. On the real workbook all
  259 read cleanly. Future periods get it at commit; Q3-2026 needs the backfill
  in item 1.
- **The export.** A Companies sheet carries the filter in words, the basis and
  the notices. Fees go in three columns, cited cells are hyperlinked, and a
  Sources sheet quotes each passage. The CSV has the same rows plus a source
  column per cited field. Every download is audited as `companies_exported`,
  with its filter.
- **The dashboard's period-export button** no longer shows to Viewers, who
  could only ever get a 403 from it.

**Release C (deployed 12 October).**
- **A new research field.** `incumbent_erp` (0032) is extracted in pass 2 with
  an anchored quote. A quote that does not name the proposed system is an
  abstention: "a new ERP" is real text that says nothing about which.
- **One spelling per system.** `canonicalErp` in `src/lib/format/fields.ts`.
- **ERP windows go last.** They are placed in whatever text budget the other
  fields left, so the field cannot push a fee table out of what the model reads.
- **An override must cite a public web address.** `SOURCED_OVERRIDES` in
  `decide.ts`, enforced in `recordDecision` for every path. The reviewer types
  "SAP S/4HANA https://…", and the address becomes the citation.
- **Not bulk-acceptable yet.**
- **Live rules move to `2026-10-09.1`.**
- **Since 22 October, an ERP change field beside it** (`erp_change`), for a
  change the filings describe without naming the system. See "Done on
  22 October 2026".

**The batch fix (deployed 12 October, `037d5b1`).** C's pass-2 re-run stalled,
and the cause was in how batched answers are saved.
- **What happened.**
  - Franco-Nevada's first answer named its auditor twice. Findings are unique
    per field and attempt, so the second insert failed the save part way.
  - That left the job in `persisting`, still holding the lease it was
    submitted under, which had expired hours before. The tick requeued it, and
    the company was researched and paid for a second time.
  - Its first answer, still waiting in batch `msgbatch_01SsmAWqCn9JaNksNfuYECYa`,
    then threw on every worker (`completed → persisting` is not a legal move).
    The error was swallowed, and IVN's and NTR's answers waited behind it.
  - Cleared by hand on 12 October: the stale request was marked cancelled
    (audited as `batch_request_superseded`) and the run completed.
- **What changed** (`worker.ts`, `batch.ts`, `drain.ts`):
  - **One finding per field.** The one the gate let through wins, then any
    other claim, then an abstention; ties go to stronger evidence, then the
    model's confidence. The full answer stays in `enrichment_job_results`.
  - **A save is all or nothing.** Findings and the job's move to `completed`
    are one transaction, so `persisting` is never seen outside it and the
    reaper cannot catch a job mid-save. Documents are inserted in hash order so
    that two saves cannot deadlock.
  - **A batched answer that fails to save is retried from the stored answer**,
    without asking the model again or charging twice. Each failure costs the
    job an attempt; once they are spent it is dead-lettered, so a batch cannot
    retry the same failure on every tick.
  - **An answer the job has moved past is set aside.** That covers a job
    finished by a later attempt, waiting on a later batch, or halted. The
    request is marked cancelled with the reason, and what it cost goes on the
    run.
  - **A result that throws stays open**, with its error on the request and
    the batch rows and in the logs, and the rest of the batch is still read.
- **Not covered by tests:** the Postgres engine (`pg:smoke`), the hash order,
  and the guard for two workers settling the same batch at once. SQLite cannot
  run two workers at the same time.
- **Left as it is:** a halted job's paid-for answer is set aside, not used, so
  resuming the run researches that company again.

**Checks on each branch:**

| Branch | Node | Python | End-to-end |
|---|---|---|---|
| Release A | 451 | 73 | 162 |
| Release C | 489 | 85 | 173 |
| Batch fix | 499 | 85 | 173 |
| Viewer market fix | 500 | 85 | 175 |
| Cheaper pass 1 | 501 | 85 | 175 |
| Opus restored, retries capped | 504 | 85 | 175 |
| Pursuits removed | 452 | 85 | 158 |
| Map tier switch | 457 | 85 | 159 |
| Commodities | 462 | 85 | 161 |
| Next quarter from TSX's list | 476 | 91 | 172 |
| Financials, fee lines, currency | 482 | 94 | 172 |
| Publish lists what changes | 492 | 94 | 174 |
| Newer research from older filings | 494 | 94 | 172 |
| Both, merged on `main` (20 Oct) | 504 | 94 | 174 |

The auth, class and contrast checks and the build pass on both. Each new
guard was watched failing against a planted bug, except where the traps below
say otherwise.

**Pass-1 trial: Sonnet with four searches (12 October), failed and reverted
(13 October).** Samuel asked to cut the API cost rather than move research onto
a Claude Max subscription. That move was weighed and set aside: Anthropic's
Claude Code documentation says Max usage limits assume ordinary individual use
and that products should use API keys, and Max runs on consumer terms rather
than the commercial API terms the risk review approved.
- **Measured first.** A pass-1 job averaged US$0.21 across 35 jobs: about 75%
  was Opus tokens (output, and search content cached and re-read on every
  turn) and a quarter was search fees. Every job used all six searches.
- **Trialled** on ten companies (run `5dd76d2b`), with discovery on Sonnet and
  four searches. It lost on both counts:
  - **Cost:** US$0.25 a finished company, run immediately, against Opus's
    US$0.21. The run recorded US$2.94, and more was billed (below).
  - **Quality:** every company spent its four searches, read the cap's error as
    the tool being down, and stopped. Paladin, China Gold and Osisko Metals
    found no filings and Versamet one; Barrick found 8 against Opus's 15 and
    Elemental 4 against 12. Two of five new websites were verified.
  - **Workers were cut off:** long, flailing discovery calls ran workers past
    the 720-second deadline. AII, DPM and NOU were cut off three times each and
    are halted in that run (audited `run_halted_by_hand`).
- **Reverted:** Opus and six searches again. Kept from the change: one
  constant, `DISCOVERY_MAX_SEARCHES` in `client.ts`, that the request and the
  route share, and the test that ties them. The `/runs` estimate is back to
  US$0.30 a company.
- **Known gap, unchanged:** findings record `claude-sonnet-5` whatever answered,
  because nothing sets the run's model. Opus pass-1 findings are labelled
  Sonnet too; tell them apart by run date. The trial's findings really are
  Sonnet's.

**Two fixes the trial exposed (13 October).**
- **A job cut off on every attempt is no longer researched forever.** Reaping
  charges nothing, but starting research charges an attempt, so a job the
  platform cuts off each time climbed an attempt per try and nothing stopped
  it. The reaper now dead-letters a job cut off on its last attempt, with the
  reason (`reapExpiredLeases`).
- **A model call's cost reaches the run as soon as it returns.** Spend was
  recorded only once a job saved, so an attempt that was cut off or failed had
  been billed and never counted. The synchronous path now records each call
  (`LiveDeps.spent`, `addSpend`), and finishing records only the remainder, so
  nothing counts twice. A call still in flight when the platform kills the
  worker is billed and lost, as before; batched runs are unchanged.

**Immediate runs (12 October).** The pass-1 trial's batch was still processing
after 20 minutes, where every earlier batch had finished in 2 to 10, and the
Batch API promises only 24 hours. Samuel chose immediate runs: the trial's
batch was cancelled in the Anthropic Console and `MM_ENRICH_BATCH` removed in
Vercel. Two things to know:
- **It costs more.** Batching halves token prices but not search fees. Across
  the remaining research, immediate runs cost about US$20 more.
- **A fix shipped with it.** The drain read open batches only while batching
  was on, so switching it off would have stranded any batch already sent, and
  nothing would ever have moved its jobs. It now reads an open batch either
  way, and anything the batch hands back (cancelled or expired) is then
  researched at once. A test covers both the answered and the handed-back
  case.

**Pursuits removed (13 October).** The client's sixth request, at Samuel's
instruction. The feature was self-contained: nothing outside it read its
tables, and no other table points at them.
- **Gone:** `/pursuits` and `/pursuits/[id]` (they now answer 404), the rail's
  Pursuits item, the company page's "Start / Open the pursuit" button,
  `src/lib/pursuit/`, the three pursuit vocabularies on `/settings`, the CSS
  only those pages wore (`.desk`, `.narrowing`, `.tag.retired`, `.tag.alert`),
  and the crosshair icon, whose one meaning was Pursuit.
- **Kept on purpose:**
  - **The tables and their rows** (`pursuits`, `pursuit_notes`,
    `pursuit_actions`, `pursuit_closures`; migrations 0018–0023 untouched).
    Production holds one pursuit (Barrick), two actions and one note. They
    stay locked down as before. Dropping them is a later choice: export the
    rows first, then add a migration with four separate `drop table if exists`
    statements, children first.
  - **The merge entry that moves pursuit rows** (`merge.ts`), so a kept
    pursuit never points at a company that no longer stands. Its test now
    inserts the rows directly.
  - **The settings rows** for the three vocabularies, unread, and the
    `pursuit_*` lines in the audit log, which is never edited.
  - **The word "pursuit" where it means the tier or a partner's
    conversation** ("Tier 6 is a watchlist rather than a pursuit").
- **Tests:** `pursuit.test.ts` (52) went with the feature. The class-check
  test that recreated the first `.filters` collision on the pursuit form now
  uses the companies filter bar. The settings round-trip test uses the
  sign-in domains. Journey 8 now holds the two Viewer Deloitte-market checks
  and proves `/pursuits` is gone and offered nowhere.
- **Docs not rewritten:** design docs 02, 05, 06, 11, 13 and 18 still describe
  Pursuits as designed. Read them as history.

**The map's tier switch (13 October).** Samuel asked to filter the dashboard
map by tier, or toggle to a tier map. One map, with a dropdown above it
("Show", a native select; Samuel preferred it to a row of eight buttons, which
took three rows on a phone):
- **All companies** is the map as it was. Hovering a province now also gives
  its split by tier ("By tier: Tier 1 · 3, Unclassified · 7").
- **Tier 1 to Tier 6 and Unclassified** redraw it for that tier, the ramp
  rescaled to it; each option carries its count, as one string ("Tier 4 (1)")
  so the markup is not split by React's text markers. Unclassified gathers the four
  reasons for no tier, and its "See them" link carries all four tokens, so the
  companies table shows exactly what the map counted. A tier view writes its
  numbers under the map, since the bars below stay every company's.
- **Counted as the snapshot counts.** `provincesByTier` (`crosstabs.ts`) reads
  the frozen revision, as the other cross-tabs do, entry for entry the way
  publish counts `province_footprint`, so a province's tiers add to its
  all-companies number. Checked on revision 9: 112 entries both ways, 83
  companies with Canadian ground.
- **Today most are Unclassified** (67 of 83), because a tier needs stage
  research. Tiers 1, 2, 4 and 5 hold 10, 2, 1 and 3. Run 3 changes that.
- **The legend** now names the counts each shade really covers. It used to
  show five shades labelled "1" when the top count was 1, and neighbouring
  steps could overlap.

**Commodities in the table, and in research (16 October).** Samuel asked for
the metals each company mines, from the workbook's B.02 tab (TSX's issuer list,
from tsx.com's mining sector profile). They were never missing: the parser has
always read B.02 and B.03's eighteen commodity flags and the "Other
Properties" text into `commodities`, published for 254 of 259 companies (27
names). They were only buried, one line on the company page.
- **Shown:** a Commodities column in the Companies table, after Footprint, the
  whole list wrapped (one company lists 14); a Commodity filter (OR within it,
  like the others, options from what rows hold); search treats it as on
  screen; sortable; in the Excel and CSV export; and in the company page's top
  facts. The five TSX lists nothing for (Cambria Gold, Doubleview, Rusoro, San
  Lorenzo, Selkirk Copper) read "Not listed".
- **Researched in pass 2**, on Samuel's choice, as ERP was: the model lists the
  commodities a filing's business description names, and `toFinding` keeps
  only those the quoted passage names (`canonicalCommodities`,
  `namesCommodity` in `fields.ts`, spelled as TSX spells them, "PGMs" as
  Platinum/PGM); none named is an abstention. "Base metals" names nothing. The
  business-description windows go last, like ERP's, so no fee is displaced.
  Live rules move to `2026-10-16.1`. A researched list that differs from TSX's
  lands in review's "extract disagrees" bucket, which bulk accept never takes.
- **Which companies get it:** every pass 2 from now on. The ~34 already
  through pass 2 only get it from a re-run (scope "Every company").

**Next quarter from TSX's list (17 October).** Samuel asked to use TSX's
issuer list for the next quarter's period rather than research what it already
says. He chose to download it from tsx.com, to carry **everything else, marked
with its age**, and to give a newcomer the Deloitte market **its head office
implies**.
- **Parsed** by `mmparser/tsxlist.py`. It recognises the list as two issuer sheets
  and no matrix, reads every issuer at any market cap (1,075 in September), and
  ties each sheet to its own "Number of Issuers" and "Total Market Cap". The
  payload says `kind: "tsx_list"`. Fixture: `tests/fixtures/build_tsx_fixture.py`,
  built at test time, never committed.
- **Planned** by `src/lib/ingest/tsx.ts`, read by both the report and the
  commit:
  - The threshold is applied from `/settings` (CAD only).
  - Companies are matched by open ticker on either exchange first, then by name
    or alias through merges.
  - It lists newcomers, leavers (under the line, or off the list), exchange,
    ticker and name moves, and near-the-line companies.
- **Committed** by `commitTsxPeriod` (`src/lib/db/committsx.ts`), in one
  transaction, as a new **draft** period with `source_kind = 'tsx_list'`:
  - Name, ticker, exchange and market cap always come from the list.
    Commodities, venture graduate, head office and regions come from it too,
    unless review settled them last period.
  - Where the list says nothing, last period's value stands. Five companies mark
    no region, and each is one of the workbook's five analyst-added regions.
  - Everything else is copied from the last published revision as `inherited`,
    with `source_period_id` set to the period it first came from, so a second
    quarter still dates it from the first. Stage rows come with it. Tiers are
    recomputed by `classifyResolved`, now shared with review's `retier`.
- **Cited and dated.** A carried value cites "Carried from Q3 2026" plus what it
  cited there (the filing, the quote), frozen with it at publish, so its "92d
  old" mark survives publishing. A value read from the list says "From TSX's
  list" and cites it by date and file hash.
- **Undo** on a carried field goes back to the carried value, not to empty
  (`inheritedOrigin` in `resolve.ts`).
- **Viewers read the newest *published* period** (`src/lib/db/periods.ts`):
  the companies table, company page, dashboard and the rail. Before this, a
  committed draft would have emptied every Viewer's screens until it was
  published.
- **Also fixed in passing:**
  - A workbook commit under a label already used for another date is now
    refused; before, it re-dated that period.
  - The upload form said "up to 25 MB"; the limit is 4 MB.
- **Checked on real data**, in a scratch copy of the workbook's database, with
  the September list: plan, commit through the form (37 ms for 266 companies),
  and publish, with all 3,990 values cited.

**Financials, the other fee lines and reporting currency (17 October).**
Samuel asked for the three research additions recommended from the workbook,
before Run 3 so pass 2 collects everything at once. Six fields (migration
`0034`, none bulk-acceptable):

| Field | Read from | Stored as |
|---|---|---|
| `total_revenue`, `net_income`, `total_assets` | the MD&A's selected annual information, or the statements | `{amount, currency, fiscal_year}`, as filed; a loss is negative |
| `audit_related_fee`, `other_fee` | the same fee table as audit and tax | `{amount, currency, fiscal_year}`, as the fees are |
| `reporting_currency` | the sentence that says what the statements are presented in | an ISO code |

- **Checked as the fees are:** the figure, a label from the field's list in
  `FIELD_LABELS` (`anchor.ts`), the year, the scale and the currency, all
  close together in the filing. A loss is stored negative but printed
  "(12,345)", so the check is given the figure as printed. A reporting currency
  whose quote does not name it is an abstention, as for ERP.
- **The windows go last.** The currency sentence and the financial-statement
  windows sit after ERP's and commodities', in whatever room the other fields
  left. Adding them cannot push a fee or an auditor out of what the model reads.
  A long filing may therefore leave no room for them, and those companies
  abstain. The first run will show how often.
- **Shown** on the company page and the review screens, both of which read the
  catalogue, and searchable and in the table export as the other fields with
  no column are. Not given table columns, which is a choice to make once values
  exist.
- **The Excel export's A.02** has its "Financial Metrics" block back (columns
  8–12: Total Revenue, Net Income, Total Assets, Period Ended, Currency). The
  source workbook filled it "in USD thousands" from a licensed database, and
  the export used to leave it out so nobody would reattach that lookup. It now
  holds only researched values, in the filing's own currency, never a formula.
  **B.04** gains the two fee lines after Website (columns 14–19), so every
  source column keeps its letter.
- **Rules version** `2026-10-17.1`. The ~34 companies already through pass 2
  only get these from a re-run.

**Flagged in passing, not fixed:**
- ~~**A Viewer still sees the Deloitte market**~~ on a company's page —
  **fixed 12 October.** `readCompanyProfile` now drops Deloitte-internal fields
  unless its `internal` option is set, and only Analysts and Admins set it. It
  is off by default, so a new caller hides the field rather than leaking it.
  The database policy in 0008 already hid these values from the Viewer role,
  but no request runs as that role, so the policy guards only direct access to
  the Data API, never the app.
- **0008 grants `app_analyst` select on the frozen tables with no analyst
  policy**, so through that role they return no rows. Nothing reads through it
  today, and 0031 pairs both for its own table.
- **The table keeps the derived "Stage" column** beside the four ticks, because
  the email said "in addition to what is already visible". Removing it is one
  line.

### Before 9 October


**Every milestone screen is built.** Upload and validation report, period
commit, run status, field-major and company-major review with keyboard accept,
override and flag, bulk accept, the publish gate and override, the dashboard,
company profiles and finder, identity merge, admin settings, the access review,
and password sign-in. Routes: `/upload`, `/upload/[id]`, `/runs`, `/review`,
`/review/[field]`, `/review/by-company`, `/publish`, `/dashboard`,
`/companies`, `/companies/[id]`, `/companies/merge`, `/access`, `/settings`,
`/styleguide`,
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

*Pursuits — the Phase 1 data model AND the Phase 2 workflow* (**removed from the
application on 13 October 2026**; what follows describes what was built, and
the tables it names are kept)

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

**The Batch API was ON in production, proven end to end, and switched OFF on
12 October** (see *Immediate runs* below), at Samuel's choice: research now
runs at once, at full token price. Putting `MM_ENRICH_BATCH=1` back and
redeploying turns it on again. As first set up, `MM_ENRICH_BATCH=1` was
deployed. A three-company smoke run took the
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

**Built and CUT OVER on 14 September 2026 — sign-in is an email address and a
password.** Applied, deployed, and in use: migrations `0027`–`0029` are on
Supabase, magic links are deleted, and three of the four people on the roster
have signed in through it.
`docs/decisions/S6-PASSWORD-AUTH.md` is the record; doc 11 is amended and keeps
the sentence it reverses visible.

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

**The cutover ran in that order and worked**: duplicate-address check (none),
migrate, seed both admins while the OLD sign-in still worked, then deploy. The
one thing that did NOT happen is a sign-in through the password form before the
deploy — the first admin was still on a pre-cutover magic-link session, which
stayed valid. Nothing was dropped and no variable removed, so a rollback is
still a redeploy; `auth_magic_links` is unreferenced but present, and is safe to
drop in a later migration once nobody wants that escape.

**Built on 14 September 2026, after the cutover — five things, all reported by
somebody looking at a screen.** Worth reading as a group: not one was caught by
a check, because in every case the markup was right and what was wrong was
layout, absence, or a claim in a comment.

- **Changing a password did not end your other sessions.** The plan said it
  should and the code did not; `revokeAllForUser` was wired into
  `setTemporaryPassword` alone. Found in production. Every session now ends on a
  change, the current one included, and a fresh cookie is handed back — without
  that, succeeding at changing your password would sign you out.
- **`/access` could review access and end it, but not GRANT it.** Inviting was a
  hand-written `INSERT` in the runbook and a role could not be changed at all.
  Now an invite form creates the row AND issues the password in one act, and
  roles change from the row. Not your own role, for the reason self-deactivation
  is refused.
- **There was no sign-out anywhere but `/signin`** — a page nobody signed in has
  a reason to open. It is in the rail's foot now. Worse than the missing button:
  `layout.tsx` carried a comment saying the rail keeps the user *"because
  signing out must stay reachable from anywhere"*, and it was not.
- **The rail's identity line wore `.role`**, which belongs to the sign-in
  screen's development buttons — a three-column grid with 22px of padding and a
  bottom border. The address measured **zero pixels wide** and a horizontal rule
  appeared under it that nobody drew. It read as a heading for a section that
  was not there. It is `.whorole`, and there is now a check (below).
- **A form field's border was 1.54:1 on dark**, against a non-text floor of 3,
  because `check:contrast` had never been told to look at a form field.
  `--input-border` is `--rule-raised` now and the pair is checked.

**`npm run check:classes` is new**, and is the gate for the trap that had sprung
three times (`.filters`, `.tag`, `.role`). It refuses a bare class rule that
imposes LAYOUT and is worn by two components that did not agree to share it;
both historical collisions are replanted as tests and watched failing. Two
earlier shapes were worse and are recorded in the script: flagging every shared
bare rule reported 33 findings, nearly all legitimate, and a check that cries
wolf 33 times is silenced in a week. What made it usable was **deriving "shared"
from `/styleguide`** rather than listing it — the styleguide renders every
shared component from the build, so a class it wears is already documented as
shared. To share a class, put the component in the styleguide.

**A request that was raised and dropped, so it is not raised again cold.**
Self-serve password reset and invite-by-email were discussed on 14 September and
**deliberately dropped**. Both need working mail, which is the thing that was
broken in the first place; a reset link is a magic link, so it would restore
most of what was just deleted; and a new sending domain mailing `@deloitte.ca`
may be quarantined by Deloitte's gateway, which is a risk worth one test message
before any work. If it comes back, `auth_magic_links` is still in the database
and the machinery is in git at `fc00769^`.

## Production settings

| Vercel variable (Production) | Value | Note |
|---|---|---|
| `MM_DATABASE_URL` | Supabase **transaction pooler** string, port 6543 (since 11 September 2026) | **Sensitive**, unreadable. Host `aws-1-ca-central-1.pooler.supabase.com`, user `postgres.djepptfxdkvmcretnogy` |
| `MM_AUTH` | `session` | Email and password since 14 September 2026 |
| `MM_MAIL`, `MM_RESEND_KEY`, `MM_MAIL_FROM` | `resend`, key, `Whitespace <onboarding@resend.dev>` | **No longer used by sign-in.** Kept set; `mail.ts` has no caller until something needs to send. The sender name still says Whitespace — change it to Market Assessment Tool before anything sends |
| `MM_ALLOWED_DOMAINS` | `gmail.com` | **Only a fallback.** The `allowed_email_domains` setting wins once it exists, and it does: `gmail.com, deloitte.ca` |
| `MM_PUBLIC_URL` | `https://mm-whitespace.vercel.app` | **How the tick reaches the worker** (`src/lib/enrich/kick.ts`). It used to be the origin in a sign-in link too; deleting it as dead magic-link config breaks enrichment |
| `MM_PARSE_SECRET` | shared secret | The Node app and `api/parse.py` both read it |
| `MM_CRON_SECRET`, `CRON_SECRET` | same value | The per-minute tick in `vercel.json`, and the worker endpoint |
| `MM_ENRICH_MODE` | `live` | Set 11 September 2026. Never `replay` in production: it would abandon every real company |
| `MM_ENRICH_BATCH` | **removed 12 October 2026** | Runs are immediate. It was `1` from 13 September, proven end to end — two real batches had settled. Sends each pass's model call to the Batch API, where the TOKENS are half price and the web searches are not. Migrations `0016`/`0017` are applied |
| `ANTHROPIC_API_KEY` | model key | **Sensitive**, added 11 September 2026, from workspace `mm-whitespace-prod` (`wrkspc_01W9ytyaac9BqDzPzLkxNAKT`) with a $100/month limit. Unused until `LIVE_ENABLED` is true |
| `MM_SEC_CONTACT` | contact email | **Sensitive**, set 11 September 2026. SEC EDGAR's required User-Agent contact. Live mode refuses to start without it |

**No variable is set for Preview deployments.** The CLI refused to add a
preview variable without a git branch. Previews are behind Vercel's login, and
uploads on them fail closed as "not configured". A *protection bypass token*
exists on the project (created by `vercel curl`); Vercel exposes it to
deployments as `VERCEL_AUTOMATION_BYPASS_SECRET`.

**Sign-in sends no mail at all.** The Resend account behind `MM_RESEND_KEY`
still has no verified domain and still reaches one inbox, and it no longer
matters: nothing in the auth path sends anything. `mail.ts` is kept and has no
caller.

**Invite people on `/access`**, which creates the row and issues a password in
one act, shown once. The raw insert still works and is still subject to the
`0024` trigger, but the screen is the supported way now:

```sql
insert into app_users (email, role) values ('someone@deloitte.ca', 'analyst');
```

`allowed_email_domains` is **`gmail.com, deloitte.ca`** and lives in
`app_settings`, editable on `/settings`. `MM_ALLOWED_DOMAINS` is only the
fallback for a database that has not had `0024`.

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

**A decision holds the grid until the page has redrawn.** `useDecide` keeps
`busy` true through `router.refresh()`, and a key pressed while busy is
dropped silently. Pace keypresses to the redraw (about 3 seconds since
`119c84b`). After the server's refresh, decided rows leave the bucket and the
cursor can sit past the last undecided row, so reload the page every few
accepts. Several tabs do not help: the server renders one page at a time, and
five tabs at once made pages fail to draw on 21 October.

**A typed flag reason needs one attempt.** Press `f`, wait for the box, type
once, Enter. Clicking into the box or retyping doubles the reason (decision
658, undone at 659).

**The grid's search matches part of a name.** `/review/<field>?q=Alamos`
shows Alamos Gold and Minera Alamos, and `a` acts on the first row. On
21 October that accepted Minera Alamos' abstention, which stores an empty
value (decision 2748). Undo is newest-first per field, so it took four undos
and three decisions redone. Before deciding by filter, check the term matches
one company, or type the full name.

**A field grid shows one finding per company: the one its standing decision
judged, or newer research.** Since `1cd38e0` a flagged row offers research
from a later filing; before that, a flag hid every later finding. Same-year
and earlier-year findings on a flagged row stay quiet by design.

**The browser pane can reopen signed out.** It did on 21 October evening.
An agent will not type a password, so Samuel signs in and says so.

**"The newest period" is two periods now.** Since a TSX list can commit a draft
after a published period, a Viewer's read must take the newest *published*
period and an Analyst's the newest of all: `shownPeriod`, `newestPublishedPeriod`
and `newestPeriod` in `src/lib/db/periods.ts`. A new screen that writes
`order by market_cap_as_of desc limit 1` for a Viewer shows them nothing, or a
draft.

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

**`e2e:isolated` could not see a DELETION until 14 September.** It builds a git
worktree at `HEAD` and rsyncs the working tree over it — and did so without
`--delete`, so a file removed in the working tree survived from `HEAD` and went
on being served. Journey 6 passed against `/auth/verify` after that route was
deleted: 147 green checks against code that did not exist. Fixed, but worth
knowing the suite ran that way for its whole life, so any past run that
"proved" a removal proved nothing.

**A required field on `AppUser` is a feature, not a nuisance.** There are TWO
construction sites — `resolveUser` and `userForSession`, which builds one from
its own join — and an optional field missed at the second reads as `undefined`,
which is falsy, which silently disables whatever depends on it. Making
`mustChangePassword` required made the compiler name both. Add fields the same
way.

**A password must never reach a log, and there are three paths.** An unhandled
throw whose message quotes the input; a `console.error(err, form)`; and Next's
development error overlay. Never log `FormData` in `signin/actions.ts` or
`password/actions.ts`, and catch narrowly — `ChangeRefused` only.

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

**`quotePrefix` is a style, not a type.** The export's injection guard set
`cell.quotePrefix = True` on anything Excel would interpret, and its test
checked that flag. But openpyxl decides a cell is a formula from its first
character, and writes `<f>…</f>` for a value beginning with `=` whatever the
style says. So `=HYPERLINK(...)` from data left every workbook as a live
formula from 12 September to 12 October. `put()` now also sets
`cell.data_type = "s"`, and the test reads the saved XML. Any check of an
export must read the FILE, not the object that wrote it.

**`periods.source_file_sha256` means two things.** The upload screen stores the
hash of the workbook's bytes; `scripts/commit_period.mjs` stores the hash of the
parsed JSON. Q3-2026 came through the script (`8c7405d3…`); the same workbook
uploaded through the screen on 11 September hashed `4d93cc52…`. Never use it to
prove "same workbook": the JSON's bytes change with every parser change. The
head-office backfill proves it by 259 market caps instead.

**A test can be written so that it cannot fail.** The ERP-window test's first
version passed with or without the protection it was written for: each pattern
takes at most six windows, so its document never reached the cap. It was
caught only because the planted bug did not turn it red. Plant first, every
time.

**`PublishUncited` has no override, and an unfaithful fixture will hit it.**
Publish refuses a researched value with neither a quote nor a document. Two
test fixtures that wrote findings "as the worker would have" omitted the quote
an anchored finding always carries, and one faked an `ai_accepted` value with
no decision behind it. Both were wrong, and the refusal was right. Give a
fixture a finding, a quote and a decision.

**`git checkout` carries uncommitted changes to the other branch** when they
do not conflict. On 9 October it moved Release B's work-in-progress onto
Release A's branch mid-cherry-pick. Commit or stash before switching.

**`e2e:isolated` can be blocked by a dead worktree registration** ("missing but
already registered worktree"). `git worktree list` shows it as prunable. Check
the commit it names is on a branch, then `git worktree prune`.

**A stale `.next/dev/types` fails the build's type-check** after a dev server
ran on another branch. It references routes the current branch does not have.
`.next/` is ignored build output: delete `.next/dev` and rebuild. Vercel builds
clean and never sees it.

**The browser pane cannot screenshot while it is hidden** ("not compositing
frames"). Read the DOM instead, or fix a viewport with `resize_window` before
screenshotting; the pane otherwise changes size between captures.

**A Vercel build can fail with `git_info_fail` before it starts.** The push
of `7828be0` errored within three seconds: Vercel could not read the commit
from GitHub. `npx vercel redeploy <failed deployment URL>` built it
cleanly. That commit was the only one whose summary line carried a non-ASCII
character ("Québec"); unproven as the cause, and cheap to avoid.

**Vercel can refuse a commit by its author's email.** On 12 October the push
of `037d5b1` never deployed, and a CLI deploy of it was *Blocked*: "the commit
email samowusuking@gmail.com could not be matched to a Git account". The
global git address on Samuel's Mac is that one, and `2bf0d77`, an hour
earlier, had the same author and deployed, so the check is not consistent.
The next commit was authored as `oksamtrading@gmail.com`, the address GitHub
itself puts on its own commits here, and Vercel builds the newest commit, so
that carried the fix out with it. The lasting fix is Samuel's: add
samowusuking@gmail.com as a verified email on the `oksamtrading-ops` GitHub
account.

**`git checkout -- <file>` while planting a bug also discards the fix.** On
12 October restoring a planted file that way threw away the uncommitted
change it was planted against. Copy the file aside and copy it back.

**A placeholder in a command will be run as written.** `MM_DATABASE_URL='…'`
was run literally and failed with `ENOTFOUND base`. Give the command that
loads the secret (`read -rs`), not a placeholder for it.

**CI was red from 10 September to 12 October and nobody noticed.** The Node
suite needs `npm ci` since `postgres.ts` imported `@vercel/functions`. Fixed
(`c6a54ef`); a red CI is a signal again, so keep it one.

**A batch that never settles used to say nothing.** Until `037d5b1` a result
that threw was swallowed, and the batch stayed open with no error anywhere.
Now read `last_error` on `enrichment_batch_requests` and `enrichment_batches`,
or search the Vercel logs for `left open`. A request still `submitted` with an
error is retried by the next worker; one the job has moved past is cancelled
on its own.

**`/Users/oksam` is itself a git repository**, with the Archieva folder inside
it. Never run `git add -A` outside this project's folder.

**Newer research can come from an older filing.** "Newer research" means a
finding created after the decision, not a document dated after it
(`newerThanDecision` in `src/lib/review/queue.ts` compares `created_at`). A
re-run that fetches an old circular proposes what that circular said, and
the tab offers it as a correction. On 18 October that reversed China Gold's
correct auditor change ("changed 26 June 2025") to "no change, since 2010".
Before taking a row there, check the quote's document is at least as recent
as the one the accepted value cites. **Fixed on 20 October (`1b09a4f`,
deployed):** each stored document records
the latest fiscal year it says has ended (`reports_on`, migration `0035`,
`src/lib/enrich/reportson.ts`). A later finding from a document that reports
on an earlier year than the accepted value's moves to an **Older filing**
tab: shown with both years, with no buttons, and not counted as waiting. If
either document states no year, nothing changes. On production's history it
demotes five findings: China Gold's two auditor rows and its Development
tick, and Radisson's and Wesdome's stage proposals.
`docs/decisions/NEWER-RESEARCH-FROM-OLDER-FILINGS.md` has the measurements.
`0035` was applied and the stored documents read on 20 October, so it acts
now.

**An EDGAR record is not a registration.** Until 20 October pass 1 proposed
"SEC registrant" for any company EDGAR had a CIK for, at evidence 0.88. In
Run 3 that was wrong for 55 of 116 proposals, plus 3 values carried from Q3:
- 49 had never registered. Their CIK came from a Form D for a US private
  placement, from a depositary's F-6 for an ADR (Alkane, Paladin), or from
  takeover filings such as 425, CB and F-80 (First Quantum).
- 6 had deregistered by Form 15 with nothing periodic after it: Arras, Entrée,
  Freegold, Gold Reserve, Patagonia and Rusoro.

**Fixed (`a523198`, deployed):** `registrationOf` in `src/lib/enrich/edgar.ts`
reads the filing list, newest first. A company is a registrant when it files
an annual report (40-F, 20-F, 10-K) or has a section-12 registration
(40FR12B, 20FR12G, 10-12B and the like). A Form 15 with no periodic report
after it ends the registration, and the quote is that form, so the reviewer
sees why. Seven tests in `edgar.test.ts`. The corrective re-run (`59d28e75`,
58 companies) proposed "not a registrant" for 54 and abstained on 4, which
were overridden by hand. Q3 revision 12 still shows the three carried ones
as registrants (item 3).

**`/runs` refuses a budget below its own estimate** (`start.ts`). On 20
October the estimate for 205 companies was US$61.50, and the run spent
US$43.00. Budget at or above the estimate. The run stops at its spend, not
at the budget.

**Undo is one field at a time, newest decision first, whoever made it.**
`undoLast` takes the newest standing decision on the field across every
company and every user. To reach an older one, every newer decision on that
field has to be undone first, and re-decided after. A held-down key records
one decision per repeat (Cameco's stage, five in seven seconds).

**A published revision carries what was decided, not what its reason says.**
The amendment reason is free text printed on the dashboard header. Revision 11
says "China Gold/Alkane fixes" and contains neither. **Fixed on 20 October
(`3c8b609`, deployed):** `/publish` now has a
"What changes in this revision" section, from `src/lib/publish/changes.ts`.
It compares the newest revision with the rows publish would freeze, value
against value, so an accept and its undo show nothing. It reads in eight
queries whatever the period's size. When nothing differs, the amend button
needs a ticked confirmation, which the server checks again. It is not refused,
because a header-only revision like 8 is legitimate. Checked: 10 new Node
tests (three watched failing against planted bugs), 174 end-to-end checks, and
both the refusal and the confirmed header-only publish on a local synthetic
database.

## What is left, in order

As at 22 October 2026, in the order worth doing:

| | | Whose |
|---|---|---|
| **a** | **Merge `claude/cool-sinoussi-fb57b1`** (the three review defects, item 2; one conflict since `eef3fc9`, see "First, before any work"), then **tier the 21 unclassified companies** from `reference/q4-unread-companies-research.json` and publish a later revision (item 1) | Samuel's decision, then Samuel or Kay on `/review` |
| **b** | **Review what the 21 October afternoon runs found** beyond the fees, for 108 companies; check run `965a1edc`'s tax, audit-related and other fees against their tables; and **review run `c4c761ec`'s 237 proposals** for the 20 largest TSX companies (item 1) | Samuel or Kay on `/review` |
| **c** | **The 19 gate conflicts** (14 commodity lists, three head offices, two regions) and the **two duplicate records**, Osisko Development and Fuerte (item 1) | Samuel or Kay; the merges are Samuel's call |
| **d** | **China Gold's auditor**, and the other flagged rows on `/review` (item 1) | the practice, then Samuel or Kay |
| **e** | **The ERP change for the other 246 companies.** Pass 2 re-researches every field when it runs. The start form quotes US$0.30 a company; the largest 20 cost US$0.18. Decide first whether "completed" should be measured from the fiscal year-end rather than the period date (Cameco). Then pilot option B of `reference/erp-research-options.md` (the company's own site and EDGAR full-text search, about US$5 for 20 TSX companies) | Samuel's decision (paid runs) |
| **f** | **The 141 companies still without an audit fee**: most TSXV circulars are on SEDAR+ only, which Decision 1 rules out | a decision about sources, not a build |
| **g** | **`pg:smoke`** (item 4) | Samuel's terminal |
| **h** | **Unblock the second Admin** (item 5) | Samuel, on `/access` |
| **i** | **Schedule retention.** The job runs; nothing calls it. Expired `auth_sessions` rows are accumulating as litter, not risk | a decision about deleting production data automatically |
| **j** | **Spikes S2 and S4** — fee-disclosure coverage, and opening the export in Excel | investigations, not builds |
| **k** | **Rotate the Resend key**, which was pasted into a chat once | Samuel |
| **l** | **Deloitte SSO**, the last hardening item. One seam | waits on a decision, not on code |
| — | ~~Release B~~ (12 Oct), ~~Viewers see the Deloitte market~~ (12 Oct), ~~re-run the ten trial companies~~ (13 Oct), ~~Barrick's fee currency~~ (18 Oct, US dollars), ~~the review brief's 15 items and revision 10~~ (18 Oct), ~~revision 11~~ (20 Oct, without its two corrections), ~~revision 12~~ (20 Oct), ~~the document backfill~~ (20 Oct, by SQL), ~~roll forward to Q4~~ (20 Oct), ~~Run 3 pass 1 and its SEC registrant correction~~ (20 Oct), ~~pass 2 for Q4~~ (20 Oct), ~~its review and Q4 revision 1~~ (21 Oct), ~~pass 2's fee search, former names, and Q4 revisions 2 and 3~~ (21 Oct), ~~the ERP change field, run `c4c761ec` and Q4 revision 4~~ (22 Oct) | done |

Rename the Vercel project, the URL and the repository only if Samuel decides
to; they are outward-facing.

### The list as it stood on 14 September, kept for its reasoning

Items 3–7 below are among the rows above. What is recorded under each, about why things
are as they are, still holds.

1. ~~Confirm the live upload~~, ~~read a day of ticks~~ (1,440 of 1,440),
   ~~Run 1~~, ~~the Excel export~~, ~~Run 2~~, ~~publish revision 7~~,
   ~~the pursuit data model~~, ~~the Phase 2 pursuit workflow~~ — all done.
   What follows is the work that has not been done.

   One thing from the pursuit work a later session should not undo: **doc 05's
   `lcsp` and `fy_tax_nsr` are deliberately not built**, and both doc 05 and
   migration `0018` say so. The Pursuit feature itself was removed on 13
   October 2026, its tables kept.

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

4. **Mail: blocking nothing. Rotate the key anyway.** It used to be what stood
   between Kay and an account; sign-in needs no mail at all now, and Kay has an
   account. Buying and verifying a domain is whenever somebody wants the
   application to SEND something — and on 14 September the obvious candidate for
   that, self-serve reset and invite-by-email, was raised and dropped on
   purpose. So there is no pending work behind it.

   **Rotating the Resend key still stands on its own**, because it was pasted
   into a chat once. That is a live credential in a transcript, and it is true
   whether or not the domain is ever bought.

5. **Schedule retention.** The job now runs on either engine
   (`node scripts/retention.mjs "$MM_DATABASE_URL" --apply`), but nothing calls
   it, so production still sweeps nothing. Putting it on a timer is a decision
   about deleting production data automatically, not a port. (`cron_ticks`
   prunes itself to a week; `worker_runs` is a few rows a day and has no rule
   yet.)

6. **The remaining spikes:** S2 (fee disclosure coverage on five companies)
   and S4 (open the generated export in Excel).

7. **Hardening: all done except Deloitte SSO.** It is still one seam,
   `sessionClaimSource`, and the password cutover was the first real evidence
   that the seam holds — it changed the whole of sign-in and touched no policy,
   no route guard and no role check.

   It no longer waits on mail. What it waits on is the decision to move the
   pilot onto Deloitte identity, at which point `allowed_email_domains` becomes
   `deloitte.ca` alone and `auth_passwords` stops being read. Two Deloitte
   addresses are already on the roster, so that half has happened.

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
