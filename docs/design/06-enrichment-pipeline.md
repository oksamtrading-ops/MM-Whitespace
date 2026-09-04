# Discover with the model, fetch with the application, and let code enforce the citation

## The decision

**A hybrid pipeline.** The model's web search discovers candidate sources; the application fetches and caches the documents itself; extraction runs as structured calls over located windows; and a deterministic gate verifies every finding against a document the application holds before it can reach review.

The reason is narrow and decisive: it makes *"a fee must cite a filing"* **enforceable by code rather than by prompt**. A single autonomous agent per company is simpler to build but leaves the citation guarantee resting on the model's own compliance. Since a fabricated audit fee in front of a partner is the worst output this system can produce, the guard has to be mechanical.

| Approach | Cost/company | Citation guarantee | Verdict |
|---|---|---|---|
| One autonomous agent per company | $0.25–0.80 | Prompt-enforced | Rejected |
| Own crawler, no model discovery | $0.11–0.35 | Code-enforced | Rejected — brittle source discovery |
| **Hybrid** | **$0.12–0.25 batched** | **Code-enforced** | **Adopted** |

## Field priority: stage first, fees last

| Order | Field | Why here |
|---|---|---|
| 1 | **Stage of operations** | 242 of 259 rows blank. The only field that unblocks the tier column, which is the entire complaint |
| 2 | Properties by region | Feeds footprint, which feeds tier. Validation and additions only |
| 3 | Auditor and Big-4 class | 116 of 259 unknown; single-valued, cheap; the join key for fee views |
| 4 | Website, commodities, summary | Low stakes, low cost |
| 5 | **Audit and tax fees** | Last — see below |

Fees come last on evidence, not preference: they do not feed the tier logic, they have no baseline to measure against because the source columns are empty for all 259 rows, their sources are the weakest, and their primary source is legally excluded. Section 2 carries the full argument.

## Per-company research contract

**Inputs.** Company identifier, canonical name and known aliases, ticker root and exchange, interlisting venues, head-office country and subdivision, existing region values with provenance, existing commodity flags, known website, and the period's as-of date.

**Never passed into a prompt, mechanically:** the Deloitte tax-client flag, the Deloitte market, comments, and every pursuit field. Section 11 makes this a type boundary plus a revoked column privilege plus an egress scan, because a convention will not hold.

**Source hierarchy**, which also drives the source-tier component of evidence strength:

| Tier | Source |
|---|---|
| T1 | Regulatory filing from an authoritative host — the US filing system, or an issuer-hosted document that is filing-shaped |
| T2 | Issuer website, non-filing page |
| T3 | Exchange profile page |
| T4 | News |
| T5 | Anything else |

**The filing aggregator is excluded**, on legal grounds covered in section 2. Do not reintroduce it via a browser tool.

## Output schema

```json
{
  "company_id": "uuid",
  "field_key": "stage_of_operations",
  "findings": [{
    "value": {"exploration": true, "development": false,
              "production": true,  "royalty_streaming": false},
    "evidence_state": "asserted",
    "sources": [{"url": "https://...", "title": "...", "retrieved_at": "2026-09-02T00:00:00Z",
                 "source_tier": 1, "doc_type": "annual_information_form"}],
    "evidence_excerpt": "verbatim, <= 300 characters",
    "anchor": {"mode": "exact_normalized", "start": 48211, "end": 48402},
    "model_self_confidence": 0.86,
    "abstained": false,
    "abstention_reason": null
  }]
}
```

**Abstention is a first-class outcome.** A model that cannot find evidence must say so; that is a different and more useful answer than a low-confidence guess, and section 9 routes the two differently.

## Per-route model and citation decisions

The constraint that "structured output cannot be combined with citations" was recorded here as **true only for web search**. **That is wrong against the current API** — corrected 4 September 2026, when the client module was built. Setting `citations: {enabled: true}` on a document block together with `output_config.format` returns a 400 on any route, not only a searching one.

The fees route therefore **keeps citations and gives up structured output**, because this section's own reasoning for citations is the stronger of the two: an API-generated span over the document cannot be fabricated, whereas a model-authored excerpt in a structured field can. Fee findings are parsed from citation blocks, and the anchoring gate re-verifies them regardless. Every other route keeps structured output and leaves citations off. `src/lib/enrich/client.ts` asserts the two are never both set, so the combination cannot be reintroduced by accident.

