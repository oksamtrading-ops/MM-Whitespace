# Ten decisions are needed before build starts, and one of them decides whether the build happens at all

**To:** Kay Ampofo (workbook owner), Samuel Owusu (solution owner)
**From:** Design workstream
**Re:** Mining Whitespace Intelligence Tool — decisions required to start Phase 1
**Status:** all ten decisions closed, 3 September 2026. Retained as the decision record.

---

## Why this pack exists

The design is complete: seventeen sections, every factual claim re-measured against the two source workbooks and held green by an automated check. It specifies schema, contracts, prompt structure and delivery plan. It does not specify ten things, because those ten are not engineering decisions.

**One of them — decision 1 — decides whether the architecture is permissible at all.** It has no engineering mitigation, the longest lead time, and an external owner. If it comes back as a refusal in week eight rather than week one, the work built on it is lost. It starts on day one regardless of everything else in this pack.

The other nine block Phase 1. Each is framed as a yes/no or a pick-one, with a recommendation and the evidence behind it. Where a decision can be defaulted safely, the default is stated — so silence delays confirmation, not construction.

**A note on the source data.** Both workbooks were read cell by cell. Several of the figures below contradict what the original brief states; where they do, the measured figure governs. The most consequential correction: the population is 144 TSX and 115 TSXV with **no** other-exchange company. A count formula starting one row below the data drops the first company, and a hard-coded `+1` restores the total by inventing a company on an exchange with no members.

---

## Decision summary

| # | Decision | Owner | Blocks | Recommendation | Status |
|---|---|---|---|---|---|
| **1** | Risk and legal acceptance of the hosting and model arrangement | **Samuel** | **Everything** | Start day one; take the strip-at-ingest design to the review | **Accepted** — review to book |
| 2 | Filing aggregator's storage restriction accepted as read | Kay + legal | Phase 1 | Accept it; issuer-hosted documents only | Open — Kay |
| 3 | May `Unclassified` be displayed as a tier state? | Kay | Phase 1 | Yes — display it | Open — Kay |
| 4 | Confirm the recovered province and jurisdiction axes | Kay | Phase 1 | Confirm Appendix A, roll the US up to one bucket | Open — Kay |
| 5 | Confirm the auditor entity identifier is carved out of the scope cut | Kay | Phase 1 | Carve it out | Open — Kay |
| 6 | Confirm computed prior-tier columns are written to the export | Kay | Phase 1 | Write them | Open — Kay |
| 7 | Cut the Deloitte-clients cross-tab, or ship it with the gap shown? | Kay + Samuel | Phase 1 | Ship it with 230 never-checked on the face of it | Samuel ✓ — Kay open |
| 8 | A dark-first dashboard? | Samuel + brand | Phase 1 | Light-first with corrected green tokens | **Accepted** — tokens to confirm |
| 9 | Threshold operator and proximity band width | Kay | Phase 1 | At or above $200M; 2% band | Open — Kay |
| 10 | Coverage floors per chart, and who may override a blocked publish | Kay | Phase 1 | Floors as tabled; Admin override with printed reason | Open — Kay |

### All ten decisions are closed as at 3 September 2026

Both owners have accepted the recommendations as they stand. Nothing in this pack is outstanding.

**One decision was overtaken by a scope constraint set after it was accepted.** Decision 7 was accepted by both owners and is then removed by the POC scope below, because the field it cross-tabulates is no longer stored. It is recorded as superseded rather than quietly dropped.

## The POC scope constraint, and the one view it removes

**This build is a proof of concept, and no Deloitte client information is stored in it.** If the firm later decides to hold client data in the application, it will run its own due diligence first. That constraint is set by the solution owner and governs the design; it is not a decision this pack asks for.

Three fields in the workbook could be read as client information. They are not equivalent, and only one of them has to come out.

