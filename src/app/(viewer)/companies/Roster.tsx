"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  auditorWord, cited, describeFilter, FILTER_LABEL, facetOptions, filterRows, FOOTPRINT_WORD, hqWord,
  isNarrowed, notFound, ROSTER_COLUMNS, sortRows, STAGE_LABEL, STAGE_OF_TIER, stageMark, TIER_WORD,
  toRosterParams, EMPTY_FILTER, type MetaEntry, type RosterFilter, type RosterRow, type SortKey,
} from "../../../lib/profile/roster.ts";
import { formatFee, formatMoney, STAGE_ORDER, type Stage } from "../../../lib/format/fields.ts";
import Icon from "../../_ui/Icon.tsx";
import MultiSelect from "../../_ui/MultiSelect.tsx";

const PICKERS = ["tier", "stage", "hq", "auditor", "footprint", "prop"] as const;

/**
 * Every company, full width, narrowed by any combination of filters, sorted on
 * any column, found by name, ticker or anything on its company page.
 *
 * The filter lives in the URL, so a narrowed view is a link somebody can be
 * sent, and the export button downloads exactly the rows on screen: both read
 * it through lib/profile/roster.ts. The server parsed the same URL to render
 * this, so the first paint is already narrowed.
 *
 * 259 rows, so everything is local; nothing pages. The first column and the
 * header stay put while the rest scrolls.
 */
