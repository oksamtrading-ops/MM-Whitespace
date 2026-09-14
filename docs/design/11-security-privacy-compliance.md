# Both files carry personal data and two licences, so parse before you persist

## Data classification

| Class | Contents | Handling |
|---|---|---|
| **Public, licence-restricted** | Issuer facts from the exchange extract and the screener | Internal use only; both notices travel with every export |
| **Deloitte internal** | Tax-client flag, Deloitte market, comments, all pursuit fields | Never leaves the database into a prompt; hidden from Viewers by column, not by interface |
| **Personal data** | Named employees and client contacts embedded in **both** uploaded files | Never persisted. Stripped or blocked at ingest |
| **Derived** | Findings, evidence, tiers, traces, audit log | Retained per the schedule below |

## Personal data is in the primary file too

Verified by reading the package parts, not inferred:

| Property | Whitespace workbook | Screener export |
|---|---|---|
| Recorded creator | **TSX Group Inc.** | **Refinitiv** |
| Last modified by | A named person | A named person |
| Cell comments | **3, authored by a named employee** | none |
| Embedded media | — | 2 screenshots of a vendor terminal |
| Third sheet | — | Named partners, client contacts, free-text notes on client responses |

So "skip the obviously irrelevant sheet in the second file" does not close the exposure. Neither file contains macros or external links.

**Two licences, not one.** The brief names the exchange restriction only.

## Parse before persist

The reflex design — store the upload, then parse it — puts named individuals into a non-Deloitte cloud before any filtering runs, where they enter backups, point-in-time recovery and any signed URL that leaks. The pilot's entire legal premise is that this is public company data plus a couple of internal flags, and that premise is false for as long as raw uploads are retained.

1. The upload lands in **short-lived quarantine** with a lifecycle rule, never in durable storage.
2. Parsing produces normalised rows; **only those are written**.
3. The **raw bytes are deleted, not archived.** If re-parsing is needed, store a redacted rebuild containing only allowlisted sheets and columns.
4. **Strip before any sheet is read:** comments, legacy drawings, embedded media, and both document-property parts.
5. **Positive allowlist** of sheets and columns, failing closed. Sheets outside it are never read, and their existence is reported as a count rather than silently dropped.
6. **A person-data tripwire** runs over ingested free text — an email pattern, or a name-shaped value in a column that is not a company or firm name. A hit **blocks the commit** and names the cell. The event is logged with coordinates only, **never the value**.
7. The person-data sheet is detected by signature and blocks with an explicit message, so an Analyst who did not realise what they uploaded finds out.

Confirm the database region and that backups inherit it. State plainly in the risk sign-off that the application's compute region may differ from the data region.

## Keeping internal fields out of prompts is mechanical, not conventional

A rule saying "never put the tax-client flag in a prompt" fails the first time someone serialises a whole company object into a template. Three independent mechanisms:

1. **A type boundary.** Two row types; the prompt builder's signature accepts only the public one. There is no code path from the internal type to the model client.
2. **Revoked column privileges.** The worker role cannot read the restricted columns at all. This survives a bad refactor; a lint rule does not.
3. **A pre-flight egress scan** in the single client module: before the request goes out, assert the serialised body contains none of the restricted column names and none of the current period's tax-client company names. A hit throws and dead-letters the job.

The contract test builds a prompt from a fixture whose restricted fields hold sentinel values and asserts the compiled request body does not contain them. That test is the only one of the three that will still be true in six months.

## Authorisation

**Middleware is not an authorisation boundary.** Next.js middleware has a documented bypass class, and every Server Action compiles to an addressable endpoint whether or not its control renders — so a Viewer who can sign in could call publish.

- Every action and route handler begins with a role assertion, enforced by a lint rule that flags any exported server function whose first statement is not one.
- The request-scoped database client uses **the user's own token**, so row-level policy denies the write even if the role check is bypassed. Service-role access never appears in a request path.
- The publish invariant is additionally enforced by a **database constraint**, so it survives an API bug.
- Pin the framework above the patched release and test the bypass explicitly as a Viewer.

## The service-role key

Its blast radius is total and row-level policy does not constrain it: every company, every internal flag, every user record, plus the ability to **delete audit rows** — destroying the one artifact that answers who published what.

- **The worker does not hold it.** It gets a dedicated role with grants only on the tables it needs and no grant at all on the decisions or resolved-value tables, so a prompt-injected agent cannot manufacture an accepted value.
- Service-role access lives in **one module** used for two operations, each of which writes an audit row. A continuous-integration check greps for it elsewhere.
- The audit table revokes update and delete from every role, with a periodic export to separate storage so even a service-role compromise cannot silently rewrite history.
- Distinct keys per environment, a **separate database project for preview deployments seeded with synthetic data**, deployment protection on preview URLs, and secret scanning in the pipeline.
- The cron endpoint is publicly addressable: require a bearer secret compared in constant time, reject when the header is absent rather than allowing when unset, and return an identical response for missing and wrong. Because the tick does no work itself, a leaked secret only causes a no-op invocation.

## Upload and document threats

