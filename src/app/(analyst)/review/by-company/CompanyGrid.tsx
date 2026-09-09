"use client";

/**
 * The same proposals, one company across the row.
 *
 * docs/design/08 keeps this for the pursuit-preparation journey, where the
 * unit of interest genuinely is one company. Field-major remains the default
 * for reviewing, because judging one field down a column reuses a single
 * mental model. Only the axis differs — the decisions are the same ones,
 * through the same hook.
 *
 * The cursor moves in two dimensions here, which is why ← and → exist on this
 * screen and nowhere else. It is still ONE TAB STOP with a roving index.
 */
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { useDecide } from "../useDecide.ts";
import ShortcutsDialog from "../[field]/ShortcutsDialog.tsx";

export type Cell = {
  fieldKey: string;
  value: string;
  band: string;
  strength: number | null;
  decided: boolean;
  decision: string | null;
  conflict: boolean;
  sourceCount: number;
  excerpt: string | null;
  sourceUrl: string | null;
  anchorMode: string;
  findingId: string | null;
  findingAttempt: number | null;
  extractValue: string | null;
  cellLabel: string;
  tierNote: string | null;
} | null;

export type Row = { companyId: string; companyName: string; cells: Cell[] };

type Props = {
  periodId: string;
  fields: Array<{ fieldKey: string; label: string }>;
  rows: Row[];
  initialQuery?: string;
};

const BAND_CELLS: Record<string, number> = { low: 1, medium: 2, high: 3, "very high": 4 };

type Patch = { companyId: string; column: number; decision: string };

