# A document an analyst supplies is read like a filing the tool fetched

**Decision, 5 November 2026.** An Analyst or Admin can attach a PDF to a
company for the current quarter. They must have downloaded it from the
company's own website, publicly and without signing in, and they say so
(the form requires it). They give the address they downloaded it from. Pass 2
then reads it before anything it fetches. Review, the company profile and the
export all say the document was supplied by an analyst. A finding read from
one scores lower than the same finding read from a fetched filing, and is
never bulk-accepted.

## Why

Some companies' websites sit behind Cloudflare and return 403 to the research
fetcher. The fetcher identifies itself honestly, and we never disguise it as a
browser. On 5 November, Cadillac Mines and GR Silver were two of the four
companies still unclassified for this reason. Neither pass could read a page of
their sites. Samuel had downloaded their Q2 2026 statements and MD&A from those
same sites in his own browser.

Cadillac had a second reason: it was privately held as Gold Candle Ltd. until
15 May 2026. A private company files no AIF, so pass 1 had nothing to find.

## What is built

### The page

`/companies/[id]/documents` is for Analysts and Admins only, and the profile
links to it for them. It has a form with four parts: the PDF, the address it
came from, what kind of document it is, and the attestation. Below the form
is the list of documents supplied for the company this quarter, with who
supplied each one, when, and whether pass 2 has read it. Each can be removed.

### Getting the file to the server

- **A file of 3 MiB or less arrives in one request** (`supplyWhole`). It is
  read in that request, and its bytes are never written anywhere.
- **A larger file arrives in pieces.** Vercel refuses any request body over
  4.5 MB before the app sees it, and GR Silver's MD&A is 7.3 MB. The browser
  sends 3 MiB pieces, in order. They wait in `document_upload_chunks` until the
  last one arrives, then they are joined, deleted, and read.
- The limits on the pieces:
  - The first piece must start as a PDF does (`%PDF-`) before anything is
    stored, so a workbook picked by mistake never reaches the database.
  - Every piece is exactly the size the declared total implies, and none
    comes past the last. A piece out of order, of the wrong size or past the
    end drops the whole upload.
  - Each person has one open upload; starting another drops the one before.
    A unique index (`document_uploads_one_open`) holds this when two are
    begun at once from two tabs.
  - All open uploads together are capped at 100 MiB, whoever began them.
  - An upload left for more than an hour is deleted by the per-minute cron
    tick (`supply/sweep.ts`, called from `enrich/tick.ts`), and by every
    upload request, from anyone. `scripts/retention.mjs` sweeps it too, but
    nothing depends on that script, which is not yet scheduled (HANDOVER
    item 5).

**This is an exception to doc 11's "parse before persist"** (lines 28–34).
For up to an hour, a supplied PDF's raw bytes sit in Postgres, and so in its
WAL and point-in-time recovery. Doc 11 forbids that for uploads because the
workbook carries named people. A supplied filing is a public document that
the company published on its own website, so the harm doc 11 guards against
is not present. The exception is accepted on three conditions:

- it is bounded by the conditions above;
- only files over 3 MiB take this path (GR Silver's MD&A did; Cadillac's two
  did not);
- the analyst attests to each file.

The alternative was object storage with a lifecycle rule, which this
application does not otherwise have.

### Reading the file

The file is read by exactly the code that reads a fetched PDF
(`documentFromBody`, `fetch.ts`):

- the type is taken from the bytes, not from the file name;
- the 25 MiB cap and the 400-page cap apply;
- NUL characters are stripped, and the text-layer gate applies.

The page count is checked once the document is opened, before any page is
read. The time limit (60 seconds for a supplied file) is checked between
pages (`pdf.ts`). The text is the same text unpdf's own `extractText` gives,
which was confirmed on all four of Cadillac's and GR Silver's files.

The content hash is sha256 of the bytes plus the extractor. A PDF an analyst
supplied and the same PDF fetched by the tool are therefore one document. Only
the text is kept (doc 11: "store extracted text, not the file").

**The document is stored as a fetch would store it.** The `documents` row is
written exactly as a fetch from that address would write it, including
issuer-hosted tier 2. One row holds one text, whoever brought it. A later
fetch of the same bytes reads that row back, so if the row said "supplied", a
filing the tool fetched for itself would have been marked down. The supply also
restarts the row's 90-day retention clock. An analyst who supplies a file
today expects it to be read, not emptied next week because the tool fetched
the same bytes in the summer.

