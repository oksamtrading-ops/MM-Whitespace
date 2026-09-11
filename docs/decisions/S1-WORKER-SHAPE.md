# S1 — The worker stays on the platform, as a function the tick asks for

**Decision, 11 September 2026.** Keep the ledger-plus-cron shape from
docs/design/03. The worker is a platform function (`/api/worker/drain`) that
answers its request immediately and drains the ledger after the response, for
up to its configured duration; the tick asks for one worker over HTTP and
never waits for it; a worker that reaches its deadline with work left asks for
a successor. No container is needed for the pilot.

The kill criterion in docs/design/14 was: usable duration well short of the
ceiling, unreliable delivery, or unacceptable idle cost. None of the three
holds. What the spike actually found was a defect, not a platform limit.

## What was measured

| Question | Measured | How |
|---|---|---|
| Plan and compute | **Pro**, Fluid compute on, region `iad1`, Node 24 | Vercel API, `/v2/teams`, `/v9/projects` |
| Function ceiling | 300 s default, **800 s** maximum with Fluid compute on Pro | Vercel documentation; `maxDuration` is set per route |
| Cron delivery, 12 h | **12 of 12** hourly ticks delivered, each within 5 s of the hour | `vercel logs --since 48h --query cron/tick` |
| Cron method | **GET**, with `Authorization: Bearer $CRON_SECRET` | The same logs |
| Tick outcome, 12 h | **12 of 12 answered 405** | The route exported `POST` only |
| Cron on Pro | Any schedule, including per-minute | Vercel documentation |
| Idle cost | A tick is sub-second; a worker with nothing to do exits at the door | By construction, see below |
| Usable wall clock | **240 of 240 s**, in `iad1`, closed by the worker itself and not by the platform (`end_reason = probe`, `ended_at` set) | `POST /api/worker/drain?probe=1` on production, 11 September 2026 02:46 UTC |
| Usable wall clock at `maxDuration = 800` | **720 of 720 s**, in `iad1`, closed by the worker itself — the drain deadline live research now uses | The same probe after the live-research deploy, 11 September 2026 09:19–09:31 UTC |
| Cron delivery, per minute | **12 of 12** in the first twelve minutes after deploy, plus one manual `GET`; every tick answered 200 and wrote its row | `cron_ticks`, 02:39–02:51 UTC |
| Fail-closed answers | Real drain refused **409** with `MM_ENRICH_MODE` unset; no bearer **401**; tick `GET` **200** | `curl` against production |

**The defect.** The scheduler calls with GET and the tick answered POST only,
so every production tick since deployment returned 405 and did nothing. No
log line flagged it, nothing recorded it, and the run screen could not show
it because there was nothing to show. That is exactly the failure the design
warned about — "a missed tick produces no error, just a run that stops
advancing" — and the design's remedy, a heartbeat written even when the tick
does nothing, had not been built. It is built now.

## What is built

- **`GET` and `POST /api/cron/tick`** both run the tick. It reaps expired
  leases, ensures the slot rows exist (a fresh database had none, which read
  as "every slot busy"), counts pending work and free slots, asks for one
  worker when both are positive, and **writes a `cron_ticks` row every time**.
  It prunes its own table to seven days.
- **`POST /api/worker/drain`**, bearer-authorised with the same secret,
  `maxDuration = 300`. It answers 202 as soon as it has scheduled itself and
  drains after the response (`after()` from `next/server`, which the platform
  backs with `waitUntil`). The drain loop holds one slot for its whole life,
  takes one job at a time, heartbeats its leases every 30 s, stops 60 s before
  the function's ceiling, and records itself in `worker_runs` — started,
  last seen, ended, why, and how many jobs it finished or abandoned.
- **Chaining.** A worker that stops at its deadline with claimable work left
  asks for a successor. The slot table bounds this: at most `WORKER_SLOTS`
  (4) workers are ever alive, whatever asks for them.
- **A probe.** `?probe=1` holds an invocation open, heartbeating, doing no
  work, until its deadline. The last `last_seen_at` that lands is how long the
  platform actually let it live. It is the instrument for the one row above
  that is still empty, and for re-measuring after any plan or setting change.
- **The schedule is now every minute** (`vercel.json`). The tick is
  sub-second and the design's stall window is three minutes; an hourly tick
  made a stalled run invisible for up to an hour.
- **`scripts/worker.mjs`** runs the same drain function as a plain process
  against a SQLite period, which is the portability claim made checkable.

## Why not a container now

The argument for moving immediately was cost of moving later: "same binary,
so this is cheap only if decided now". That remains true and is unaffected —
`drain()` has no platform binding; the route handler and the script are each
a dozen lines around it. What a container would buy today is an unbounded
wall clock, and the Batch API design (docs/design/03) removes the need for
one: the longest worker unit becomes submit, poll, download. Until live
enrichment exists, a container would be paying for a property nothing uses.

## What is still open

1. ~~Run the probe on production~~ — done, 240 of 240 s. The deadline can be
   raised toward the 800 s ceiling when a live run needs it; probe again after
   any change to `maxDuration` or the plan.
2. **Read `cron_ticks` after 24 hours** of the per-minute schedule. The
   number to expect is 1,440; the run screen shows it. Twelve minutes is
   twelve of twelve; a day is the measurement.
3. **Overlap under load** cannot be measured until a run has real work. In
   replay mode a job takes milliseconds. Revisit with S3.
4. `WORKER_SLOTS` is the design's placeholder. S3 sets it from the account's
   real limits.
