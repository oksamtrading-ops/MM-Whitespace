import Link from "next/link";
import type { Metadata, Route } from "next";
import { requireRole } from "../../../../lib/auth/context.ts";
import PursuitLink from "./PursuitLink.tsx";
import { Forbidden, Unauthenticated } from "../../../../lib/auth/session.ts";
import {
  readCompanyProfile, SOURCE_LABEL, unpublishedChanges, type ProfileValue,
} from "../../../../lib/profile/company.ts";
import { evidenceBand } from "../../../../lib/review/decide.ts";
import Facts from "../../../_ui/Facts.tsx";
import Refusal from "../../../_ui/Refusal.tsx";
import Section from "../../../_ui/Section.tsx";
import Callout from "../../../_ui/Callout.tsx";
import Icon from "../../../_ui/Icon.tsx";
import Page from "../../../_ui/Page.tsx";
import { fmtDate, periodName } from "../../../_ui/format.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Company" };

const UNCLASSIFIED: Record<string, string> = {
  unclassified_no_stage_evidence: "Unclassified — no stage research yet",
  unclassified_no_property_evidence: "Unclassified — no property evidence",
  unclassified_conflicting: "Unclassified — the evidence conflicts",
};

const FOOTPRINT: Record<string, string> = {
  canada_only: "Properties in Canada only",
  abroad: "Properties abroad only",
  canada_and_abroad: "Properties in Canada and abroad",
  none: "No properties — a royalty or streaming company",
};

/** Plain readings of the rule ids. An unmapped id falls back to the id itself. */
const RULE: Record<string, string> = {
  guard_no_stage_evidence: "Stage has not been researched, so no tier can be claimed",
  guard_no_property_evidence: "Producing, but no property evidence to place it",
  rule_1_production_both: "Producing, in Canada and abroad",
  rule_2_production_canada: "Producing, in Canada only",
  rule_3_production_abroad: "Producing, abroad only",
  rule_4_royalty: "Royalty or streaming",
  rule_5_development: "In development",
  rule_6_exploration: "In exploration",
  catch_all: "Nothing above matched",
};

