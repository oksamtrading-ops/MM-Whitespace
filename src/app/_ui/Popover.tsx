"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import Icon from "./Icon.tsx";

/** The room an open list keeps from the window's edge; .picker-pop's max-width keeps the same. */
const EDGE = 8;

/**
 * Hang an open list under its button and inside the window: from the button's
 * left edge, running right; where the window ends first, from its right edge,
 * running left; and where neither side has room, as on a phone, against the
 * window's right edge, still under the button. The filters wrap, so which one
 * ends a line depends on the width, and only the open one can see where it is.
 *
 * It moves by `left`, which lays the page out again, and not by a transform,
 * which does not: a phone sizes the page from its layout, and would keep the
 * width the list reached before it moved. Its width is held, or the room it
 * gains by moving left would let it grow.
 */
export function place(el: HTMLDetailsElement) {
  const pop = el.querySelector<HTMLElement>(":scope > .picker-pop");
  if (!el.open || !pop) return;
  pop.style.left = pop.style.width = "";
  const b = el.querySelector(":scope > summary")!.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const end = document.documentElement.clientWidth - EDGE;
  const x = b.left + p.width <= end ? b.left
    : b.right - p.width >= EDGE ? b.right - p.width
    : Math.max(EDGE, end - p.width);
  pop.style.width = `${p.width}px`;
  pop.style.left = `${x - p.left}px`;
}

/**
 * Open a popover now, placed before its first frame. `focus` moves the
 * keyboard into it, for an opening that did not come from its own button
 * (the "More filters" menu), so Escape still finds it.
 */
export function openPopover(el: HTMLDetailsElement | null, opts: { focus?: boolean } = {}) {
  if (!el) return;
  if (!el.open) {
    el.open = true;
    place(el);
  }
  if (opts.focus) {
    el.querySelector<HTMLElement>(":scope > .picker-pop :is(input, button)")?.focus({ preventScroll: true });
  }
}

/**
 * The filter bar's one pop-up: a button that says what it is set to, and a
 * panel under it. MultiSelect is one; the companies table's text and range
 * filters are others, so they all open, place and close alike.
 *
 * Built on <details>, so it is keyboard-operable with no script of its own.
 * Escape and a click outside close it, because a filter left open covers the
 * rows it is narrowing. It opens toward whichever side has room, so an open
 * panel never widens the page.
 */
export default function Popover({ label, summary, set, autoOpen = false, dataKey, children }: {
  /** What the control is: "Tier", "Audit fees". */
  label: string;
  /** What it is set to: "Any", "Tier 2", "3 selected". None for a menu ("More filters"). */
  summary?: string;
  /** Whether it is narrowing anything, which the button shows. */
  set: boolean;
  /** Open on first render: a filter just added from "More filters". */
  autoOpen?: boolean;
  /** Lets "More filters" find a picker already in the bar and open it. */
  dataKey?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const away = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const fit = () => place(el);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", fit);
    if (autoOpen) openPopover(el, { focus: true });
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", fit);
    };
    // autoOpen is read once, on mount: it is what a just-added filter does first.
  }, []);

  // A choice rewrites the button, and a wider button can wrap to the next
  // line: the open panel follows it there before the frame is drawn.
  useLayoutEffect(() => { if (ref.current) place(ref.current); }, [summary]);

  return (
    <details ref={ref} className={`picker${set ? " picker-set" : ""}`} data-key={dataKey}
             onToggle={(e) => place(e.currentTarget)}
             onKeyDown={(e) => {
               if (e.key === "Escape" && ref.current?.open) {
                 e.stopPropagation();
                 ref.current.open = false;
                 ref.current.querySelector("summary")?.focus();
               }
             }}>
      {/* A press opens it here, not by default, so the panel is placed before
          its first frame; the toggle event comes a frame late, and places it
          however else it opens. */}
      <summary className="picker-sum" aria-label={summary === undefined ? label : `${label}: ${summary}`}
               onClick={(e) => {
                 const el = ref.current;
                 if (!el || el.open) return;
                 e.preventDefault();
                 openPopover(el);
               }}>
        <span className="picker-k">{label}</span>
        {summary !== undefined && <span className="picker-v">{summary}</span>}
        <Icon name="chevron-down" size={13} />
      </summary>
      <div className="picker-pop" role="group" aria-labelledby={`${id}-l`}>
        <p className="picker-head" id={`${id}-l`}>{label}</p>
        {children}
      </div>
    </details>
  );
}
