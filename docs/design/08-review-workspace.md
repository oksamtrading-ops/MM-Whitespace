# Review one field down the column, not one company across the row

## The number that decides this screen

259 companies by roughly ten enriched fields is about **2,590 decisions per period**. A company-by-field grid charges the Analyst a context switch on every cell: is this company's auditor right, then is this company's stage right, then is its website right. Judging one field down a column instead reuses a single mental model.

That is the difference between a two-hour review and a two-day one — and a two-day review means the period never gets published, which is the bottleneck the product exists to remove.

## The Analyst lands on a triage board, not the grid

```
┌────────────────────────────────────────────────────────────────────────┐
│  Q3-2026 · draft · 259 companies · enrichment complete 14:32           │
├────────────────────────────────────────────────────────────────────────┤
│  ENRICHMENT COVERAGE                                                   │
│   Stage of operations   ███████████████████░  242 researched  (93%)    │
│   Properties by region  ████████████████████  259 confirmed  (100%)    │
│   Auditor               ██████████████░░░░░░  187 resolved    (72%)    │
│   Audit / tax fees      ███░░░░░░░░░░░░░░░░░   31 found       (12%)    │
├────────────────────────────────────────────────────────────────────────┤
│  YOUR QUEUE                                             2,590 values   │
│   ▸ 1,847  above threshold — bulk-acceptable                           │
│   ▸   512  need review                                                 │
│   ▸   187  extract disagrees with AI            ← start here           │
│   ▸    44  no evidence found                                           │
│   ▸    31  quarantined: excerpt did not anchor                         │
├────────────────────────────────────────────────────────────────────────┤
│  PUBLISH GATE                                                          │
│   ✗ Stage coverage 93% — floor is 95%                                  │
│   ✓ No unresolved conflicts                                            │
│   ✓ Hallucination rate 0.4% — ceiling is 2%                            │
└────────────────────────────────────────────────────────────────────────┘
```

Every number is a link that opens the grid pre-filtered. The Analyst chooses a batch; they never face 2,590 undifferentiated cells. Coverage is the only view with real data on day one, which is why it leads.

## Field-major by default

```
Field: Stage of operations          259 companies · sorted by evidence ascending
┌──────┬──────────────────────┬─────────────────────┬────────┬─────────────────┐
│      │ Company              │ Proposed            │ Evid.  │ State           │
├──────┼──────────────────────┼─────────────────────┼────────┼─────────────────┤
│ ►    │ Sailfish Royalty     │ Royalty             │ 0.31 L │ ⚠ 1 source      │
│      │ LunR Royalties       │ Royalty             │ 0.44 L │ ⚠ conflict      │
│      │ Lara Exploration     │ Exploration+Royalty │ 0.52 M │                 │
│      │ Agnico Eagle Mines   │ Production          │ 0.94 H │ ✓ 3 sources     │
└──────┴──────────────────────┴─────────────────────┴────────┴─────────────────┘
  EVIDENCE  ▸ AIF "Description of Business", retrieved 2026-08-14  [T1] [open ↗]
            "…commenced commercial production at the Meliadine mine…"
            anchor: exact match, chars 48211–48402
  TIER      Accepting moves Agnico Eagle from Unclassified to Tier 1
```

Three properties matter. **Sorted by evidence ascending**, so the worst work comes first and the tail is bulk-acceptable. **The tier consequence is shown live**, because stage is the only field that moves tier and an Analyst should see what they are about to change. And **the evidence panel follows focus** rather than requiring a click.

**Stage gets its own review mode.** It is 242 of the blanks, it is multi-select, and it alone determines tier.

Company-major remains available for the pursuit-preparation journey, where the unit of interest genuinely is one company. Both read the same resolved values; only the axis differs.

## The keyboard loop

The grid is **one tab stop with a roving index** — never 2,590 tab stops, which would trap keyboard users.

| Key | Action |
|---|---|
| `↓` `↑` | Move row; evidence panel follows |
| `←` `→` | Move field (company-major only) |
| `A` | Accept |
| `O` | Override — inline editor, AI value pre-filled and selected; `Enter` commits, `Esc` restores focus |
| `F` | Flag — requires a one-line reason |
| `Space` | Expand or collapse the evidence panel |
| `E` | Open the cited source in a new tab |
| `Shift+A` | Bulk-accept the remainder above threshold **in this column** — always via confirmation |
| `Ctrl/Cmd+Z` | Undo the last decision — an insert, not a delete, since decisions are rows |
| `?` | Shortcut sheet |
| `Esc` | Editor → cell; cell → toolbar |