export default function CompanyGrid({ periodId, fields, rows, initialQuery = "" }: Props) {
  const { busy, announcement, announce, record, keepExtract, undoLast } = useDecide(periodId);

  const [optRows, applyPatch] = useOptimistic(rows, (state: Row[], p: Patch) =>
    state.map((r) => r.companyId !== p.companyId ? r : {
      ...r,
      cells: r.cells.map((c, i) => i !== p.column || !c ? c : {
        ...c, decided: true, decision: p.decision,
        cellLabel: c.cellLabel.replace(/, [a-z]+$/, `, ${p.decision}`),
      }),
    }));

  const [query, setQuery] = useState(initialQuery);
  const [rowIndex, setRowIndex] = useState(0);
  const [column, setColumn] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const cellRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const editorRef = useRef<HTMLInputElement | null>(null);
  const flagRef = useRef<HTMLInputElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? optRows.filter((r) => r.companyName.toLowerCase().includes(q)) : optRows;
  }, [optRows, query]);

  const row = visible[Math.min(rowIndex, Math.max(0, visible.length - 1))];
  const cell = row?.cells[column] ?? null;
  const remaining = useMemo(
    () => optRows.reduce((n, r) => n + r.cells.filter((c) => c && !c.decided).length, 0),
    [optRows]);

  const key = (r: number, c: number) => `${r}:${c}`;
  useEffect(() => {
    if (!editing && !flagging && !showHelp) cellRefs.current.get(key(rowIndex, column))?.focus();
  }, [rowIndex, column, editing, flagging, showHelp]);
  useEffect(() => { if (editing) editorRef.current?.select(); }, [editing]);
  useEffect(() => { if (flagging) flagRef.current?.focus(); }, [flagging]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [query]);

  const target = useCallback(() => cell && row && ({
    companyId: row.companyId, fieldKey: cell.fieldKey,
    findingId: cell.findingId, findingAttempt: cell.findingAttempt,
  }), [cell, row]);

  const opts = useCallback(() => ({
    optimistic: () => row && applyPatch({ companyId: row.companyId, column, decision: "accept" }),
    consequence: cell?.tierNote,
    remainingAfter: Math.max(0, remaining - 1),
  }), [row, column, applyPatch, cell, remaining]);

  const submit = useCallback((decision: string, extra: Record<string, string> = {}) => {
    const t = target();
    if (!t || !row) return;
    record(t, decision, {
      ...opts(), extra,
      optimistic: () => applyPatch({ companyId: row.companyId, column, decision }),
    });
  }, [target, row, record, opts, applyPatch, column]);

  const keep = useCallback(() => {
    const t = target();
    if (!t || !row) return;
    keepExtract(t, {
      ...opts(),
      optimistic: () => applyPatch({ companyId: row.companyId, column, decision: "override" }),
    });
  }, [target, row, keepExtract, opts, applyPatch, column]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const focus = event.target as HTMLElement;
    // Single unmodified letters are suppressed while focus sits in a text input.
    const inText = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement;
    if (inText && !event.metaKey && !event.ctrlKey) {
      if (event.key === "Escape") { setEditing(false); setFlagging(false); }
      return;
    }
    if (busy) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (cell) undoLast(cell.fieldKey);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault(); setRowIndex((i) => Math.min(visible.length - 1, i + 1)); break;
      case "ArrowUp":
        event.preventDefault(); setRowIndex((i) => Math.max(0, i - 1)); break;
      // The second axis, and the reason these keys exist on this screen only.
      case "ArrowRight":
        event.preventDefault(); setColumn((c) => Math.min(fields.length - 1, c + 1)); break;
      case "ArrowLeft":
        event.preventDefault(); setColumn((c) => Math.max(0, c - 1)); break;
      case "Home":
        event.preventDefault(); setRowIndex(0); setColumn(0); break;
      case "End":
        event.preventDefault(); setRowIndex(visible.length - 1); break;
      case " ":
        event.preventDefault(); setExpanded((v) => !v); break;
      case "a": case "A":
        if (cell && !cell.decided) { event.preventDefault(); submit("accept"); }
        break;
      case "o": case "O":
        if (cell && !cell.decided) { event.preventDefault(); setEditing(true); }
        break;
      case "f": case "F":
        if (cell && !cell.decided) { event.preventDefault(); setFlagging(true); }
        break;
      case "k": case "K":
        if (cell?.conflict && !cell.decided) { event.preventDefault(); keep(); }
        break;
      case "e": case "E":
        if (cell?.sourceUrl) window.open(cell.sourceUrl, "_blank", "noopener,noreferrer");
        break;
      case "/":
        event.preventDefault(); findRef.current?.focus(); break;
      case "?":
        event.preventDefault(); setShowHelp((v) => !v); break;
      case "Escape":
        setShowHelp(false); break;
    }
  }, [busy, cell, visible.length, fields.length, submit, keep, undoLast]);

  if (rows.length === 0) {
    return <p className="empty rise"><b>Nothing to review.</b> No enrichment has run against this period.</p>;
  }

  return (
    <>
      <div className="tools rise">
        <div className="find">
          <input ref={findRef} type="search" name="q" placeholder="Find a company…"
                 aria-label="Find a company" autoComplete="off" spellCheck={false}
                 value={query}
                 onChange={(e) => { setQuery(e.target.value); setRowIndex(0); }}
                 onKeyDown={(e) => {
                   if (e.key === "Escape" || e.key === "Enter") {
                     e.preventDefault(); cellRefs.current.get(key(rowIndex, column))?.focus();
                   }
                 }} />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </div>
        <button type="button" className="btn" onClick={() => setShowHelp(true)} aria-expanded={showHelp}>
          Keys <kbd>?</kbd>
        </button>
        <span className="spacer" />
        <span className="statusline">
          <span aria-live="polite" aria-atomic="true" role="status">{announcement}</span>
          {!announcement && (
            <span className="meta"><span className="fig-sm">{remaining}</span> undecided</span>
          )}
        </span>
      </div>

      <div className="workbench rise">
        <div
          role="grid"
          aria-label="Companies against fields"
          aria-rowcount={visible.length + 1}
          aria-colcount={fields.length + 1}
          className="grid"
          onKeyDown={onKeyDown}
        >
          <div role="row" aria-rowindex={1} className="grow ghead"
               style={{ gridTemplateColumns: `minmax(200px, 2fr) repeat(${fields.length}, minmax(180px, 1fr))` }}>
            <span role="columnheader" aria-colindex={1}>Company</span>
            {fields.map((f, i) => (
              <span key={f.fieldKey} role="columnheader" aria-colindex={i + 2}>{f.label}</span>
            ))}
          </div>

          {visible.map((r, i) => (
            <div key={r.companyId} role="row" aria-rowindex={i + 2}
                 aria-selected={i === rowIndex}
                 className={`grow${i === rowIndex ? " sel" : ""}`}
                 style={{ gridTemplateColumns: `minmax(200px, 2fr) repeat(${fields.length}, minmax(180px, 1fr))` }}>
              <span role="rowheader" aria-colindex={1} className="co">{r.companyName}</span>
              {r.cells.map((c, j) => (
                <div
                  key={fields[j].fieldKey}
                  role="gridcell"
                  aria-colindex={j + 2}
                  ref={(el) => { cellRefs.current.set(key(i, j), el); }}
                  tabIndex={i === rowIndex && j === column ? 0 : -1}
                  aria-label={c ? c.cellLabel : `${fields[j].label}, nothing proposed`}
                  aria-describedby={i === rowIndex && j === column && expanded ? "evidence-panel" : undefined}
                  onFocus={() => { setRowIndex(i); setColumn(j); }}
                  onClick={() => { setRowIndex(i); setColumn(j); }}
                  className={`val cell${c?.decided ? " done" : ""}`}
                >
                  {c ? (
                    <>
                      <span className="v">{c.value}</span>
                      <span aria-hidden="true" className={`strip b-${c.band.replace(" ", "-")}`}>
                        {[1, 2, 3, 4].map((n) => (
                          <i key={n} className={n <= (BAND_CELLS[c.band] ?? 0) ? "on" : ""} />
                        ))}
                      </span>
                      {c.conflict && <span className="tag conflict">conflict</span>}
                      {c.decided && <span className="tag done">{c.decision}</span>}
                    </>
                  ) : <span className="meta">—</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <section id="evidence-panel" className="evidence"
                 aria-label={`Evidence for ${row?.companyName ?? ""}`} hidden={!expanded}>
          {cell && row && (
            <div className="body fadein" key={`${row.companyId}:${cell.fieldKey}`}>
              <p className="eyebrow">{fields[column].label}</p>
              <h3>{row.companyName}</h3>
              {cell.conflict && (
                <div className="diff">
                  <div>
                    <span className="k">Extract</span>
                    <p className="v">{cell.extractValue ?? "(empty)"}</p>
                    <span className="s">what the workbook says</span>
                  </div>
                  <div>
                    <span className="k">AI proposal</span>
                    <p className="v">{cell.value}</p>
                    <span className="s">{cell.sourceCount} source{cell.sourceCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              )}
              {cell.excerpt
                ? <blockquote>{cell.excerpt}</blockquote>
                : <p className="meta">No excerpt was recorded for this proposal.</p>}
              <p className="anchor">
                <span>{cell.anchorMode.replace(/_/g, " ")}</span>
                {cell.sourceUrl && (
                  <a href={cell.sourceUrl} target="_blank" rel="noopener noreferrer">open source ↗</a>
                )}
              </p>
              {cell.tierNote && <p className="tiernote">{cell.tierNote}</p>}

              {!cell.decided && (
                <div className="acts">
                  {cell.conflict ? (
                    <>
                      <button type="button" className="btn" disabled={busy} onClick={keep}>
                        Keep extract <kbd>K</kbd></button>
                      <button type="button" className="btn" disabled={busy} onClick={() => submit("accept")}>
                        Use AI <kbd>A</kbd></button>
                    </>
                  ) : (
                    <button type="button" className="btn primary" disabled={busy}
                            onClick={() => submit("accept")}>Accept <kbd>A</kbd></button>
                  )}
                  <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>
                    Override <kbd>O</kbd></button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setFlagging(true)}>
                    Flag <kbd>F</kbd></button>
                </div>
              )}

              {editing && (
                <div className="editor" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
                  <label htmlFor="override-input">Override {fields[column].label} for {row.companyName}</label>
                  <input id="override-input" name="overrideValue" autoComplete="off" ref={editorRef}
                         defaultValue={cell.value}
                         onKeyDown={(e) => {
                           if (e.key === "Enter") {
                             e.preventDefault();
                             submit("override", { overrideValue: e.currentTarget.value });
                             setEditing(false);
                           }
                         }} />
                  <p className="hint">Enter commits · Esc returns to the cell</p>
                </div>
              )}

              {flagging && (
                <div className="editor" onKeyDown={(e) => { if (e.key === "Escape") setFlagging(false); }}>
                  <label htmlFor="flag-input">Flag {row.companyName} — a reason is required</label>
                  <input id="flag-input" name="reason" autoComplete="off" ref={flagRef}
                         placeholder="Why is this flagged?"
                         onKeyDown={(e) => {
                           if (e.key === "Enter") {
                             e.preventDefault();
                             const reason = e.currentTarget.value.trim();
                             if (!reason) { announce("A flag needs a reason."); return; }
                             submit("flag", { reason });
                             setFlagging(false);
                           }
                         }} />
                  <p className="hint">Enter commits · Esc returns to the cell</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <ShortcutsDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
