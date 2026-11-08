import type { ReactNode } from "react";
import { CANADA_LABELS, CANADA_PATHS, CANADA_VIEWBOX } from "../../../lib/publish/canada.ts";
import {
  companiesHref, TIER_KEYS, type FirmGrid, type FirmRow, type HqRow, type Place, type TierCounts, type TierKey,
} from "../../../lib/publish/board.ts";
import { pct } from "../../../lib/publish/lens.ts";
import AiNotice from "../../_ui/AiNotice.tsx";
import Hover from "./Hover.tsx";
import { STEP_LABELS, stepOf, TIER_RULE } from "./words.ts";

/**
 * The dashboard's three panels (doc 19): the market by tier, its head offices
 * across Canada by province and tier, and its attest firms by head office and
 * by tier. One published revision, unfiltered, on one screen.
 *
 * Rendered on the server, whole: every figure is in the HTML, and each one is
 * a link that opens its companies in Companies. Hover only adds a tooltip
 * repeating what the link already says, and lights a province on the map and
 * its row in the table together.
 *
 * Green is everyone's or Deloitte's, never another firm's (doc 19): the tiers
 * and the head offices count every company, so they are green; in the firm
 * table Deloitte's row is green, every other firm's grey, and the companies
 * whose auditor is not yet known are hatched, because that is research still
 * to do rather than a firm.
 */

const tierName = (t: TierKey) => (t === "none" ? "No tier" : `Tier ${t}`);
const tierHead = (t: TierKey) => (t === "none" ? "None" : `T${t}`);
const ruleOf = (t: TierKey) => (t === "none" ? "Not yet classified" : TIER_RULE[t][0].toUpperCase() + TIER_RULE[t].slice(1));
const companies = (n: number) => `${n.toLocaleString("en-CA")} ${n === 1 ? "company" : "companies"}`;

/** A figure that opens its companies; its name says what it counts, and its tooltip repeats it. */
function Fig({ href, label, tip, className, children, hl }: {
  href: string; label: string; tip: string[]; className?: string; children: ReactNode; hl?: string;
}) {
  return (
    <a href={href} className={className} aria-label={`${label} Open them in Companies.`} data-tip={tip.join("\n")} data-hl={hl}>
      {children}
    </a>
  );
}

export type BoardData = {
  total: number;
  tiers: TierCounts;
  hq: { rows: HqRow[]; canada: number; outside: number; unknown: number };
  firms: FirmGrid;
  /** "of C$100M or more, as of 31 Aug 2026". */
  basis: string;
};

export default function Board({ data }: { data: BoardData }) {
  return (
    <Hover className="db">
      <div className="db-left">
        <Tiers data={data} />
        {/* How the information was produced: under the tiers, where the column has room for it. */}
        <AiNotice compact />
      </div>
      <HeadOffices data={data} />
      <Firms data={data} />
    </Hover>
  );
}

/* --------------------------------------------------------------- 1. tiers */

const GROUPS: Array<{ label: string | null; tiers: TierKey[] }> = [
  { label: "Producing", tiers: ["1", "2", "3"] },
  { label: null, tiers: ["4"] }, { label: null, tiers: ["5"] }, { label: null, tiers: ["6"] }, { label: null, tiers: ["none"] },
];

