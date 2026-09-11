"use client";

/**
 * The review grid.
 *
 * ONE TAB STOP WITH A ROVING INDEX -- never 2,590 tab stops, which would trap
 * keyboard users. Every accessibility obligation in docs/design/08 is load
 * bearing here, because this is the screen where a WCAG 2.1 AA claim will
 * actually fail:
 *
 *   - evidence is never colour alone: four ordinal bands, the numeric value in
 *     the cell, and the band label in the accessible name
 *   - the company cell is the ROW HEADER, so every announcement is anchored to
 *     a company
 *   - each cell's accessible name carries value, evidence band and review state
 *   - a POLITE LIVE REGION announces each decision and its consequence, and the
 *     same text is visible in the toolbar so a sighted Analyst gets it too
 *   - the evidence panel is a labelled region referenced from the cell, NOT a
 *     tooltip: tooltips are unreachable by keyboard and must never gate a value
 *   - single unmodified letters are suppressed while focus sits in a text input
 */
import {
  useCallback, useEffect, useMemo, useOptimistic, useRef, useState,
  type ReactNode,
} from "react";
import { bulkAccept, confirmationText } from "./actions.ts";
import { useDecide } from "../useDecide.ts";
import BulkDialog from "./BulkDialog.tsx";
import ShortcutsDialog from "./ShortcutsDialog.tsx";

export type GridRow = {
  companyId: string;
  companyName: string;
  value: string;
  band: string;
  strength: number | null;
  state: string;
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
};

type Props = {
  periodId: string;
  fieldKey: string;
  fieldLabel: string;
  bucket: string;
  threshold: number;
  isStageField: boolean;
  rows: GridRow[];
  initialQuery?: string;
};

const BAND_CELLS: Record<string, number> = { low: 1, medium: 2, high: 3, "very high": 4 };

const ANCHOR_WORD: Record<string, string> = {
  exact_normalized: "exact match in the source",
  proximity: "found near its label",
  label_only: "label found, value not anchored",
  none: "not anchored",
};

type Patch = { companyId: string; decision: string };

