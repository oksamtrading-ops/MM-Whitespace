# S3 — What this account may spend, how fast, and how it says stop

**Status, 11 September 2026: prepared, not yet run.** Everything below that
needs the Claude Console or the key itself is Samuel's to do. It takes one
sitting of about thirty minutes and costs under $2. Fill in the results table
at the end as you go.

docs/design/14 sets the spike: confirm the actual account tier and limits, set
spend limits, and **exercise both spend-limit error shapes**. It decides the
worker cap and per-worker concurrency, and its kill criterion is a tier whose
limits make a full run take longer than a working day.

## Preparing it has already found one defect

**Neither real spend-limit error would have halted a run.** The API
documentation, read on 11 September 2026, gives the two shapes verbatim:

| Limit | HTTP | `error.type` | How to recognise it |
|---|---|---|---|
| One **you set**, org or workspace | **400** | `invalid_request_error` | Message begins `You have reached your specified API usage limits` — or `…specified workspace API usage limits` |
| The **tier's** monthly cap | **429** | `rate_limit_error` | `error.details.error_code` is `enforced_spend_limit_reached`; **no `retry-after`** |

`classifyError` in `src/lib/enrich/client.ts` looked for the words
"spend limit", "quota", "billing" or "credit balance". Neither message
contains any of them. So the 400 would have dead-lettered every remaining
company one at a time — the exact trap docs/design/03 names — and the 429
would have been retried against a limit that lifts on the first of next
month. The tests passed because they used invented messages.

Fixed: the classifier now matches the documented `error_code` first, then
the `specified [workspace ]API usage limits` wording, plus `402
billing_error` and a low credit balance. The tests carry the documented
bodies verbatim, and **they failed against the old classifier before the fix
went in**. Step 6 below replaces the documented 400 with one captured from
this account.

## Before you start: the key

`ANTHROPIC_API_KEY` is in Vercel, Production only, added 11 September 2026 —
the name the application and the SDK read. An earlier attempt under
`MM_RESEARCH` is still there and read by nothing; **delete it**, so a stray
copy of the key is not left behind. Nothing uses either yet: live mode is off
in the build, and a variable reaches the application only with the next
deployment. Step 3 may still mean replacing the key with one from a
dedicated workspace.

## The checklist

**1. Read the tier.** Console → Settings → **Limits**. Record the tier name
and, for **Claude Opus 5** and **Claude Sonnet 5** separately, the requests,
input tokens and output tokens per minute. New organisations can start on an
*Evaluation* tier below the published table, so the page, not the
documentation, is the answer.

**2. Read the spend cap and set an org limit.** Console → Settings →
**Billing** → Spend limits. Record the tier's monthly cap (Start $500, Build
$1,000, Scale $200,000). Setting an organisation limit below it is optional
and is a backstop for the whole account, including anything else that runs
on it — so set it at what you would be comfortable losing in a month.

**3. Give production its own workspace.** Console → Settings →
**Workspaces**. **The Default workspace cannot carry a spend limit**, so a
key that lives there can only be stopped by the organisation's limit. Create
`mm-whitespace-prod`, set its **spend limit to $100 a month**, and create the
production key inside it. If the key now in `MM_RESEARCH` was created in
Default, use the new one for `ANTHROPIC_API_KEY` and revoke the old one.

Why $100: the design estimates a full synchronous run at $65–115 and a
batched one at $30–65, and the first live run will be five companies, not
259. Raise it deliberately when a full run is due.

**4. Read the limits the key actually gets.** In your own shell, with the
production key exported for this command only:

```bash
ANTHROPIC_API_KEY='…' node scripts/s3_probe.mjs limits
```

It sends one fixed word to each of the two models the pipeline routes to and
prints every `anthropic-ratelimit-*` header, the usage, and the workspace the
key resolved to. It costs a fraction of a cent and sends nothing about any
company. The workspace printed should be `mm-whitespace-prod`'s ID.

**5. Confirm retention.** Console → Settings → Privacy (or your organisation
settings): check the data-retention configuration is the one legal approved
under decision 1. Sonnet 5 and Opus 5 both work under zero data retention;
Fable does not, and the pipeline does not route to it.

**6. Trip a spend limit on purpose.** Create a second workspace,
`mm-s3-throwaway`, set its spend limit as low as the Console allows, and
create a key in it. Then:

```bash
ANTHROPIC_API_KEY='<throwaway key>' node scripts/s3_probe.mjs burn --model claude-sonnet-5 --max 40
```

It asks for long answers until the API refuses, up to 40 requests at about
$0.04 each. When it refuses, it prints the status, type, verbatim message,
whether `retry-after` was sent, and **what `classifyError` says — which must
be `HALT`**. Paste the printed body into the results below. Then revoke the
key and archive the workspace. If spend accounting lags and a few requests
land past the limit, that is worth writing down too.

**7. Accept that the tier-cap 429 cannot be tripped.** Producing it means
spending the whole tier cap. It stays pinned from the documentation, in the
test, and the classifier matches on its documented `error_code` rather than
its wording.

## What S3 decides, and the recommendation going in

| Decision | Recommendation | Why |
|---|---|---|
| `WORKER_SLOTS` | **Stay at 4** unless step 4 shows an Evaluation tier far below the table | Even the Start tier allows 1,000 requests and 2,000,000 input tokens a minute per model. Four synchronous workers make about three requests a minute. **Spend, not rate, is the binding limit** |
| Full-run duration | ~100 minutes at 4 slots and a 90-second p95 job | Inside the four-hour target in docs/design/12, so the kill criterion does not fire |
| First live run | 5 companies, then 25, then the period | The API applies *acceleration limits* to sharp increases; ramping avoids 429s on the first full run and makes the per-company cost measurable before it matters |
| Default run budget | Keep $5 for the first run; the start form refuses any run whose estimate exceeds its budget, so a full run will ask for ~$65 at the current placeholder | The estimate is replaced by the measured cost after the five-company run |
| Batch API | No constraint: 200,000 requests may be queued and 100,000 per batch at the Start tier; a period is 259 | The Batch path is item 3 in the handover, not S3 |

## Results

| Item | Value | Read from |
|---|---|---|
| Tier | | Console → Limits |
| Opus 5: RPM / ITPM / OTPM | | Console → Limits, and step 4 headers |
| Sonnet 5: RPM / ITPM / OTPM | | Console → Limits, and step 4 headers |
| Tier monthly spend cap | | Console → Billing |
| Organisation spend limit set | | Console → Billing |
| Production workspace and its spend limit | | Console → Workspaces |
| `anthropic-workspace-id` from step 4 matches it | | Step 4 output |
| Retention configuration | | Console → Privacy |
| Self-set limit error, captured | | Step 6 output, verbatim |
| `classifyError` on the captured error | | Step 6 output — must be HALT |
| Requests that landed past the limit | | Step 6 output |
| `WORKER_SLOTS` decided | | |
