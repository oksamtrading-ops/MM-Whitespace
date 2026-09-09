# Runbook

Three things will go wrong first. Each has a diagnosis you can run and a fix you
can apply, because "restart it and see" is how a quarter close turns into a day.

Every command assumes the repository root and a period database at `./period.db`.

---

## 1. A run has stalled

**What you will see.** A run sits at `running` and the job counts stop moving.
The cron tick keeps returning `invokedWorker: false`, or returns `true` and
nothing changes.

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
curl -X POST localhost:3000/api/cron/tick -H "Authorization: Bearer $MM_CRON_SECRET"
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

## Standing checks

```bash
npm test                                   # library suites and the auth gate
node scripts/check_contrast.mjs            # every colour token against its floor
node tests/e2e/journeys.mjs                # five journeys, six routes
node scripts/retention.mjs ./period.db     # dry run; --apply to act
python3 scripts/verify_ground_truth.py --reference-dir reference
```

`retention.mjs` **exits non-zero while any rule has no named owner.** That is
deliberate: an unowned retention rule is one nobody will notice failing. Assign
owners in the `RULES` table before it runs on a schedule.
