# Spike S5 — the access model, closed

**Status:** closed, 9 September 2026. Run against Postgres 17.6 on Supabase.
**Decision it unblocked:** the entire authorisation design.
**Verdict:** the design is sound and was **not deployable as written**. Three
defects, all found in the first hour of it running anywhere. Fixed in
`0008_close_the_data_api.sql`; re-provable with `scripts/s5_access_model.sql`.

Migration `0003_roles_and_policies.sql` had never executed. It is the only
Postgres-only file in the schema, the local runtime is SQLite, and SQLite has
neither roles nor row-level security — so the authorisation design had been
reviewed but never run. Everything below is what running it revealed.

---

## 1. A policy grants nothing

`0003` writes policies for `app_viewer` and `app_analyst` and never grants
`select` on the tables those policies govern. In Postgres a policy **narrows an
existing privilege**; it does not confer one. Every read came back
`permission denied for table`, not a filtered row.

This failed **closed**, which is the safe direction — but it meant the
internal-field rule had never filtered anything, because no Viewer could get
far enough to be filtered. The mechanism the design leans on hardest was
untested by construction.

## 2. RLS on `periods` with no policy silently defeats the policies that read it

`viewer_reads_public_published` is:

```sql
exists (select 1 from periods p where p.id = period_id and p.status = 'published')
```

`0003` enables row-level security on `periods` and writes no policy for it.
That subquery is **itself subject to RLS for the querying role**, so a Viewer
sees zero periods, the `EXISTS` is false for every row, and the Viewer sees
nothing at all.

Measured, after granting the privileges missing from defect 1 and before
fixing this one:

| role | probe | rows |
|---|---|---|
| `app_viewer` | published + public field | **0** (should be 1) |
| `app_viewer` | periods visible to it | **0** of 2 |
| `app_analyst` | tiers | 2 — its policy is `using (true)` and reads no period |

A Viewer would have opened an empty dashboard, and the cause is two tables
away from the symptom.

**This trap bites more than once.** Writing the fix, I enabled RLS on every
remaining table and immediately reproduced the same defect twice: the Analyst
lost `tier_traces` and the worker lost `companies`, both holding grants with no
policy. Enabling RLS on a table whose role has a grant but no policy silently
takes the grant away.

## 3. The data API bypassed all of it

The largest finding, and one that no amount of reading `0003` would produce,
because it is not about `0003`.

Supabase serves every table in the `public` schema over PostgREST as the `anon`
role — the key that ships inside a browser. `0003` enables row-level security
on **six** tables. The schema has **thirty-one**.

Measured before the fix, `anon` held `select` on all thirty-one and returned
rows from every table without RLS:

| table | RLS | `anon` could read |
|---|---|---|
| `app_users` | no | every email and role |
| `enrichment_findings` | no | every unreviewed draft finding |
| `review_decisions` | no | every analyst judgement |
| `audit_log` | no | who did what |
| `companies`, `company_identifiers` | no | the whole population |
| `published_period_values` | no | everything published |
| the six in `0003` | yes | nothing — RLS with no policy returns no rows |

The six tables `0003` protects were the only ones that behaved.

---

## What changed

`0008_close_the_data_api.sql`:

- **Grants the privileges the policies were written for**, so they engage.
- **Adds the missing `periods` policy**, and one for every other table where a
  role holds a grant.
- **Closes the data API.** This application queries from the server and never
  through PostgREST, so `anon` and `authenticated` are revoked from everything
  in `public`, including default privileges for tables created later.
- **Enables row-level security on all thirty-one tables**, so a future grant
  cannot open one by accident. Deny-by-default: a table with RLS and no policy
  for a role returns nothing to it.

## The result

Eighteen probes, all passing, including against **real workbook values**:

- A Viewer reads published, public values — six real auditors — and **none** of
  the `dtt_market` values on the same rows. The internal classification is
  enforced against real data, not just a synthetic fixture.
- A Viewer is refused `tier_traces`, `audit_log` and `enrichment_findings`
  outright.
- A Viewer sees no draft period at all: not its values, not its tiers.
- An Analyst reads the draft, which is the job.
- The worker reads `companies` and is refused `company_period_field_values` and
  `tiers` — so a prompt-injected agent cannot manufacture an accepted value.
  **This half of the design was correct as written.**
- `anon` and `authenticated` are refused everything.

## The kill criterion

> Column grants do not compose as expected with the connection pooler → split
> restricted columns into their own table with its own policy.

**Not triggered.** The composition works. The internal-field restriction is
enforced by `field_key` against `field_catalog`, not by column grants, so the
pooler is not in the path of that decision at all. No table split is needed.

## What this does not yet prove

- The application does not connect as `app_viewer` or `app_analyst` yet. It
  enforces roles in application code and queries SQLite. These policies are the
  second layer for when it moves, and the layer is now known to work.
- `enrichment_worker` has never been used by the worker, which also still runs
  against SQLite.
- Nothing here was tested through the pooler under load.

## Re-running it

```bash
psql "$DATABASE_URL" -f scripts/s5_access_model.sql
```

Self-contained: it seeds, probes, prints PASS/FAIL, and deletes its own rows.
Safe against a database holding real data.
