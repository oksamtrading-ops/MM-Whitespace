# Nine of the sixteen open questions block Phase 1, and one blocks everything


> **S5 closed, 9 September 2026.** The access model has been run on a real
> Postgres. It was sound in design and not deployable as written: a policy
> grants nothing, row-level security on `periods` with no policy defeats every
> policy that reads it, and Supabase's data API served twenty-five unprotected
> tables to the browser key. Fixed in `0008_close_the_data_api.sql`, evidence in
> `docs/decisions/S5-ACCESS-MODEL.md`.


Each is tagged with an owner and whether it blocks Phase 1. Questions are ordered by the cost of answering them late.

| # | Question | Owner | Blocks Phase 1? |
|---|---|---|---|
| 1 | **Do risk and legal accept licensed extracts plus internal client flags in a non-Deloitte cloud, with prompts going to the model vendor?** | Samuel | **Yes — everything.** Longest lead time; start day one |
| 2 | Is the filing aggregator's storage restriction accepted as read, making issuer-hosted documents the only automated route to fee disclosure? | Kay + legal | **Yes** — determines whether fee coverage is a floor of tens or of hundreds |
| 3 | May `Unclassified` be displayed as a tier state, or must every company resolve to 1–6? | Kay | **Yes** — determines whether day one ships a truthful 242-unclassified or a false 259-at-Tier-4 |
| 4 | Confirm the twelve provinces and the foreign-jurisdiction list recovered from the data as the application's canonical axes | Kay | **Yes** — axis definitions for two views |
| 5 | Was "producing mines by province" counting companies with a producing footprint in the province, or individual mines? | Kay | Blocks that view only |
| 6 | Confirm the auditor entity identifier is **carved out** of the empty-artifact scope cut | Kay | **Yes** — without it the matcher loses its only stable non-ticker key |
| 7 | Confirm writing computed prior-tier columns to the export, a deliberate departure from the scope cut | Kay | **Yes** — export contract |
| 8 | Cut the Deloitte-clients cross-tab, or ship it showing 230 never-checked explicitly? | Kay + Samuel | **Yes** — the denominator is unknown for 89% of the population |
| 9 | **A dark-first dashboard?** The brand green is compliant on dark at 9.23:1 and non-compliant on white at 2.27:1 | Samuel + brand | **Yes** — palette tokens |
| 10 | Confirm the reserved status scale is acceptable for tier-migration polarity alongside the brand green | Samuel + brand | Blocks that view only |
| 11 | Threshold operator — strictly above, or at or above? — and the proximity band width | Kay | **Yes** — entrant and drop-out semantics; two companies sit under 1% above the line |
| 12 | Coverage floors per chart, and who may override a blocked publish | Kay | **Yes** — publish gate |
| 13 | Confirm the exact brand tokens against Deloitte's internal brand hub; public sources corroborate the green as Pantone 368 but are not authoritative | Samuel | Blocks visual sign-off, not function |
| 14 | Staleness windows per field, and whether an accepted value is ever re-verified automatically (proposal: never) | Kay | No |
| 15 | Acceptable wall clock for a full run — hours synchronously, or overnight batched at half the token cost | Samuel | No — batching is recommended regardless |
| 16 | Who owns each retention deletion job | Samuel | No, but unowned retention does not happen |

## Assumptions recorded in place of answers

Where the brief was silent, these were chosen and are flagged rather than buried:

- **Six tiers in the model, grouped 5-and-6 on the dashboard.** The source computes six, the dashboard shows five, the pursuit tab lists five and omits exploration. Six is kept because grouping is reversible and losing a tier is not.
- **`Unclassified` is implemented regardless of question 3.** Only its display is in question; the engine needs the state either way.
- **Fees are sequenced last** in enrichment, which the brief lists third.
- **The evaluation set is a regression and failure-mode instrument, not a precision estimate.** At 25 companies the interval is roughly ±20 points.
- **Magic-link authentication only**, no passwords, for the pilot.
- **Batched enrichment is the default** and synchronous is the exception, reversing the usual assumption.