| Field | What it holds | Public? | Disposition |
|---|---|---|---|
| **`Deloitte Tax Client`** (col. AI) | **28 `Yes`, 1 `No`, 230 blank.** Names 28 companies as Deloitte tax clients | **No.** A tax engagement is not a public disclosure | **Removed from the POC.** Not parsed, not stored, not exported |
| `DTT Market` (col. N) | 209 populated — British Columbia 121, Ontario 61, Quebec & NCR 12, Prairies Region 7, Atlantic 5, Chile 3 | Not client data — a Deloitte-internal geographic label applied to a public company | **Retained.** Identifies no client. Flag if the firm reads it otherwise |
| `Auditor` (col. AK) | 259 populated, `Deloitte` on 17 rows | **Yes** — the auditor of record appears in every issuer's annual filing | **Retained.** Publicly disclosed fact, sourced via a licensed platform |

**The consequence: the Deloitte-clients cross-tab cannot be built.** Decision 7 chose to ship it with three states so the 230 never-checked companies were visible. With column AI out of scope there is no client status to cross-tabulate at all, so the view is cut from the POC — by the data policy, not by preference. It returns intact if due diligence later admits the field, and the three-state design stands ready for that.

**Kay should hear this from Samuel rather than find it on the dashboard**, since he accepted a view that the scope constraint then removed.

### What the constraint does *not* change

- **The personal-data controls stay exactly as designed.** Named individuals sit in both uploaded files regardless of what is stored downstream — three cell comments by a named employee, and a sheet of named partners and client contacts in the screener. Parse-before-persist, the one-hour quarantine and the person-data tripwire are unaffected.
- **The prompt-egress controls stay too**, and the reason is worth stating: if this POC is what the firm evaluates during due diligence, the controls that keep internal fields out of prompts should already be in place to *be* evaluated. Removing them because there is currently nothing to protect makes the later review harder, not easier.
- **The licence position is unchanged.** Public issuer facts are still held under two third-party licences. Public does not mean freely storable.

---

## 1. Risk and legal must accept the hosting and model arrangement before anything else is built

**Decision needed:** Do risk and legal accept (a) licensed exchange and screener extracts, and (b) internal Deloitte client flags, held in a non-Deloitte cloud, with (c) company facts sent as prompts to the model vendor?

**Owner:** Samuel. **Blocks:** everything. **Lead time:** external and unbounded.

Three separate acceptances are bundled in one question, and they can be granted separately. Ranked by exposure:

| What is being asked | Exposure | If refused |
|---|---|---|
| Licensed extract facts in the database | Public company data under two third-party licences — the exchange's and the screener vendor's | Fatal to the architecture |
| ~~Internal client flags in the database~~ | ~~Tax-client flag, Deloitte market, pursuit fields~~ | **Withdrawn from the POC.** The tax-client field is not stored, so this acceptance is not sought |
| Company facts in prompts to the vendor | Public issuer facts only; internal fields are excluded by three independent mechanisms | Survivable — enrichment becomes manual with assistance, which removes most of the tool's value |

**Take these mitigations into the review; they are already designed in, not promises.**

- **Personal data is never persisted.** Both files carry it — the primary workbook has three cell comments authored by a named employee, and the screener's third sheet holds named partners, named client contacts and free-text notes on individuals' responses. Uploads land in one-hour quarantine, are parsed, and the raw bytes are deleted rather than archived. A tripwire blocks the commit and names the cell coordinates — never the value — if person-shaped data reaches an ingested field.
- **Internal fields cannot reach a prompt.** A type boundary the prompt builder will not accept, revoked column privileges on the worker's database role, and a pre-flight egress scan that throws and dead-letters the job. The last of these is covered by a contract test.
- **Both licence notices travel with every export** and onto printable dashboard views. No share links and no public dashboards in Phase 1.
- **The residual stored data is public-only** if the second acceptance is refused, which is what makes that refusal survivable.

**State the purpose limitation in the ask.** These records are used for one thing: deciding which companies the practice pursues. A named, bounded purpose is easier to accept than an open-ended data holding, and it is the truth.

**Do not overstate how public the corpus is.** The issuer facts are public records and the pack treats them that way. Two things in the uploaded files are not, and a reviewer will find them:

- **Personal data in both files.** The whitespace workbook carries three cell comments authored by a named employee. The screener's third sheet holds named partners, named client relationship owners, and free-text notes recording individuals' responses to outreach. Verified by reading the package parts.
- **The tax-client flag**, populated on 29 rows, records which companies are Deloitte clients. That is an internal fact about the firm, not a public record about the issuer.

