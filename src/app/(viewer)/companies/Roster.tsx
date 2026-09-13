"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CompanyRow } from "../../../lib/profile/company.ts";
import { provinceCode, provinceName } from "../../../lib/publish/jurisdictions.ts";
import { formatMoney } from "../../../lib/format/fields.ts";

const TIER_WORD: Record<string, string> = {
  unclassified_no_stage_evidence: "No stage research",
  unclassified_no_property_evidence: "No property evidence",
  unclassified_conflicting: "Conflicting",
};

/* The stage a published tier implies. Derived from the tier rather than read
   from the live stage rows, so a Viewer never sees a stage that is not yet
   published; an unclassified company has no stage to show. */
const STAGE_OF_TIER: Record<number, string> = {
  1: "Production", 2: "Production", 3: "Production", 4: "Royalty / streaming", 5: "Development", 6: "Exploration",
};
const FOOTPRINT_WORD: Record<string, string> = {
  canada_only: "Canada only", abroad: "Abroad only", canada_and_abroad: "Canada and abroad", none: "None",
};

type Key = "name" | "ticker" | "exchange" | "tier" | "stage" | "footprint" | "market" | "auditor" | "marketCap";
type Sort = { key: Key; dir: 1 | -1 };

const COLUMNS: Array<{ key: Key; label: string; numeric?: boolean }> = [
  { key: "name", label: "Company" },
  { key: "ticker", label: "Ticker" },
  { key: "exchange", label: "Exchange" },
  { key: "tier", label: "Tier" },
  { key: "stage", label: "Stage" },
  { key: "footprint", label: "Footprint" },
  { key: "market", label: "Deloitte market" },
  { key: "auditor", label: "Auditor" },
  { key: "marketCap", label: "Market cap", numeric: true },
];

/**
 * Every company, full width, sorted on any column, found by name or ticker.
 * 259 rows, so everything is local; nothing pages. The first column and the
 * header stay put while the rest scrolls.
 */
export default function Roster({ rows, deloitteAudits, province = null }: {
  rows: CompanyRow[]; deloitteAudits: number; province?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [onlyWhitespace, setOnlyWhitespace] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const findRef = useRef<HTMLInputElement | null>(null);
  const prov = province ? provinceCode(province) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !inText) { e.preventDefault(); findRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!onlyWhitespace || r.auditor !== "Deloitte") &&
      (!prov || r.provinces.some((p) => provinceCode(p) === prov)) &&
      (!q || r.name.toLowerCase().includes(q) || (r.ticker ?? "").toLowerCase().includes(q)));
    const val = (r: CompanyRow): string | number | null => {
      switch (sort.key) {
        case "tier": return r.tier ?? 99;
        case "stage": return r.tier === null ? "" : STAGE_OF_TIER[r.tier];
        case "footprint": return FOOTPRINT_WORD[r.footprint] ?? r.footprint;
        case "marketCap": return r.marketCap ?? -1;
        default: return r[sort.key];
      }
    };
    return list.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "en-CA") * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, query, onlyWhitespace, prov, sort]);

  const toggle = (key: Key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));

  return (
    <>
      <div className="tools">
        <div className="find">
          <input ref={findRef} type="search" name="q" placeholder="Find a company or ticker…"
                 aria-label="Find a company or ticker" autoComplete="off" spellCheck={false}
                 value={query} onChange={(e) => setQuery(e.target.value)} />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </div>
        <button type="button" className="btn" aria-pressed={onlyWhitespace}
                onClick={() => setOnlyWhitespace((v) => !v)}>
          {onlyWhitespace ? "Showing whitespace only" : "Whitespace only"}
        </button>
        {prov && (
          <Link className="btn quiet" href="/companies" prefetch={false}>
            With a property in {provinceName(prov)} — clear
          </Link>
        )}
        <span className="spacer" />
        <span className="meta" role="status" aria-live="polite">
          <span className="fig-sm">{shown.length}</span> of <span className="fig-sm">{rows.length}</span>
          {" · Deloitte audits "}<span className="fig-sm">{deloitteAudits}</span>
        </span>
      </div>

      {shown.length === 0
        ? <p className="empty">No company matches{query ? ` “${query}”` : ""}{prov ? ` with a property in ${provinceName(prov)}` : ""}.</p>
        : (
          <div className="roster">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className={c.numeric ? "n" : undefined}
                        aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                      <button type="button" className="sort" onClick={() => toggle(c.key)}>
                        {c.label}
                        {sort.key === c.key && <span className="dir" aria-hidden="true">{sort.dir === 1 ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.companyId}>
                    <th scope="row">
                      <Link href={`/companies/${r.companyId}` as Route} prefetch={false}>{r.name}</Link>
                    </th>
                    <td className="fig-sm">{r.ticker ?? "—"}</td>
                    <td className="meta">{r.exchange ?? "—"}</td>
                    <td>
                      {r.tier === null
                        ? <span className="pill quiet">{TIER_WORD[r.status] ?? "Unclassified"}</span>
                        : <span className="fig-sm">Tier {r.tier}</span>}
                    </td>
                    <td>{r.tier === null ? <span className="meta">—</span> : STAGE_OF_TIER[r.tier]}</td>
                    <td>{FOOTPRINT_WORD[r.footprint] ?? r.footprint}</td>
                    <td>{r.market ?? <span className="meta">no Deloitte market</span>}</td>
                    <td>
                      {r.auditor === "Deloitte"
                        ? <span className="pill ok">Deloitte</span>
                        : r.auditor ?? <span className="meta">not known</span>}
                    </td>
                    <td className="n fig-sm">{r.marketCap === null ? "—" : formatMoney(r.marketCap, "CAD", { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
