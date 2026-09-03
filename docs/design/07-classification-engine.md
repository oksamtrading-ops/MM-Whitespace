# The tier rules are correct as written; the inputs are what need fixing

## The rules were verified formula-for-formula

The workbook's nested condition was read verbatim at three separate rows and matches Appendix C exactly — same rule order, same footprint strings, same else-branch. **Implement it as written.** No correction is needed to the logic.

```
B6  =IF(AND(R6="X",U6="Canada & Abroad"),"1",
     IF(AND(R6="X",U6="Canada only"),"2",
     IF(AND(R6="X",U6="Abroad"),"3",
     IF(S6="X","4",
     IF(AND(Q6="X",R6<>"X"),"5",
     IF(AND(P6="X",R6<>"X",Q6<>"X"),"6","4"))))))
```

Two properties of the source worth noting: tier values are returned as **text**, and the catch-all returns 4 — the same value as the royalty rule, which is why 242 unresearched companies are today indistinguishable from genuine royalty companies.

## What changes is the signature

```
classify(
  stages:            Set<'exploration'|'development'|'production'|'royalty_streaming'>,
  stage_evidence:    'none' | 'partial' | 'complete',
  footprint:         'canada_only' | 'abroad' | 'canada_and_abroad' | 'none',
  property_evidence: 'none' | 'partial' | 'complete'
) -> { tier: 1..6 | null, status, footprint, trace: TraceStep[] }
```

Four changes from the brief's version, each forced by measured data:

1. **Stages is a set, not four booleans.** A company can be Production and Development at once, and blank must not read as false.
2. **Evidence state is an input.** `Unclassified` cannot be derived from values — only from the absence of evidence. Without this, 242 companies with no research arrive identical to a company affirmatively confirmed pre-exploration.
3. **Footprint has four values.** `none` is declared in Appendix B and never produced by the workbook.
4. **Unclassified is a status beside a nullable tier**, not a seventh tier, because it has two independent causes that route to different review queues.

## Rule order, with the two guards first

```
# Guard 1 — no stage evidence at all
if stage_evidence == 'none':
    return Unclassified(no_stage_evidence)          # 242 of 259 companies today

# Guard 2 — footprint is required by rules 1-3 and unavailable
if 'production' in stages and footprint == 'none':
    return Unclassified(no_property_evidence)

# Appendix C, unchanged
if 'production' in stages and footprint == 'canada_and_abroad':  return Tier 1
if 'production' in stages and footprint == 'canada_only':        return Tier 2
if 'production' in stages and footprint == 'abroad':             return Tier 3
if 'royalty_streaming' in stages:                                return Tier 4
if 'development' in stages and 'production' not in stages:       return Tier 5
if 'exploration' in stages and not {'production','development'} & stages: return Tier 6

# The workbook's catch-all returns 4. We do not.
return Unclassified(conflicting)
```

**The royalty rule deliberately does not consult footprint.** That is why the twelve companies with no properties can still resolve honestly to Tier 4 with a `footprint = none` trace, rather than being assigned a fabricated Canadian footprint.

## Footprint derivation, including the value the workbook never emits

```
props_canada = CANADA column non-empty
props_abroad = any of AFRICA, ASIA, AUS/NZ/PNG, LATIN AMERICA, OTHER, UK/EUROPE, USA non-empty

if property_evidence == 'none':      footprint = 'none'      # NEW
elif  props_canada and  props_abroad: footprint = 'canada_and_abroad'
elif not props_canada and props_abroad: footprint = 'abroad'
elif  props_canada and not props_abroad: footprint = 'canada_only'
else:                                 footprint = 'none'      # NEW — was 'canada_only'
```

The last line is the correction. The workbook's else-branch swallows both "properties in Canada only" and "no properties at all", which is how **roughly $146 billion of market capitalisation** — Wheaton Precious Metals and Franco-Nevada among them — is filed as having a Canadian mining footprint that neither company has.

Exactly twelve companies are affected today, all royalty and streaming. Because the royalty rule fires before footprint is consulted, **their tier is unchanged** — which is precisely why this defect survives the tier unit tests and reaches the dashboard. It must be caught on the footprint views, not the tier ones.

## Two unclassified causes, not one

