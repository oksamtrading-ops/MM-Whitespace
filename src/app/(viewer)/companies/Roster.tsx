"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  auditorWord, cited, describeFilter, EMPTY_RANGE, FILTER_LABEL, facetOptions, filterRows, FOOTPRINT_WORD,
  HIDE_KEYS, HIDE_WORD, hideKeyOf, hqWord, isNarrowed, notFound, RANGE_LABEL, rangeSet, ROSTER_COLUMNS, sortRows,
  parseRosterParams, STAGE_LABEL, STAGE_OF_TIER, stageMark, TIER_WORD, toRosterParams, EMPTY_FILTER,
  type HideKey, type MetaEntry, type Multi, type Presence, type RangeKey, type RosterFilter, type RosterRow, type SortKey,
} from "../../../lib/profile/roster.ts";
import { formatFee, formatMoney, STAGE_ORDER, type Stage } from "../../../lib/format/fields.ts";
import Icon from "../../_ui/Icon.tsx";
import MultiSelect from "../../_ui/MultiSelect.tsx";
import { openPopover } from "../../_ui/Popover.tsx";
import { AddFilter, RangeFilter, TextFilter } from "./ColumnFilters.tsx";
import { ReportControls, SaveAsReport, type ReportInfo } from "../reports/ReportControls.tsx";

/** The pickers that are always in the bar: the filters people reach for first. */
const PICKERS = ["tier", "stage", "hq", "auditor", "footprint", "commodity", "prop"] as const;

/** The filters a column has that are not always in the bar; "Add filter" brings them. */
const EXTRA_LIST = ["exchange", "decides", ...STAGE_ORDER] as const;
const EXTRA_TEXT = ["name", "ticker"] as const;
const EXTRA_RANGE = ["auditFee", "taxFee", "marketCap"] as const;
type ExtraKey = typeof EXTRA_LIST[number] | typeof EXTRA_TEXT[number] | typeof EXTRA_RANGE[number];

/** Every column, in the table's order, and the filter that narrows it. */
const ADDABLE: Array<{ key: ExtraKey | typeof PICKERS[number]; label: string }> = [
  { key: "name", label: "Company" },
  { key: "marketCap", label: "Market cap" },
  { key: "ticker", label: "Ticker" },
  { key: "exchange", label: "Exchange" },
  { key: "tier", label: "Tier" },
  { key: "decides", label: "Stage (deciding the tier)" },
  { key: "stage", label: "Stage of operations (any)" },
  ...STAGE_ORDER.map((s) => ({ key: s, label: `Stage: ${STAGE_LABEL[s]}` })),
  { key: "footprint", label: "Footprint" },
  { key: "commodity", label: "Commodities" },
  { key: "hq", label: "Company HQ" },
  { key: "prop", label: "Properties in" },
  { key: "auditor", label: "Auditor" },
  { key: "auditFee", label: "Audit fees" },
  { key: "taxFee", label: "Tax fees paid to audit firm" },
];

const FEE_PRESENCE: Array<[Presence, string]> = [
  ["value", "Has a value"], ["empty", "No value"], ["not_found", "Researched, not found"],
];
const CAP_PRESENCE: Array<[Presence, string]> = [["value", "Has a value"], ["empty", "No value"]];

function extraActive(f: RosterFilter, key: ExtraKey): boolean {
  if (key === "name") return Boolean(f.name);
  if (key === "ticker") return Boolean(f.ticker) || f.tickerHas !== "";
  if ((EXTRA_RANGE as readonly string[]).includes(key)) return rangeSet(f[key as RangeKey]);
  return f[key as Multi].length > 0;
}

function clearExtra(key: ExtraKey): Partial<RosterFilter> {
  if (key === "name") return { name: "" };
  if (key === "ticker") return { ticker: "", tickerHas: "" };
  if ((EXTRA_RANGE as readonly string[]).includes(key)) return { [key]: EMPTY_RANGE };
  return { [key]: [] };
}

const EXTRA_KEYS: readonly ExtraKey[] = [...EXTRA_TEXT, ...EXTRA_LIST, ...EXTRA_RANGE];

/**
 * Every company, full width, narrowed by any combination of filters -- one
 * for every column -- sorted on any column, found by name, ticker or anything
 * on its company page, with any column but Company taken off.
 *
 * The filter lives in the URL, so a narrowed view is a link somebody can be
 * sent, and the export button downloads exactly the rows on screen: both read
 * it through lib/profile/roster.ts. The server parsed the same URL to render
 * this, so the first paint is already narrowed.
 *
 * A saved report is this table with `report` set: its URL is the report's own
 * while the view is as saved, and says ?edit=1 once it has been changed, so a
 * changed view still reloads as it was left and can be sent as a link.
 *
 * A few hundred rows, so everything is local; nothing pages. The first column
 * and the header stay put while the rest scrolls.
 */