Raising both unprompted is the stronger position, because the design already answers them — personal data is never persisted, and internal flags cannot reach a prompt.

**One item to raise explicitly:** the model vendor's training and retention posture. Request zero-retention if it is available on the account.

**Recommendation.** Book the review this week and take all three acceptances at once. Confirm the database region and that backups inherit it, and state plainly in the sign-off that the compute region may differ from the data region.

**Position accepted by the solution owner. Narrowed on 3 September 2026 by the POC scope constraint.**

The second acceptance is withdrawn — the tax-client field is not stored, so the review is not asked to approve internal client data in a non-Deloitte cloud. **Two acceptances remain, both covering public issuer facts:** licensed extract records held in the database, and those same facts sent as prompts. That is a materially lighter ask than the one this section was originally written for, and the review should be framed to match. It still has to happen: licensed public records are not the same as unrestricted ones, and the vendor's retention posture is still worth asking about.

---

## 2. Accept the filing aggregator's storage restriction as read, and fee coverage becomes a floor of tens rather than hundreds

**Decision needed:** Is the aggregator's terms-of-use restriction accepted as read — that it forbids automated *and* manual extraction, and forbids storing the retrieved data in a database?

**Owner:** Kay with legal. **Blocks:** whether the fee dashboards are deliverable at all.

The restriction reaches further than a scraping ban. It reaches the application's own document cache, which means the source cannot be used even with a human in the loop. Reading it as read leaves issuer-hosted documents — a company's own investor-relations site — as the only automated route to audit and tax fee disclosure.

That is a materially smaller reachable population. Note also that trading on a US over-the-counter venue generally does not make a Canadian issuer a filer there; of the venue spellings present in the extract, only three are registrant venues. The reachable subset is smaller than the 110 interlisted companies.

**Consequence either way.** The design commits to fee coverage as **a floor with a named count**, never as a percentage of the population. A dashboard tile reading "audit fees found for 61 of 259 companies" is honest. One reading "24%" invites the question of what the other 76% are, and the answer is not "no fees" but "not disclosed where we may look."

**Recommendation.** Accept it. Fees are already sequenced last in enrichment for independent reasons: they do not feed the tier logic, the source columns are empty for all 259 rows so there is no baseline to validate against, and they carry the highest fabrication stakes of any field in the product.

**This is the one decision with a scheduled evidence check.** Week-one spike S2 samples five companies for fee disclosure on issuer sites. If coverage is high, fees move up the order and this conversation reopens with data.

**Default if we hear nothing:** treat as accepted. Issuer-hosted only.

---

## 3. Displaying `Unclassified` is the difference between a truthful dashboard and a false one

**Decision needed:** May `Unclassified` appear as a tier state on the dashboard, or must every company resolve to a tier between 1 and 6?

**Owner:** Kay. **Blocks:** what day one looks like.

The stage-of-operations columns use an `X` presence marker, and blank means *not researched* — not *false*.

| State | Companies |
|---|---|
| No stage marker at all | **242 of 259** |
| Royalty or streaming marker only | 17 |
| Exploration, development or production marker | **0** |

Modelling stage as four booleans collapses all 242 unresearched companies into the same input a company would have if an analyst had affirmatively confirmed it was pre-exploration. Agnico Eagle — a producer with properties in Nunavut, Ontario and Finland — and a dormant shell arrive at the classifier indistinguishable. That is exactly how today's dashboard reaches a single bar at Tier 4.

So the choice on day one, before enrichment has run, is between a dashboard showing 242 companies as `Unclassified` and one showing 259 companies at Tier 4. The first is true. The second is the defect this project exists to fix.

**Recommendation.** Display it, styled as a gap rather than as a sixth colour in the tier ramp, with the count on the face of the chart. The state is implemented in the engine either way — only its display is in question — so this decision is reversible at no cost.

**Default if we hear nothing:** display it.

---

## 4. Confirm the province and jurisdiction axes recovered from the data, because the headers that named them are gone

**Decision needed:** Confirm the twelve Canadian jurisdictions and the foreign-jurisdiction list in Appendix A as the application's canonical axes — and decide whether the United States is one bucket or fifty.