export default function Grid(props: Props) {
  const { rows, fieldKey, fieldLabel, periodId, threshold, isStageField } = props;
  const { busy, announcement, announce, record, keepExtract: keep, undoLast, run } =
    useDecide(periodId);

  // Decisions land on screen at the keypress; the server's rows replace them
  // when the refresh completes.
  const [optRows, applyPatch] = useOptimistic(rows, (state: GridRow[], patch: Patch) =>
    state.map((r) => r.companyId === patch.companyId
      ? { ...r, decided: true, decision: patch.decision,
          cellLabel: r.cellLabel.replace(/, [a-z]+$/, `, ${patch.decision}`) }
      : r));

  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [bulk, setBulk] = useState<{ open: boolean; text: string | null }>({ open: false, text: null });
  const submitRef = useRef<((d: string, extra?: Record<string, string>) => void) | null>(null);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const editorRef = useRef<HTMLInputElement | null>(null);
  const flagRef = useRef<HTMLInputElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? optRows.filter((r) => r.companyName.toLowerCase().includes(q)) : optRows;
  }, [optRows, query]);
  const row = visible[Math.min(index, Math.max(0, visible.length - 1))];
  const remaining = useMemo(() => optRows.filter((r) => !r.decided).length, [optRows]);

  useEffect(() => {
    if (!editing && !flagging && !bulk.open && !showHelp) cellRefs.current[index]?.focus();
  }, [index, editing, flagging, bulk.open, showHelp]);
  useEffect(() => { if (editing) editorRef.current?.select(); }, [editing]);
  useEffect(() => { if (flagging) flagRef.current?.focus(); }, [flagging]);

  // The find text lives in the URL so a view can be handed to a colleague.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [query]);

  const advance = useCallback(() => {
    // Move on to the next undecided row, if there is one below.
    const next = visible.findIndex((r, i) => i > index && !r.decided);
    if (next >= 0) setIndex(next);
  }, [visible, index]);

  const target = useCallback(() => row && ({
    companyId: row.companyId, fieldKey,
    findingId: row.findingId, findingAttempt: row.findingAttempt,
  }), [row, fieldKey]);

  const submit = useCallback((decision: string, extra: Record<string, string> = {}) => {
    const t = target();
    if (!t || !row) return;
    record(t, decision, {
      extra,
      optimistic: () => applyPatch({ companyId: row.companyId, decision }),
      consequence: row.tierNote,
      remainingAfter: Math.max(0, remaining - 1),
    });
    advance();
  }, [target, row, record, applyPatch, remaining, advance]);
  submitRef.current = submit;

  const keepExtract = useCallback(() => {
    const t = target();
    if (!t || !row) return;
    keep(t, {
      optimistic: () => applyPatch({ companyId: row.companyId, decision: "override" }),
      consequence: row.tierNote,
      remainingAfter: Math.max(0, remaining - 1),
    });
    advance();
  }, [target, row, keep, applyPatch, remaining, advance]);

  const doUndo = useCallback(() => undoLast(fieldKey), [undoLast, fieldKey]);

  const openBulk = useCallback(async () => {
    setBulk({ open: true, text: null });
    const text = await confirmationText(periodId, fieldKey, fieldLabel, props.bucket, threshold);
    setBulk({ open: true, text });
  }, [periodId, fieldKey, fieldLabel, props.bucket, threshold]);

  const confirmBulk = useCallback((stageOptIn: string) => {
    setBulk({ open: false, text: null });
    const form = new FormData();
    form.set("periodId", periodId);
    form.set("fieldKey", fieldKey);
    form.set("bucket", props.bucket);
    form.set("threshold", String(threshold));
    form.set("stageOptIn", stageOptIn);
    run(() => bulkAccept(form));
  }, [periodId, fieldKey, props.bucket, threshold, run]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // Single unmodified letters are suppressed whenever focus sits in a text
    // input, or an Analyst typing an override fires three actions mid-word.
    const inText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (inText && !event.metaKey && !event.ctrlKey) {
      if (event.key === "Escape") { setEditing(false); setFlagging(false); }
      return;
    }
    if (busy) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); doUndo(); return;
    }
    if (event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault(); void openBulk(); return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault(); setIndex((i) => Math.min(visible.length - 1, i + 1)); break;
      case "ArrowUp":
        event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); break;
      case "Home":
        event.preventDefault(); setIndex(0); break;
      case "End":
        event.preventDefault(); setIndex(visible.length - 1); break;
      case " ":
        event.preventDefault(); setExpanded((v) => !v); break;
      case "a": case "A":
        event.preventDefault(); submit("accept"); break;
      case "o": case "O":
        event.preventDefault(); setEditing(true); break;
      case "f": case "F":
        event.preventDefault(); setFlagging(true); break;
      case "k": case "K":
        // Only meaningful where there are two values to choose between.
        if (row?.conflict && !row.decided) { event.preventDefault(); keepExtract(); }
        break;
      case "e": case "E":
        if (row?.sourceUrl) window.open(row.sourceUrl, "_blank", "noopener,noreferrer");
        break;
      case "/":
        event.preventDefault(); findRef.current?.focus(); break;
      case "?":
        event.preventDefault(); setShowHelp((v) => !v); break;
      case "Escape":
        setShowHelp(false); break;
    }
  }, [busy, visible.length, row, submit, doUndo, openBulk, keepExtract]);

  if (rows.length === 0) {
    return (
      <p className="empty rise">
        <b>Nothing in this view.</b> Choose another filter above, or go back to the review board.
      </p>
    );
  }

  return (
    <>
      <div className="tools rise" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="find">
          <input ref={findRef} type="search" name="q" placeholder="Find a company…" aria-label="Find a company"
                 value={query} autoComplete="off" spellCheck={false}
                 onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
                 onKeyDown={(e) => {
                   if (e.key === "Escape" || e.key === "Enter") {
                     e.preventDefault(); cellRefs.current[index]?.focus();
                   }
                 }} />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </div>
        <button type="button" className="btn" onClick={() => void openBulk()} disabled={busy}>
          Accept ≥ {threshold.toFixed(2)} in bulk <kbd>⇧A</kbd>
        </button>
        <button type="button" className="btn" disabled={busy} onClick={doUndo}>
          Undo <kbd>⌘Z</kbd>
        </button>
        <button type="button" className="btn" onClick={() => setShowHelp(true)} aria-expanded={showHelp}>
          Keys <kbd>?</kbd>
        </button>
        <span className="spacer" />
        <span className="statusline">
          {/* A polite live region: it announces each decision and its consequence. */}
          <span aria-live="polite" aria-atomic="true" role="status">{announcement}</span>
          {!announcement && (
            <span className="meta"><span className="fig-sm">{remaining}</span> of <span className="fig-sm">{rows.length}</span> undecided</span>
          )}
        </span>
      </div>

      <div className="workbench rise" style={{ "--i": 3 } as React.CSSProperties}>
        <div
          role="grid"
          aria-label={`${fieldLabel} review`}
          aria-rowcount={visible.length + 1}
          aria-colcount={4}
          className="grid"
          onKeyDown={onKeyDown}
        >
          <div role="row" aria-rowindex={1} className="grow ghead">
            <span role="columnheader" aria-colindex={1}>Company</span>
            <span role="columnheader" aria-colindex={2}>Proposed</span>
            <span role="columnheader" aria-colindex={3}>Evidence</span>
            <span role="columnheader" aria-colindex={4}>State</span>
          </div>

          {visible.length === 0 && (
            <div className="grow"><span className="meta">No company matches “{query}”.</span></div>
          )}

          {visible.map((r, i) => (
            <div
              key={r.companyId}
              role="row"
              /* Explicit, because virtualisation makes the DOM count lie. */
              aria-rowindex={i + 2}
              aria-selected={i === index}
              className={`grow${i === index ? " sel" : ""}${r.decided ? " done" : ""}`}
              /* A click anywhere on the row selects it -- the company name is
                 where a mouse goes first. Keyboard focus still lands on the
                 value cell, so the roving index is unchanged. */
              onClick={() => setIndex(i)}
            >
              {/* The company cell is the ROW HEADER, so every announcement is
                  anchored to a company. */}
              <span role="rowheader" aria-colindex={1} className="co">{r.companyName}</span>
              <div
                role="gridcell"
                aria-colindex={2}
                ref={(el) => { cellRefs.current[i] = el; }}
                /* One tab stop with a roving index. */
                tabIndex={i === index ? 0 : -1}
                aria-label={r.cellLabel}
                aria-describedby={i === index && expanded ? "evidence-panel" : undefined}
                onFocus={() => setIndex(i)}
                onClick={() => setIndex(i)}
                className="val"
              >
                {r.value}
                {r.conflict && <span className="tag conflict">conflict</span>}
              </div>
              {/* Evidence is never colour alone: strip, numeral and band word. */}
              <span role="gridcell" aria-colindex={3} className="ev">
                <span aria-hidden="true" className={`strip b-${r.band.replace(" ", "-")}`}>
                  {[1, 2, 3, 4].map((c) => <i key={c} className={c <= (BAND_CELLS[r.band] ?? 0) ? "on" : ""} />)}
                </span>
                <span className="num">{r.strength === null ? "—" : r.strength.toFixed(2)}</span>
                <span className="bandword">{r.band}</span>
              </span>
              <span role="gridcell" aria-colindex={4} className="st">
                {r.decided
                  ? <span className="tag done">{r.decision}</span>
                  : r.sourceCount === 0
                    ? <span className="tag warn">no sources</span>
                    : r.anchorMode === "label_only" || r.anchorMode === "none"
                      ? <span className="tag warn">not anchored</span>
                      : <span className="tag ok">{r.sourceCount} source{r.sourceCount === 1 ? "" : "s"}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* A labelled REGION referenced from the focused cell -- not a tooltip.
            Tooltips are unreachable by keyboard and must never gate a value. */}
        <section
          id="evidence-panel"
          aria-label={`Evidence for ${row?.companyName ?? ""}`}
          className="evidence"
          hidden={!expanded}
        >
          {row && (
            <div className="body fadein" key={row.companyId}>
              <p className="eyebrow">Evidence</p>
              <h3>{row.companyName}</h3>
              {row.conflict && (
                <div className="diff">
                  <div>
                    <span className="k">Extract</span>
                    <p className="v">{row.extractValue ?? "(empty)"}</p>
                    <span className="s">what the workbook says</span>
                  </div>
                  <div>
                    <span className="k">AI proposal</span>
                    <p className="v">{row.value}</p>
                    <span className="s">{row.sourceCount} source{row.sourceCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              )}
              {row.excerpt
                ? <blockquote>{highlight(row.excerpt, row.value)}</blockquote>
                : <p className="meta">No excerpt was recorded for this proposal.</p>}
              <p className="anchor">
                <span>{ANCHOR_WORD[row.anchorMode] ?? row.anchorMode}</span>
                {row.sourceUrl && (
                  <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">open source ↗</a>
                )}
              </p>
              {row.tierNote && <p className="tiernote">{row.tierNote}</p>}

              {!row.decided && (
                /* On a conflict the choice is between two named values, so the
                   controls name them. No default is pre-selected and nothing
                   resolves it by timing out. */
                <div className="acts">
                  {row.conflict ? (
                    <>
                      <button type="button" className="btn" disabled={busy}
                              onClick={keepExtract}>Keep extract <kbd>K</kbd></button>
                      <button type="button" className="btn" disabled={busy}
                              onClick={() => submit("accept")}>Use AI <kbd>A</kbd></button>
                      <button type="button" className="btn" disabled={busy}
                              onClick={() => setEditing(true)}>Enter my own <kbd>O</kbd></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn primary" disabled={busy}
                              onClick={() => submit("accept")}>Accept <kbd>A</kbd></button>
                      <button type="button" className="btn" disabled={busy}
                              onClick={() => setEditing(true)}>Override <kbd>O</kbd></button>
                    </>
                  )}
                  <button type="button" className="btn" disabled={busy}
                          onClick={() => setFlagging(true)}>Flag <kbd>F</kbd></button>
                </div>
              )}

              {editing && (
                <div className="editor" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
                  <label htmlFor="override-input">Override {fieldLabel} for {row.companyName}</label>
                  <input id="override-input" name="overrideValue" autoComplete="off" ref={editorRef} defaultValue={row.value}
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
                  <input id="flag-input" name="reason" autoComplete="off" ref={flagRef} placeholder="Why is this flagged?"
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

      <BulkDialog open={bulk.open} text={bulk.text} needsStage={isStageField}
                  onConfirm={confirmBulk}
                  onCancel={() => { setBulk({ open: false, text: null }); announce("Bulk accept cancelled."); }} />
      <ShortcutsDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}

/** Mark the proposed value inside its excerpt. Never invents a match. */
function highlight(excerpt: string, value: string): ReactNode {
  const needle = value.trim();
  if (needle.length < 2 || needle === "abstained" || needle === "no value") return excerpt;
  const at = excerpt.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return excerpt;
  return (
    <>
      {excerpt.slice(0, at)}
      <mark>{excerpt.slice(at, at + needle.length)}</mark>
      {excerpt.slice(at + needle.length)}
    </>
  );
}