export default async function CompanyProfile({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireRole(["viewer", "analyst", "admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="Your account does not have access to this view." />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message}
                 action={{ href: "/signin", label: "Sign in" }} />;
  }

  const { id } = await params;
  const canReview = ctx.user.role !== "viewer";
  // A pursuit is Deloitte internal, so a Viewer is not offered one and is not
  // told whether one exists (docs/design/11).
  const canPursue = canReview;
  const pursuitId = canPursue
    ? ((await ctx.db.get(
        "select id from pursuits where company_id = ? order by created_at limit 1", id) as
        { id: string } | undefined)?.id ?? null)
    : null;
  const p = await readCompanyProfile(ctx.db, id, { allowDraft: canReview });
  if (!p) {
    return <Refusal title="No such company"
                    body="That company is not in the published population for this period."
                    action={{ href: "/companies", label: "Back to companies" }} />;
  }

  // Only someone who can change a value is told it has changed; a Viewer
  // reads the published revision and nothing about what may replace it.
  const pending = canReview && p.publication ? await unpublishedChanges(ctx.db, p.companyId) : null;

  const auditor = p.values.find((v) => v.fieldKey === "auditor");
  const auditorName = auditor && auditor.value !== null ? String(auditor.value) : null;
  const isDeloitte = auditorName === "Deloitte";
  const website = p.values.find((v) => v.fieldKey === "website");
  const websiteUrl = website && typeof website.value === "string" && /^https?:\/\//.test(website.value)
    ? website.value : null;
  const fees = p.values.filter((v) => v.fieldKey.endsWith("_fee"));
  const researched = p.values.filter((v) => v.source === "ai_accepted" || v.strength !== null);

  return (
    <Page title={p.name}
          back={{ href: "/companies", label: "Companies" }}
          meta={p.ticker ? `${p.ticker}${p.exchange ? ` · ${p.exchange}` : ""}` : undefined}
          actions={canPursue ? <PursuitLink companyId={id} pursuitId={pursuitId} /> : undefined}>
    <div className="withrail">
      <div className="reading">

        {pending && (pending.fields.length > 0 || pending.tier) && (
          <Callout tone="warn" live title="Not yet published" className="rise">
            <>
              This page shows revision {pending.revision}, which is what a Viewer sees.{" "}
              {pending.tier && <>Since then its tier has moved to <strong>{tierWords(pending.tier.to)}</strong>
                {" "}(published: {tierWords(pending.tier.from)}). </>}
              {pending.fields.length > 0 && <>
                {pending.fields.length === 1 ? "One value has" : `${pending.fields.length} values have`} changed
                {" "}in review: {pending.fields.join(", ")}.{" "}
              </>}
              <Link href={"/publish" as Route} prefetch={false}>Publish revision {pending.revision + 1}</Link> to show them.
            </>
          </Callout>
        )}

        {/* The two things a partner opened this page to learn. */}
        <p className="verdict rise">
          {p.tier
            ? (p.tier.tier === null
                ? <>{UNCLASSIFIED[p.tier.status] ?? "Unclassified"}.</>
                : <><span className="fig-lg">{`Tier ${p.tier.tier}`}</span>.</>)
            : <>No tier has been computed.</>}
          {" "}
          {p.tier && <span className="quiet">{FOOTPRINT[p.tier.footprint] ?? p.tier.footprint}.</span>}
        </p>
        <p className="verdict-2 rise">
          {auditorName
            ? (isDeloitte
                ? <>Audited by <b>Deloitte</b>. Already a client.</>
                : <>Audited by <b>{auditorName}</b>. <span className="quiet">Not a Deloitte audit client — this is the whitespace.</span></>)
            : <>The auditor is <b>not yet known</b>. <span className="quiet">Nothing can be said about the relationship until it is.</span></>}
        </p>

        <Section id="why" title="Why this tier" index={1} icon="layers" lead
                 caption={p.trace
                   ? "Each rule in order. The one that fired decides, and the inputs it read are shown beside it."
                   : "The rule trace is not part of the frozen snapshot, and the rules have been re-run since this revision was published."}>
          <div className="glance">
          <div>
          {p.trace && p.trace.length > 0 ? (
            <ol className="trace">
              {p.trace.map((step) => (
                <li key={step.ord} className={step.matched ? "fired" : ""}>
                  <span className="mark"><Icon name={step.matched ? "circle-check" : "circle-dashed"} size={14} /></span>
                  {/* An unmapped rule id shows as itself once, not twice: the
                      map is a courtesy and the id is the fact. */}
                  <span className="what">
                    {RULE[step.ruleId] ?? ""}
                    <code>{step.ruleId}</code>
                  </span>
                  <span className="inputs">
                    {Object.entries(step.inputs).map(([k, v]) => (
                      <span key={k}>{k} <b>{Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v)}</b></span>
                    ))}
                  </span>
                  <span className="sr-only">{step.matched ? "This rule fired." : "Did not match."}</span>
                </li>
              ))}
            </ol>
          ) : p.trace ? <p className="empty">No rule was recorded for this company.</p> : null}
          </div>
          <Glance values={researched} />
          </div>
          {p.tier && (
            <p className="note">
              Rule set <code>{p.tier.ruleSetVersion}</code>.{" "}
              {/* Not when review has already classified it: the stage is
                  researched, and only waiting to be published. */}
              {p.tier.tier === null && canReview && !pending?.tier && (
                <Link className="btn sm secondary" href={"/review/stage_evidence_state?bucket=need_review" as Route} prefetch={false}>
                  <Icon name="pickaxe" size={13} />Research the stage
                </Link>
              )}
            </p>
          )}
        </Section>

        <Section id="fees" title="Fees" index={2} icon="banknote"
                 caption="From the company's own filings, in the currency it reports in, for the fiscal year shown.">
          {fees.length === 0 || fees.every((f) => f.value === null)
            ? <p className="empty">No fee has been recorded for this company.</p>
            : (
              <Facts items={fees.map((f) => ({ label: f.label, value: f.display, figure: true }))} />
            )}
        </Section>

        <Section id="values" title="Every value, and where it came from" index={3} icon="scroll-text"
                 caption="Nothing here is presented without its provenance. A researched value carries the evidence that produced it.">
          <table className="provenance">
            <thead>
              <tr><th scope="col">Field</th><th scope="col">Value</th>
                  <th scope="col">Source</th><th scope="col">Evidence</th></tr>
            </thead>
            <tbody>
              {p.values.map((v) => <ValueRow key={v.fieldKey} v={v} />)}
            </tbody>
          </table>
          {researched.length === 0 && (
            <p className="note">
              <b>Nothing here was researched by the model.</b> Every value came from the workbook
              or from the rules. Evidence appears once enrichment has run against this company.
            </p>
          )}
        </Section>

        <Section id="changed" title="Since last period" index={4} icon="history">
          {p.tier?.priorTier === null || p.tier?.priorTier === undefined
            ? <p className="empty">
                This is the first published period, so there is nothing to compare against.
                Next quarter this says what moved and why.
              </p>
            : <p>
                {`Tier ${p.tier.priorTier} → ${p.tier.tier ?? "Unclassified"}`}
                {p.tier.changed ? " — changed" : " — unchanged"}.
              </p>}
        </Section>
      </div>

      <aside className="rail rise" aria-label="About this company">
        <p className="k">This company</p>
        <Facts items={[
          ...(p.ticker ? [{ label: "Ticker", value: `${p.ticker}${p.exchange ? ` · ${p.exchange}` : ""}`, figure: true }] : []),
          ...p.values.filter((v) => ["market_cap_cad", "head_office_location", "dtt_market"].includes(v.fieldKey))
            .map((v) => ({ label: v.label, value: v.display, figure: v.fieldKey === "market_cap_cad" })),
          { label: "Period", value: periodName(p.period.label).name },
          { label: p.publication ? "Published" : "Status",
            value: p.publication
              ? <>Revision {p.publication.revision}<span className="sub">{fmtDate(p.publication.publishedAt)}</span></>
              : <span className="pill warn">draft</span> },
        ]} />
        {websiteUrl && (
          <p style={{ marginTop: 20 }}>
            <a className="btn sm secondary" href={websiteUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="external-link" size={13} />Company website
            </a>
          </p>
        )}
        {!p.publication && (
          <p className="meta" style={{ marginTop: 20 }}>
            This period is not published. A Viewer sees nothing here until it is.
          </p>
        )}
      </aside>
    </div>
    </Page>
  );
}

const BAND_CELLS: Record<string, number> = { low: 1, medium: 2, high: 3, "very high": 4 };

/** Evidence at a glance: one line per researched value, beside the trace. */
function Glance({ values }: { values: ProfileValue[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="k">Evidence at a glance</p>
      <ul className="ev-list">
        {values.slice(0, 8).map((v) => {
          const band = v.strength === null ? null : evidenceBand(v.strength);
          return (
            <li key={v.fieldKey}>
              <span className="f">{v.label}</span>
              {band === null
                ? <span className="meta">accepted</span>
                : <span className="ev">
                    <span aria-hidden="true" className={`strip b-${band.replace(" ", "-")}`}>
                      {[1, 2, 3, 4].map((c) => <i key={c} className={c <= (BAND_CELLS[band] ?? 0) ? "on" : ""} />)}
                    </span>
                    <span className="num">{v.strength!.toFixed(2)}</span>
                    <span className="bandword">{band}</span>
                  </span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function tierWords(t: { tier: number | null; status: string }): string {
  return t.tier === null ? (UNCLASSIFIED[t.status] ?? "Unclassified") : `Tier ${t.tier}`;
}

function ValueRow({ v }: { v: ProfileValue }) {
  const band = v.strength === null ? null : evidenceBand(v.strength);
  return (
    <tr>
      <th scope="row">{v.label}</th>
      <td className="wrap">
        {v.display}
        {v.inheritedFrom && (
          <span className="pill warn" title={`From ${v.inheritedFrom.label}`}>
            <Icon name="history" size={12} />inherited · {v.inheritedFrom.ageDays}d old
          </span>
        )}
        {v.excerpt && (
          <details className="excerpt">
            <summary>Evidence</summary>
            <blockquote>{v.excerpt}</blockquote>
            {v.sources.length > 0 && (
              <p className="meta">
                {v.sources.map((s, i) => (
                  <a key={i} href={s} target="_blank" rel="noopener noreferrer">
                    source {i + 1}<Icon name="external-link" size={12} />
                  </a>
                ))}
              </p>
            )}
          </details>
        )}
      </td>
      <td className="meta wrap">{SOURCE_LABEL[v.source] ?? v.source}</td>
      <td>
        {band === null
          ? <span className="meta">{v.evidenceState === "asserted" ? "—" : v.evidenceState.replace(/_/g, " ")}</span>
          : <span className="ev">
              <span className="num">{v.strength!.toFixed(2)}</span>
              <span className="bandword">{band}</span>
            </span>}
      </td>
    </tr>
  );
}