**Owner:** Kay. **Blocks:** two dashboard views.

The "producing mines by Canadian province" table is eleven columns wide with **nine of eleven header cells reduced to `#REF!`**. Two province labels survive. The jurisdiction table does not exist at all — no table, not even a broken one. The axes have therefore been recovered from the property values themselves rather than from any header, and need confirming by someone who knows the practice's intent.

Three findings that need a decision, not just a nod:

- **Thirteen Canadian tokens collapse to twelve jurisdictions.** `NT` (6 companies) and `NWT` (1) are the same territory. Prince Edward Island is absent. Three of the twelve are territories, not provinces, so "by province" is the wrong label for the view — suggest "by province and territory."
- **The foreign axis mixes two levels of granularity.** Every column holds country names except the USA column, which holds twenty US **state** codes — Nevada 25, Alaska 15, Arizona 10. A single jurisdiction axis cannot hold both without ranking Nevada against Mexico.
- **Both axes carry the same spelling disease as the auditor column.** `Colombia` beside `Columbia`, `Côte d'Ivoire` beside `Cote D'Ivoire`, `Ethiopia` beside `Ethopia`, plus `Sambia` and `Botawana`. Each needs an alias map, which is built once and confirmed once.

**Recommendation.** Confirm Appendix A. Roll the United States up to a single bucket on the jurisdiction axis and keep the state detail on the company profile, where it is useful and where nothing is being ranked.

**Default if we hear nothing:** Appendix A as listed, US rolled up, aliases as mapped — all reversible, none silently.

---

## 5. The auditor entity identifier must be carved out of the empty-artifact scope cut

**Decision needed:** Confirm that `Entity ID (S&P)` on the auditor tab is explicitly excluded from the decision to cut empty artifacts from scope.

**Owner:** Kay. **Blocks:** the identity model.

The scope cut says: nothing empty in the source workbooks is designed in. Applied carelessly, it takes this column with it — and the column is not empty.

| Identifier | Coverage | Usable? |
|---|---|---|
| `Co_ID` (TSX extract) | **0 of 181** | No — header-only placeholder |
| `Co_ID` / `PO ID` (TSXV extract) | **0 of 899** each | No — header-only placeholders |
| `Entity ID (S&P)` (auditor tab) | **143 real numeric IDs**, 116 `Not found` | **Yes** |

It resembles the two genuinely empty vendor columns closely enough to be swept away by the same reading, and it is the only stable non-ticker identifier anywhere in the corpus.

**Why that matters more than it sounds.** Ticker plus exchange is not a stable key either: **98 rows in the TSX extract carry a venture-graduate flag**, so a majority of the senior-exchange cohort has already changed exchange at least once. A composite key reads an ordinary graduation as one company disappearing and a different one appearing — corrupting period comparison and tier migration for precisely the companies whose progression the practice most wants to track. Losing the entity identifier forces the matcher onto that unstable key for the whole population instead of a little over half of it.

**Recommendation.** Carve it out. This is a confirmation, not a trade-off.

**Default if we hear nothing:** carved out.

---

## 6. Computed prior-tier columns go into the export, a deliberate departure from the scope cut

**Decision needed:** Confirm that the export writes computed prior-period tier columns, even though the corresponding source columns are empty today.

**Owner:** Kay. **Blocks:** the export contract.

Same scope cut as decision 5, and this time the departure is deliberate rather than a rescue. The prior-tier columns are empty in the source because there has never been a prior period to compute from. The application will have one from its second period onward, and the tier-migration view — which the practice asked for — is unreadable without it.

Two things to be aware of when the first export lands:

- **The exported totals will not match the workbook's.** The application computes population from its own dataset. The workbook's proof block is off by one and carries a compensating `+1`. Expect "the numbers changed" to be raised as a defect on first delivery; the answer is pre-written and ships with the export.
- **Nine source cells already begin with `@`**, which Excel interprets as a formula. The export sanitiser marks any cell beginning with an interpretable character as text. This is an active concern with a live example, not a theoretical one.

**Recommendation.** Write them.

**Default if we hear nothing:** written.

---