export default function Roster({ rows, deloitteAudits, initial, report }: {
  rows: RosterRow[]; deloitteAudits: number; initial: RosterFilter; report?: ReportInfo;
}) {
  const [filter, setFilter] = useState<RosterFilter>(initial);
  // Filters brought into the bar by "Add filter", kept while they are being set.
  const [added, setAdded] = useState<ExtraKey[]>(() => EXTRA_KEYS.filter((k) => extraActive(initial, k)));
  const [justAdded, setJustAdded] = useState<ExtraKey | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const facets = useMemo(() => facetOptions(rows), [rows]);

  const basePath = report ? `/reports/${report.id}` : "/companies";
  const params = toRosterParams(filter).toString();
  // Compared as the server will store it (trimmed, capped), so a trailing
  // space typed in a box is not a change nobody can save away.
  const dirty = report
    ? toRosterParams(parseRosterParams(new URLSearchParams(params))).toString() !== report.params
    : false;

  // replaceState rather than the router: the URL should follow the filter, but
  // a force-dynamic page re-rendered on every keystroke would throw the rows
  // away to fetch the same rows again.
  useEffect(() => {
    const url = report
      ? (dirty ? `${basePath}?edit=1${params ? `&${params}` : ""}` : basePath)
      : (params ? `${basePath}?${params}` : basePath);
    if (`${location.pathname}${location.search}` !== url) window.history.replaceState(null, "", url);
  }, [params, basePath, dirty, report]);

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
    if (report) p.set("report", report.id);
    return `/api/companies/export?${p.toString()}`;
  };

  const hidden = new Set<HideKey>(filter.hide);
  const columns = ROSTER_COLUMNS.filter((c) => { const h = hideKeyOf(c.key); return !h || !hidden.has(h); });
  const show = (h: HideKey) => !hidden.has(h);
  const stagesShown = show("stages");

  const pick = (key: string) => {
    if ((EXTRA_KEYS as readonly string[]).includes(key)) {
      const k = key as ExtraKey;
      if (added.includes(k)) {
        openPopover(barRef.current?.querySelector<HTMLDetailsElement>(`details[data-key="${k}"]`) ?? null, { focus: true });
      } else {
        setAdded((a) => [...a, k]);
        setJustAdded(k);
      }
      return;
    }
    openPopover(barRef.current?.querySelector<HTMLDetailsElement>(`details[data-key="${key}"]`) ?? null, { focus: true });
  };
  const remove = (key: ExtraKey) => {
    set(clearExtra(key));
    setAdded((a) => a.filter((k) => k !== key));
  };

  const extra = (key: ExtraKey) => {
    const common = { autoOpen: justAdded === key, onRemove: () => remove(key) };
    switch (key) {
      case "name":
        return <TextFilter key={key} name="name" label="Company" value={filter.name}
                           onChange={(name) => set({ name })} {...common} />;
      case "ticker":
        return <TextFilter key={key} name="ticker" label="Ticker" value={filter.ticker}
                           onChange={(ticker) => set({ ticker })}
                           presence={filter.tickerHas} onPresence={(tickerHas) => set({ tickerHas })} {...common} />;
      case "auditFee": case "taxFee":
        return <RangeFilter key={key} name={key} label={RANGE_LABEL[key]} value={filter[key]}
                            onChange={(r) => set({ [key]: r })}
                            currencies={facets[`${key}Cur`]} years={facets[`${key}Fy`]} presences={FEE_PRESENCE}
                            note="Amounts compare as printed, each in its own currency. Pick a currency to compare like with like."
                            {...common} />;
      case "marketCap":
        return <RangeFilter key={key} name={key} label={RANGE_LABEL[key]} value={filter.marketCap}
                            onChange={(marketCap) => set({ marketCap })} presences={CAP_PRESENCE}
                            note="In Canadian dollars. Type 500M or 2B." {...common} />;
      default:
        return (
          <span key={key} className="cf-chip">
            <MultiSelect name={key} label={FILTER_LABEL[key]} groups={facets[key]} selected={filter[key]}
                         onChange={(next) => set({ [key]: next })} autoOpen={justAdded === key} />
            <button type="button" className="btn sm quiet icon-only cf-x" onClick={() => remove(key)}
                    aria-label={`Remove the ${FILTER_LABEL[key].toLowerCase()} filter`} title="Remove filter">
              <Icon name="x" size={13} />
            </button>
          </span>
        );
    }
  };

  const columnGroups = [{ label: "Columns", options: HIDE_KEYS.map((h) => ({ value: h, label: HIDE_WORD[h] })) }];
  const shownColumns = HIDE_KEYS.filter((h) => !hidden.has(h));

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
        <MultiSelect name="cols" label="Columns" groups={columnGroups} selected={shownColumns}
                     summary={hidden.size === 0 ? "All" : `${shownColumns.length + 1} of ${HIDE_KEYS.length + 1}`}
                     onChange={(next) => set({ hide: HIDE_KEYS.filter((h) => !next.includes(h)) })} />
        <a className="btn sm secondary" href={exportHref("xlsx")} download>
          <Icon name="download" size={13} />Excel
        </a>
        <a className="btn sm quiet" href={exportHref("csv")} download>CSV</a>
        {!report && <SaveAsReport params={params} />}
      </div>

      {report && (
        <div className="tools reportbar" role="group" aria-label="This report">
          <ReportControls report={report} params={params} dirty={dirty} />
        </div>
      )}

      <div ref={barRef} className="filterbar" role="group" aria-label="Filters">
        {PICKERS.map((key) => (
          <MultiSelect key={key} name={key} label={FILTER_LABEL[key]} groups={facets[key]}
                       selected={filter[key]} onChange={(next) => set({ [key]: next })} />
        ))}
        {added.map(extra)}
        <AddFilter columns={ADDABLE.map((c) => ({
                     key: c.key, label: c.label,
                     active: (EXTRA_KEYS as readonly string[]).includes(c.key)
                       ? extraActive(filter, c.key as ExtraKey) : filter[c.key as Multi].length > 0,
                   }))}
                   onPick={pick} />
        {narrowed && (
          <button type="button" className="btn sm quiet" onClick={() => {
            setFilter({ ...EMPTY_FILTER, sort: filter.sort, dir: filter.dir, hide: filter.hide });
            setAdded([]);
          }}>
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
                  {columns.map((c) => c.stage
                    ? (c.key === STAGE_ORDER[0] &&
                        <th key="stages" scope="colgroup" colSpan={STAGE_ORDER.length} className="groupspan">Stage of operations</th>)
                    : <th key={c.key} aria-hidden="true" />)}
                </tr>
                <tr className="colhead">
                  {columns.map((c) => c.stage
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
                    {show("marketCap") && (
                      <td className="n fig-sm">{r.marketCap === null ? "—" : formatMoney(r.marketCap, "CAD", { compact: true })}</td>
                    )}
                    {show("ticker") && (
                      <td className="fig-sm">
                        {r.ticker ?? "—"}
                        {r.exchange && <span className="dim">{` · ${r.exchange}`}</span>}
                      </td>
                    )}
                    {show("tier") && (
                      <td>
                        {r.tier === null
                          ? <span className="pill quiet">{TIER_WORD[r.status] ?? "Unclassified"}</span>
                          : <span className="fig-sm">{`Tier ${r.tier}`}</span>}
                      </td>
                    )}
                    {show("stage") && (
                      <td>{r.tier === null ? <span className="meta">—</span> : STAGE_LABEL[STAGE_OF_TIER[r.tier]]}</td>
                    )}
                    {stagesShown && <StageCells row={r} />}
                    {show("footprint") && <td>{FOOTPRINT_WORD[r.footprint] ?? r.footprint}</td>}
                    {show("commodities") && (
                      <td className="wrap">
                        <Cite row={r} field="commodities" value={r.commodities.length ? r.commodities.join(", ") : null} />
                      </td>
                    )}
                    {show("hq") && <td><Cite row={r} field="head_office_region" value={hqWord(r)} /></td>}
                    {show("auditor") && (
                      <td>
                        {r.auditor === "Deloitte"
                          ? <span className="pill ok"><Icon name="landmark" size={12} />Deloitte</span>
                          : <Cite row={r} field="auditor" value={r.auditor ? auditorWord(r.auditor) : null} empty="not known" />}
                      </td>
                    )}
                    {show("auditFee") && (
                      <td className="fig-sm">
                        <Cite row={r} field="audit_fee"
                              value={r.auditFee === null || r.auditFee === undefined ? null : formatFee(r.auditFee)} />
                      </td>
                    )}
                    {show("taxFee") && (
                      <td className="fig-sm">
                        <Cite row={r} field="tax_fee"
                              value={r.taxFee === null || r.taxFee === undefined ? null : formatFee(r.taxFee)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="roster-legend">
        ✓ the company operates at this stage · — not known: research has not settled it, or no published
        value · <em>Not researched</em> no stage research yet · <em>Not found</em> researched, and its filings
        do not say. A researched value links to its source on the company page. Fees are as the company
        printed them, in its reporting currency, for the fiscal year shown.
      </p>
    </>
  );
}

/**
 * The four Stage of operations cells. Blank means no ONLY where the evidence
 * is complete; a stage research has not settled shows a dash that reads "Not
 * known"; a company never researched says so once across all four, so four
 * empty cells never read as four noes.
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
            {mark === "unknown" && (
              <><span className="stage-unknown" aria-hidden="true" title="Not known">—</span><span className="sr-only">Not known</span></>
            )}
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