export default function Roster({ rows, deloitteAudits, initial }: {
  rows: RosterRow[]; deloitteAudits: number; initial: RosterFilter;
}) {
  const [filter, setFilter] = useState<RosterFilter>(initial);
  const findRef = useRef<HTMLInputElement | null>(null);
  const facets = useMemo(() => facetOptions(rows), [rows]);

  // replaceState rather than the router: the URL should follow the filter, but
  // a force-dynamic page re-rendered on every keystroke would throw the rows
  // away to fetch the same rows again.
  const params = toRosterParams(filter).toString();
  useEffect(() => {
    const url = params ? `/companies?${params}` : "/companies";
    if (`${location.pathname}${location.search}` !== url) window.history.replaceState(null, "", url);
  }, [params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !inText) { e.preventDefault(); findRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => sortRows(filterRows(rows, filter), filter.sort, filter.dir), [rows, filter]);
  const set = (patch: Partial<RosterFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggleSort = (key: SortKey) => set({
    sort: key, dir: filter.sort === key ? (filter.dir === 1 ? -1 : 1) : (key === "marketCap" ? -1 : 1),
  });
  const narrowed = isNarrowed(filter);
  const exportHref = (format: "xlsx" | "csv") => {
    const p = toRosterParams(filter);
    p.set("format", format);
    return `/api/companies/export?${p.toString()}`;
  };

  return (
    <>
      <div className="tools">
        <div className="find">
          <input ref={findRef} type="search" name="q" placeholder="Find a company or detail…"
                 aria-label="Find a company, ticker, or anything on its company page"
                 autoComplete="off" spellCheck={false}
                 value={filter.q} onChange={(e) => set({ q: e.target.value })} />
          {!filter.q && <kbd aria-hidden="true">/</kbd>}
        </div>
        <button type="button" className={`btn secondary${filter.ws ? " on" : ""}`} aria-pressed={filter.ws}
                onClick={() => set({ ws: !filter.ws })}>
          <Icon name={filter.ws ? "check" : "landmark"} size={15} />
          {filter.ws ? "Showing whitespace only" : "Whitespace only"}
        </button>
        <span className="spacer" />
        <span className="meta" role="status" aria-live="polite">
          <span className="fig-sm">{shown.length}</span> of <span className="fig-sm">{rows.length}</span>
          {" · Deloitte audits "}<span className="fig-sm">{deloitteAudits}</span>
        </span>
        <a className="btn sm secondary" href={exportHref("xlsx")} download>
          <Icon name="download" size={13} />Excel
        </a>
        <a className="btn sm quiet" href={exportHref("csv")} download>CSV</a>
      </div>

      <div className="filterbar" role="group" aria-label="Filters">
        {PICKERS.map((key, i) => (
          <MultiSelect key={key} name={key} label={FILTER_LABEL[key]} groups={facets[key]}
                       selected={filter[key]} onChange={(next) => set({ [key]: next })}
                       align={i >= PICKERS.length - 2 ? "end" : "start"} />
        ))}
        {narrowed && (
          <button type="button" className="btn sm quiet" onClick={() => setFilter({ ...EMPTY_FILTER, sort: filter.sort, dir: filter.dir })}>
            <Icon name="x" size={13} />Clear filters
          </button>
        )}
      </div>
      {narrowed && <p className="meta" style={{ margin: "0 0 10px" }}>{describeFilter(filter, facets)}</p>}

      {shown.length === 0
        ? <p className="empty">No company matches {describeFilter(filter, facets).toLowerCase()}.</p>
        : (
          <div className="roster">
            <table>
              <thead>
                <tr className="grouphead">
                  {ROSTER_COLUMNS.map((c) => c.stage
                    ? (c.key === STAGE_ORDER[0] &&
                        <th key="stages" scope="colgroup" colSpan={STAGE_ORDER.length} className="groupspan">Stage of operations</th>)
                    : <th key={c.key} aria-hidden="true" />)}
                </tr>
                <tr className="colhead">
                  {ROSTER_COLUMNS.map((c) => c.stage
                    ? <th key={c.key} scope="col" className="stagecell">{c.label}</th>
                    : (
                      <th key={c.key} scope="col" className={c.numeric ? "n" : undefined}
                          aria-sort={filter.sort === c.key ? (filter.dir === 1 ? "ascending" : "descending") : "none"}>
                        <button type="button" className="sort" onClick={() => toggleSort(c.key as SortKey)}>
                          {c.label}
                          <Icon name={filter.sort === c.key && filter.dir === -1 ? "chevron-down" : "chevron-up"} size={12} />
                        </button>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row: r, matched }) => (
                  <tr key={r.companyId}>
                    <th scope="row">
                      <Link href={`/companies/${r.companyId}` as Route} prefetch={false}>{r.name}</Link>
                      {matched && <MatchHint entry={matched} q={filter.q} />}
                    </th>
                    <td className="fig-sm">
                      {r.ticker ?? "—"}
                      {r.exchange && <span className="dim">{` · ${r.exchange}`}</span>}
                    </td>
                    <td>
                      {r.tier === null
                        ? <span className="pill quiet">{TIER_WORD[r.status] ?? "Unclassified"}</span>
                        : <span className="fig-sm">{`Tier ${r.tier}`}</span>}
                    </td>
                    <td>{r.tier === null ? <span className="meta">—</span> : STAGE_LABEL[STAGE_OF_TIER[r.tier]]}</td>
                    <StageCells row={r} />
                    <td>{FOOTPRINT_WORD[r.footprint] ?? r.footprint}</td>
                    <td><Cite row={r} field="head_office_region" value={hqWord(r)} /></td>
                    <td>
                      {r.auditor === "Deloitte"
                        ? <span className="pill ok"><Icon name="landmark" size={12} />Deloitte</span>
                        : <Cite row={r} field="auditor" value={r.auditor ? auditorWord(r.auditor) : null} empty="not known" />}
                    </td>
                    <td className="fig-sm">
                      <Cite row={r} field="audit_fee"
                            value={r.auditFee === null || r.auditFee === undefined ? null : formatFee(r.auditFee)} />
                    </td>
                    <td><Cite row={r} field="incumbent_erp" value={r.erp} /></td>
                    <td className="n fig-sm">{r.marketCap === null ? "—" : formatMoney(r.marketCap, "CAD", { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="roster-legend">
        ✓ the company operates at this stage · ? research has not settled it · <em>Not researched</em> no
        stage research yet · <em>Not found</em> researched, and its filings do not say · — no published
        value. A researched value links to its source on the company page.
      </p>
    </>
  );
}

/**
 * The four Stage of operations cells. Blank means no ONLY where the evidence
 * is complete; a company never researched says so once across all four, so
 * four empty cells never read as four noes.
 */
function StageCells({ row }: { row: RosterRow }) {
  const first = stageMark(row, STAGE_ORDER[0]);
  if (first === "not_researched" || first === "not_recorded") {
    return (
      <td className="stage-none" colSpan={STAGE_ORDER.length}>
        {first === "not_researched" ? "Not researched" : "Not recorded in this revision"}
      </td>
    );
  }
  return (
    <>
      {STAGE_ORDER.map((s: Stage) => {
        const mark = stageMark(row, s);
        return (
          <td key={s} className="stagecell">
            {mark === "yes" && <><span className="stage-yes" aria-hidden="true">✓</span><span className="sr-only">Yes</span></>}
            {mark === "unknown" && <><span className="stage-unknown" aria-hidden="true">?</span><span className="sr-only">Not known</span></>}
            {mark === "blank" && <span className="sr-only">No</span>}
          </td>
        );
      })}
    </>
  );
}

/**
 * A value that came from research or a reviewer links to its citation on the
 * company page; one research looked for and did not find says "Not found",
 * and links there too, because "the filings were read and do not say" is a
 * finding with a source of its own.
 */
function Cite({ row, field, value, empty = "—" }: { row: RosterRow; field: string; value: string | null; empty?: string }) {
  const href = `/companies/${row.companyId}#v-${field}` as Route;
  if (value === null || value === "") {
    if (notFound(row, field, null)) {
      return <Link className="citelink notfound" href={href} prefetch={false} title="Researched: see what was read">Not found</Link>;
    }
    return <span className="meta">{empty}</span>;
  }
  if (cited(row, field)) {
    return <Link className="citelink" href={href} prefetch={false} title="See the source">{value}</Link>;
  }
  return <>{value}</>;
}

/** Why a row matched a search that nothing on screen explains. */
function MatchHint({ entry, q }: { entry: MetaEntry; q: string }) {
  const text = entry.text;
  const at = text.toLowerCase().indexOf(q.trim().toLowerCase());
  const from = Math.max(0, at - 24);
  const snippet: ReactNode = at < 0 ? text.slice(0, 60) : (
    <>
      {from > 0 && "…"}{text.slice(from, at)}<mark>{text.slice(at, at + q.trim().length)}</mark>
      {text.slice(at + q.trim().length, at + q.trim().length + 32)}{at + q.trim().length + 32 < text.length && "…"}
    </>
  );
  return <span className="matchhint">matched: {entry.label} — {snippet}</span>;
}