Single unmodified letters must be **suppressed whenever focus sits in a text input**, or an Analyst typing an override fires three actions mid-word.

## What bulk-accept must refuse

| Refused | Why |
|---|---|
| **Fees, at any evidence level** | The guarantee is that a fee cites a filing. A threshold is not a citation check |
| **Any extract-versus-AI conflict** | High confidence in a wrong answer is exactly the failure this creates |
| **Any already-overridden value** | Overrides are never overwritten; this is where that invariant would break |
| **Stage flags**, without a per-session typed opt-in | Stage determines tier and tier is the deliverable |
| **Anything with zero sources** | A confident answer with no source is a hallucination with good posture |
| **Anything quarantined by the anchoring gate** | Its excerpt did not verify against the document |
| **Across fields** | Always scoped to one field in one filtered view. There is no accept-everything control anywhere in the product |

The confirmation names the count, the field and the threshold, states that it is undoable, and is the only path — no suppress-this-dialog option. `bulk_acceptable` is a column on the field catalogue, so the fee exclusion is data rather than a special case in the interface.

## A conflict is a decision, not a warning

Not one value with a warning icon. A **two-column diff**:

```
┌── EXTRACT ───────────────────┬── AI PROPOSAL ─────────────────────────┐
│ CANADA: (empty)              │ CANADA: BC                             │
│ TSX extract · B.02 row 47    │ claude-… · prompt v3 · T1 source       │
│                              │ "…the Company's Redton property in     │
│                              │  central British Columbia…"  [open ↗]  │
└──────────────────────────────┴────────────────────────────────────────┘
        [ Keep extract ]   [ Use AI ]   [ Enter my own ]
```

**No default is pre-selected and no timer resolves it.** Pre-selecting silently makes the decision for the Analyst.

For regions specifically, where the extract is authoritative and the agent only confirms or proposes additions, additions are presented as a **separate accept-each list** rather than a wholesale replacement — otherwise accepting one new country silently replaces the authoritative list.

## Audit trail and the publish gate

Every decision writes a row carrying the actor, the timestamp, the reason where required, and the **finding version the decision was made against** — without which an override silently re-binds to a later proposal and the trail no longer records what the Analyst actually saw.

Publish is blocked while any default-dashboard chart sits below its coverage floor, while unresolved conflicts remain, or while the run's hallucination rate exceeds its ceiling. An Admin may override with a **recorded reason that is then printed on the dashboard header** — which is the mechanism that stops "TAB NOT UPDATED" from recurring as a banner nobody reads.

Publish is a transactional job with a progress state, not a button that returns instantly. It writes the frozen snapshot described in section 5 and will take tens of seconds.

## Accessibility

The review grid is where a WCAG 2.1 AA claim will actually fail, so the obligations are specific:

- **Confidence must not be colour-only.** Section 9 gives the encoding: four ordinal bands, the numeric value rendered in the cell, and a band label in the accessible name.
- `role="grid"` with true row and column counts, since virtualisation makes the DOM count lie, and an explicit row index on virtualised rows.
- The company cell is the **row header**, so every cell announcement is anchored to a company.
- Each cell's accessible name carries value, evidence band and review state — *"Auditor, PwC, evidence high, unreviewed"* — rather than leaving state to a colour wash.
- A **polite live region** announces each decision and its consequence: *"Accepted. 511 remaining. Agnico Eagle now Tier 1."* This is how a non-sighted Analyst receives the feedback a sighted one gets from the row changing.
- The evidence panel is a labelled region referenced from the cell, **not a tooltip** — tooltips are unreachable by keyboard and must never gate a value.
- Focus indicators at 3:1 minimum, which is why the focus ring uses the darkened green from section 9 and never the brand green at 2.27:1.
- Touch targets at least 44 by 44. At 200% zoom the grid may scroll horizontally under the data-table exception, but the toolbar and filter row must reflow.
