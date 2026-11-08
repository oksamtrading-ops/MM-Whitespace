"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The dashboard's one piece of script: a tooltip for whatever figure the
 * pointer or the keyboard is on, and a province lit on the map together with
 * its row in the table.
 *
 * Everything it shows is already on the page: each figure is a link whose
 * name says what it counts, and the tooltip repeats that name in lines
 * (`data-tip`), so it is hidden from assistive technology. It never covers
 * what it describes, Escape dismisses it, and it follows the pointer rather
 * than catching it. Without script the page loses nothing but this.
 */
type Tip = { lines: string[]; x: number; y: number };

export default function Hover({ className, children }: { className: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const lit = useRef<string | null>(null);

  const light = (key: string | null) => {
    if (lit.current === key) return;
    const el = root.current;
    if (!el) return;
    for (const n of el.querySelectorAll(".db-hot")) n.classList.remove("db-hot");
    lit.current = key;
    if (key) for (const n of el.querySelectorAll(`[data-hl="${CSS.escape(key)}"]`)) n.classList.add("db-hot");
  };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const at = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement | SVGElement>("[data-tip]") : null);
    const row = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement | SVGElement>("[data-hl]")?.getAttribute("data-hl") ?? null : null);
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      light(row(e.target));
      const f = at(e.target);
      setTip(f ? { lines: (f.getAttribute("data-tip") ?? "").split("\n"), x: e.clientX, y: e.clientY } : null);
    };
    const leave = () => { light(null); setTip(null); };
    const focus = (e: FocusEvent) => {
      const f = at(e.target);
      light(row(e.target));
      if (!f || !(e.target as Element).matches?.(":focus-visible")) return setTip(null);
      const r = f.getBoundingClientRect();
      setTip({ lines: (f.getAttribute("data-tip") ?? "").split("\n"), x: r.right, y: r.bottom });
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(null); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", leave);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", leave, { passive: true });
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("focusout", leave);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", leave);
    };
  }, []);

  // Beside the pointer, turned back inside the window where it would leave it,
  // placed before it is painted.
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || !tip) return;
    const r = b.getBoundingClientRect();
    const w = document.documentElement.clientWidth, h = window.innerHeight;
    const x = tip.x + 14 + r.width > w - 8 ? Math.max(8, tip.x - 14 - r.width) : tip.x + 14;
    const y = tip.y + 14 + r.height > h - 8 ? Math.max(8, tip.y - 14 - r.height) : tip.y + 14;
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [tip]);

  return (
    <div className={className} ref={root}>
      {children}
      {tip && tip.lines[0] && (
        <div className="db-tip" ref={box} aria-hidden="true">
          <b>{tip.lines[0]}</b>
          {tip.lines.slice(1).filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}
          <em>Opens these companies in Companies</em>
        </div>
      )}
    </div>
  );
}