| Status | Cause | Queue |
|---|---|---|
| `unclassified_no_stage_evidence` | No stage researched | Stage review — 242 companies on day one |
| `unclassified_no_property_evidence` | A production rule needs footprint and none exists | Region review |
| `unclassified_conflicting` | Stage evidence exists but matches no rule | Analyst adjudication |

These conditions happen not to co-occur today — all twelve no-property companies carry the royalty flag, so all twelve have stage evidence. That coincidence will not survive the next quarter, and collapsing the two causes into one state would be right today and silently wrong later.

**Five royalty companies do have properties**, including Versamet Royalties and Labrador Iron Ore Royalty, so any shortcut assuming royalty implies no properties breaks on them.

One canary worth a validation rule: **a Canadian-headquartered company whose only region value is foreign** is more likely an extract error than a fact. It fires on Labrador Iron Ore Royalty today, whose sole region value is a US state despite its asset being in Newfoundland and Labrador. Flag as `unclassified_conflicting` rather than classifying on it.

## The trace is structured data, not a sentence

```sql
create table tier_traces (
  period_id uuid not null, company_id uuid not null,
  ord smallint not null,          -- rule evaluation order
  rule_id text not null,          -- 'guard_no_stage_evidence', 'rule_1_production_both', ...
  inputs jsonb not null,          -- the values this rule actually read
  matched boolean not null,
  primary key (period_id, company_id, ord)
);
```

A sentence like *"Tier 3 because Production = X and footprint = Abroad"* is renderable from these rows, but the reverse is not true. The migration view needs to say **which rule** changed between periods, and prose cannot be diffed. Rendering happens at the edge; storage is structured.

Every classification records the `rule_set_version` it ran under, so a tier that changes with no human action and no new data is attributable to a rule change rather than appearing inexplicable.

## Truth table

The function is total over 16 stage combinations by 4 footprints by 3 evidence states. **Enumerate all 64 stage-footprint pairs** in a table-driven test — it is 64 rows, not a burden — asserting tier, status, trace and a divergence flag.

The cases the brief names, plus those it omits:

| Stages | Footprint | Evidence | Result | Diverges from workbook |
|---|---|---|---|---|
| production | canada_and_abroad | complete | Tier 1 | — |
| production | canada_only | complete | Tier 2 | — |
| production | abroad | complete | Tier 3 | — |
| royalty | any | complete | Tier 4 | — |
| royalty + production | canada_only | complete | Tier 2 | — (production wins) |
| development | any | complete | Tier 5 | — |
| development + exploration | any | complete | Tier 5 | — |
| exploration | any | complete | Tier 6 | — |
| **royalty + development** | any | complete | **Tier 4** | — (royalty precedes development) |
| **production + development** | canada_and_abroad | complete | **Tier 1** | — |
| **exploration + royalty** | any | complete | **Tier 4** | — |
| **royalty** | **none** | complete | **Tier 4, footprint none** | **Yes** — workbook says footprint canada_only |
| **production** | **none** | complete | **Unclassified (no property evidence)** | **Yes** — workbook says Tier 2 |
| **none** | any | **none** | **Unclassified (no stage evidence)** | **Yes** — workbook says Tier 4 |

**Assert the trace string exactly**, not just the tier. The trace is the product feature; an unasserted trace rots.

A separate **parity test** runs the function across all 259 real rows and asserts the difference against the workbook's computed column equals exactly the known-divergent set. It runs nightly against the private copy of the file, not in continuous integration, for the licensing reason in section 13.

## Six tiers in the model, five on the dashboard

The matrix computes six tiers; the dashboard collapses 5 and 6 into a single development-and-exploration band; the pursuit tab lists five. **Keep six in the model** and let the dashboard group them, so the grouping is a presentation choice rather than a lossy storage decision. The dashboard's own tier block already contains a vestigial sixth row wired into its totals, so the workbook half-agrees.

**Labels** are taken from the pursuit tab, which holds the canonical strings the practice already recognises, before that tab is otherwise dropped from scope. Note the exact source text for Tier 3 contains a parenthetical and a trailing space; normalise on import and store the clean label.

## Open question that blocks a dashboard, not the engine

Whether `Unclassified` may be **displayed** is Kay's decision, and section 15 records it as blocking. The engine implements it either way; what changes is whether the day-one dashboard shows a truthful "242 unclassified" or a false "259 companies, all Tier 4, royalty and streaming". Section 9 recommends the former strongly enough to treat it as decided for the interface pending confirmation.