| Route | Model | Output mode | Rationale |
|---|---|---|---|
| **Discovery** | Opus-tier | Strict tool call, citations forced on by search | Picking the wrong company's filing produces a confidently wrong, well-cited fee — the worst failure. The cost delta does not buy that risk across 110 interlisted companies and known renames |
| **Extraction**, general fields | Sonnet-tier | Structured output, citations off, application-side anchoring | 1M context, structured output supported, effort available |
| **Extraction, fees** | Opus-tier, high effort | **Citations on**, over a document block | The returned span is **API-generated against the document** and cannot be fabricated — strictly stronger than a model-authored excerpt. Tiny volume, largest downside |
| **Adjudication** | Opus-tier, high effort | Structured output, no tools | Only for detected conflicts |

**Take candidate URLs from the search result citations** rather than asking the model to restate them in tool arguments. It is free and removes a transcription-hallucination class.

**Not the cheapest tier as the general extractor**, for three checkable reasons: its context window cannot hold a large filing plus a multi-document window; the effort parameter is unavailable there, so there is no quality lever if it falls short; and its minimum cacheable prefix is several times larger than the others, so a field-dictionary prefix of a few thousand tokens **silently fails to cache with no error** — visible only as a zero in the cache-creation counter.

**Adjudication should mostly not be a model call.** The tier rules are a pure function and region conflicts are set arithmetic. Reserve the model for genuinely ambiguous cases — two documents disagreeing about stage — and invoke it only for companies with a detected conflict. Running adjudication across all 259 is the standard way this class of pipeline doubles its cost for no measured benefit.

## Prompt caching

Render order is tools, then system, then messages, and any byte change invalidates everything after it. Caches are scoped per workspace and per model.

**Stable prefix**, byte-identical across all companies on a route: the tool array serialised with sorted keys, then the field dictionary — allowed values, the exact region vocabulary, currency codes, the auditor enum and its normalisation rules, the abstention policy, the excerpt rules, and few-shot examples drawn from real rows.

**Breakpoints.** One at the end of the system block; one at the end of route-specific instructions; **one on the document content block**, which is the highest-value and most-missed of the three, since a large filing is read by three or four field-group calls and caching it converts three full-price reads into three cheap ones; and one on the growing message tail during discovery.

**What silently invalidates the cache in this specific pipeline:**

- **Per-company allowed-domain lists on the web tools.** Scoping fetch to the issuer's own domain looks like a safety improvement and changes the tools block, forcing a **full rebuild of every cache tier on every company**. Use a constant blocked-domain list instead, or stop budgeting for cache reads.
- **Toggling citations between field groups**, which invalidates system and messages. Fees-with-citations and everything-else-without are therefore **two cache namespaces**; do not expect one warm prefix to serve both.
- Toggling web search on for discovery and off for extraction while sharing a system prompt. Treat them as separate routes with separate prefixes deliberately.
- Any per-company value drifting into the system prompt — the company name "for context", the period label, a retrieval timestamp, a run identifier.
- Conditional system sections. Four route prefixes, never one branching prefix.
- **Non-deterministic serialisation** — an object assembled from an unordered query result, or a set. In a TypeScript and Postgres codebase this is the most likely accidental invalidator.
- Per-company effort based on a difficulty heuristic.
- **Fan-out timing.** A cache entry is readable only once the first response begins streaming, so firing ten companies at once means all ten pay the write and none reads. Send one, await first token, release the rest. This does not apply the same way on the batch path, which is why the longer cache lifetime is used there.

Make a cache read from the second company onward an **asserted invariant**, and put per-route hit rate on the observability dashboard.

## The anchoring gate

"Verify the excerpt against the cached document" is under-specified in exactly the ways real filings break it.

| Hole | Failure | Rule |
|---|---|---|
| Re-extraction drift | Correct findings rejected because the verifier re-extracted and column order changed | Verify against the **byte-identical stored artifact**, keyed by hash, with extractor name and version recorded. Never re-extract at verification time |
| Unicode | Ligatures, soft hyphens, non-breaking spaces inside figures, dash and quote variants | Compare a normalised form on both sides; store the normalisation version |
| **Tables** | A fee and its label are rarely contiguous, so a contiguous excerpt often **does not exist as a substring** | For numeric fields drop contiguity. Require a **proximity conjunction**: the normalised numeral, a label from a controlled bilingual list, and the fiscal year, all within a window |
| **Scale words** | "$412" under an "in thousands" header is $412,000 | The finding carries an explicit scale token; the verifier checks it against the document's scale phrase. This alone prevents thousandfold errors |
| No text layer | Scanned filings yield garbage; the model correctly reports nothing and the pipeline records "no fee disclosed" | Characters-per-page gate **before** the document is sent, producing a distinct state |
| Language | Quebec issuers file in French | Bilingual label lists; a French filer in the evaluation set |

