-- The worker's own ledger: every tick delivery and every worker invocation.
--
-- docs/design/03: "the tick writes a heartbeat even when it does nothing",
-- because cron delivery is best-effort and a missed tick produces no error --
-- only a run that stops advancing. These two tables are how that absence
-- becomes visible, and they are the instrument spike S1 reads: how reliably
-- the platform delivers the tick over a day, and how long a worker invocation
-- actually lives before the platform ends it.
--
-- Both are append-only and small. The tick prunes its own table to a week so
-- a per-minute schedule does not need a retention rule of its own.

create table cron_ticks (
  id          uuid primary key default gen_random_uuid(),
  ticked_at   timestamptz not null default now(),
  reaped      int not null default 0,
  pending     int not null default 0,
  free_slots  int not null default 0,
  invoked     boolean not null default false,
  -- What the tick concluded, in words: "nothing to do", "work exists and a
  -- slot is free", or why an invocation it attempted did not go out.
  note        text
);

create index cron_ticks_at on cron_ticks (ticked_at);

create table worker_runs (
  id               uuid primary key default gen_random_uuid(),
  worker_id        text not null,
  -- Where it ran: the platform region, or "local".
  host             text,
  -- A probe holds the invocation open and does no work, so the platform's
  -- real wall clock can be measured without spending anything.
  probe            boolean not null default false,
  deadline_seconds int not null,
  started_at       timestamptz not null default now(),
  -- Advanced while the worker is alive; the gap to ended_at is the honest
  -- measure of how long an invocation survived when the platform ended it.
  last_seen_at     timestamptz not null default now(),
  ended_at         timestamptz,
  -- drained | deadline | no_slot | no_work | halted | probe | error
  end_reason       text,
  jobs_completed   int not null default 0,
  jobs_failed      int not null default 0,
  last_error       text
);

create index worker_runs_started on worker_runs (started_at);
