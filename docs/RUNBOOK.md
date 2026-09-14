# Runbook

Three things will go wrong first. Each has a diagnosis you can run and a fix you
can apply, because "restart it and see" is how a quarter close turns into a day.

Every command assumes the repository root and a period database at `./period.db`.

---

## 1. A run has stalled

**What you will see.** **/runs** says `Stalled` — a run the database still
records as `running`, with nothing moved for three minutes and work left. The
screen names the expired leases and the abandoned jobs; the queries below say
why. The cron tick keeps returning `invokedWorker: false`, or returns `true`
and nothing changes.

### First, is the schedule being delivered?

A stall has two causes and they need different responses. The rail on
**/runs** answers this before anything else: **Last tick** says when the
scheduler last reached the application and what the tick concluded;
**Ticks, last 24 h** is against the 1,440 a per-minute schedule delivers;
**Last worker** says what the last invocation did and how long it lived.

| What you see | What it means |
|---|---|
| Last tick minutes or hours ago | The schedule is not being delivered. Check `vercel logs --query cron/tick`: a **405** means the route lost its `GET` export; a **401** means `CRON_SECRET` and `MM_CRON_SECRET` differ |
| Ticks arriving, `invoked` true, no worker run follows | The tick cannot reach the worker. Its note says why: no `MM_PUBLIC_URL`, no secret, or what the worker answered (a **409** is `MM_ENRICH_MODE` unset) |
| Worker runs ending `error` | The worker itself is failing; `last_error` on the row names it |
| Worker runs ending `deadline` with `lived` well short of the deadline | The platform ended the invocation early. Run the probe below |

```bash
curl -X POST "$MM_PUBLIC_URL/api/worker/drain?probe=1" -H "Authorization: Bearer $MM_CRON_SECRET"
```

A probe holds an invocation open, heartbeating, doing no work, until its
deadline. Its `worker_runs` row then says how long the platform actually let
it live. That is the measurement spike S1 reads; docs/decisions/S1-WORKER-SHAPE.md
records the last one.

### Diagnose

```bash
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./period.db");
console.table(db.prepare(`
  select state, count(*) n, min(updated_at) oldest, max(attempts) attempts
    from enrichment_jobs group by state`).all());
console.table(db.prepare("select id, leased_by, lease_expires_at from worker_slots").all());
'
```

Read it in this order.

| What you see | What it means |
|---|---|
| Jobs in `claimed`/`researching` with a **past** `lease_expires_at` | A worker died holding them. This is the ordinary case |
| Every slot leased, all `lease_expires_at` in the past | The slots leaked with the workers |
| Jobs in `awaiting_batch` and no movement | The batch is still running, or its results were never downloaded |
| `attempts` at `max_attempts` | These are not stalled, they are exhausted — look in `last_error` |

### Fix

The tick reaps expired leases every time it runs, so the ordinary fix is to let
it, or force one:

```bash
curl localhost:3000/api/cron/tick -H "Authorization: Bearer $MM_CRON_SECRET"
```

Locally there is no scheduler, so run the worker as a process instead:

```bash
MM_ENRICH_MODE=replay node scripts/worker.mjs ./period.db
```

**An expired lease returns its job to `queued` and charges NO attempt.** That is
deliberate: a worker killed mid-run must not burn a retry. So reaping is safe to
do repeatedly and you will not exhaust a job by doing it.

If the slots themselves leaked, the same reap clears them. If jobs are genuinely
exhausted, they are in `dead_letter` and need the underlying error fixed before
a replay — a replay creates a **new attempt and a new visible finding**, never a
silent overwrite.

### What not to do

Do not delete rows from `enrichment_jobs` to "clear" a stall. The ledger is how
the run knows what it has already paid for; deleting a job in `awaiting_batch`
loses a result you have already been billed for.

---

## 2. A spend halt

**What you will see.** The run status is `halted` with a `halt_reason`, and
every unfinished job has moved to `halted` too.

### Diagnose

```bash
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./period.db");
console.table(db.prepare(`
  select id, status, budget_usd, spend_usd,
         round(100.0 * spend_usd / budget_usd, 1) pct, halt_reason
    from enrichment_runs order by created_at desc limit 5`).all());
'
```

Two different things produce a halt and they need different responses.

| `halt_reason` | Cause | Response |
|---|---|---|
| `budget exhausted: …` | The run reached its own per-run budget | A deliberate stop. Decide whether the work is worth more money |
| A vendor billing error | The **account** spend limit was hit | Raise it vendor-side first, or every resumed job halts again immediately |

**Both spend-limit error shapes route to halt, not retry** — including the 400 a
self-set spend limit produces, which a naive classifier reads as permanent and
which would otherwise fail every remaining company one at a time.