| Threat | Control |
|---|---|
| Zip inflation | The real file expands 8.7-fold from one megabyte, mostly one six-megabyte part. Cap upload size, inflated size, entry count, single-entry size and expansion ratio; enforce while streaming, **before** any XML is parsed |
| Macro-bearing or external-link workbooks | Rejected outright by part inspection |
| Entity expansion | Pin the parser version and keep a regression fixture asserting rejection rather than resolution |
| Type confusion | Sniff magic bytes and the content-types part; never trust extension or client-declared type |
| Memory exhaustion | Parse in the worker under a memory ceiling, never in a request handler; the large drawing part is never materialised |
| **User-supplied filings** | Accept PDF only after magic-byte sniffing; cap size and page count; extract text server-side under a timeout; strip embedded scripts, actions and attachments; **store extracted text, not the file**. If previewed, serve from a **separate origin** with a sandbox policy and attachment disposition |
| **Prompt injection via fetched pages** | A filing is untrusted text, and the model is being asked for a number that will appear on a partner's dashboard. Wrap retrieved content in explicit delimiters, instruct that content inside them is never an instruction, and give the agent **no side-effecting tools** |
| Server-side request forgery | The application's own fetcher must block private and link-local address space **after DNS resolution**, disallow redirects into private space, cap body size and time, and allowlist domains from the extract — **never a domain the model proposed** |

**The decisive control for fabricated fees is the grounding gate**, not the prompt: a numeric fee must appear verbatim, after normalisation, in text the application itself retrieved from a URL the application itself fetched. Failing that, the finding is created in an unverifiable state that can never be bulk-accepted. Section 6 specifies the matching rules.

## Formula injection on export

Nine source cells already begin with `@`, so the sanitiser will be exercised and a regression will be visible. One writer helper marks any cell beginning with an interpretable character as text, and the export emits no formula the application did not author. Section 10 carries the detail and the round-trip fixture.

## Cost control is a security property

Nothing else stops a mis-scoped re-run from spending the quarter's budget, and the failure is quiet.

- **A blocking pre-flight estimate** at scope selection: company count, estimated spend, estimated duration. Above a threshold the Analyst types the company count to confirm; full-scope re-runs are Admin-only. The default re-run scope is "unreviewed or stale" and is pre-selected.
- **A per-run budget** stored on the run, decremented from actual reported usage. Warn at 80%; halt at 100% pending an explicit raise with a recorded reason. A run cannot be created without one.
- **Both spend-limit error shapes route to halt**, not retry — including the 400 that a self-set limit produces, which a naive classifier treats as permanent and which would otherwise fail every remaining company (section 3).
- Vendor-side limits set per environment, with a separate key and a small cap for the nightly evaluation job.

## Audit logging

Recorded: sign-in success and failure; user invited, role changed, deactivated; upload received with hash, size and uploader; upload rejected with reason; **personal-data block with sheet and cell coordinates only**; parse completed with row counts and warnings; import committed; run started with scope, budget, model and prompt version; job failed with company and error type; run halted on budget; each accept, override and flag with field, old and new values and reason; bulk accept with threshold, count and identifiers; period published with unresolved count; period amended with reason; export generated and downloaded; admin setting changed; and any prompt-redaction violation.

That set answers **"who published this period and on what evidence"** only in combination with the frozen snapshot from section 5 — a decision log alone cannot, because findings are superseded by later runs.

Hash-chained tamper-evident logging is disproportionate for a pilot. Append-only grants plus the periodic export are the right level.

## Retention

| Data | Retention |
|---|---|
| Raw uploads | **One hour**, in quarantine, then deleted |
| Extracted document text | 90 days |
| Findings, decisions, traces | Life of the pilot |
| Frozen published snapshots | Life of the pilot — they are the audit answer |
| Audit log | 24 months, with periodic export |
| Platform logs | Platform default, **with prompt bodies redacted before logging** |

Each line needs a named owner for the deletion job, or none of it happens.

## Authentication and the Azure path

**An email address and a password, since 14 September 2026.** This reverses what this section said, and the sentence it reverses is kept here because the reasoning was sound and the record should show what was given up:

> ~~**Magic link only for the pilot; no passwords.** That removes credential stuffing, password reuse and reset flows in one decision, and it maps cleanly onto the eventual identity provider, since both are an external system asserting an email address.~~

What it did not survive was delivery. A mailed link is only as good as the mail, and the pilot's sender has no verified domain — so it reaches one inbox, and **the practice's own workbook owner could not sign in at all**. A sign-in that depends on an external vendor to work is not more available than one that does not; it is less.

All three things the old decision removed are genuinely back, and each is answered rather than waved at. **Credential stuffing** has an invite-only roster of about five accounts to work against, behind a throttle. **Password reuse** is a real residual risk and is accepted. **Reset flows** are the one that is not back: there is no self-serve reset, because there is no mail — an Admin issues a temporary password out of band and the holder must replace it at first sign-in, so no reset token exists to attack.

The property that changed shape is the sign-in form's answer. It used to be one sentence whoever asked, success included. It cannot be: somebody holding the right password is let in. What is defended now is narrower and is stated exactly — **every refusal reads the same, and takes the same time** — which is why an address with no account is still hashed against a decoy, and why every refusal is padded to one floor.

Deloitte SSO remains the destination, and this does not move away from it: the claim source below is still the only thing that changes. See `docs/decisions/S6-PASSWORD-AUTH.md`.

Invite-only, with a domain allowlist enforced in a database trigger rather than in the interface. Sessions bounded and revocable. A quarterly access review as a first-class Admin screen showing last sign-in with one-click deactivation — because there is no leaver process for an application outside Deloitte's own estate, and a partner who rolls off otherwise keeps access to the client roster indefinitely.

Portability is the indirection in section 5: authorisation never reads the provider's user table, only an application user table resolved from a single token claim. Swapping providers changes the claim source and nothing else.

## Licence obligations

Both notices are written into every export and onto printable dashboard views. Storage buckets are private with short-lived signed URLs and no caching. **No share links and no public dashboards in Phase 1.** Viewers receive derived and published values only, never re-served raw extract rows.

One item for the risk sign-off with a long lead time: prompts sent to the model vendor contain exchange-derived company facts. Confirm the vendor's training and retention posture and consider requesting zero-retention. Start this in week one; section 14 makes it the gating spike.
