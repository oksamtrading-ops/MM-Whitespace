# The five decisions I am least confident about

Stated plainly, with what would change my mind.

## 1. Sequencing fees last, when fees are what the practice asked to see

The reasoning is sound on the evidence: fees do not feed the tier logic, they have no baseline to validate against because the source columns are empty for all 259 rows, their primary source is legally excluded, and they carry the highest fabrication stakes. But the fee columns are visibly what the practice wants — the workbook has dedicated blocks for audit fees, tax fees, currency, fiscal year and the ratio, and a dashboard tile designed around them.

A Phase 1 that ships correct tiers and empty fee columns may read as having missed the point, however defensible the sequencing is.

**What would change my mind:** the week-one spike finding that fee disclosure is reliably retrievable from issuer sites for a majority of the population. If coverage is high, fees move up the order.

## 2. Recommending a dark-first dashboard on a contrast measurement

The measurement is not in doubt — 2.27:1 on white against 9.23:1 on black — and the consequence is real: on a light surface the brand green cannot carry axis text, thin lines, focus rings or small markers. Recommending dark-first resolves it cleanly.

But this is a Deloitte deliverable, partners will see it beside other Deloitte material, and a dark dashboard may simply be wrong for the context in ways a contrast ratio does not capture. The alternative — light mode with darkened green for every small mark and the brand green reserved for large fills — is entirely workable and only slightly less elegant.

**What would change my mind:** any house guidance on dashboard surfaces, or a partner preference. This is a taste-and-brand decision wearing an accessibility argument, and I have put it as an open question rather than a recommendation for that reason.

## 3. The three-way region merge, which trades one silent failure for another

Carrying an analyst-added region value forward when the extract goes silent prevents a real, demonstrated failure: two named companies changing tier purely because a file was re-parsed.

But it introduces the opposite risk. If the exchange **legitimately** removes a property — a divestment, a lapsed claim — the application carries the stale value forward indefinitely, and the warning that says so will be one line in a report during a busy quarter close. I have chosen the failure that is loud over the one that is silent, but I am not certain that is right for a value nobody re-examines.

**What would change my mind:** evidence about how often the extract's region data legitimately shrinks between quarters. Nobody currently knows, because nobody has diffed two consecutive extracts.

## 4. Building the anchoring gate before knowing how often it fires

The gate — proximity conjunction for numerics, scale-word checking, normalised comparison against a stored artifact — is the most intricate machinery in the design, and it exists to prevent a failure mode that has not yet been observed **because the pipeline does not exist yet**.

It could turn out that the model, given a located window from a document the application already fetched, essentially never fabricates a figure, in which case a much simpler substring check would do and the elaborate version is over-engineering paid for in complexity forever.

**What would change my mind:** the fabrication rate measured against the known-negative fee controls in the evaluation set. If it is near zero with a simple check, simplify. I have deliberately front-loaded that measurement into the evaluation design so the answer arrives early rather than after the machinery is built.

## 5. Postgres-plus-cron over a managed durable workflow, on a portability argument

The rejection of the managed option rests on portability to Azure — an event with no date, no committed budget, and no certainty of happening at all. The pilot may run for years on current infrastructure, in which case the managed option would have been less code, better observability out of the box, and less of the ledger, lease-renewal and worker-slot machinery that section 3 now specifies.

I also want to be honest that an earlier draft of this design justified the rejection on a technical claim about the managed option's state layer that could **not be substantiated on review**, and I withdrew it. What remains is a real but softer argument.

**What would change my mind:** a firm decision that the Azure migration is not happening, or is more than two years out. At that point the managed option is probably the better engineering choice, and the ledger becomes machinery built for a migration that never came.
