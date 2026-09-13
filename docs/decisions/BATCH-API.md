# The Batch API halves the bill, because each pass is one request

**Decision, 13 September 2026.** Send both passes' model calls to the Message
Batches API, behind `MM_ENRICH_BATCH=1`, off until Samuel switches it on. The
document fetching stays synchronous and stays in the worker. Run 3's 229
companies cost about **US$40 batched against US$80 live**, on Run 2's measured
rate.

docs/design/03 promised this and migration 0004 has held a place for it since
the beginning — the job state `awaiting_batch`, and a `batch_id` column nothing
ever wrote. All 30 companies of Runs 1 and 2 were researched at full price.

## What made it possible, and what nearly made it pointless

Discovery *looks* unbatchable. It is written as an agentic loop of up to six
turns, and the Batch API answers one request with one message; a loop cannot be
expressed as a batch entry. Discovery is also where the money is — US$0.22 of
the US$0.31 a company, on Opus with web search. If only the extraction call
batched, the saving would be about **US$11 across Run 3, not US$40**, and this
would not have been worth building.

It is batchable because **the web searches happen inside the single call** —
the search tool is server-side — and the loop exists only to force a
`report_sources` call out of a model that answered without one. Run 2 settles
what actually happens:

| Pass | Jobs | Vendor calls each |
|---|---|---|
| identity (discovery) | 30 | **1** |
| general (extraction) | 40 | **1** |
| general | 1 | none — nothing fetchable to ask about |

*Source: `enrichment_job_results.usage->>'requests'` in production, which the
meter writes per call.*

Not one job in Run 2 needed a second turn. So both passes batch, and the
company that does need one is finished synchronously when its answer is read
(`live.continueDiscovery`) rather than thrown away.

## Each pass is cut in half, not reimplemented

The structural decision, and the one that matters in a year. Every pass is now
split at its single model call:

- `prepare` — everything before it. For discovery, nothing but building the
  request. For the fields pass, the whole document fetch.
- `resume` — everything after it. For discovery, the website verification,
  EDGAR and the filing list. For the fields pass, parsing and mapping findings
  onto documents.

**The synchronous path is prepare, call, resume.** There is one implementation
of each pass, so a batched company and a live one cannot drift apart. The test
that guards this runs the same company down both paths and compares the
findings row for row.

## What a suspended pass has to carry

A batch is answered minutes or hours later by a worker with none of the
submitting one's memory. Three things therefore travel in the request row:

- **The documents, by content hash, in order.** An extraction answer cites its
  source by POSITION in the list it was given, so `resume` reloads them in that
  order and refuses outright if any is missing — a short list would attribute a
  finding to a different filing, which is the worst output this system can
  produce.
- **The half-spent meter.** Without it the fetching half's cost simply vanishes
  from the run's total.
- **The model**, so the answer can be priced.

## Money, and the two ways to get it wrong

Batched tokens cost half. The meter is told (`Meter(BATCH_DISCOUNT)`), because
the budget that halts a run reads that number and a meter at full rate would
halt a run at half its budget.

The subtler one, which a test caught rather than a review: `resume` meters only
the calls it makes itself, and in the ordinary case it makes none — so the
tokens the batch actually billed for reached nothing at all. The answer is now
metered where it arrives.

## Failure, and the state machine

`awaiting_batch` gained one transition: **back to `queued`**. A batch expires
after 24 hours, and a request that comes back unanswered is not the company's
fault — the job is requeued with its attempt given back, exactly as a lapsed
lease is treated. An errored result goes through the same `routeFailure` as a
synchronous one, so the spend-limit trap is handled in one place.

Results are matched by `custom_id` and never by position: the API returns them
in any order. Settling is re-entrant — a request row leaves `submitted` once —
so a worker killed mid-download costs the download and nothing else.

## Two things the tick and the queue had to learn

**An open batch is work.** Once every job is submitted nothing is queued, and
the tick would have concluded "nothing to do" for ever: a period that stops
advancing with no error anywhere, which is precisely the failure the tick's own
row exists to expose.

**A batch is the unit of waiting.** Every company in one is held until the last
is answered, so they go out in 64s rather than one batch of 259.

## What is not proven

**Nothing here has run against the real Batch API.** The tests drive a fake one
backed by the same fake vendor the synchronous tests use, which proves our two
paths agree — not that the vendor behaves as documented. That is why it is off
by default, and why the first real use should be a handful of companies with
`/runs` watched, not Run 3.

Migrations `0016` and `0017` create the two tables and must be applied to
Supabase before the flag is turned on.
