# 20 — Triggers and the approach calendar

**One sentence:** the tool already knows what changed for every company and when its year ends; this doc turns that into nine named, dated, cited events a partner can read aloud, a quarterly list of the companies where one fired, and a calendar of when each company can practically change its auditor — counts and dates, never a score.

**Status:** draft for Kay's review, 3 November 2026. Nothing in the application has changed. **Owners:** Kay Ampofo (domain), Samuel Owusu (solution). Decisions taken on 3 November are marked *settled*; the rest are asked in §11.

This doc amends doc 01 §"Journey two" and doc 19 §1 as stated in §1, adds fields under doc 06's contract, a snapshot table under doc 05, and a sheet to doc 10's export. Everything else stays in force, doc 11 above all.

## 1. What this adds, and what it leaves alone

Doc 01 says the application "does not decide which companies are worth pursuing", and doc 19 that it "scores nothing". Both hold. What they left unanswered is the question the practice built the workbook to ask: *who do we approach, and when?* Today a partner gets 348 companies and a globe, and the answer lives in their head.

Three facts about this market shape the answer:

- **Audit clients move because something happened to them**, not because a firm found them. Tenure runs in decades. A change follows an event: a merger, a new CFO, a first pour, a US listing, a vote against the auditor.
- **Tenders matter** (*settled*). The audit committee runs a process and the AGM ratifies it, so there is a season, and a call outside it is a call wasted.
- **Every partner already knows the 348 names.** The edge is not the list. It is knowing what changed, for whom, since last quarter — which is the one thing this application has that the workbook never did: history, with every fact cited.

So the addition is **triggers**: a fixed set of nine events, each a published fact with a date, a source and a rule, each naming the Deloitte door it opens. A trigger is a count, like every other figure here. The one extension to doc 19's rule is that the quarterly list is **ordered by how many triggers fired**, which is still a count a manager can defend upward; a composite number is not, and §10 says why it is not taken.

**Who it is for** (*settled*): the Audit team, managers to partners. A manager prepares the quarter's list; a partner acts on it. The doors it names cover every service line (*settled*), because an audit partner in a boardroom carries the whole firm, but the Audit team is the user, so the independence map that would grey Deloitte's own audit clients as "closed for consulting" is **not built** (*settled*, §10).

**What it never does.** It stores no client information (doc 11; the tax-client flag stays out), it names no individual (§6), it contacts no one (doc 02), and it reads no source doc 02 excludes.

## 2. The triggers

Each trigger is a pure function of published values for the current publication and the newest revision of the prior period, exactly as doc 19 §6 reads "Since". Each fires for a company or does not; a company with no value for an input **does not fire** and is counted among those research could not check, in the same "of *K* research could check" form doc 19 uses for every fact.