## 7. Ship the Deloitte-clients cross-tab with its gap on the face of it, or cut it — but do not ship it looking complete

> **Superseded, 3 September 2026.** Accepted by both owners, then removed by the POC scope constraint: the tax-client field is not stored, so there is no client status to cross-tabulate. The view is cut from the POC and the reasoning below is retained for the point at which due diligence admits the field.

**Decision needed:** Cut the Deloitte-clients cross-tab from Phase 1, or ship it showing the 230 never-checked companies explicitly?

**Owner:** Kay and Samuel. **Blocks:** a dashboard view.

**230 of 259 rows are blank on the client flag, and blank means never checked — not "not a client."** The denominator is unknown for 89% of the population. A cross-tab that treats blank as "no" reports a whitespace count that could be wrong by up to 230 in one direction.

The workbook's existing version compounds this with a second defect: cross-tabs fail on string mismatch rather than missing data. Column headers typed as `Quebec and NCR` and `Prairie Region` never match the stored `Quebec & NCR` and `Prairies Region`, so two of five market rows can only ever return zero. Separately, 20% of the population — **53 of 259 companies** — has a foreign head office and therefore no Deloitte market at all, dropping a fifth of the population out of every market view.

**Three options.**

1. **Cut it from Phase 1.** Honest, and removes a view the practice asked for.
2. **Ship it with the never-checked count on the face of the chart** — three states, not two: client, confirmed not a client, never checked.
3. Ship it as a two-state chart. **Not recommended at any price.** It produces a confident number that is wrong, on a partner's screen, with nothing on screen saying so.

**Recommendation.** Option 2. The gap is the finding — it tells the practice that client status has never been established for 89% of the companies it tracks, which is itself worth knowing and is fixable by an afternoon of checking rather than by AI enrichment.

**Accepted by both owners, then superseded.** Option 2 stands as the design for the day the field returns; the POC ships without the view.

---

## 8. The brand green fails contrast on white, which forces a palette decision rather than an accessibility footnote

**Decision needed:** Dark-first dashboard, or light-first with corrected green tokens?

**Owner:** Samuel with brand. **Blocks:** palette tokens.

The Deloitte signature green `#86BC25` measures **2.27:1 on white** and **9.23:1 on black**. WCAG requires 3:1 for non-text and 4.5:1 for text. So on a light surface the brand green cannot carry axis text, thin lines, focus rings or small markers — and the failure is invisible to eye-checking, because large green fills look perfectly fine.

| Use | Light-mode token | Ratio | Dark-mode token | Ratio |
|---|---|---|---|---|
| Focus rings, borders (3:1 floor) | `#5E841A` | 4.38:1 ✓ | `#86BC25` | 7.66:1 ✓ |
| Green text (4.5:1 floor) | `#567C18` | 4.89:1 ✓ | `#86BC25` | 7.66:1 ✓ |

Text and non-text have different floors and one token cannot serve both, which is why there are two light-mode greens above.

**Being straight about this one.** Dark-first resolves the problem cleanly and the measurement is not in doubt. But this is a Deloitte deliverable that partners will see beside other Deloitte material, and a dark dashboard may be wrong for that context in ways a contrast ratio does not capture. The light-mode alternative — the corrected greens for every small mark, brand green reserved for large fills — is entirely workable and only slightly less elegant. **This is a taste-and-brand decision wearing an accessibility argument**, and it is put here as a question for that reason.

**Recommendation.** Light-first with the corrected tokens, unless there is house guidance or a partner preference pointing the other way. The brand green stays on screen where it reads as the brand — in large fills — and gets out of the way where it cannot be read.

**One dependency:** the exact tokens need confirming against Deloitte's internal brand hub. Public sources corroborate the green as Pantone 368 but are not authoritative. That confirmation blocks visual sign-off at milestone five, not function.

**Default if we hear nothing:** light-first with corrected tokens.

---

## 9. The threshold operator is ambiguous, and two companies sit close enough to the line for it to matter next quarter

**Decision needed:** Is the market-cap threshold *strictly above* $200M or *at or above* $200M — and how wide is the proximity band?

**Owner:** Kay. **Blocks:** entrant and drop-out semantics.

