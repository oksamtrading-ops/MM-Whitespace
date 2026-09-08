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
 *   - a POLITE LIVE REGION announces each decision and its consequence
 *   - the evidence panel is a labelled region referenced from the cell, NOT a
 *     tooltip: tooltips are unreachable by keyboard and must never gate a value
 *   - single unmodified letters are suppressed while focus sits in a text input
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { bulkAccept, decide, undo } from "./actions.ts";

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
};

const BAND_MARK: Record<string, string> = {
  low: "▁", medium: "▃", high: "▆", "very high": "█",
};

export default function Grid(props: Props) {
  const { rows, fieldKey, fieldLabel, periodId, threshold, isStageField } = props;
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const editorRef = useRef<HTMLInputElement | null>(null);
  const flagRef = useRef<HTMLInputElement | null>(null);

  const row = rows[index];
  const remaining = useMemo(() => rows.filter((r) => !r.decided).length, [rows]);

  useEffect(() => {
    if (!editing && !flagging) cellRefs.current[index]?.focus();
  }, [index, editing, flagging]);

  useEffect(() => { if (editing) editorRef.current?.select(); }, [editing]);
  useEffect(() => { if (flagging) flagRef.current?.focus(); }, [flagging]);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; message: string }>,
                                consequence?: string) => {
    setBusy(true);
    try {
      const result = await fn();
      // The announcement carries the decision AND its consequence -- this is how
      // a non-sighted Analyst receives the feedback a sighted one gets from the
      // row changing.
      announce(`${result.message} ${Math.max(0, remaining - 1)} remaining.` +
               (consequence ? ` ${consequence}` : ""));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [announce, remaining, router]);

  const submit = useCallback((decision: string, extra: Record<string, string> = {}) => {
    if (!row) return;
    const form = new FormData();
    form.set("periodId", periodId);
    form.set("companyId", row.companyId);
    form.set("fieldKey", fieldKey);
    form.set("decision", decision);
    if (row.findingId) form.set("findingId", row.findingId);
    if (row.findingAttempt !== null) form.set("findingAttempt", String(row.findingAttempt));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return run(() => decide(form), row.tierNote ?? undefined);
  }, [row, periodId, fieldKey, run]);

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
      event.preventDefault();
      const form = new FormData();
      form.set("periodId", periodId);
      form.set("fieldKey", fieldKey);
      void run(() => undo(form));
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      void onBulk();
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); break;
      case "ArrowUp":
        event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); break;
      case "Home":
        event.preventDefault(); setIndex(0); break;
      case "End":
        event.preventDefault(); setIndex(rows.length - 1); break;
      case " ":
        event.preventDefault(); setExpanded((v) => !v); break;
      case "a": case "A":
        event.preventDefault(); void submit("accept"); break;
      case "o": case "O":
        event.preventDefault(); setEditing(true); break;
      case "f": case "F":
        event.preventDefault(); setFlagging(true); break;
      case "e": case "E":
        if (row?.sourceUrl) window.open(row.sourceUrl, "_blank", "noopener,noreferrer");
        break;
      case "?":
        event.preventDefault(); setShowHelp((v) => !v); break;
      case "Escape":
        setShowHelp(false); break;
    }
  }, [busy, rows.length, row, submit, run, periodId, fieldKey]);

  async function onBulk() {
    let stageOptIn = "";
    if (isStageField) {
      // Stage determines tier and tier is the deliverable, so the opt-in is
      // typed rather than clicked.
      stageOptIn = window.prompt(
        "Stage determines the tier. Type STAGE to confirm bulk accept for this field.") ?? "";
      if (stageOptIn.trim().toUpperCase() !== "STAGE") {
        announce("Bulk accept cancelled.");
        return;
      }
    }
    const eligible = rows.filter((r) => !r.decided).length;
    // The confirmation is the ONLY path. There is no suppress-this-dialog option.
    const ok = window.confirm(
      `Accept ${fieldLabel} values at evidence ${threshold} or above, from the ` +
      `${eligible} undecided in this view? Values that are quarantined, conflicting, ` +
      `already overridden or without sources are excluded and stay for individual ` +
      `review. This is undoable.`);
    if (!ok) { announce("Bulk accept cancelled."); return; }

    const form = new FormData();
    form.set("periodId", periodId);
    form.set("fieldKey", fieldKey);
    form.set("bucket", props.bucket);
    form.set("threshold", String(threshold));
    form.set("stageOptIn", stageOptIn);
    await run(() => bulkAccept(form));
  }

  if (rows.length === 0) {
    return <div className="empty"><p>Nothing in this view.</p></div>;
  }

  return (
    <>
      {/* A polite live region: it announces each decision and its consequence. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
        {announcement}
      </div>

      <div className="gridtools">
        <button type="button" onClick={onBulk} disabled={busy}>
          Bulk accept above {threshold} <kbd>⇧A</kbd>
        </button>
        <button type="button" disabled={busy} onClick={() => {
          const form = new FormData();
          form.set("periodId", periodId); form.set("fieldKey", fieldKey);
          void run(() => undo(form));
        }}>Undo <kbd>⌘Z</kbd></button>
        <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
          Shortcuts <kbd>?</kbd>
        </button>
        <span className="count">{remaining} of {rows.length} undecided</span>
      </div>

      {showHelp && (
        <table className="help">
          <caption>Keyboard shortcuts</caption>
          <thead><tr><th>Key</th><th>Action</th></tr></thead>
          <tbody>
            {[["↓ ↑", "Move row; the evidence panel follows"],
              ["A", "Accept"], ["O", "Override"], ["F", "Flag (needs a reason)"],
              ["Space", "Expand or collapse evidence"], ["E", "Open the cited source"],
              ["⇧A", "Bulk accept the remainder in this column"],
              ["⌘Z / Ctrl+Z", "Undo the last decision"],
              ["Esc", "Editor → cell; cell → toolbar"]].map(([k, a]) => (
                <tr key={k}><td><kbd>{k}</kbd></td><td>{a}</td></tr>
              ))}
          </tbody>
        </table>
      )}

      <div
        role="grid"
        aria-label={`${fieldLabel} review`}
        aria-rowcount={rows.length + 1}
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

        {rows.map((r, i) => (
          <div
            key={r.companyId}
            role="row"
            /* Explicit, because virtualisation makes the DOM count lie. */
            aria-rowindex={i + 2}
            aria-selected={i === index}
            className={`grow${i === index ? " sel" : ""}${r.decided ? " done" : ""}`}
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
              className="val"
            >
              {r.value}
              {r.conflict && <span className="tag conflict"> conflict</span>}
            </div>
            {/* Evidence is never colour alone: numeral, band mark and band word. */}
            <span role="gridcell" aria-colindex={3} className="ev">
              <span aria-hidden="true" className={`mark b-${r.band.replace(" ", "-")}`}>
                {BAND_MARK[r.band]}
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
        <h3>Evidence</h3>
        {row?.conflict && (
          <div className="diff">
            <div>
              <b>Extract</b>
              <p>{row.extractValue ?? "(empty)"}</p>
              <span className="sub">source workbook</span>
            </div>
            <div>
              <b>AI proposal</b>
              <p>{row.value}</p>
              <span className="sub">{row.anchorMode} · {row.sourceCount} source(s)</span>
            </div>
          </div>
        )}
        {row?.excerpt
          ? <blockquote>{row.excerpt}</blockquote>
          : <p className="sub">No excerpt was recorded for this proposal.</p>}
        <p className="sub">
          anchor: {row?.anchorMode ?? "—"}
          {row?.sourceUrl && (
            <> · <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">
              open source ↗</a></>
          )}
        </p>
        {row?.tierNote && <p className="tiernote">{row.tierNote}</p>}
      </section>

      {editing && row && (
        <div className="editor">
          <label htmlFor="override-input">Override {fieldLabel} for {row.companyName}</label>
          <input id="override-input" ref={editorRef} defaultValue={row.value}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") {
                     e.preventDefault();
                     void submit("override", { overrideValue: e.currentTarget.value });
                     setEditing(false);
                   }
                 }} />
          <p className="sub">Enter commits · Esc restores focus to the cell</p>
        </div>
      )}

      {flagging && row && (
        <div className="editor">
          <label htmlFor="flag-input">Flag {row.companyName} — a reason is required</label>
          <input id="flag-input" ref={flagRef} placeholder="Why is this flagged?"
                 onKeyDown={(e) => {
                   if (e.key === "Enter") {
                     e.preventDefault();
                     const reason = e.currentTarget.value.trim();
                     if (!reason) { announce("A flag needs a reason."); return; }
                     void submit("flag", { reason });
                     setFlagging(false);
                   }
                 }} />
        </div>
      )}
    </>
  );
}
