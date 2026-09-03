# Four of the five stated targets cannot pass or fail as written

An untestable requirement silently becomes one nobody checks. Each target below names a percentile, a measurement point and a workload.

## Replacements

| Stated | Problem | Replacement |
|---|---|---|
| A 300-row workbook parses in under 10 s | The real file is 13 sheets and roughly 1,600 data rows, and "parses" does not say from where to where | **p95 ≤ 8 s** from upload complete to validation report rendered, measured server-side on the 1,600-row fixture, cold and warm reported separately. Hard ceiling 60 s. Plus **peak memory ≤ 512 MB**, so the six-megabyte drawing part is never materialised |
| Enrichment completes "within a stated target" | No target was stated | **≥ 95% of 260 jobs reach a terminal state within 4 h** of run start at the configured worker cap; p95 per-company job ≤ 180 s on the synchronous path; ≤ 3 attempts per job; zero jobs stalled at run end. Fix the number from the week-one spike rather than guessing now |
| Dashboard queries under 1 s | No percentile, no data volume, no client or server boundary | **p95 server-side query ≤ 300 ms** at 300 companies across 8 periods, **time to first byte p75 ≤ 800 ms**, **largest contentful paint p75 ≤ 2.5 s**. Achieved by reading the frozen snapshot; dashboards never touch the findings table |
| WCAG 2.1 AA | Unfalsifiable as a blanket claim, and the review grid is where it will actually fail | **Zero serious or critical automated findings** on six named routes in the pipeline, **plus a manual keyboard-only pass** on the review workspace each milestone. Named obligations in sections 8 and 9: no colour-only encoding, 3:1 non-text contrast, correct grid semantics under virtualisation, live-region announcements |
| Browser support | Unstated | Chrome and Edge, last two versions — Deloitte-managed devices are Edge — plus Safari 17+. End-to-end matrix is two engines, not three |

## Why the parse budget is not the constraint

Measured on the real workbook: both load passes complete in **under one second**, roughly ten times inside budget. Parsing runs in the background worker rather than the request path, so the function time limit does not apply to it at all. Correctness is the binding constraint here, not speed — which is why section 4 spends its length on header normalisation and merge rules rather than on performance.

## Why the dashboard budget needs an architectural answer

The naive query resolves override-beats-accepted-beats-extract across three tables for every tile. That does not hold under a second as periods accumulate, and worse, it implements the precedence rule a dozen times so the tiles can disagree with each other.

Publish writes a resolved snapshot, so each dashboard query becomes a single-table group-by over roughly 259 rows: flat, fast, and consistent by construction. Charts are dynamically imported and the tier table streams ahead of heavier tiles.

## Capacity

Five concurrent Analysts at most, 259 companies per quarter, four periods a year. No horizontal scaling work is warranted, and the design should not carry any. The one resource that genuinely needs governing is **model API concurrency**, which section 3 handles in Postgres because it must hold across a dozen concurrent worker instances.

## Reliability

| Property | Target |
|---|---|
| A run survives a deploy mid-flight | Yes — lease expiry does not consume an attempt |
| A run survives a missed cron delivery | Yes — the next tick reclaims expired leases |
| A stalled run is visible | Within 3 minutes, as an explicit state with an alert |
| Published data changes during a run | Never — Viewers read only the frozen snapshot |
| Re-running enrichment overwrites an accepted value | **Never** — enforced by the conditional promotion in section 5 |

## Accessibility obligations that carry real design cost

Three are worth naming here because they constrain implementation rather than merely being checked at the end:

1. **The brand green fails contrast on white** at 2.27:1, so the token set in section 9 is not optional and white-on-green chips are forbidden.
2. **Evidence strength cannot be colour alone**, so every cell carries the numeric value and a band label in its accessible name.
3. **The virtualised grid must declare true row counts and explicit row indices**, or it is unusable with a screen reader regardless of anything else.
