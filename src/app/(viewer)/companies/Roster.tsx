"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COL_KEYS, COL_WORD, describeFilter, EMPTY_RANGE, FILTER_LABEL, facetOptions, filterRows,
  isNarrowed, LEGACY_COLS, MORE_COLS, RANGE_LABEL, rangeSet, sortRows, parseRosterParams, STAGE_LABEL,
  toRosterParams, EMPTY_FILTER, type ColKey, type Multi, type Presence, type RangeKey, type RosterFilter,
  type RosterRow, type SortKey,
} from "../../../lib/profile/roster.ts";
import { STAGE_ORDER } from "../../../lib/format/fields.ts";
import Icon from "../../_ui/Icon.tsx";
import MultiSelect from "../../_ui/MultiSelect.tsx";
import { openPopover } from "../../_ui/Popover.tsx";
import { AddFilter, filterWord, RangeFilter, TextFilter } from "./ColumnFilters.tsx";
import RosterTable, { RosterLegend } from "./RosterTable.tsx";
import { ReplaceReport, SaveAsReport, type FromReport } from "../reports/ReportControls.tsx";

/**
 * The pickers always in the bar (Samuel, 7 November: three, so a phone reaches
 * the table sooner). Every other filter waits in "More filters" and joins the
 * bar while it is set, however it was set: by hand, a shared link or a report.
 */
const PICKERS = ["tier", "auditor", "commodity"] as const;

/** The filters a column has that are not always in the bar; "More filters" brings them. */
const EXTRA_LIST = [
  "exchange", "decides", "stage", ...STAGE_ORDER, "footprint", "prop", "hq", "venture", "sec", "audchg", "fye", "repcur",
] as const;
const EXTRA_TEXT = ["name", "ticker", "website"] as const;
const EXTRA_RANGE = [
  "auditFee", "taxFee", "marketCap", "revenue", "netIncome", "totalAssets", "auditRelatedFee", "otherFee",
  "auditorSince",
] as const;
type ExtraKey = typeof EXTRA_LIST[number] | typeof EXTRA_TEXT[number] | typeof EXTRA_RANGE[number];

/** Every column, in the table's order, and the filter that narrows it. */
const ADDABLE: Array<{ key: ExtraKey | typeof PICKERS[number]; label: string }> = [
  { key: "name", label: "Company" },
  { key: "marketCap", label: "Market cap" },
  { key: "ticker", label: "Ticker" },
  { key: "exchange", label: "Exchange" },
  { key: "website", label: "Website" },
  { key: "tier", label: "Tier" },
  { key: "decides", label: "Stage (deciding the tier)" },
  { key: "stage", label: "Stage of operations (any)" },
  ...STAGE_ORDER.map((s) => ({ key: s, label: `Stage: ${STAGE_LABEL[s]}` })),
  { key: "footprint", label: "Footprint" },
  { key: "prop", label: "Properties in" },
  { key: "commodity", label: "Commodities" },
  { key: "hq", label: "Company HQ" },
  { key: "venture", label: "Venture graduate" },
  { key: "sec", label: "SEC registrant" },
  { key: "fye", label: "Fiscal year-end" },
  { key: "repcur", label: "Reporting currency" },
  { key: "revenue", label: "Revenue" },
  { key: "netIncome", label: "Net income" },
  { key: "totalAssets", label: "Total assets" },
  { key: "auditor", label: "Auditor" },
  { key: "auditorSince", label: "Auditor since" },
  { key: "audchg", label: "Auditor change" },
  { key: "auditFee", label: "Audit fees" },
  { key: "auditRelatedFee", label: "Audit-related fees" },
  { key: "taxFee", label: "Tax fees paid to audit firm" },
  { key: "otherFee", label: "Other fees" },
];

const FEE_PRESENCE: Array<[Presence, string]> = [
  ["value", "Has a value"], ["empty", "No value"], ["not_found", "Researched, not found"],
];
const CAP_PRESENCE: Array<[Presence, string]> = [["value", "Has a value"], ["empty", "No value"]];

function extraActive(f: RosterFilter, key: ExtraKey): boolean {
  if (key === "name") return Boolean(f.name);
  if (key === "ticker") return Boolean(f.ticker) || f.tickerHas !== "";
  if (key === "website") return Boolean(f.website) || f.websiteHas !== "";
  if ((EXTRA_RANGE as readonly string[]).includes(key)) return rangeSet(f[key as RangeKey]);
  return f[key as Multi].length > 0;
}

function clearExtra(key: ExtraKey): Partial<RosterFilter> {
  if (key === "name") return { name: "" };
  if (key === "ticker") return { ticker: "", tickerHas: "" };
  if (key === "website") return { website: "", websiteHas: "" };
  if ((EXTRA_RANGE as readonly string[]).includes(key)) return { [key]: EMPTY_RANGE };
  return { [key]: [] };
}