| # | Trigger | Rule | Inputs | Door | Source |
|---|---|---|---|---|---|
| 1 | **Merged this period** | The company absorbed another between the prior and current publication (a merge recorded in `company_aliases` with a predecessor present in the prior period), and the two had different auditors | merge log, prior `auditor` | Audit | Held |
| 2 | **Outgrew the auditor** | Prior tier 5 or 6 (or unclassified with no production) and current tier 1, 2 or 3; auditor's `firm_class` regional or other | `tier`, prior tier, `auditor` | Audit | Held |
| 3 | **Newly SEC-registered** | `sec_registrant` true now and false in the prior period (not null) | `sec_registrant`, prior | Audit, risk advisory | Held |
| 4 | **Votes withheld against the auditor** | At the last AGM before the as-of date, votes withheld on the reappointment of the auditor at or above **10%** (Kay confirms, §11) | `auditor_vote_withheld` (new, §6) | Audit | **New** |
| 5 | **Finance leadership changed** | A CFO or audit committee chair change announced within the 12 months before the as-of date | `finance_leadership_change` (new, §6) | Audit | **New** |
| 6 | **Footprint mismatch** | Properties in two or more jurisdictions outside Canada; auditor's `firm_class` regional or other | `property_regions`, `auditor` | Audit | Held |
| 7 | **ERP change underway** | `erp_change.status` is selecting or implementing | `erp_change` | Consulting referral | Held |
| 8 | **Tax done elsewhere** | An audit fee on record for a fiscal year and the tax fee for the same year **absent, confirmed** (the filing's fee table shows nil or no line), not unknown | `audit_fee`, `tax_fee` | Tax referral | Held |
| 9 | **Standing whitespace** | Market value C$500M or more and auditor outside the Big 4 and the national firms; **or** auditor appointed ten or more years before the as-of year | `market_cap_cad`, `auditor`, `auditor_since` | Audit | Held (doc 19's facts) |

Trigger 9 is the backdrop, not the headline: doc 19 publishes both halves already as "facts worth knowing". It is kept as a trigger so the list has one place to count it, and it is shown beneath the others (§4).

**The cold list.** A company that changed auditor within the 24 months before the as-of date (doc 19's "What moved") is shown apart and greyed, whatever else fired: it has just signed a relationship, and a partner's hour is better spent elsewhere. **Deloitte's own audit clients never appear**: the list is of companies Deloitte does not audit.

**Developers** (*settled*). A Tier 5 company is listed as "developing" when any trigger fires for it, because the auditor decision is still open before first pour and closed soon after. Whether to research an expected first-pour year is asked in §11; without it the flag is the stage, nothing finer.

**Acceptance.** A table-driven test enumerates every trigger against a fixture with one company that fires it, one that misses it by the smallest step (9.9% withheld, 13 months, one foreign jurisdiction, a null input), and one in the cold list; it asserts the fired set, the "of *K*" denominator and the inputs recorded. Before any screen is built, the nine rules are run once as a query over Q4-2026 revision 6, and the count for each is written into this doc (§9): a trigger that fires for nobody, or for everybody, is wrong or useless, and that is cheaper to learn from a query than a page.

## 3. The approach calendar

This is the centrepiece, because tenders matter and nobody in the practice has the calendar today.

**What is known.** `fiscal_year_end` is published for most of the period (doc 19 §6 counts it). A Canadian reporting issuer appoints its auditor at the annual meeting, which the corporate statutes require within six months of the year-end (and fifteen of the last meeting); the audited statements are due 90 days after year-end on TSX and 120 on TSXV; the audit committee's planning for the next audit begins in the last quarter of the fiscal year.

**The window, as a rule** (Kay confirms the shape, §11):

```
year_end        = fiscal_year_end in the as-of year (or the next, if passed)
agm             = agm_date where research found it, else year_end + 6 months
filing          = year_end + 90 days (TSX) or + 120 days (TSXV)
open            = max(agm, filing)            # last year's audit signed off, appointment ratified
close           = year_end - 3 months          # the next audit's planning begins
window          = [open, close)                # when a change can be decided for the next AGM
```

For a December year-end on TSX: open in June, close at the end of September. For a June year-end: open in December, close in March. The window is **where a change can be decided**, not when it takes effect: a firm chosen in the window is appointed at the next AGM, and the outgoing auditor usually signs the current year.

**What it shows.** On the profile, one line under the facts: "Window: June to September; AGM ratifies, usually May." On the quarterly list, a column, and a filter "in window this quarter". A company whose year-end is unknown shows "window unknown" and is counted as such; it is never placed by guess.

**Why a rule and not research.** Every input is already published or derivable, so the calendar costs nothing to run for all 348. `agm_date` sharpens it where the voting-results pass (§6) finds a meeting date, and that pass is the only research the calendar touches.

**Acceptance.** `calendar.test.ts` fixes the four cases above (December and June year-ends on each exchange), the leap from one fiscal year to the next across the as-of date, an unknown year-end, and an AGM later than the filing deadline. The window on a published profile equals the one the list shows for the same company.

## 4. Where it shows

**Why now, on the profile.** A fourth part of the company page (doc 18's profile, PR #6), after "Why this tier": a list of the triggers that fired, each with its date, the value it read, the source behind that value, and the door it names. Then the window. Then, if the company is cold, the reason in one line. A company with nothing fired says so in one sentence and names how many triggers research could check, so silence is never mistaken for a clean bill.

**What opened this quarter, `/opened`.** A Viewer page, one list of the companies Deloitte does not audit, in three bands:

1. **Opened this period** — companies where trigger 1 to 8 fired for the first time in this publication, ordered by the number fired, then by market value. Each row: company, tier, auditor and class, the triggers as short labels, the window.
2. **Standing** — trigger 9 only, same columns, same order.
3. **Cold** — greyed, with the change of auditor and its date.

Filters: tier, head-office region, commodity, "in window this quarter", trigger. Not the Deloitte market: it is `deloitte_internal` and Viewers do not receive it (doc 11; October's change). Grouping by head-office region serves the same purpose for a partner and is public.

Every band carries doc 18 §9's footing: the count, the denominator research could check, and the publication it was computed from. A row's triggers link to the profile's "Why now", and from there each value to its row in "Every value, and where it came from".

**The export.** One sheet, "Opened", with the same three bands and the window columns, under doc 10's rules (no formulas, text-prefixed cells, the same proof total as the page). A manager preparing the quarter works from this sheet.

**Rhythm.** Quarterly, with publication (*settled*). A trigger is computed when a period is published and frozen with it (§5); between publications the list does not move. This is what managers-to-partners asked for: a list a manager prepares and a partner acts on, not a feed.

**Acceptance.** At 1440×900 and 375×812 the first band reads without scrolling sideways (doc 18 §5's 320px floor holds, the table in a `.tablewrap`). The journeys open `/opened` as a Viewer and assert that no Deloitte-audited company, no `dtt_market` value and no banned word (§7) is in the page.

## 5. Freezing, and the snapshot table

Triggers are computed at publish and stored, as the tier migration and the coverage totals are (doc 09 §"Meeting the one-second budget"). The list and the profile read the rows; nothing is derived at request time.

```sql
create table published_triggers (
  publication_id uuid not null references period_publications(id),
  company_id     uuid not null references companies(id),
  trigger_id     text not null,           -- 'merged', 'outgrew', 'sec_new', 'vote_withheld',
                                          -- 'finance_change', 'footprint_mismatch', 'erp_change',
                                          -- 'tax_elsewhere', 'standing', 'cold'
  first_fired    boolean not null,        -- not fired in the prior publication
  inputs         jsonb not null,          -- the published values the rule read, with their sources
  event_date     date,                    -- the date the event carries, where it has one
  rule_version   text not null,
  primary key (publication_id, company_id, trigger_id)
);
create table published_windows (
  publication_id uuid not null references period_publications(id),
  company_id     uuid not null references companies(id),
  opens          date, closes date, agm date, basis text not null,   -- 'agm_found' | 'agm_assumed' | 'unknown'
  primary key (publication_id, company_id)
);
```

Both are read under the same policies as `published_period_values` (doc 05): a Viewer reads published rows and nothing else. `inputs` carries only public fields; the publish step refuses a row whose inputs name a `deloitte_internal` key, the way the egress scan refuses a prompt that does.

`first_fired` is computed against the newest revision of the prior period at publish time, so an amendment to the prior period moves the "opened this period" band only on the next publication. That is the same frozen-against-newest tension doc 19 §10 records for the migration matrix, and it is accepted here for the same reason: a list that re-sorted itself after publication could not be worked from.

**Acceptance.** `publish.test.ts` publishes two periods and asserts the rows, then amends the first and asserts the second's rows did not change.

## 6. Two new research fields

Both come from the issuer's own news pages and the hosts pass 2 already trusts (the company's domain, `q4cdn.com`, SEC EDGAR for registrants' 6-K and 8-K). No new host class, no filing aggregator (doc 02). Both are `ai_enriched`, `public`, not bulk-acceptable, and overridden only by citing a public address (`SOURCED_OVERRIDES` in `decide.ts`), as the ERP fields are.

| Field | Value | Rubric | Stale after |
|---|---|---|---|
| `auditor_vote_withheld` | `{ pct, meeting_date, votes_for, votes_withheld }` | From the issuer's report of voting results (TSX requires one by news release after each meeting). The percentage withheld on the resolution appointing or reappointing the auditor. Abstain if the release reports the resolution carried without figures | 365 days |
| `finance_leadership_change` | `{ role: 'cfo' | 'audit_chair', date, kind: 'appointed' | 'departed' }` | From a news release announcing the appointment or departure of a chief financial officer or the chair of the audit committee. **The name is not extracted, not stored, and not in the excerpt**: the stored quote is cut to the role and date. An interim appointment counts; a board refresh that does not name the audit chair does not | 365 days |

`agm_date` is written from the same voting-results release when found, as a derived input to §3, and is not a field of its own.

**Personal data.** A person's name in a press release is personal data in the sense of doc 11. The event is a corporate fact; the name is not needed for it. The extraction rubric asks for role and date only, the excerpt rule drops the sentence's subject, and `check_role_assertions`-style tests assert no stored excerpt for this field contains a capitalised two-word sequence followed by "as Chief Financial Officer" or the French equivalent. If the gate cannot anchor an excerpt without the name, the finding is an abstention, not a stored name.

**Discovery.** One search per company per field over the trusted hosts, in the order the ERP options note measured: issuer news page first, EDGAR full-text second. Discovery cost measured in October at about US$0.21 a company; two fields across 348 companies is **about US$150 a quarter, before review**, which is of the order of one month's recorded research spend. The pilot is 40 companies: the 20 largest on TSX and 20 at random, so the yield is known before the full run.

**Acceptance.** The cassette set gains a synthesised voting-results release with figures, one without, a CFO appointment release, and a board release that names no audit chair; the pipeline test asserts one finding, one abstention, one finding with no name in the excerpt, and one abstention.

## 7. Words

`words.test.ts` holds the dashboard to doc 01: no *opportunity*, *target*, *should*, *pursue*, *recommend* or *prioritise*. The same test covers `/opened` and "Why now". The words this doc adds are **trigger**, **fired**, **opened**, **window**, **cold** and **door**, each a fact about the company or the calendar, none an instruction. "Opened this period" means a trigger fired for the first time; it does not mean the company is open to anything, and the page's own sentence says so once, at the top: "A trigger is a published fact that changed. It says what happened, not what to do."

## 8. Security and access

Nothing new crosses a boundary. The new fields are public facts from public hosts; the prompt egress scan, the type boundary and the revoked column privilege (doc 11) are unchanged and still exclude `dtt_market` and the pursuit tables. The snapshot tables take the published-only policies. The export sheet carries the same cells the page shows. No name of any person is stored anywhere in this feature.

## 9. Measured before built

To be filled in from a query over Q4-2026 revision 6 before any screen is designed:

| Trigger | Fired | Of (research could check) |
|---|---|---|
| 1 Merged | — | — |
| 2 Outgrew | — | — |
| 3 Newly SEC-registered | — | — |
| 6 Footprint mismatch | — | — |
| 7 ERP change | — | 94 researched (handover, 3 November) |
| 8 Tax elsewhere | — | 125 with an audit fee |
| 9 Standing | — | — |
| Cold | — | — |
| Window known | — | 348 |

Triggers 4 and 5 are measured after the 40-company pilot.

## 10. Considered and not taken

**A composite score.** One number per company, weighted triggers. Not taken: a manager cannot defend "0.73" to a partner, the weights would be opinions dressed as data, and doc 01's rule exists for exactly this. The ordered count keeps every term visible.

**A live watchlist.** Triggers re-evaluated between publications as research lands. Not taken: the audience is managers to partners on a quarterly rhythm, and a list that moves under them cannot be worked.

**The independence map** (Deloitte's audit clients greyed as closed for consulting and tax). Correct and public, and not wanted while the tool is the Audit team's (*settled*).

**Auditor-change notices from the filing aggregator.** The richest source for trigger 1's predecessor and the cold list, and excluded by Decision 2. The issuer's own release announcing the change is read instead, as "What moved" already does.

**Officer names, LinkedIn, Deloitte relationship knowledge.** Not stored, not read, not asked for. The event without the name is enough for the trigger; the rest is a CRM's job and a due-diligence question (doc 11, the ERP options note).

**CPAB inspection findings and auditor rotation mandates.** Canada mandates partner rotation, not firm rotation, so there is no clock to read; CPAB's public reports do not name issuers. Nothing to build.

## 11. Decisions asked of Kay

1. **The vote threshold** for trigger 4: 10% withheld, or another figure, or any figure above the issuer's usual run.
2. **The window rule** in §3: does the practice's experience match "decided between the AGM and the last quarter, appointed at the next AGM"? Which exchanges' and statutes' deadlines does the practice use?
3. **Developers:** research an expected first-pour or commercial-production year for Tier 5 companies (one more pass-2 window in filings already read), so "developing" can say "developing, first pour expected 2027"?
4. **Trigger 2's lower edge:** does a move from unclassified to tier 1–3 count as outgrowing, when the prior period simply had no evidence? Proposed: no; it is research completing, as doc 09 says of the migration view.
5. **Who sees `/opened`:** every Viewer, or Analysts and Admins until the practice has read one quarter of it.
