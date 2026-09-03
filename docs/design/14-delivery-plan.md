# Six spikes close before the architecture is committed, and one starts on day one

## Week-one spikes

Each must produce a decision. The architecture is not committed until all six close.

| # | Spike | Decision it unblocks | Kill criterion |
|---|---|---|---|
| **S1** | Cron plus long-running function on the real plan: usable wall clock, delivery reliability over 24 h, overlap behaviour, compute consumption | Keep the ledger-plus-cron shape, or move the worker to a container now | Usable duration well short of the ceiling, unreliable delivery, or unacceptable idle cost → move to a container service **immediately**. Same binary, so this is cheap only if decided now |
| **S2** | One real company end to end, and specifically: **can fee disclosure be found without the excluded aggregator** | The throughput target, the cost model, and whether fee dashboards are deliverable at all | Fee coverage on five sampled companies below a useful floor → fees become analyst-entered with assistance, and that scope conversation happens in week one rather than week eight |
| **S3** | Confirm the actual account tier and limits; set spend limits; **exercise both spend-limit error shapes** | Worker cap and per-worker concurrency | A tier whose limits make a full run take longer than a working day → request an increase before the first full run |
| **S4** | Parse the real workbook including the shifted extract; generate the template; **open it in Excel** | Parser choice and the value-versus-formula map | The export does not open cleanly, or formulas break → export becomes flat-file only, which changes what the later milestone demonstrates |
| **S5** | Prove the access model: a Viewer cannot read internal columns or draft findings through the data API, and the worker role cannot either | The entire authorisation design | Column grants do not compose as expected with the connection pooler → split restricted columns into their own table with its own policy |
| **S6** | **Start day one, longest lead time.** Risk and legal sign-off: licensed extracts plus internal client flags in this hosting arrangement, and prompts going to the model vendor | **Whether this architecture is permissible at all** | Refusal changes everything. This must not surface at milestone four |

S6 is the only one that cannot be compressed by working harder, which is why it goes first.

## Milestones

| # | Weeks | Outcome | Demonstrable artifact |
|---|---|---|---|
| **M0** | 1 | Spikes closed | A one-page decision record answering all six, with the confirmed cost per company. Go or no-go on the architecture |
| **M1** | 2–3 | **Ingest is trustworthy** | Upload the real workbook, see a validation report — 259 companies, ignored sheets named, warnings listed, proof totals tying — and commit a period. Golden fixtures and the tier truth table green. **No AI yet.** This milestone de-risks the most and costs the least |
| **M2** | 4–5 | One company enriched end to end | Click research on a company, watch the ledger move, see a finding with evidence strength, sources and an anchored excerpt — and watch the grounding gate reject a planted fabricated fee. Cassette record and replay working |
| **M3** | 6–7 | A full run inside budget | 260 jobs on a run page, real cost against the cap, a deliberately triggered spend-limit halt and resume, and a stalled-run banner produced by killing the worker mid-run. Evaluation set scored |
| **M4** | 8–9 | **Review and publish** | An Analyst reviews 50 companies keyboard-only; the tier distribution moves from a single false bar to a real spread; publish is blocked and then succeeds; the audit trail answers who published this and on what evidence |
| **M5** | 10–11 | Dashboard and export | The surviving views with proof totals that tie and no broken references, plus the template opening in Excel with the injection fixture quote-prefixed |
| **M6** | 12 | Pilot hardening | Accessibility clean on six routes, five end-to-end journeys green, access-review screen, retention jobs running, and a written runbook for a stalled run, a spend halt, and a changed source column |

M1 is deliberately AI-free. The most expensive failure mode in a project like this is discovering in week eight that the data was never being read correctly.

## Repository shape

```
├── docs/design/                 # this document
├── reference/                   # source workbooks — NOT committed (licence + personal data)
├── src/app/                     # Next.js App Router
│   ├── (analyst)/               # upload, review, run pages
│   ├── (viewer)/                # dashboards, company profile
│   └── api/cron/tick/           # sub-second tick only
├── src/lib/
│   ├── ai/                      # the ONLY module importing the vendor SDK
│   ├── tiering/                 # pure function + truth table
│   ├── ingest/                  # normalisation, identity, validation report
│   └── db/                      # typed queries, no service-role in request paths
├── worker/                      # stateless drainer; runs on cron, locally, and on a container
├── parser/                      # Python + openpyxl, invoked by the worker
├── supabase/migrations/         # DDL, policies, roles, grants
└── tests/
    ├── fixtures/                # synthesised derivatives, never the real file
    ├── cassettes/               # keyed by prompt version
    └── e2e/                     # five journeys
```

## Environment setup

| Item | Notes |
|---|---|
| Database project | Confirm region; **a separate project for preview deployments**, seeded synthetic only |
| Hosting plan | The paid tier is required — the free tier is non-commercial and its function limits are too tight |
| Model account | Confirm tier; per-environment keys; spend limits set per environment; a small separate cap for the nightly evaluation job |
| Secrets | Marked sensitive, distinct per environment, secret scanning in the pipeline, deployment protection on previews |
| Local | The worker runs as a plain process against a local stack; replay mode by default so no key is needed to develop |

## RAID

**Risks**

| # | Risk | Owner | Mitigation |
|---|---|---|---|
| R1 | Risk and legal decline non-Deloitte hosting for internal client flags → the project stops | Samuel | S6 on day one; the strip-at-ingest design means residual stored data is public-only |
| R2 | Fee disclosure is not obtainable at useful coverage without the excluded aggregator → the headline fee views are undeliverable | Engineering | S2 resolves in week one; fees already sequenced last |
| R3 | Account tier or spend cap throttles the quarterly run at the worst moment | Samuel | S3, plus the halt state and pre-flight estimate |
| R4 | Stage accuracy below the level analysts trust → they redo the research and the tool has negative return | Kay | The evaluation set is the early warning; the production-recall floor is the number to watch |
| R5 | Kay is a single point of dependency for labels, domain truth and the evaluation set | Samuel | Front-load the 25-company labelling into M1–M2 |
| R6 | The exchange changes the extract layout next quarter and the parser breaks at quarter close | Engineering | Name-based mapping, a report that names the missing header, and a manual column-mapping fallback |
| R7 | Personal data appears in a future upload in a sheet nobody anticipated | Engineering | The tripwire and the fail-closed allowlist |
| R8 | Platform duration or cron behaviour differs from documentation under load | Engineering | S1 |

**Assumptions** — the database region is available on the chosen plan; roughly 260 companies per quarter is stable; at most five concurrent Analysts, so no scaling work; the workbook's own formulas remain a downstream consumer, so export fidelity matters more than export elegance.

**Issues, already true** — the broken references and the compensating constant mean there is **no correct baseline to diff against**; the threshold contradiction is unresolved pending Kay; and there is no not-checked state for the client flag today, so any count of non-clients is currently wrong.

**Dependencies** — S6 sign-off, external and unbounded; Kay's 25 hand-labelled companies **including fees**, which blocks the M3 evaluation; the model account tier and limits, which blocks M3; and confirmed brand tokens, which blocks the M5 visual sign-off but not its function.
