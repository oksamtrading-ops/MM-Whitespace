# Cassettes

**These are synthesised recordings, not captured vendor responses.**

No request has ever been sent to the model vendor from this build. Live mode is
disabled in `src/lib/enrich/worker.ts` and throws, pending the risk and legal
review under decision 1 in `docs/decisions/QUESTIONS-PACK.md`.

The companies here — Northco Mining Corp., Royalco Streaming Inc. — are the
fabricated ones from the synthetic fixture. No real issuer, no real filing text,
and no licensed content appears in this directory.

They exist so the pipeline can be exercised end to end with no key and no
network: the ledger moves, the anchoring gate runs, evidence is scored, and
findings persist. Replay is the default mode for exactly that reason.

## What they deliberately contain

Northco's recording includes a **planted fabricated tax fee** — $265,000, plausible,
well-formed, and stated with higher self-confidence than the real audit fee. It
appears nowhere in the fee table. The gate quarantines it as `anchor_mismatch`
while accepting the real $412,000 audit fee via a proximity anchor, which is the
demonstrable artifact for this milestone.

Royalco's recording includes an **abstention**, which is a first-class outcome
with its own state and is excluded from the hallucination rate that gates publish.

## Rebuilding

```bash
node tests/cassettes/build_cassettes.mjs
```

Keys are derived from route, model, prompt version, schema hash and the rendered
per-company content. Changing any of them changes the key and produces a miss,
which is correct: a stale recording answering a changed prompt is worse than no
recording.