### Fix

Raise the budget deliberately, with a recorded reason, then requeue:

```bash
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./period.db");
const runId = process.argv[1], newBudget = Number(process.argv[2]), reason = process.argv[3];
db.prepare("update enrichment_runs set budget_usd = ?, status = ?, halt_reason = null where id = ?")
  .run(newBudget, "running", runId);
db.prepare("update enrichment_jobs set state = ?, leased_by = null where run_id = ? and state = ?")
  .run("queued", runId, "halted");
db.prepare("insert into audit_log (event, period_id, detail) values (?, (select period_id from enrichment_runs where id = ?), ?)")
  .run("budget_raised", runId, JSON.stringify({ runId, newBudget, reason }));
' <run-id> 150 "quarter close, approved by <name>"
```

Raising the budget without recording why is the thing that makes the next
quarter's cost unexplainable. The audit line is the point.

---

## 3. The source workbook changed a column

**What you will see.** Ingest reports a blocking finding — `required_column_missing`,
`duplicate_column_key` or `ambiguous_column` — and refuses to commit.

This is the design working. Column mapping is by **compound name**, not by
letter, precisely so a shifted column fails loudly instead of silently loading
the wrong data into the right field.

### Diagnose

An Analyst sees this on **/upload**: the workbook is parsed, the report names the
finding, and the commit is refused until it is resolved. Nothing is written, and the
workbook is deleted as soon as it has been read. To get the same report on the
command line, with the column letters:

```bash
python3 -m mmparser.cli "reference/<workbook>.xlsx" --verbose
```

The report names the column letters involved. Then compare the headers the
parser actually resolved:

```bash
python3 - <<'PY'
import warnings; warnings.filterwarnings("ignore")
import openpyxl
from mmparser.workbook import bind_sheets, read_columns
wb = openpyxl.load_workbook("reference/<workbook>.xlsx", data_only=True)
findings = []
roles = bind_sheets(wb, findings)
ws, header_row = roles["matrix"][0]
for c in read_columns(ws, header_row, header_row - 1, findings).columns:
    print(f"{c.letter:>4}  group={c.group!r:44} header={c.header!r}")
PY
```

### Fix, by finding

| Finding | Fix |
|---|---|
| `required_column_missing` | The header was renamed. Add the new spelling to `HEADER_ALIASES` in `mmparser/aliases.py`, mapping it onto the existing slug. **Do not** rename the slug — everything downstream keys off it |
| `duplicate_column_key` | Two columns now resolve to the same `(group, header)`. The group row is what disambiguates the two fee blocks; check whether a group label was deleted |
| `ambiguous_column` | Code asked for a header that now appears more than once. Pass the group explicitly at the call site |
| `sheet_missing` | A tab was restructured past its content signature. Signatures are in `bind_sheets`; widen the one that no longer matches, and never bind by sheet name |

After any alias change:

```bash
python3 -m unittest discover -s tests
python3 scripts/verify_ground_truth.py --reference-dir reference
```

The ground-truth script re-measures every figure the design asserts. If an alias
change moves a count, that script is what tells you.

### What not to do

Do not map by column letter to get past it. **The column shift between the two
extract tabs is not a uniform offset** — it runs +1, then 0, then −1, because one
tab drops a column and collapses another. Letter mapping appears to work and is
wrong for a third of the columns.

---

## A database is a migration behind

A migration added later reaches new databases only: the schema is applied when
a database is created and never again. A read of an optional setting degrades
to its fallback rather than failing, so the symptom is usually a screen that is
missing rather than an error — **/settings** is the one that says so loudest.

```bash
node scripts/migrate.mjs ./period.db
```

It applies what is missing and records it. Run twice, the second is a no-op.
A database made before the ledger existed is adopted rather than replayed:
migrations run in order, so what it has had is the prefix ending at the last
migration whose first table is present.

## Moving to Postgres

The schema is canonical Postgres and the local runtime is SQLite, so the roles
and policies in `0003` and `0008` are skipped locally and only run where there
is a real database.

```bash
node scripts/migrate.mjs "$DATABASE_URL"              # schema, roles and policies
node scripts/pg_export.mjs ./period.db > period.sql   # a committed period, as SQL
psql "$DATABASE_URL" -f period.sql
MM_DATABASE_URL="$DATABASE_URL" npm run pg:smoke      # the adapter, against the real thing
psql "$DATABASE_URL" -f scripts/s5_access_model.sql   # prove the access model
```

Run the application against it by setting `MM_DATABASE_URL` instead of
`MM_DATABASE`; nothing else changes. `pg:smoke` is the one to run first after a
schema or query change — it checks that values come back in the shapes the
application expects, which is the difference that does not announce itself.