### Checks when the file is supplied

- The address must be http(s), on the company's trusted website this quarter
  or a subdomain of it, and never SEDAR+.
  - The IR platform pass 2 also fetches from (`q4cdn.com`) is refused. It
    serves every issuer's documents, so an address there says nothing about
    whose a file is.
- The company must have a trusted website at all.
- The quarter must be the current one, the newest period: pass 2 researches
  that one, and a past quarter is published.
- The file must be a PDF with a text layer that names the company
  (`namesCompany`).
- At most three documents can be supplied for one company in a quarter, and
  the same file only once. A unique index
  (`supplied_documents_live`) holds this when the same file is sent twice at
  once.
  - The exception: when retention has emptied the stored text, the same file
    supplied again replaces the first row (withdrawn, `replaces` in the audit
    row), puts the text back, and reopens the company for pass 2. Findings
    already read from the first copy are not superseded: it was the same
    text.
- The attestation must be ticked: "I downloaded this file from this address
  on the company's own website, publicly, without signing in."

### Checks again when pass 2 reads it (`readSupplied`, `live.ts`)

- The address is still on the trusted website, which may have changed.
- The text is still there, since retention empties it after 90 days.
- The document still names the company.

A document that fails any of these is skipped, with the reason in the run's
notes.

### How pass 2 reads it

- **Supplied documents are read first and spend no fetch.** They count against
  the five documents a job reads.
- **Of one kind, the analyst's comes first.** A supplied document has no
  stated year, so the reading order alone would put a fetched one of the same
  kind with a year ahead of it.
- **One reading order.** Supplied and fetched documents are put into one
  reading order by the kind the analyst gave. The prompt's character budget
  is spent in list order, so three interim reports ahead of a fetched AIF
  would otherwise crowd out its fee table.
- **No duplicate reads.** The same file is not fetched again from its address,
  and a fetched copy of the same bytes is skipped.
- **Fewer paid searches.**
  - If pass 1 listed nothing this quarter and an analyst supplied documents,
    pass 2 does not run its paid search.
  - A supplied AIF or circular counts as the fee-bearing filing the second
    search looks for.
- **A pass that reads one has read a filing.** The home-page fallback does not
  run, and the job counts as research.

### How a finding records it

At prepare time, `PassContext.supplied` records which documents were read as
supplied, as which row, and at what address. That context is frozen there. A
batched answer can come back up to a day later, and a document withdrawn in
the meantime was still what the model read.

From that context, each finding gets:

- the address the analyst gave, as its source;
- source tier 4 ("other"), so its evidence strength is lower than the same
  quote from a fetched filing;
- `enrichment_findings.supplied_document_id`, the supplied row it was read
  through.

Review, the bulk refusal and the citation all read the finding's own record.
None of them depends on the document still being supplied, or on which copy of
the bytes the `documents` table kept.

### A supplied document reopens the company

`passCoverage` (`start.ts`) offers the company again for pass 2, every group,
until a pass 2 job has read the document. That holds even when values are
already settled in review. A read is recorded in `supplied_reads` when the job
saves its answer.

A job created after the supply that finished without reading the document also
closes it. That happens when retention has emptied the text or the website has
changed, and closing it stops an unreadable file being paid for in every run.
Supplying the file again reopens the company.

The run form's scope text says this (`scope.ts`).

### Labelled wherever it is cited

- **Review** tags the row "supplied". The evidence panel names who supplied
  it, when and as what, and says the application did not fetch it. Its link
  reads "address given", not "open source".
- **The profile** shows "supplied by an analyst" with the date, and "not
  fetched by the application". It does not say who: a Viewer sees that a
  person supplied the document, not which person.
- **The export's** Sources sheet says "Researched from a document an analyst
  supplied".
- **Every review link** passes through `safeHref`, because this is the first
  source address a person typed.

### Never bulk-accepted

Doc 11 (line 84) requires the quote to be in text "the application itself
retrieved from a URL the application itself fetched". A supplied document
fails that premise. Its text still goes through the same anchor gate, and an
anchored finding is `proposed` as any other is. The difference is that
`partitionForBulkAccept` refuses it (refusal 6), and the board's
bulk-acceptable bucket never counts it. Each one is a person's call. The run's
own account of the finding also says it is not bulk-acceptable.