**Failure states are explicit, and none is a silent drop:**

- `anchor_mismatch` — plausible but unanchored. Quarantined, never bulk-acceptable, shown beside the document.
- `unsupported` — absent from the document. Never surfaced as a proposal; counted in a per-run hallucination rate that **gates publish**.
- `no_text_layer` / `source_unreachable` — routed to the manual queue.

And preserve the distinction the workbook loses: **searched-and-found-nothing is not the same as source-unreachable**, which is not the same as never-attempted.

## Evidence strength replaces confidence

A model's self-reported float is not calibrated, is not comparable across fields, drifts with every prompt change, and clusters — most values land in a narrow band with errors distributed indistinguishably among them. Since bulk-accept keys off this number, an uncalibrated float would be the highest-leverage control in the product, backed by nothing measured.

Replace it with a **versioned function of observable components**, renamed in the interface to make the change of meaning visible:

| Component | Derivation |
|---|---|
| `source_tier` | Computed from the resolved URL and document classification — **not asked of the model** |
| `recency` | Age of the source document against the field's expected cadence |
| `anchor_strength` | Exact-normalised, proximity, label-only, or none |
| `corroboration` | Count of independent T1–T2 sources agreeing. Decisive for stage, where one press release is weak and a filing plus a production disclosure is strong |
| `extraction_agreement` | Two independent passes agreeing, on a sample |

The model's self-report is **stored but excluded from the accept threshold** until it demonstrably adds signal on the labelled set. Thresholds are calibrated so that a given level corresponds to a **measured** precision, and the calibration run is recorded alongside the threshold so a prompt or model change forces re-calibration rather than silently invalidating it.

## Re-run policy

**Never re-researched:** any field with an accepted or overridden decision, and every manual-only field.

**Staleness is anchored to the source document's date, not the research date:**

| Field | Clock | Trigger |
|---|---|---|
| Fees | Event | Latest known fiscal year falls behind the period, or a newer filing appears on the issuer site |
| Auditor | Event | Auditor-change announcement; annual fallback |
| Stage | Event | Commercial-production or first-pour announcement; six-month fallback |
| Regions | Derived | Re-derive when the extract changes — **never overwriting analyst-added values** |
| Website, summary, commodities | Counter | Annual |

**Forced triggers**, bypassing all clocks: prompt version change, model change, schema hash change, document hash change, or a reviewer flag.

An **inherited value must look inherited** in the interface, with its age. Otherwise research from two years ago silently presents as this quarter's work.

## Throughput and cost, restated honestly

The earlier per-company estimate was optimistic by two to four times. Three corrections: **web search is billed per search** on top of tokens, which at a handful of searches per company is a fifth of the whole earlier budget; the current model generation's tokenizer produces roughly a third more tokens for the same text, so any count benchmarked on an older model under-counts; and the assumed cache hits depend on tool configuration that a per-company domain list would destroy.

| Mode | Per company | Per 259-company run |
|---|---|---|
| Synchronous | $0.25–0.45 | $65–115 |
| **Batched, with document caching** | **$0.12–0.25** | **$30–65** |

Re-baseline with a token-counting call against a real filing before publishing a firm number.

**The useful conclusion is that cost is not a design constraint at this magnitude.** A full quarterly run costs less than an hour of professional time. Stop optimising it and spend the engineering on the anchoring gate and the evaluation set. The one lever worth taking is the Batch API, and only because it also fixes the job architecture.

## Observability and replay

Section 3 lists the recorded artifacts. Two obligations specific to enrichment: search results carry encrypted content that must be replayed **byte-exact** or a continuation fails, so a stored assistant turn cannot be reconstructed and must be persisted verbatim; and batch results are retained only 29 days, so they must be downloaded and persisted or the archive silently empties a month after each quarterly run.

Replaying one company reproduces its prompt from the recorded prefix hash, model, tool versions, effort and schema hash, and either reuses the stored raw result or re-issues the call under a new attempt — visibly, as a new finding, never as a silent overwrite.