The threshold is stated three ways in the workbook: "in excess of" $200M on the cover, "≥ CAD $200M" on the consolidated list, and $50M on the dashboard labels. The active autofilter baked into the extract uses `greaterThanOrEqual 200000000`.

Today both readings yield the same 259 companies, because the smallest is $201,701,608. So this looks like it does not matter. It matters next quarter: **Generation Mining and Greenland Resources sit 0.85% and 0.86% above the line.** A normal market move drops either below it, and the application reports a drop-out — a company the practice stopped tracking — when nothing happened except a share price.

**Recommendation.** At or above $200M, matching the filter actually baked into the source file. Add a **2% proximity band** so companies within it are flagged as near-threshold on both sides rather than silently entering and leaving the population. Both of the companies above fall inside that band today, which is the point.

**Default if we hear nothing:** at or above, 2% band.

---

## 10. Coverage floors decide when a period may be published, and someone has to be able to override them

**Decision needed:** Confirm the per-chart coverage floors below which publish is blocked, and confirm that an Admin may override with a recorded reason.

**Owner:** Kay. **Blocks:** the publish gate.

Publish freezes an immutable snapshot that every dashboard then reads. It is blocked while any default-dashboard chart sits below its coverage floor, while unresolved conflicts remain, or while the run's fabrication rate exceeds its ceiling.

The floors are a judgement about how much of a chart may be missing before the chart misleads. Engineering has no basis for setting them; the practice does. Proposed starting values, to be confirmed or moved:

| Chart | Proposed floor |
|---|---|
| Tier distribution | 95% of companies with a resolved stage |
| Footprint views | 95% of companies with a resolved footprint |
| Province and jurisdiction views | 90% of companies with resolved property regions |
| Auditor cross-tab | 90% |
| Fee views | **No floor** — published with a named count, per decision 2 |

**On the override.** It must exist — a quarter close will eventually arrive with a chart one company short of its floor, and a tool that cannot be published is a tool that gets abandoned for the workbook. The design gives the override to an Admin and **prints the recorded reason in the dashboard header**, where a reader sees it. That is the mechanism that stops a stale-data warning from becoming a banner nobody reads, which is what happened to the workbook's own `TAB NOT UPDATED` notice.

**Recommendation.** Floors as tabled. Admin-only override, reason mandatory and printed.

**Default if we hear nothing:** as tabled.

---

## What we do while we wait

Decisions 2 through 10 all have safe defaults, so **Phase 1 construction is not blocked by silence** — it is blocked only by a *change* to a default arriving after the code is written, which is why confirmation is worth the meeting.

Decision 1 has no default. Milestone 1 — ingestion, validation report and the tier truth table, with no AI — is the natural work to run in parallel, and it is where the design already puts weeks two and three. One caveat worth stating: as designed, milestone 1 already writes licensed extracts and internal client flags to the non-Deloitte database. If decision 1 is still open when milestone 1 starts, that milestone should run against a local database and defer the hosted store until the answer arrives.

## Six things the design assumed, recorded here rather than buried

Where the brief was silent, these were chosen. None blocks Phase 1; each is stated so it can be challenged.

- **Six tiers in the model, grouped 5-and-6 on the dashboard.** The source computes six, the dashboard shows five, the pursuit tab lists five and omits exploration. Six is kept because grouping is reversible and losing a tier is not.
- **`Unclassified` is implemented regardless of decision 3.** The engine needs the state; only its display is in question.
- **Fees are sequenced last**, which the brief lists third. See decision 2.
- **The evaluation set is a regression and failure-mode instrument, not a precision estimate.** At 25 companies the confidence interval is roughly ±20 points, and it should not be quoted as an accuracy figure.
- **Magic-link authentication only**, no passwords, for the pilot.
- **Batched enrichment is the default** and synchronous is the exception, reversing the usual assumption. It halves the token cost and removes the deadline problem.

---

## Appendix A — the recovered axes, for decision 4

Extracted from the property region columns of the whitespace matrix (`A.02 Matrix`, columns Y–AF, rows 6–264), splitting multi-value cells on commas, slashes and conjunctions. Counts are company-mentions, not companies. Reproducible from the source workbook.

### Canadian jurisdictions — 13 tokens, 12 jurisdictions, 112 mentions