This is a deliberate reading of doc 11's "unverifiable state". The state is
the finding's record, not a separate value of `state`. A separate state would
send the finding to the quarantined bucket, where a well-anchored quote does
not belong.

### Removing a document

Removing a document keeps its row, so a finding read from it still says where
its quote came from. Findings read from it that nobody has decided on are
superseded and leave review: they should not wait there to be accepted from a
document the analyst has taken back. A decision since undone counts as none.
A decided finding stays decided; undo it in review if it should go. The audit
row lists the superseded findings.

A pass 2 job prepared before the removal can save its answer after it: a
batched answer comes back up to a day later. What it read from the removed
document is written already superseded (`worker.ts`, `persist`). The save
holds the document's row while it reads it, so a removal at the same moment
either waits for the save, and supersedes what it wrote, or goes first, and
the save sees it.

Any Analyst or Admin can remove any supplied document, not only their own:
the practice reviews together, and every removal is audited by name. Of two
removals at once, one succeeds and the other is told the document has gone.

### Audited

`audit_log` records the following events:

- `document_upload_started` for a file sent in pieces
- `document_supplied`, with the company, address, kind, hash, size, pages and
  the attestation's words
- `document_withdrawn`, with the findings it superseded
- `document_refused`, for every refusal, with the reason and whatever was
  declared. The file's contents are never recorded.

## What is not done, and known limits

- **The file is not kept.** A reviewer opens the address the analyst gave. If
  the company later changes or removes the file there, the stored text is
  still what every quote was checked against.
- **A supplied document's text is not exempt from retention.** It is cleared
  90 days after it was supplied and cannot be fetched back, so a later quarter
  needs it supplied again. Retention is not yet scheduled in production
  (HANDOVER item 5), so today nothing is cleared at all.
- **No four-eyes rule.** The analyst who supplied a document can accept, one
  at a time, the findings read from it. The supplier's name is beside every
  such finding in review. Refusing those accepts to the supplier is a small
  change if a second person joins the practice's review.
- **An interim report is read for what it says.** A Q2 MD&A says "six months
  ended June 30, 2026", so review's newer-research rule counts it as reporting
  on 2026. The extraction rules already refuse a quarter's or six months'
  figures for the annual financial fields. Any other value it changes is
  offered as newer research, which a person decides one value at a time.
- **Supplying a document does not start a run.** An Admin starts pass 2 from
  `/runs` as usual, and the company is offered as not yet researched.
- **Only the first five bytes of an upload are checked before it is
  stored.** An Analyst who means to can put up to 25 MiB of any bytes behind
  `%PDF-` into the database for up to an hour: they are dropped when the
  last piece arrives and the file fails to read, or when the hour passes.
  The caps above bound how much. This is an insider with an Analyst's
  account, every step of which is audited by name.
- **The time limit is looked at between pages.** One pathological page can
  run past 60 seconds; the page's own limit (`maxDuration`, 120 seconds)
  ends the request.
- **The 100 MiB cap on open uploads can be overshot by people beginning at
  the same moment.** Each checks the total before inserting. The overshoot
  is at most 25 MiB per Analyst beginning at once.
- **A supplied address is never fetched by pass 2,** even when its supplied
  copy could not be read (emptied by retention). Supplying the file again
  is the remedy, and the sites in question refuse the fetcher anyway.
- **A removal does not reopen the company.** If every finding of a job came
  from a document since removed, the job still counts the company as
  researched. Start pass 2 for it from `/runs` if it should be read again.
- **Replay mode and the end-to-end journeys do not exercise reading.** The
  library tests do, with injected live dependencies: the upload, provenance,
  the batch gap, reopening and withdrawal. The journeys check only that the
  page renders for an Analyst and is refused to a Viewer.

## Where it lives

- Migrations `0041_supplied_documents.sql` and `0042_supplied_documents_grants.sql`
- `src/lib/supply/` (the library, and `kinds.ts` for the labels)
- `src/app/(viewer)/companies/[id]/documents/`
- `src/lib/enrich/pdf.ts`, `fetch.ts`, `live.ts`, `worker.ts`, `start.ts`, `scope.ts`
- `src/lib/review/queue.ts`, `decide.ts`, and the two review grids
- `src/lib/profile/citations.ts` and the profile page
- `scripts/retention.mjs`
