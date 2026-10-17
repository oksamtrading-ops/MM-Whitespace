import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import { periodAdmissibility } from "../../../../lib/db/commit.ts";
import { readParse, suggestLabel, type ParseFinding } from "../../../../lib/ingest/quarantine.ts";
import {
  anyRegion, baseLeftovers, deloitteMarketFor, isTsxPayload, loadTsxPlan, type TsxPlan,
} from "../../../../lib/ingest/tsx.ts";
import { formatMoney } from "../../../../lib/format/fields.ts";
import Facts from "../../../_ui/Facts.tsx";
import Refusal from "../../../_ui/Refusal.tsx";
import Icon from "../../../_ui/Icon.tsx";
import Page from "../../../_ui/Page.tsx";
import Section from "../../../_ui/Section.tsx";
import { fmtDate, periodName } from "../../../_ui/format.ts";
import CommitForm from "./CommitForm.tsx";
import Callout from "../../../_ui/Callout.tsx";

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
               body="A parsed file is held for one hour and then deleted, and a committed one is deleted straight away. Upload it again to see the report."
               action={{ href: "/upload", label: "Upload it again" }} />
    );
  }

  const { report } = parse.payload;
  const asOf = parse.payload.period;
  const companies = parse.payload.companies.length;
  const totals = Object.entries(report.totals ?? {});
  const failing = totals.filter(([, [actual, expected]]) => actual !== expected);

  // TSX's list is not a period by itself: it is planned against the last
  // published period, which it rolls forward.
  const plan = isTsxPayload(parse.payload) ? await loadTsxPlan(ctx.db, parse.payload) : null;
  const warnings = [...report.warnings, ...(plan ? await baseLeftovers(ctx.db, plan.base) : [])];
  const file = plan ? "list" : "workbook";

  const previous = await ctx.db.get("select label from periods order by market_cap_as_of desc limit 1") as { label: string } | undefined;

  // What the commit will refuse, said here rather than discovered by pressing
  // the button. A period with no date cannot be committed at all.
  const blocked = !asOf
    ? "The parser could not resolve a market-cap date, so there is no period to commit."
    : report.blocking.length > 0
      ? `${report.blocking.length} blocking finding${report.blocking.length === 1 ? "" : "s"} must be resolved in the ${file} first.`
      : plan?.blocking[0] ?? await periodAdmissibility(ctx.db, asOf);

  return (
    <Page title="Validation report" back={{ href: "/upload", label: "Upload" }}>
    <div className="reading">
      <Facts className="rise" items={plan
        ? [
            { label: "TSX list", value: parse.filename },
            { label: "Market cap as of", value: asOf ? fmtDate(asOf) : "unresolved" },
            { label: "Issuers on the list", value: companies, figure: true },
            { label: "In the period", value: plan.population.length, figure: true },
            { label: "Rolls forward", value: plan.base ? `${periodName(plan.base.label).name}, revision ${plan.base.revision}` : "nothing published" },
            { label: "Source SHA-256", value: <code>{parse.sha256.slice(0, 12)}</code> },
          ]
        : [
            { label: "Workbook", value: parse.filename },
            { label: "Market cap as of", value: asOf ? fmtDate(asOf) : "unresolved" },
            { label: "Companies", value: companies, figure: true },
            { label: "Source SHA-256", value: <code>{parse.sha256.slice(0, 12)}</code> },
          ]} />

      {blocked
        ? <Callout tone="danger" live title="Cannot be committed" className="rise">{blocked}</Callout>
        : <Callout tone="ok" live title="Ready to commit" className="rise">
            Nothing is blocking.{" "}
            {warnings.length > 0
              ? `Read the ${warnings.length} warning${warnings.length === 1 ? "" : "s"} below and acknowledge ${warnings.length === 1 ? "it" : "them"}.`
              : "There are no warnings."}
          </Callout>}

      {plan && <NextPeriod plan={plan} />}

      <Section id="blocking" title="Blocking" index={plan ? 2 : 1}
               caption={report.blocking.length === 0
                 ? `None. Nothing in this ${file} refuses the commit.`
                 : `These stop the commit. They are problems in the ${file}, not in the reading of it.`}>
        {report.blocking.length > 0 && <Findings findings={report.blocking} tone="alert" open />}
      </Section>

      <Section id="warnings" title="Warnings" index={plan ? 3 : 2}
               caption={warnings.length === 0
                 ? "None. There is nothing to acknowledge."
                 : "These do not stop the commit, and you acknowledge them before it happens."}>
        {warnings.length > 0 && <Findings findings={warnings} tone="warn" />}
      </Section>

      <Section id="proofs" title="Proof totals" index={plan ? 4 : 3}
               caption={`Each total is recomputed from the rows and checked against what the ${file} says. A total that does not tie means the two disagree.`}>
        {totals.length === 0
          ? <p className="empty">The parser produced no proof totals.</p>
          : (
            <ul className="gatelist">
              {totals.map(([label, [actual, expected]]) => {
                const ties = actual === expected;
                return (
                  <li key={label} className={`gateline ${ties ? "ok" : "no"}`}>
                    <span className="mark"><Icon name={ties ? "circle-check" : "octagon-alert"} size={16} /></span>
                    <span className="what">{label}</span>
                    <span className="fig-sm">{ties ? figure(actual) : `${figure(actual)} vs ${figure(expected)}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        {failing.length > 0 && (
          <p className="note">
            <b>{failing.length} total{failing.length === 1 ? " does" : "s do"} not tie.</b>{" "}
            The {file} disagrees with itself here; committing records what the rows say.
          </p>
        )}
      </Section>

      <Section id="info" title="Informational" index={plan ? 5 : 4}
               caption={report.info.length === 0
                 ? "Nothing to note."
                 : "What was read, what was skipped, and why."}>
        {report.info.length > 0 && <Findings findings={report.info} tone="quiet" />}
      </Section>

      <Section id="commit" title="Commit" index={plan ? 6 : 5}>
        <CommitForm parseId={parse.id}
                    suggestedLabel={asOf ? await suggestLabel(previous?.label ?? null, asOf) : ""}
                    warnings={warnings.length}
                    source={file}
                    blocked={blocked} />
      </Section>
    </div>
    </Page>
  );
}

const SHOWN = 6;

/** A proof total, grouped: TSX's lists total C$1,269,443,035,841, unreadable as one run of digits. */
const figure = (n: number) => (Number.isInteger(n) ? new Intl.NumberFormat("en-CA").format(n) : String(n));

const cad = (n: number | null) => (n === null ? "no market cap" : formatMoney(n, "CAD", { compact: true }));
const who = (name: string, ticker: string | null, exchange: string | null) =>
  `${name} (${[ticker, exchange].filter(Boolean).join(", ")})`;

/**
 * What the commit will make of the list: the population at the threshold, and
 * what moved against the period it rolls forward from. Each line is one
 * company, grouped by what happened to it, so a reviewer reads the quarter's
 * changes before any of them is written.
 */
function NextPeriod({ plan }: { plan: TsxPlan }) {
  const t = plan.threshold;
  const line = `${t.operator === "gt" ? "above" : "at or above"} ${formatMoney(t.amount, t.currency, { compact: true })}`;
  const moved = (m: "exchange" | "ticker" | "name") => plan.continuing.filter((p) => p.moves.includes(m));
  const groups: Array<{ label: string; lines: string[] }> = [
    { label: "New to the population",
      lines: plan.entrants.map((p) => `${who(p.issuer.name, p.issuer.ticker, p.issuer.exchange)} — ${cad(p.issuer.market_cap)}` +
        (p.companyId ? ", seen in an earlier period" : "")) },
    { label: "Left: now under the line",
      lines: plan.dropOuts.filter((d) => d.reason === "below_threshold")
        .map((d) => `${who(d.name, d.ticker, d.exchange)} — ${cad(d.now?.marketCap ?? null)}`) },
    { label: "Left: not on TSX's list (delisted, acquired, moved, or no longer classed as mining)",
      lines: plan.dropOuts.filter((d) => d.reason === "not_listed")
        .map((d) => `${who(d.name, d.ticker, d.exchange)}, ${cad(d.marketCap)} last period`) },
    { label: "Moved exchange",
      lines: moved("exchange").map((p) => `${p.issuer.name}: ${p.prior?.exchange} to ${p.issuer.exchange}`) },
    { label: "New ticker",
      lines: moved("ticker").map((p) => `${p.issuer.name}: ${p.prior?.ticker} to ${p.issuer.ticker}, matched by name`) },
    { label: "New name",
      lines: moved("name").map((p) => `${p.prior?.name} is now ${p.issuer.name} (${p.issuer.ticker})`) },
    { label: "Near the line",
      lines: plan.near.map((n) => `${who(n.name, n.ticker, n.exchange)} — ${cad(n.marketCap)}, ${n.inPeriod ? "in" : "out of"} the period`) },
    { label: "No region on TSX's list: last period's regions kept",
      lines: plan.continuing.filter((p) => !anyRegion(p.issuer.regions) && anyRegion(p.prior?.regions))
        .map((p) => who(p.issuer.name, p.issuer.ticker, p.issuer.exchange)) },
    { label: "No Deloitte market for the head office yet",
      lines: plan.entrants.filter((p) => deloitteMarketFor(p.issuer.head_office_region).unmapped)
        .map((p) => `${who(p.issuer.name, p.issuer.ticker, p.issuer.exchange)} — ${p.issuer.head_office_region}`) },
  ];

  return (
    <Section id="next" title="The next period" index={1}
             caption={plan.base
               ? `Companies ${line} on ${plan.asOf ? fmtDate(plan.asOf) : "the list's date"}. TSX's list gives each one its name, ticker, ` +
                 "exchange, market cap, commodities, head office and property regions. Everything else (stages, auditor, fees, " +
                 `website and research) is carried from ${periodName(plan.base.label).name} revision ${plan.base.revision}, marked with its age, ` +
                 "and a value settled in review there is kept over the list's. Tiers are recomputed."
               : "Nothing has been published to roll forward from."}>
      <Facts items={[
        { label: "Continuing", value: plan.continuing.length, figure: true },
        { label: "New", value: plan.entrants.length, figure: true },
        { label: "Left", value: plan.dropOuts.length, figure: true },
        { label: "Near the line", value: plan.near.length, figure: true },
      ]} />
      <PlanGroups groups={groups.filter((g) => g.lines.length > 0)} />
    </Section>
  );
}

function PlanGroups({ groups }: { groups: Array<{ label: string; lines: string[] }> }) {
  return (
    <ul className="findings quiet">
      {groups.map((g) => (
        <li key={g.label}>
          <p className="head">
            <b>{g.label}</b>
            <span className="fig-sm">{g.lines.length}</span>
          </p>
          <ul className="detail">
            {g.lines.slice(0, SHOWN).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
          {g.lines.length > SHOWN && (
            <details>
              <summary>{g.lines.length - SHOWN} more</summary>
              <ul className="detail">
                {g.lines.slice(SHOWN).map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

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
