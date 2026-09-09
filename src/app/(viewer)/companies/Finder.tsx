"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";

export type Row = {
  companyId: string; name: string; ticker: string | null; exchange: string | null;
  tier: number | null; status: string; auditor: string | null;
};

const TIER_WORD: Record<string, string> = {
  unclassified_no_stage_evidence: "No stage research",
  unclassified_no_property_evidence: "No property evidence",
  unclassified_conflicting: "Conflicting",
};

/** Find a company by name or ticker. 259 rows, so the filtering is local. */
export default function Finder({ rows, deloitteAudits }: { rows: Row[]; deloitteAudits: number }) {
  const [query, setQuery] = useState("");
  const [onlyWhitespace, setOnlyWhitespace] = useState(false);
  const findRef = useRef<HTMLInputElement | null>(null);

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
    return rows.filter((r) =>
      (!onlyWhitespace || r.auditor !== "Deloitte") &&
      (!q || r.name.toLowerCase().includes(q) || (r.ticker ?? "").toLowerCase().includes(q)));
  }, [rows, query, onlyWhitespace]);

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
        <span className="spacer" />
        <span className="meta" role="status" aria-live="polite">
          <span className="fig-sm">{shown.length}</span> of <span className="fig-sm">{rows.length}</span>
          {" · Deloitte audits "}<span className="fig-sm">{deloitteAudits}</span>
        </span>
      </div>

      {shown.length === 0
        ? <p className="empty">No company matches “{query}”.</p>
        : (
          <table>
            <thead>
              <tr><th>Company</th><th>Ticker</th><th>Tier</th><th>Auditor</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.companyId}>
                  <td>
                    <Link href={`/companies/${r.companyId}` as Route} prefetch={false}>{r.name}</Link>
                  </td>
                  <td className="meta">{r.ticker ?? "—"}{r.exchange ? ` · ${r.exchange}` : ""}</td>
                  <td>
                    {r.tier === null
                      ? <span className="pill quiet">{TIER_WORD[r.status] ?? "Unclassified"}</span>
                      : <span className="fig-sm">Tier {r.tier}</span>}
                  </td>
                  <td>
                    {r.auditor === "Deloitte"
                      ? <span className="pill ok">Deloitte</span>
                      : r.auditor ?? <span className="meta">not known</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}
