"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { MarketRow } from "../../../lib/publish/crosstabs.ts";
import {
  DELOITTE, delta, fees, firmLabel, fmtCap, league, MATRIX_FIRM_LABEL, MATRIX_FIRMS, matrix, moves, pct,
  plural, propertyCounts, signals, UNNAMED, yearEnds,
  type Atlas, type AtlasCompany, type Lens,
} from "../../../lib/publish/lens.ts";
import Composition, { type Part } from "../../_ui/Composition.tsx";
import DotPlot from "../../_ui/DotPlot.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Callout from "../../_ui/Callout.tsx";
import Icon from "../../_ui/Icon.tsx";
import { periodName } from "../../_ui/format.ts";
import { andList, dayLabel, groupOf, leaders, nameOf, proofOf, rankOf, stepOf, type MapMode } from "./words.ts";
import type { Office } from "./offices.ts";

/**
 * The memo: the numbered points beside the globe, each a sentence with its
 * count and what it is a count of, the chart that proves it, and the way to
 * the companies behind it. Every point is recomputed from the companies the
 * filters leave, so the globe and every number here describe the same ones.
 */

export type CoverageRow = { chart: string; label: string; resolved: number; population: number; floorPct: number | null };
export type Chooser = (patch: Partial<Lens>, opts?: { mode?: MapMode; fly?: string }) => void;