const EXTRA_SET = new Set<string>([...EXTRA_TEXT, ...EXTRA_LIST, ...EXTRA_RANGE]);
/** In the table's column order, so filters a link or report sets line up as the columns do. */
const EXTRA_KEYS: readonly ExtraKey[] = ADDABLE.map((c) => c.key).filter((k): k is ExtraKey => EXTRA_SET.has(k));

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
 * Reports are made here, never edited on their own page: "Save as report"
 * keeps the view under a name. A report opened here ("Open in Companies")
 * carries ?from=<id>, so whoever may edit it can replace its filters with
 * these; everyone else can save them as a report of their own.
 *
 * A few hundred rows, so everything is local; nothing pages. The first column
 * and the header stay put while the rest scrolls.
 */
export default function Roster({ rows, initial, from }: {
  rows: RosterRow[]; initial: RosterFilter; from?: FromReport;
}) {
  const [filter, setFilter] = useState<RosterFilter>(initial);
  // Filters brought into the bar by "More filters" or set by the URL, kept while they are being set.
  const [added, setAdded] = useState<ExtraKey[]>(() => EXTRA_KEYS.filter((k) => extraActive(initial, k)));
  const [justAdded, setJustAdded] = useState<ExtraKey | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const facets = useMemo(() => facetOptions(rows), [rows]);

  const params = toRosterParams(filter).toString();
  // Compared as the server will store it (trimmed, capped), so a trailing
  // space typed in a box is not a change nobody can save away.
  const changed = from
    ? toRosterParams(parseRosterParams(new URLSearchParams(params))).toString() !== from.params
    : false;

  // replaceState rather than the router: the URL should follow the filter, but
  // a force-dynamic page re-rendered on every keystroke would throw the rows
  // away to fetch the same rows again.
  useEffect(() => {
    const q = [params, from ? `from=${from.id}` : ""].filter(Boolean).join("&");
    const url = q ? `/companies?${q}` : "/companies";
    if (`${location.pathname}${location.search}` !== url) window.history.replaceState(null, "", url);
  }, [params, from]);

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
  // Excel only (Samuel, 7 November); the export still answers ?format=csv.
  const excelParams = toRosterParams(filter);
  excelParams.set("format", "xlsx");
  const excelHref = `/api/companies/export?${excelParams.toString()}`;

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
      case "website":
        return <TextFilter key={key} name="website" label="Website" value={filter.website}
                           onChange={(website) => set({ website })}
                           presence={filter.websiteHas} onPresence={(websiteHas) => set({ websiteHas })} {...common} />;
      case "auditFee": case "taxFee": case "revenue": case "netIncome": case "totalAssets":
      case "auditRelatedFee": case "otherFee":
        return <RangeFilter key={key} name={key} label={RANGE_LABEL[key]} value={filter[key]}
                            onChange={(r) => set({ [key]: r })}
                            currencies={facets[`${key}Cur`]} years={facets[`${key}Fy`]} presences={FEE_PRESENCE}
                            note="Amounts compare as printed, each in its own currency. Pick a currency to compare like with like."
                            {...common} />;
      case "auditorSince":
        return <RangeFilter key={key} name={key} label={RANGE_LABEL[key]} value={filter.auditorSince}
                            onChange={(auditorSince) => set({ auditorSince })} presences={FEE_PRESENCE} plain
                            note="A year, such as 2015." {...common} />;
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
                    aria-label={`Remove the ${filterWord(FILTER_LABEL[key])} filter`} title="Remove filter">
              <Icon name="x" size={13} />
            </button>
          </span>
        );
    }
  };

  // Just the column's name (Samuel, 7 November: a count here read oddly).
  const colOption = (k: ColKey) => ({ value: k, label: COL_WORD[k] });
  const columnGroups = [
    { label: "Columns", options: LEGACY_COLS.map(colOption) },
    { label: "More columns", options: MORE_COLS.map(colOption) },
  ];

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
        {/* Not shown (Samuel, 7 November: not needed), but still said aloud
            when a filter changes the rows, so a screen reader hears it work. */}
        <span className="sr-only" role="status" aria-live="polite">
          <span className="fig-sm">{shown.length}</span> of <span className="fig-sm">{rows.length}</span> companies
        </span>
        <MultiSelect name="cols" label="Columns" groups={columnGroups} selected={filter.cols}
                     summary={`${filter.cols.length + 1} of ${COL_KEYS.length + 1}`}
                     onChange={(next) => set({ cols: COL_KEYS.filter((k) => next.includes(k)) })} />
        <a className="btn sm secondary" href={excelHref} download>
          <Icon name="download" size={13} />Excel
        </a>
        <SaveAsReport params={params} />
      </div>

      {from && (
        <div className="tools rp-from" role="group" aria-label="The report these filters came from">
          <span className="meta">
            {"Filters from the report "}
            <Link href={`/reports/${from.id}` as Route} prefetch={false}>{from.name}</Link>
            {changed ? ", changed since it was saved." : "."}
          </span>
          {from.canEdit && <ReplaceReport report={from} params={params} changed={changed} />}
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
            setFilter({ ...EMPTY_FILTER, sort: filter.sort, dir: filter.dir, cols: filter.cols });
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
          <RosterTable shown={shown} filter={filter} onSort={toggleSort} />
        )}
      <RosterLegend />
    </>
  );
}
