import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../../lib/auth/session.ts";
import { newestPeriod } from "../../../../../lib/db/periods.ts";
import { hostOf } from "../../../../../lib/enrich/live.ts";
import {
  ATTESTATION, CHUNK_BYTES, isRowId, kindLabel, MAX_SUPPLIED, MAX_SUPPLY_BYTES, SUPPLY_KINDS, suppliedFor, trustedWebsite,
} from "../../../../../lib/supply/supply.ts";
import Callout from "../../../../_ui/Callout.tsx";
import Refusal from "../../../../_ui/Refusal.tsx";
import Section from "../../../../_ui/Section.tsx";
import Page from "../../../../_ui/Page.tsx";
import { fmtDate, periodName } from "../../../../_ui/format.ts";
import SupplyForm from "./SupplyForm.tsx";
import RemoveButton from "./RemoveButton.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supply a document" };
// Reading a long PDF is done in the request that sends its last piece.
export const maxDuration = 120;

/**
 * Documents an analyst supplied for one company this quarter: the form, and
 * what is already supplied. For a company whose website refuses the research
 * fetcher. docs/decisions/SUPPLIED-DOCUMENTS.md.
 */
export default async function SupplyDocuments({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted"
                 body="Supplying a company's documents is for Analysts and Admins."
                 action={{ href: "/companies", label: "Back to companies" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }
  const { id } = await params;
  const company = isRowId(id)
    ? await ctx.db.get("select id, canonical_name from companies where id = ?", id) as { id: string; canonical_name: string } | undefined
    : undefined;
  const period = await newestPeriod(ctx.db);
  if (!company || !period) {
    return <Refusal title="No such company" body="That company is not in the database."
                    action={{ href: "/companies", label: "Back to companies" }} />;
  }
  const website = await trustedWebsite(ctx.db, company.id, period.id);
  const site = website ? hostOf(website) : null;
  const supplied = await suppliedFor(ctx.db, company.id, period.id);
  const live = supplied.filter((s) => s.withdrawnAt === null);
  const profile = `/companies/${company.id}` as Route;

  return (
    <Page title="Supply a document" back={{ href: profile, label: company.canonical_name }}
          meta={`${company.canonical_name} · ${periodName(period.label).name}`}>
    <div className="withrail">
      <div className="reading">
        <p className="sub rise">
          When the company&rsquo;s website turns the research fetcher away, download its filing in your
          browser and supply it here. The next pass 2 reads it before anything it fetches. Only its text is
          kept, and every value read from it is labelled as supplied in review and never bulk-accepted.
        </p>

        <Section id="supply" title="Supply a PDF" index={1}>
          {!site
            ? <Callout tone="warn" title="No website to check against">
                This company has no website the application trusts this quarter, so there is nothing to check a
                download&rsquo;s address against. Accept its website in review first.
              </Callout>
            : live.length >= MAX_SUPPLIED
              ? <Callout tone="info" title={`${MAX_SUPPLIED} documents supplied`}>
                  That is the most for one company in a quarter. Remove one below to supply another.
                </Callout>
              : <SupplyForm companyId={company.id} periodId={period.id} site={site}
                            kinds={SUPPLY_KINDS} attestation={ATTESTATION}
                            chunkBytes={CHUNK_BYTES} maxBytes={MAX_SUPPLY_BYTES} />}
        </Section>

        <Section id="supplied" title="Supplied this quarter" index={2}
                 caption={supplied.length === 0 ? "Nothing yet." : undefined}>
          {supplied.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead><tr>
                  <th scope="col">Document</th><th scope="col">Supplied</th>
                  <th scope="col">Research</th><th scope="col"><span className="sr-only">Remove</span></th>
                </tr></thead>
                <tbody>
                  {supplied.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">{s.filename}</a>
                        <span className="meta">{` · ${kindLabel(s.kind)} · ${s.pageCount} page${s.pageCount === 1 ? "" : "s"}`}</span>
                      </td>
                      <td>{s.suppliedBy}<span className="meta">{` · ${fmtDate(s.suppliedAt)}`}</span></td>
                      <td>
                        {s.withdrawnAt
                          ? <span className="meta">Removed {fmtDate(s.withdrawnAt)}</span>
                          : s.read ? "Read by pass 2" : <span className="meta">Waiting for pass 2</span>}
                      </td>
                      <td>{!s.withdrawnAt && <RemoveButton suppliedId={s.id} name={s.filename} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <aside className="rail rise" aria-label="What happens">
        <p className="k">What happens</p>
        <ol className="steps">
          <li><b>Read</b><span>The PDF is read as a fetched filing is: the same limits, the same reader. Its text is kept; the file is not.</span></li>
          <li><b>Checked</b><span>It must be a PDF with text, name this company, and come from {site ?? "its website"}.</span></li>
          <li><b>Researched</b><span>The next pass 2 run offers this company again and reads the document first.</span></li>
          <li><b>Reviewed</b><span>Each value read from it is labelled as supplied, and accepted one at a time.</span></li>
        </ol>
        <p className="meta site">
          <Link href={"/runs" as Route} prefetch={false}>Start a run</Link> when you have supplied what you need.
        </p>
      </aside>
    </div>
    </Page>
  );
}