The export is a file rather than an API call on purpose: the extract is
licensed for internal use and not for redistribution, and a file goes from this
machine to the practice's own database through nothing else.

`s5_access_model.sql` seeds, probes every role, prints PASS/FAIL and deletes its
own rows. **Run it after any change to grants or policies.** What it guards is
in `docs/decisions/S5-ACCESS-MODEL.md`; the short version is that a policy
grants nothing, and enabling row-level security on a table whose role holds a
grant but no policy silently takes that grant away.

Run it as a login that can `set role` to `app_viewer`, `app_analyst` and
`enrichment_worker`. Admin option on a role stopped implying that at PostgreSQL
16, so grant the three `with set true` for the run and revoke them after. The
script checks all five roles before it seeds anything and stops with the ones it
could not become, because a refused `set role` reads as a refusal and a refusal
is what most of the probes expect: a suite that cannot assume the role would
otherwise print a column of PASSes proving nothing.

## Sign-in

An address and a password. **No mail is involved**, so nothing here waits on a
verified domain — that is the whole reason it changed
(`docs/decisions/S6-PASSWORD-AUTH.md`).

```bash
node scripts/migrate.mjs "$DATABASE_URL"   # 0009, 0010 and 0027-0029
```

Inviting somebody is two steps, and they are separate on purpose. First the
row, because sign-in is invite-only and an address with no row is not a user:

```sql
insert into app_users (email, role) values ('someone@deloitte.ca', 'analyst');
```

That address must be on `allowed_email_domains`, which an Admin edits on
`/settings` — a trigger enforces it, so an address outside the list cannot be
inserted by any route including this one.

A new row has **no password**, and cannot sign in until somebody gives them
one. An Admin does that on `/access` — *New password*, shown once — or from
outside the application:

```bash
node scripts/set_temp_password.mjs "$MM_DATABASE_URL" someone@deloitte.ca
```

Either way they are made to replace it the first time they sign in, so nobody
is left holding a working credential for somebody else's account.

**When somebody cannot sign in**, `audit_log` has the answer and the screen
deliberately does not — every refusal reads identically and takes the same
time. `sign_in_refused` carries the reason:

| Reason | What happened |
|---|---|
| `malformed` | Not an address, or no password typed |
| `domain` | Their domain is not on `allowed_email_domains` |
| `not on the roster` | No row in `app_users`. Invite them |
| `inactive` | Deactivated. `/access` reactivates |
| `no password set` | Invited, never given a password. Issue one |
| `bad password` | The account exists and the password is wrong |
| `throttled` | Too many recent failures — see below |

`sign_in` records a success, and is the only auth event carrying `actor_id`.
`password_set_by_admin` and `password_changed` record the two ways a password
moves.

**A run of `throttled` against one address is the signature worth knowing.**
Eight failures in fifteen minutes refuses everything from that address, the
right password included, and anybody who knows a colleague's address can spend
those eight guesses for them. It expires on its own; there is deliberately no
unlock button, because both Admins locked out with the cure behind an Admin
session is the deadlock it would create. `scripts/set_temp_password.mjs` clears
the counter, and runs from a shell rather than the product.

**Rows written before 14 September 2026 use the old vocabulary** —
`sign_in_link_sent`, `sign_in_link_refused`, `sign_in_mail_failed`, and a
`too many live links` reason. Nothing rewrites them, and `audit_log` is kept 24
months, so expect to meet them until late 2028.

**To end somebody's access now**, deactivate them on `/access`. That revokes
every session they hold as well as stopping the next sign-in.

## Standing checks

```bash
npm test                                   # library suites and the auth gate
node scripts/check_contrast.mjs            # every colour token against its floor
npm run e2e:isolated                       # five journeys, six routes
node scripts/retention.mjs ./period.db     # dry run; --apply to act
python3 scripts/verify_ground_truth.py --reference-dir reference
```

`e2e:isolated` runs the journeys in a detached worktree on its own port.
`npm run e2e` is the same suite, but Next allows one dev server per project
directory, so it must take down whatever is serving the demo for the length of
the run — **a page reloaded during that window comes back half-loaded and looks
like a broken interface**. Use the isolated form whenever someone is watching.

`retention.mjs` **exits non-zero while any rule has no named owner.** That is
deliberate: an unowned retention rule is one nobody will notice failing.

All five rules are owned by **Samuel Owusu** for the pilot. Two of them — raw
uploads and extracted document text — are automated and carry no judgement; they
are marked `transferable` and should move to a named engineer once there is one.
Change the owner in the `RULES` table in `scripts/retention.mjs`; the tests will
refuse a team name in that field.
