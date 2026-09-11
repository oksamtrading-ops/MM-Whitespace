import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { periodAdmissibility } from "../../../../lib/db/commit.ts";
import { readParse, suggestLabel, type ParseFinding } from "../../../../lib/ingest/quarantine.ts";
import Facts from "../../../_ui/Facts.tsx";
import Refusal from "../../../_ui/Refusal.tsx";
import Section from "../../../_ui/Section.tsx";
import { fmtDate } from "../../../_ui/format.ts";
import CommitForm from "./CommitForm.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Validation report" };

export default async function ValidationReport({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireRole(["analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Uploading a workbook is for Analysts and Admins."
                 action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { id } = await params;
  const parse = await readParse(ctx.db, id);
  if (!parse) {
    return (
      <Refusal title="That report has gone"
               body="A parsed workbook is held for one hour and then deleted, and a committed one is deleted straight away. Upload it again to see the report."
               action={{ href: "/upload", label: "Upload a workbook" }} />
    );
  }

  const { report } = parse.payload;
  const asOf = parse.payload.period;
  const companies = parse.payload.companies.length;
  const totals = Object.entries(report.totals ?? {});
  const failing = totals.filter(([, [actual, expected]]) => actual !== expected);

  const previous = await ctx.db.get("select label from periods order by market_cap_as_of desc limit 1") as { label: string } | undefined;

  // What the commit will refuse, said here rather than discovered by pressing
  // the button. A period with no date cannot be committed at all.
  const blocked = !asOf
    ? "The parser could not resolve a market-cap date, so there is no period to commit."
    : report.blocking.length > 0
      ? `${report.blocking.length} blocking finding${report.blocking.length === 1 ? "" : "s"} must be resolved in the workbook first.`
      : await periodAdmissibility(ctx.db, asOf);

  return (
    <div className="reading">
      <p className="crumb rise"><Link href="/upload" prefetch={false}>← Upload</Link></p>
      <h1 className="rise">Validation report</h1>
      <Facts className="rise" items={[
        { label: "Workbook", value: parse.filename },
        { label: "Market cap as of", value: asOf ? fmtDate(asOf) : "unresolved" },
        { label: "Companies", value: companies, figure: true },
        { label: "Source SHA-256", value: <code>{parse.sha256.slice(0, 12)}</code> },
      ]} />

      {blocked
        ? <div className="notice alert rise" role="status">
            <b>Cannot be committed</b><span>{blocked}</span>
          </div>
        : <div className="notice ok rise" role="status">
            <b>Ready to commit</b>
            <span>
              Nothing is blocking.{" "}
              {report.warnings.length > 0
                ? `Read the ${report.warnings.length} warnings below and acknowledge them.`
                : "There are no warnings."}
            </span>
          </div>}

      <Section id="blocking" title="Blocking" index={1}
               caption={report.blocking.length === 0
                 ? "None. Nothing in this workbook refuses the commit."
                 : "These stop the commit. They are problems in the workbook, not in the reading of it."}>
        {report.blocking.length > 0 && <Findings findings={report.blocking} tone="alert" open />}
      </Section>

      <Section id="warnings" title="Warnings" index={2}
               caption={report.warnings.length === 0
                 ? "None. There is nothing to acknowledge."
                 : "These do not stop the commit, and you acknowledge them before it happens."}>
        {report.warnings.length > 0 && <Findings findings={report.warnings} tone="warn" />}
      </Section>

      <Section id="proofs" title="Proof totals" index={3}
               caption="Each total is recomputed from the rows and checked against what the workbook says. A total that does not tie means the two disagree.">
        {totals.length === 0
          ? <p className="empty">The parser produced no proof totals.</p>
          : (
            <ul className="gatelist">
              {totals.map(([label, [actual, expected]]) => {
                const ties = actual === expected;
                return (
                  <li key={label} className={`gateline ${ties ? "ok" : "no"}`}>
                    <span className="mark" aria-hidden="true">{ties ? "✓" : "✗"}</span>
                    <span className="what">{label}</span>
                    <span className="fig-sm">{ties ? actual : `${actual} vs ${expected}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        {failing.length > 0 && (
          <p className="note">
            <b>{failing.length} total{failing.length === 1 ? " does" : "s do"} not tie.</b>{" "}
            The workbook disagrees with itself here; committing records what the rows say.
          </p>
        )}
      </Section>

      <Section id="info" title="Informational" index={4}
               caption={report.info.length === 0
                 ? "Nothing to note."
                 : "What was read, what was skipped, and why."}>
        {report.info.length > 0 && <Findings findings={report.info} tone="quiet" />}
      </Section>

      <Section id="commit" title="Commit" index={5}>
        <CommitForm parseId={parse.id}
                    suggestedLabel={asOf ? await suggestLabel(previous?.label ?? null, asOf) : ""}
                    warnings={report.warnings.length}
                    blocked={blocked} />
      </Section>
    </div>
  );
}

const SHOWN = 6;

/** Findings grouped by code: the code is the fix, the details are the instances. */
function Findings({ findings, tone, open = false }: {
  findings: ParseFinding[]; tone: "alert" | "warn" | "quiet"; open?: boolean;
}) {
  const groups = new Map<string, string[]>();
  for (const f of findings) {
    const list = groups.get(f.code) ?? [];
    list.push(f.detail);
    groups.set(f.code, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <ul className={`findings ${tone}`}>
      {ordered.map(([code, details]) => (
        <li key={code}>
          <p className="head">
            <code>{code}</code>
            <span className="fig-sm">{details.length}</span>
          </p>
          <ul className="detail">
            {details.slice(0, SHOWN).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
          {details.length > SHOWN && (
            <details open={open}>
              <summary>{details.length - SHOWN} more</summary>
              <ul className="detail">
                {details.slice(SHOWN).map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