const FOOTPRINT: Array<{ key: string; label: string; slot: Part["slot"] }> = [
  { key: "canada_only", label: "Canada only", slot: 1 },
  { key: "canada_and_abroad", label: "Canada and abroad", slot: 2 },
  { key: "abroad", label: "Abroad only", slot: 3 },
  { key: "none", label: "No properties", slot: "quiet" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const company = (c: Pick<AtlasCompany, "id">) => `/companies/${c.id}`;

/**
 * A numbered point. `working` names the published fields its figures are
 * counted from, shown beside the heading under "Show working" (doc 09: every
 * chart names its query), so an analyst can check a figure against the same
 * values in Companies or the period workbook.
 */
function Point({ n, id, title, working, lead, children }: {
  n: number; id: string; title: string; working: string; lead: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="pt" id={id} aria-labelledby={`${id}-h`}>
      <header>
        <span className="pt-n" aria-hidden="true">{String(n).padStart(2, "0")}</span>
        <h2 id={`${id}-h`}>{title}</h2>
        <span className="key"><span className="sr-only">Counted from </span>{working}</span>
      </header>
      <p className="pt-lead">{lead}</p>
      {children}
    </section>
  );
}

type Row = { key: string; label: string; sub?: string; n: number; ours: number; on?: boolean; quiet?: boolean; note?: string };

/** Ranked rows, each a button: a bar whose green part is Deloitte's, the count, and Deloitte's share of it in words. */
function Rank({ rows, max, onPick, firm = false }: { rows: Row[]; max: number; onPick: (key: string) => void; firm?: boolean }) {
  return (
    <ol className="rank">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" className={`rank-row${r.on ? " on" : ""}${r.quiet ? " quiet" : ""}`}
                  aria-pressed={Boolean(r.on)} onClick={() => onPick(r.key)}>
            <span className="lab">{r.label}{r.sub && <span className="aux">{r.sub}</span>}</span>
            <span className="track" aria-hidden="true">
              {r.ours > 0 && <span className="ours" style={{ width: `${(100 * r.ours) / max}%` }} />}
              <span className="rest" style={{ width: `${(100 * (r.n - r.ours)) / max}%` }} />
            </span>
            <span className="fig">{r.n}</span>
            <span className="dl">{r.note ?? (firm ? "" : r.ours ? `Deloitte ${r.ours}` : "Deloitte 0")}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Names({ companies, max = 40 }: { companies: AtlasCompany[]; max?: number }) {
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className="names">
      {sorted.slice(0, max).map((c) => (
        <li key={c.id}><a href={company(c)}>{c.name}</a>{c.ticker && <span className="tk">{c.ticker}</span>}</li>
      ))}
      {sorted.length > max && <li className="more">and {sorted.length - max} more, in Companies</li>}
    </ul>
  );
}

export default function Memo({ atlas, shown, lens, mode, pick, offices, markets, coverage, frozen, publisher, periodTitle, roster }: {
  atlas: Atlas;
  shown: AtlasCompany[];
  lens: Lens;
  mode: MapMode;
  pick: Chooser;
  offices: Office[];
  markets: { rows: MarketRow[]; population: number } | null;
  coverage: CoverageRow[];
  frozen: { population: number; deloitte: number };
  publisher: string | null;
  periodTitle: string;
  roster: string;
}) {
  const { threshold, currency, asOf } = atlas.period;
  const money = (n: number) => fmtCap(n, currency);
  const N = shown.length;
  let n = 0;
  const next = () => ++n;

  /* 01 ground */
  const foot = FOOTPRINT.map((f) => ({ ...f, n: shown.filter((c) => c.footprint === f.key).length }));
  const unrecorded = N - foot.reduce((a, f) => a + f.n, 0);
  const footParts: Part[] = [...foot.map((f) => ({ label: f.label, n: f.n, slot: f.slot })),
    ...(unrecorded ? [{ label: "Not recorded", n: unrecorded, slot: "quiet" as const }] : [])];
  const inCanada = foot[0].n + foot[1].n;
  const abroad = foot[1].n + foot[2].n;
  const ground = propertyCounts(shown);
  const unknownAt = new Map<string, number>();
  for (const c of shown) if (c.auditor === null) for (const p of c.places) unknownAt.set(p, (unknownAt.get(p) ?? 0) + 1);
  const unplaced = new Map<string, number>();
  for (const c of shown) for (const u of c.unplaced) unplaced.set(u, (unplaced.get(u) ?? 0) + 1);

  /* 02 firms: ranked among the firms research names; the unnamed pool is not a firm. */
  const firms = league(shown);
  const ranked = firms.filter((r) => r.firm !== "unknown" && r.firm !== UNNAMED);
  const top = leaders(ranked);
  const ours = firms.find((r) => r.ours);
  const capAll = shown.reduce((a, c) => a + (c.cap ?? 0), 0);
  const [allFirms, setAllFirms] = useState(false);

  /* 03 offices */
  const officeTotal = offices.reduce((a, o) => a + o.n, 0);
  const noPlace = shown.filter((c) => !c.hq).length;
  const topCity = offices.find((o) => !o.dashed);

  /* 04 size */
  const mx = matrix(shown, threshold, currency);

  /* 05 moved */
  const m = moves(shown, asOf);
  const dm = m.byFirm.find((f) => f.firm === DELOITTE) ?? { won: 0, lost: 0 };
  const moveMax = Math.max(1, ...m.byFirm.map((f) => Math.max(f.won, f.lost)));

  /* 06 since */
  const d = atlas.prior ? delta({ companies: shown, prior: atlas.prior, firmClasses: atlas.firmClasses }) : null;
  const leavers = lens.firm === "all" && !lens.auditor && !lens.tier && !lens.commodity && !lens.place && !lens.hq && !lens.band
    ? atlas.leavers : null;
  const wider = atlas.prior && atlas.prior.threshold > threshold ? atlas.prior.threshold : null;
  const widened = d && wider ? d.entrants.filter((c) => c.cap !== null && c.cap < wider) : [];
  const unpriced = d && wider ? d.entrants.filter((c) => c.cap === null) : [];
  const otherwise = d ? d.entrants.filter((c) => !widened.includes(c) && !unpriced.includes(c)) : [];

  /* 07 facts */
  const facts = signals(shown, asOf, currency);

  /* 08 year-ends */
  const ye = yearEnds(shown);
  const yeKnown = N - ye.unknown;
  const peak = ye.months.indexOf(Math.max(...ye.months));

  /* 09 fees */
  const fe = fees(shown);
  const currencies = [...new Set(fe.rows.flatMap((r) => r.byCurrency.map((b) => b.currency)))].sort((a, b) => (a === currency ? -1 : b === currency ? 1 : a.localeCompare(b)));

  /* 10 basis */
  const recomputed = { population: atlas.companies.length, deloitte: atlas.companies.filter((c) => c.auditor === DELOITTE).length };
  const selfCheck = recomputed.population === frozen.population && recomputed.deloitte === frozen.deloitte;

  if (N === 0) {
    return (
      <div className="memo">
        <div className="memo-empty">
          <p className="pt-lead">No company in this period matches every filter.</p>
          <button type="button" className="btn secondary sm" onClick={() => pick({ firm: "all", tier: null, commodity: null, place: null, hq: null, auditor: null, band: null })}>
            Clear the filters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="memo">
      <Point n={next()} id="ground" title="Where they dig" working="footprint · property_regions"
             lead={<><b className="fig">{inCanada}</b> hold ground in Canada and <b className="fig">{abroad}</b> abroad; {foot[1].n} hold both{foot[3].n ? <> and {foot[3].n} hold none</> : null}.</>}>
        <Composition parts={footParts} proof={proofOf(footParts.map((p) => p.n), N)} />
        <h3 className="pt-sub">Places by companies with ground there</h3>
        <Rank max={Math.max(1, ground[0]?.n ?? 1)}
              rows={ground.slice(0, 10).map((p) => ({ key: p.key, label: nameOf(p.key), sub: groupOf(p.key), n: p.n, ours: p.deloitte, on: lens.place === p.key }))}
              onPick={(key) => pick({ place: lens.place === key ? null : key }, { mode: "ground", fly: key })} />
        <p className="note">
          A company counts once in every place it holds ground, so the places do not add up; the bar above does.
          The globe shades a place by its count, not its size: a large country with three companies looks bigger than it counts.
        </p>
        <details className="twin" id="places-twin">
          <summary>All {plural(ground.length, "place")}, as a table</summary>
          {/* Five columns do not fit a phone: the table scrolls in its place, not the page. */}
          <div className="mx-wrap">
            <table className="tbl">
              <caption className="sr-only">Companies with ground in each place</caption>
              <thead><tr><th scope="col">Place</th><th scope="col" className="n">Companies</th><th scope="col" className="n">Deloitte</th>
                <th scope="col" className="n">Another firm</th><th scope="col" className="n">Not yet known</th></tr></thead>
              <tbody>
                {ground.map((p) => {
                  const unknown = unknownAt.get(p.key) ?? 0;
                  return (
                    <tr key={p.key} className={lens.place === p.key ? "on" : undefined}>
                      <th scope="row">
                        <button type="button" className="link" onClick={() => pick({ place: lens.place === p.key ? null : p.key }, { mode: "ground", fly: p.key })}>
                          {nameOf(p.key)}
                        </button>
                        {groupOf(p.key) && <span className="aux">{groupOf(p.key)}</span>}
                      </th>
                      <td className="n">{p.n}</td><td className="n">{p.deloitte}</td>
                      <td className="n">{p.n - p.deloitte - unknown}</td><td className="n">{unknown}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {unplaced.size > 0 && (
            <p className="note">
              Ground the globe has no shape for:{" "}
              {[...unplaced].map(([u, k], i) => <span key={u}>{i ? "; " : ""}{u} ({k})</span>)}.
            </p>
          )}
        </details>
      </Point>

      <Point n={next()} id="firms" title="Who audits them" working="auditor · market_cap_cad"
             lead={top.length
               ? <>{andList(top.map((r) => r.label))} {top.length === 1 ? "audits" : "audit"} the most: <b className="fig">{top[0].n}</b>{top.length > 1 ? " each" : ""}.{" "}
                   {ours
                     ? <>Deloitte audits <b className="fig">{ours.n}</b>, {rankOf(ranked, ours, (r) => r.n)} by companies and {rankOf(ranked, ours, (r) => r.cap)} by market value.</>
                     : <>Deloitte audits none of them.</>}</>
               : firms.some((r) => r.firm === UNNAMED)
                 ? <>No auditor of these companies is a firm research has named yet.</>
                 : <>No auditor is known for these companies yet.</>}>
        <Rank firm max={Math.max(1, firms[0]?.n ?? 1)}
              rows={(allFirms ? firms : firms.slice(0, 9)).map((r) => ({
                key: r.firm, label: r.label, n: r.n, ours: r.ours ? r.n : 0, quiet: r.firm === "unknown",
                on: lens.auditor === r.firm,
                note: N < 10
                  ? shown.filter((c) => (c.auditor ?? "unknown") === r.firm).map((c) => c.name).join(", ")
                  : r.firm === "unknown" ? "auditor not yet found" : `${pct(r.cap, capAll)} of the value`,
              }))}
              onPick={(key) => pick({ auditor: lens.auditor === key ? null : key, firm: "all" })} />
        {firms.length > 9 && (
          <button type="button" className="btn quiet sm" aria-expanded={allFirms} onClick={() => setAllFirms((v) => !v)}>
            <Icon name={allFirms ? "chevron-up" : "chevron-down"} size={13} />
            {allFirms ? "Show the first nine" : `Show all ${firms.length} firms`}
          </button>
        )}
        <Composition parts={firms.map((r) => ({ label: r.label, n: r.n, slot: r.ours ? 1 : "quiet" }))}
                     proof={proofOf(firms.map((r) => r.n), N)} variant="emphasis" />
        <p className="note">
          The value share is each firm&rsquo;s clients&rsquo; combined market value, as published{shown.some((c) => c.cap === null) ? "; companies with none are counted but add nothing" : ""}.
          {firms.some((r) => r.firm === UNNAMED) && <> &ldquo;Another firm, not named&rdquo; is an auditor the filing names and research has not matched to a firm.</>}
        </p>
      </Point>

      <Point n={next()} id="offices" title="Where they are run from" working="head_office_location · head_office_region"
             lead={topCity
               ? <>{topCity.label} is home to <b className="fig">{plural(topCity.n, "head office")}</b>; Deloitte audits <b className="fig">{topCity.ours}</b> of {topCity.n === 1 ? "it" : "them"}.</>
               : <>No head office in view could be placed in a city.</>}>
        <Rank max={Math.max(1, offices[0]?.n ?? 1)}
              rows={offices.slice(0, 10).map((o) => ({
                key: o.key, label: o.label, sub: o.dashed ? "no city the globe can place" : nameOf(o.place),
                n: o.n, ours: o.ours, on: lens.hq === o.place, quiet: o.dashed,
              }))}
              onPick={(key) => {
                const place = offices.find((o) => o.key === key)!.place;
                pick({ hq: lens.hq === place ? null : place }, { mode: "hq", fly: place });
              }} />
        <p className="note">
          {plural(officeTotal, "head office is", "head offices are")} placed: in their city where the globe knows it, otherwise at the centre of their region, drawn dashed.
          {noPlace > 0 && <> {plural(noPlace, "company has", "companies have")} no head office the globe can place.</>}
          {" "}Choosing one narrows the page to its region.
        </p>
        {markets && (
          <>
            <h3 className="pt-sub">By Deloitte market <span className="key">dtt_market · auditor</span></h3>
            <DotPlot rows={markets.rows} />
            <p className="note">
              All {markets.population} companies, whatever the filters: which market a company belongs to is
              kept to these totals, so this view does not narrow.
            </p>
          </>
        )}
      </Point>

      <Point n={next()} id="size" title="By size" working="market_cap_cad × auditor"
             lead={<><b className="fig">{mx.rows[0].n}</b> {mx.rows[0].n === 1 ? "is" : "are"} worth {money(10e9)} or more; Deloitte audits <b className="fig">{mx.rows[0].cells.Deloitte}</b> of them.</>}>
        <div className="mx-wrap">
          <table className="mx">
            <caption className="sr-only">Companies by market value and auditor</caption>
            <thead>
              <tr>
                <th scope="col">Market value</th>
                {MATRIX_FIRMS.map((f) => <th key={f} scope="col" className={f === "Deloitte" ? "ours" : undefined}>{MATRIX_FIRM_LABEL[f]}</th>)}
                <th scope="col" className="tot">All</th>
              </tr>
            </thead>
            <tbody>
              {mx.rows.map((r) => (
                <tr key={r.band} className={lens.band === r.band ? "on" : undefined}>
                  <th scope="row">
                    {/* "C$2B" over "to C$10B": two short lines keep the label
                        column narrow enough for the eight beside it. */}
                    <button type="button" className="link" aria-pressed={lens.band === r.band}
                            onClick={() => pick({ band: lens.band === r.band ? null : r.band })}>
                      <b>{r.label.split(" ")[0]}</b>{" "}<span className="aux">{r.label.split(" ").slice(1).join(" ")}</span>
                    </button>
                  </th>
                  {MATRIX_FIRMS.map((f) => (
                    <td key={f} className={`c q${stepOf(r.cells[f])}${f === "Deloitte" ? " ours" : ""}`}>
                      {r.cells[f] || <><span aria-hidden="true">·</span><span className="sr-only">none</span></>}
                    </td>
                  ))}
                  <td className="tot">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Composition parts={[...mx.rows.map((r) => ({ label: r.label, n: r.n, slot: 1 as const })),
                             ...(mx.unsized ? [{ label: "No market value", n: mx.unsized, slot: "quiet" as const }] : [])]}
                     proof={proofOf([...mx.rows.map((r) => r.n), mx.unsized], N)} variant="mono" />
        <p className="note">
          The Deloitte column is green and the rest grey: one colour for Deloitte&rsquo;s book, and a shade for how many.
          {mx.unsized > 0 && <> {plural(mx.unsized, "company has", "companies have")} no published market value and {mx.unsized === 1 ? "sits" : "sit"} in no band.</>}
        </p>
      </Point>

      <Point n={next()} id="moved" title="What moved" working="auditor_change · auditor"
             lead={<>At least <b className="fig">{m.moves.length}</b> changed auditor in the two years to {dayLabel(asOf)}, among the {m.looked} whose history research found.
               Deloitte was appointed at <b className="fig">{dm.won}</b> and replaced at <b className="fig">{dm.lost}</b>.</>}>
        {m.byFirm.length > 0 && (
          <div className="fly" role="table" aria-label="Appointments and replacements by firm">
            <div className="fly-h" role="row">
              <span role="columnheader" className="l">Replaced</span><span role="columnheader">Firm</span><span role="columnheader" className="r">Appointed</span>
            </div>
            {m.byFirm.slice(0, 8).map((f) => (
              <div key={f.firm} role="row" className={`fly-row${f.firm === DELOITTE ? " ours" : ""}`}>
                <span role="cell" className="l">
                  <span className="fig">{f.lost || ""}</span>
                  <span className="bar lost" style={{ "--of": f.lost / moveMax } as CSSProperties} aria-hidden="true" />
                </span>
                <span role="cell" className="firm">{firmLabel(f.firm)}</span>
                <span role="cell" className="r">
                  <span className="bar won" style={{ "--of": f.won / moveMax } as CSSProperties} aria-hidden="true" />
                  <span className="fig">{f.won || ""}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {m.moves.length > 0 && (
          <div className="mx-wrap">
            <table className="tbl ledger">
              <caption className="sr-only">Changes of auditor, newest first</caption>
              <thead><tr><th scope="col">Company, dated</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
              <tbody>
                {m.moves.slice(0, 10).map((x) => (
                  <tr key={x.company.id}>
                    <th scope="row"><a href={company(x.company)}>{x.company.name}</a><span className="aux when">{dayLabel(x.date)}</span></th>
                    <td>{x.from ? firmLabel(x.from) : "Not stated"}</td>
                    <td className={x.to === DELOITTE ? "ours" : undefined}>{firmLabel(x.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          A date given only as a year or a month counts only when all of it falls in the two years, so no change is claimed that may fall outside them.
          {m.straddling > 0 && <> {plural(m.straddling, "change is", "changes are")} dated that loosely across an edge of the window and left out.</>}
          {m.undated > 0 && <> {plural(m.undated, "change carries", "changes carry")} no date and {m.undated === 1 ? "is" : "are"} left out.</>}
          {m.moves.length > 10 && <> The ten newest are listed; all {m.moves.length} open in each company&rsquo;s profile.</>}
        </p>
      </Point>

      {d && atlas.prior && (
        <Point n={next()} id="since" title={`Since ${periodName(atlas.prior.label).name}`}
               working={`revision ${atlas.prior.revision} of ${periodName(atlas.prior.label).name} · tier · auditor · market_cap_cad`}
               lead={<><b className="fig">{d.entrants.length}</b> {d.entrants.length === 1 ? "company is" : "companies are"} new to the population
                 {leavers ? <> and <b className="fig">{leavers.length}</b> left it</> : null}.
                 {d.paired > 0 && <>
                   {" "}{d.paired === d.continuing ? <>The {d.continuing} in both are</> : <>Of the {d.continuing} in both, the {d.paired} with a market value both times are</>}
                   {" "}worth {pct(Math.abs(d.capNow - d.capThen), d.capThen || 1)} {d.capNow >= d.capThen ? "more" : "less"} than then.
                 </>}</>}>
          <dl className="kv">
            {wider && <><dt>Came in with the wider line</dt><dd><span className="fig">{widened.length}</span> worth {money(threshold)} to {money(wider)}: below last period&rsquo;s line, above this one&rsquo;s</dd></>}
            <dt>New listing or market move</dt>
            <dd><span className="fig">{otherwise.length}</span>{wider ? ` worth ${money(wider)} or more` : ""}; the snapshot does not say which</dd>
            {unpriced.length > 0 && <><dt>No market value published</dt><dd><span className="fig">{unpriced.length}</span></dd></>}
            <dt>Moved up a tier</dt><dd><span className="fig">{d.tierUp}</span></dd>
            <dt>Moved down a tier</dt><dd><span className="fig">{d.tierDown}</span></dd>
            <dt>Changed auditor between the two</dt><dd><span className="fig">{d.switched.length}</span></dd>
          </dl>
          {d.switched.length > 0 && (
            <div className="mx-wrap">
              <table className="tbl ledger">
                <caption className="sr-only">Auditor in {periodName(atlas.prior.label).name} and now</caption>
                <thead><tr><th scope="col">Company</th><th scope="col">{periodName(atlas.prior.label).name}</th><th scope="col">{periodTitle}</th></tr></thead>
                <tbody>
                  {d.switched.map((x) => (
                    <tr key={x.company.id}>
                      <th scope="row"><a href={company(x.company)}>{x.company.name}</a></th>
                      <td className={x.from === DELOITTE ? "ours" : undefined}>{firmLabel(x.from)}</td>
                      <td className={x.to === DELOITTE ? "ours" : undefined}>{firmLabel(x.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="twin">
            <summary>The {plural(d.entrants.length, "company", "companies")} new to the population</summary>
            <Names companies={d.entrants} />
          </details>
          {leavers && leavers.length > 0 && (
            <details className="twin">
              <summary>The {plural(leavers.length, "company", "companies")} no longer in it</summary>
              <ul className="names">
                {[...leavers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <li key={c.id}><a href={`/companies/${c.id}`}>{c.name}</a>{c.ticker && <span className="tk">{c.ticker}</span>}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="note">
            Tier moves count companies classified in both periods; a company classified for the first time is research completing, not a move.
            {d.unclear > 0 && <> {plural(d.unclear, "company", "companies")} went between &ldquo;another firm, not named&rdquo; and a firm outside the Big 4, which may be the same firm, so {d.unclear === 1 ? "it is" : "they are"} not counted as a change.</>}
          </p>
        </Point>
      )}

      <Point n={next()} id="facts" title="Facts worth knowing"
             working="market_cap_cad · tier · auditor · auditor_since · sec_registrant · auditor_change"
             lead="Published facts, each a count out of the companies it could be checked for. None is a score, and none is combined with another.">
        <div className="fact-grid">
          {facts.map((f) => (
            <article key={f.id} className="fact">
              <p className="fact-n"><b className="fig">{f.companies.length}</b><span> of {f.of}</span></p>
              <h3>{f.title}</h3>
              <p className="rule">{f.rule}</p>
              {f.companies.length > 0 && (
                <details>
                  <summary>Name the {plural(f.companies.length, "company", "companies")}</summary>
                  <Names companies={f.companies} />
                </details>
              )}
            </article>
          ))}
        </div>
      </Point>

      <Point n={next()} id="year-ends" title="When their years end" working="fiscal_year_end"
             lead={yeKnown
               ? <><b className="fig">{pct(ye.months[peak], yeKnown)}</b> of the year-ends on record fall in {MONTHS[peak]}: {ye.months[peak]} of the {yeKnown} known.</>
               : <>No fiscal year-end is on record for these companies yet.</>}>
        <ol className="months" aria-label="Fiscal year-ends by month">
          {ye.months.map((k, i) => (
            <li key={i} className={`q${stepOf(k)}`}>
              <span className="m">{MONTHS[i].slice(0, 3)}</span>
              <span className="fig">{k}</span>
            </li>
          ))}
        </ol>
        <p className="note">{ye.unknown > 0 ? `${plural(ye.unknown, "company has", "companies have")} no year-end on record. ` : ""}A year-end sets when its audit falls due.</p>
      </Point>

      <Point n={next()} id="fees" title="Audit fees on record" working="audit_fee · auditor"
             lead={<>Audit fees are on record for <b className="fig">{fe.known}</b> of {N}. Each currency is added up on its own; none is converted.</>}>
        {fe.rows.length > 0 && currencies.length > 0 && (
          <div className="mx-wrap">
            <table className="tbl fees">
              <caption className="sr-only">Audit fees on record by firm, at least, in each currency</caption>
              <thead>
                <tr><th scope="col">Firm</th>{currencies.map((cur) => <th key={cur} scope="col" className="n">At least, {cur}</th>)}</tr>
              </thead>
              <tbody>
                {fe.rows.slice(0, 10).map((r) => (
                  <tr key={r.firm} className={r.firm === DELOITTE ? "ours" : undefined}>
                    <th scope="row">{r.firm === "unknown" ? "Not yet known" : firmLabel(r.firm)}</th>
                    {currencies.map((cur) => {
                      const b = r.byCurrency.find((x) => x.currency === cur);
                      return <td key={cur} className="n">{b ? <>{fmtCap(b.sum, cur)}<span className="aux">{plural(b.n, "company", "companies")}</span></> : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          A sum is at least what these companies paid: fees research has not found are not in it.
          {fe.noCurrency > 0 && <> {plural(fe.noCurrency, "fee has", "fees have")} no currency and {fe.noCurrency === 1 ? "is" : "are"} counted apart.</>}
        </p>
      </Point>

      <Point n={next()} id="basis" title="Basis of preparation" working="coverage · tier_distribution · auditor_share"
             lead={<>{periodTitle}, revision {atlas.publication.revision}, published {dayLabel(atlas.publication.publishedAt.slice(0, 10))}{publisher ? ` by ${publisher}` : ""}.
               Market values as of {dayLabel(asOf)}; the population is every company worth {money(threshold)} or more.</>}>
        {atlas.publication.overrideReason && (
          <Callout tone="warn" title="Published through a blocked gate">{atlas.publication.overrideReason}</Callout>
        )}
        {atlas.publication.amendmentReason && (
          <Callout tone="info" title={`What revision ${atlas.publication.revision} changed`}>{atlas.publication.amendmentReason}</Callout>
        )}
        <div className="gauges">
          {coverage.map((c, i) => (
            <Gauge key={c.chart} label={c.label} resolved={c.resolved} population={c.population} floorPct={c.floorPct} index={i} compact />
          ))}
        </div>
        <p className={`check${selfCheck ? "" : " fail"}`}>
          <Icon name={selfCheck ? "circle-check" : "octagon-alert"} size={14} />
          {selfCheck
            ? <>Recomputed from the published companies: {recomputed.population} companies, {recomputed.deloitte} audited by Deloitte. The frozen totals agree.</>
            : <>Recomputed {recomputed.population} companies and {recomputed.deloitte} Deloitte audits, but the frozen totals say {frozen.population} and {frozen.deloitte}. Report this before relying on the page.</>}
        </p>
        <p className="note">
          Firm classes (Big 4, national, regional) are as the firm list records them; a firm it does not list counts as regional or other.
          Every figure is a count of published values. Nothing here ranks a company or says which to approach.
        </p>
        <p className="note"><a href={roster}>Open the {plural(N, "company", "companies")} in view in Companies</a>, where every value carries its source.</p>
      </Point>
    </div>
  );
}