| Token | Mentions | Note |
|---|---|---|
| BC | 27 | |
| ON | 25 | |
| QC | 17 | |
| YT | 12 | Territory |
| SK | 8 | |
| NL | 6 | |
| NT | 6 | Territory |
| NU | 3 | Territory |
| MB | 3 | |
| AB | 2 | |
| NB | 1 | |
| NWT | 1 | **Alias of NT** |
| NS | 1 | |

Prince Edward Island does not appear. Three of the twelve are territories.

### Foreign jurisdictions — 82 tokens, 342 mentions

**Latin America** (16 tokens, 147 mentions) — Mexico 36; Peru 21; Chile 20; Brazil 19; Argentina 18; Colombia 6; Guyana 6; Bolivia 5; Nicaragua 4; Ecuador 3; Dominican Republic 2; Panama 2; Suriname 2; Guatemala 1; **Columbia 1** *(misspelling of Colombia)*; Venezuela 1

**United States** (20 tokens, 86 mentions) — **state codes, not countries** — NV 25; AK 15; AZ 10; ID 8; CA 5; UT 5; WY 3; SD 2; MT 2; OR 1; WV 1; VA 1; MI 1; SC 1; CO 1; MN 1; NY 1; TX 1; NM 1; AR 1

**Africa** (24 tokens, 51 mentions) — Cote D'Ivoire 6; Mali 5; Burkina Faso 5; Namibia 3; DRC 3; Tanzania 3; Zambia 3; Ghana 3; Guinea 2; Senegal 2; Mauritania 2; South Africa 2; Morocco 1; Niger 1; Sudan 1; Guinea-Bissau 1; Gabon 1; Malawi 1; Nigeria 1; **Côte d'Ivoire 1** *(variant)*; **Ethopia 1** and Ethiopia 1 *(misspelling)*; **Sambia 1** *(presumed Zambia)*; **Botawana 1** *(presumed Botswana)*

**UK and Europe** (12 tokens, 29 mentions) — Turkiye 6; Finland 5; Sweden 4; Spain 3; Ireland 3; Portugal 2; Bulgaria 1; Serbia 1; Greece 1; Netherlands 1; Greenland 1; Poland 1

**Australia, NZ and PNG** (3 tokens, 15 mentions) — Australia 12; Papua New Guinea 2; New Zealand 1

**Asia** (6 tokens, 13 mentions) — Mongolia 5; Philippines 3; China 2; South Korea 1; Kazakhstan 1; Malaysia 1

**Other** (1 token, 1 mention) — Saudi Arabia 1

### Alias map proposed for confirmation

| Variant found | Canonical |
|---|---|
| NWT | NT |
| Columbia | Colombia |
| Cote D'Ivoire | Côte d'Ivoire |
| Ethopia | Ethiopia |
| Sambia | Zambia — **confirm** |
| Botawana | Botswana — **confirm** |
| Turkiye | Türkiye |

The last two are inferences from a single mention each and should be checked against the underlying companies before the map is fixed.

---

## Appendix B — where these decisions come from

| Decision | Design section |
|---|---|
| 1 | `11-security-privacy-compliance.md`, `14-delivery-plan.md` (spike S6, risk R1) |
| 2 | `02-scope-phases-non-goals.md`, `14-delivery-plan.md` (spike S2, risk R2) |
| 3 | `00-corrected-ground-truth.md`, `07-classification-engine.md` |
| 4 | `00-corrected-ground-truth.md`, `09-dashboards-and-reporting.md` |
| 5 | `00-corrected-ground-truth.md`, `05-domain-model-and-schema.md` |
| 6 | `10-excel-export.md` |
| 7 | `05-domain-model-and-schema.md`, `09-dashboards-and-reporting.md` |
| 8 | `09-dashboards-and-reporting.md`, `16-least-confident-decisions.md` |
| 9 | `00-corrected-ground-truth.md` |
| 10 | `08-review-workspace.md` |

Every figure quoted in this pack is re-measured against the source workbooks by `scripts/verify_ground_truth.py`, currently 54 of 54 assertions passing. The axis extraction in Appendix A is reproducible from the same workbooks.
