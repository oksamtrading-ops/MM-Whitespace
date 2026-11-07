"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Atlas } from "../../../lib/publish/lens.ts";
import Globe, { CAMERAS } from "../../_ui/Globe.tsx";
import Icon from "../../_ui/Icon.tsx";
import { briefFrames, dayLabel } from "./words.ts";

/**
 * Brief me: the period in a fixed order of full-screen frames, for a partner
 * presenting from a laptop. The same published numbers as the page,
 * unfiltered, each frame a sentence and, where it has one, the globe turned
 * to show it, with the basis printed on every frame so a photograph of the
 * screen still says what it is. A frame without a map is its table.
 *
 * Keys: → or Page Down for the next frame, ← or Page Up for the last, Home
 * and End for the first and the final one, B for a black screen, T for the
 * frame's numbers as a table, Esc to leave.
 */
export default function Brief({ atlas, periodTitle, onClose }: { atlas: Atlas; periodTitle: string; onClose: () => void }) {
  const frames = useMemo(() => briefFrames(atlas, periodTitle), [atlas, periodTitle]);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [i, setI] = useState(0);
  const [black, setBlack] = useState(false);
  const [twin, setTwin] = useState(false);
  // The dialog itself takes focus, so the arrow keys move the brief and a
  // button does not swallow the first press of Space.
  useEffect(() => { const d = dialog.current; d?.showModal(); d?.focus(); }, []);
  // B hides everything on the screen, the control the reader last used with
  // it, and focus would fall to the page, outside the dialog: it goes to the
  // dialog instead.
  useLayoutEffect(() => {
    const d = dialog.current, a = document.activeElement;
    if (!d?.open || a === d) return;
    if (!(a instanceof HTMLElement) || !d.contains(a) || a.closest(".brief-in.black")) d.focus();
  }, [i, black, twin]);
  // On a phone a frame can be taller than the screen, and the brief scrolls:
  // each frame opens at its top, not where the last one was left.
  // On a laptop the words scroll instead, and on a phone a wide table scrolls
  // sideways: every scroller goes back to its start.
  useLayoutEffect(() => {
    inner.current?.scrollTo(0, 0);
    inner.current?.querySelectorAll(".brief-text, .brief-scroll").forEach((e) => e.scrollTo(0, 0));
  }, [i]);

  const f = frames[i];
  // A table with a figure per column gets its heads; a frame of one figure a row reads without them.
  const headed = f.head.length > 2;
  const basis = `${periodTitle} · revision ${atlas.publication.revision} · as of ${dayLabel(atlas.period.asOf)} · internal use`;

  // Every move lifts a black screen, and none goes past either end.
  const clamp = (n: number) => Math.max(0, Math.min(frames.length - 1, n));
  const go = (d: number) => { setBlack(false); setI((x) => clamp(x + d)); };
  const to = (n: number) => { setBlack(false); setI(clamp(n)); };

  // The keys are heard at the document, wherever focus is while the brief is
  // open. Tab does nothing on a black screen, which has nothing to reach, and
  // nor does Option-Tab; Ctrl-Tab and Cmd-Tab, like every other chord, belong
  // to the browser. Space and Enter on a button press it; the end buttons
  // stay pressable, marked unavailable, so a key pressed on one never moves
  // the other way.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const k = e.key;
    if (k === "Tab" && !e.metaKey && !e.ctrlKey) { if (black) e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((k === " " || k === "Enter") && e.target instanceof Element && e.target.closest("button")) return;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); go(1); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); go(-1); }
    else if (k === "Home") { e.preventDefault(); to(0); }
    else if (k === "End") { e.preventDefault(); to(frames.length - 1); }
    else if (k === "b" || k === "B" || k === ".") { e.preventDefault(); setBlack((v) => !v); }
    else if (k === "t" || k === "T") { e.preventDefault(); setTwin((v) => !v); }
  };
  useEffect(() => {
    const listen = (e: KeyboardEvent) => onKey.current(e);
    document.addEventListener("keydown", listen);
    return () => document.removeEventListener("keydown", listen);
  }, []);

  return (
    <dialog ref={dialog} className="brief" aria-label={`Brief: ${periodTitle}`} tabIndex={-1} onClose={onClose}>
      <div ref={inner} className={`brief-in${black ? " black" : ""}${twin ? " twin" : ""}${f.map ? "" : " nomap"}${f.head.length > 3 ? " wide" : ""}`}>
        {!twin && f.map && (
          <div className="brief-globe">
            <Globe steps={f.map.steps} selected={null} discs={[]} discMax={1}
                   arcs={[]} labels={[]} camera={CAMERAS[f.map.camera]} onSelect={() => {}} title={`Globe: ${f.title}`} interactive={false} />
          </div>
        )}
        <div className="brief-text">
          {/* Only the words are announced on a move; the table is there to browse, not read out whole. */}
          <div aria-live="polite">
            <p className="k"><span className="no">{String(i + 1).padStart(2, "0")}</span> / {frames.length} · {f.kicker}</p>
            <h2>{f.title}</h2>
            <p className="body">{f.body}</p>
          </div>
          {/* A table wider than its column scrolls in place, so the brief never scrolls sideways. */}
          <div className="brief-scroll">
            <table className={`brief-rows${twin ? " big" : ""}${headed ? " headed" : ""}`}>
              <caption className="sr-only">{f.title}</caption>
              {headed && (
                <thead>
                  <tr>{f.head.map((h, j) => <th key={h || j} scope="col">{h}</th>)}</tr>
                </thead>
              )}
              <tbody>
                {f.rows.map((r) => (
                  <tr key={r.label} className={r.ours ? "ours" : undefined}>
                    <th scope="row">{r.label}</th>
                    {r.cells.map((v, j) => <td key={j}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="brief-foot">
          <span className="basis">{basis}</span>
          <span className="dots" aria-hidden="true">
            {frames.map((x, j) => <span key={x.id} className={j === i ? "on" : undefined} />)}
          </span>
          <span className="keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> move · <kbd>B</kbd> black · <kbd>T</kbd> table · <kbd>Esc</kbd> leave</span>
          <button type="button" className="btn quiet sm icon-only" onClick={() => go(-1)} aria-disabled={i === 0} aria-label="Previous frame"><Icon name="arrow-left" size={14} /></button>
          <button type="button" className="btn quiet sm icon-only" onClick={() => go(1)} aria-disabled={i === frames.length - 1} aria-label="Next frame"><Icon name="arrow-right" size={14} /></button>
          <button type="button" className="btn quiet sm icon-only" onClick={() => dialog.current?.close()} aria-label="Leave the brief"><Icon name="x" size={14} /></button>
        </footer>
      </div>
    </dialog>
  );
}