function Tiers({ data }: { data: BoardData }) {
  const { tiers, total } = data;
  const max = Math.max(1, ...TIER_KEYS.map((t) => tiers[t]));
  return (
    <section className="db-panel db-tiers" aria-labelledby="db-h1">
      <header className="db-head">
        <h2 id="db-h1"><span className="db-n" aria-hidden="true">1</span>Market composition by tier</h2>
      </header>
      <p className="db-sub"><b className="db-big">{total.toLocaleString("en-CA")}</b> companies {data.basis}</p>
      <ol className="db-bars">
        {GROUPS.map((g) => {
          const n = g.tiers.reduce((s, t) => s + tiers[t], 0);
          return [
            g.label && (
              <li key={g.label} className="db-grp" aria-hidden="true">
                <span>{g.label} · Tiers 1–3</span><span className="db-grp-n">{n} · {pct(n, total)}</span>
              </li>
            ),
            ...g.tiers.map((t) => (
              <li key={t} className={g.label ? "db-in" : undefined}>
                <Fig href={companiesHref({ tier: t })} className="db-bar"
                     label={`${tierName(t)}, ${ruleOf(t).toLowerCase()}: ${companies(tiers[t])}, ${pct(tiers[t], total)} of ${total}.`}
                     tip={[`${tierName(t)} · ${ruleOf(t)}`, `${companies(tiers[t])}, ${pct(tiers[t], total)} of ${total}`]}>
                  <span className="db-bar-name"><b>{tierName(t)}</b>{ruleOf(t)}</span>
                  <span className="db-bar-n">{tiers[t]}<small>{pct(tiers[t], total)}</small></span>
                  <span className="db-track" aria-hidden="true"><span style={{ width: `${(100 * tiers[t]) / max}%` }} /></span>
                </Fig>
              </li>
            )),
          ];
        })}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------- 2. head offices */

function HeadOffices({ data }: { data: BoardData }) {
  const { rows, canada, outside, unknown } = data.hq;
  const byCode = new Map(rows.filter((r) => r.code).map((r) => [r.code!, r]));
  const placeWords = (r: HqRow) => (r.kind === "province" ? `in ${r.label}` : r.kind === "canada" ? "in Canada, with no province on record"
    : r.kind === "outside" ? "outside Canada" : "with no head office on record");
  return (
    <section className="db-panel db-hq" aria-labelledby="db-h2">
      <header className="db-head">
        <h2 id="db-h2"><span className="db-n" aria-hidden="true">2</span>Head offices across Canada, by province and tier</h2>
        <p className="db-fig"><b>{canada}</b> run from Canada · {outside} from outside{unknown ? ` · ${unknown} not on record` : ""}</p>
      </header>
      <div className="db-hq-body">
        <div className="db-map">
          {/* The map is for the eye; the table beside it is its twin, and the
              keyboard's: the same counts, every one a link. */}
          <svg viewBox={CANADA_VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
            {Object.entries(CANADA_PATHS).map(([code, d]) => {
              const r = byCode.get(code);
              if (!r) return <path key={code} d={d} className="db-prov" />;
              return (
                <a key={code} href={companiesHref({ hq: r.tokens })} tabIndex={-1} data-hl={r.key}
                   data-tip={[r.label, `${r.n} head offices, ${pct(r.n, data.total)} of all`,
                     TIER_KEYS.filter((t) => r.tiers[t]).map((t) => `${tierName(t)} ${r.tiers[t]}`).join(" · ")].join("\n")}>
                  <path d={d} className={`db-prov q${stepOf(r.n)}`} />
                </a>
              );
            })}
            {rows.filter((r) => r.code && CANADA_LABELS[r.code]).map((r) => {
              const [x, y] = CANADA_LABELS[r.code!];
              const [dx, dy] = NUDGE[r.code!] ?? [0, 0];
              return (
                <text key={r.code} x={x + dx} y={y + dy} textAnchor="middle" className="db-lbl">
                  {r.code} <tspan className="db-lbl-n">{r.n}</tspan>
                </text>
              );
            })}
          </svg>
          {outside > 0 && <p className="db-out">Plus <b>{outside}</b> run from outside Canada, in the table&rsquo;s last rows.</p>}
        </div>
        <div className="db-scroll">
          <table className="db-mx">
            <caption className="sr-only">Head offices by province and tier</caption>
            <colgroup><col className="db-col-lab" />{TIER_KEYS.map((t) => <col key={t} />)}<col className="db-col-tot" /></colgroup>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Head office</span></th>
                {TIER_KEYS.map((t) => <TierTh key={t} t={t} />)}
                <th scope="col" className="db-tot">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} data-hl={r.key} className={r.kind !== "province" && rows[i - 1]?.kind === "province" ? "db-split" : undefined}>
                  <th scope="row" title={r.label}>{r.label.replace(" and ", " & ")}</th>
                  {TIER_KEYS.map((t) => (
                    <Cell key={t} n={r.tiers[t]} tone={`g${stepOf(r.tiers[t])}`} hl={r.key}
                          href={companiesHref({ tier: t, hq: r.tokens })}
                          label={`${tierName(t)}, head office ${placeWords(r)}: ${companies(r.tiers[t])}, ${pct(r.tiers[t], r.n)} of ${r.n}.`}
                          tip={[`${r.label} · ${tierName(t)}`, `${companies(r.tiers[t])}: ${pct(r.tiers[t], r.n)} of the ${r.n} head offices ${placeWords(r)}`,
                            `${pct(r.tiers[t], data.tiers[t])} of the ${data.tiers[t]} in ${tierName(t)}`]} />
                  ))}
                  <td className="db-tot">
                    <Fig href={companiesHref({ hq: r.tokens })} hl={r.key}
                         label={`Head office ${placeWords(r)}: ${companies(r.n)}, ${pct(r.n, data.total)} of ${data.total}.`}
                         tip={[r.label, `${companies(r.n)}, ${pct(r.n, data.total)} of ${data.total}`]}>{r.n}</Fig>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Labels moved clear of a neighbour or the frame's edge, in the map's own units. */
const NUDGE: Record<string, [number, number]> = { BC: [50, 0], AB: [0, 40], SK: [0, 40], ON: [0, 30], NL: [40, -20], NS: [60, 70] };

function TierTh({ t, className }: { t: TierKey; className?: string }) {
  return (
    <th scope="col" className={className} title={`${tierName(t)}: ${ruleOf(t).toLowerCase()}`}>
      <span aria-hidden="true">{tierHead(t)}</span><span className="sr-only">{tierName(t)}</span>
    </th>
  );
}

function Cell({ n, tone, href, label, tip, hl, className }: {
  n: number; tone: string; href: string; label: string; tip: string[]; hl?: string; className?: string;
}) {
  if (n === 0) {
    return <td className={`db-z${className ? ` ${className}` : ""}`}><span aria-hidden="true">–</span><span className="sr-only">none</span></td>;
  }
  return (
    <td className={`db-c ${tone}${className ? ` ${className}` : ""}`}>
      <Fig href={href} label={label} tip={tip} hl={hl}>{n}</Fig>
    </td>
  );
}

/* ------------------------------------------------------- 3. attest firms */

function Firms({ data }: { data: BoardData }) {
  const { places, rows, known, unknown } = data.firms;
  const toneOf = (r: FirmRow, n: number) => (r.kind === "unknown" ? "db-gap" : r.kind === "deloitte" ? `g${stepOf(n)}` : `k${stepOf(n)}`);
  const whose = (r: FirmRow) => (r.kind === "unknown" ? "with no known auditor"
    : r.kind === "other" ? `audited by other firms (${r.firms} named)` : `audited by ${r.label}`);
  const where = (p: Place) => (p.kind === "province" ? `run from ${p.label}` : p.kind === "rest" ? `run from ${p.label === "Canada" ? "Canada" : "the rest of Canada"}`
    : p.kind === "outside" ? "run from outside Canada" : "with no head office on record");
  const placeTotal = (p: Place) => rows.reduce((s, r) => s + r.places[p.key], 0);
  const name = (r: FirmRow) => (r.kind === "unknown" ? "Auditor not yet known" : r.kind === "other" ? `Other firms (${r.firms})` : r.label);
  return (
    <section className="db-panel db-firms" aria-labelledby="db-h3">
      <header className="db-head">
        <h2 id="db-h3"><span className="db-n" aria-hidden="true">3</span>Attest firms, by head office and by tier</h2>
        <p className="db-fig"><b>{known}</b> with a known auditor · {unknown} not yet known</p>
      </header>
      <div className="db-scroll db-fill">
        <table className="db-mx db-wide">
          <caption className="sr-only">Companies by auditor, by the province of their head office and by tier</caption>
          <colgroup>
            <col className="db-col-firm" />{places.map((p) => <col key={p.key} />)}{TIER_KEYS.map((t) => <col key={t} />)}<col className="db-col-tot" />
          </colgroup>
          <thead>
            <tr className="db-groups">
              <td />
              <th scope="colgroup" colSpan={places.length}>Head office</th>
              <th scope="colgroup" colSpan={TIER_KEYS.length} className="db-gap-l">Tier</th>
              <td />
            </tr>
            <tr>
              <th scope="col"><span className="sr-only">Auditor</span></th>
              {places.map((p) => <th key={p.key} scope="col" title={p.label}><span aria-hidden="true">{p.short}</span><span className="sr-only">{p.label}</span></th>)}
              {TIER_KEYS.map((t, i) => <TierTh key={t} t={t} className={i === 0 ? "db-gap-l" : undefined} />)}
              <th scope="col" className="db-tot">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.kind === "other" ? "db-split" : undefined}>
                <th scope="row" className={r.kind === "deloitte" ? "db-ours" : undefined} title={name(r)}>
                  {r.kind === "other" ? "Other firms" : r.kind === "unknown" ? "Not yet known" : r.label}
                </th>
                {places.map((p) => (
                  <Cell key={p.key} n={r.places[p.key]} tone={toneOf(r, r.places[p.key])}
                        href={companiesHref({ hq: p.tokens, auditor: r.tokens })}
                        label={`${name(r)}, head office ${where(p).replace("run from ", "in ")}: ${companies(r.places[p.key])}.`}
                        tip={[`${name(r)} · ${p.label}`, `${r.places[p.key]} of the ${companies(r.n)} ${whose(r)}`,
                          `${pct(r.places[p.key], placeTotal(p))} of the ${placeTotal(p)} ${where(p)}`]} />
                ))}
                {TIER_KEYS.map((t, i) => (
                  <Cell key={t} n={r.tiers[t]} tone={toneOf(r, r.tiers[t])} className={i === 0 ? "db-gap-l" : undefined}
                        href={companiesHref({ tier: t, auditor: r.tokens })}
                        label={`${name(r)}, ${tierName(t)}: ${companies(r.tiers[t])}.`}
                        tip={[`${name(r)} · ${tierName(t)}`, `${r.tiers[t]} of the ${companies(r.n)} ${whose(r)}`,
                          `${pct(r.tiers[t], data.tiers[t])} of the ${data.tiers[t]} in ${tierName(t)}`]} />
                ))}
                <td className="db-tot">
                  {r.n === 0 ? <span className="db-none">0</span> : (
                    <Fig href={companiesHref({ auditor: r.tokens })}
                         label={`${name(r)}: ${companies(r.n)}, ${pct(r.n, data.total)} of ${data.total}.`}
                         tip={[name(r), `${companies(r.n)}, ${pct(r.n, data.total)} of ${data.total}`]}>
                      {r.n}<small>{pct(r.n, data.total)}</small>
                    </Fig>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="db-legend" aria-hidden="true">
        <span>Companies:</span>
        <span className="db-steps db-steps-g">{STEP_LABELS.map((l) => <i key={l}>{l.replace(" or more", "+")}</i>)}</span>
        <span>everyone · Deloitte</span>
        <span className="db-steps db-steps-k">{STEP_LABELS.map((l) => <i key={l}>{l.replace(" or more", "+")}</i>)}</span>
        <span>other firms</span>
        <span><span className="db-hatch" /> not yet known</span>
      </div>
    </section>
  );
}
