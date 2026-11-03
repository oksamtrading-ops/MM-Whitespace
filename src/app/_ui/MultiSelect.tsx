"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.tsx";

export type PickerOption = { value: string; label: string; count?: number };
export type PickerGroup = { label: string; options: PickerOption[] };

/** Above this many options the list gets a box to narrow it: the property list runs to eighty. */
const FINDABLE = 12;

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
function place(el: HTMLDetailsElement) {
  const pop = el.querySelector<HTMLElement>(".picker-pop");
  if (!el.open || !pop) return;
  pop.style.left = pop.style.width = "";
  const b = el.querySelector("summary")!.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const end = document.documentElement.clientWidth - EDGE;
  const x = b.left + p.width <= end ? b.left
    : b.right - p.width >= EDGE ? b.right - p.width
    : Math.max(EDGE, end - p.width);
  pop.style.width = `${p.width}px`;
  pop.style.left = `${x - p.left}px`;
}

/**
 * Choose any number of values from a list, grouped, with how many rows hold each.
 *
 * Built on <details> and real checkboxes named `name`, so it is keyboard- and
 * screen-reader-operable with no script of its own, and in a plain GET form it
 * submits exactly the repeated parameters the companies table reads
 * (?tier=1&tier=2). With `onChange` it is controlled, and the table narrows as
 * each box is ticked; without, it is an ordinary form control.
 *
 * Escape and a click outside close it, because a filter left open covers the
 * rows it is narrowing. It opens toward whichever side has room, so an open
 * list never widens the page.
 */
export default function MultiSelect({ name, label, groups, selected, onChange }: {
  name: string;
  label: string;
  groups: PickerGroup[];
  selected: string[];
  onChange?: (next: string[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const [find, setFind] = useState("");
  const id = useId();
  const options = groups.flatMap((g) => g.options);
  const chosen = new Set(selected);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const away = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const fit = () => place(el);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", fit);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", fit);
    };
  }, []);

  const toggle = (value: string, on: boolean) => {
    if (!onChange) return;
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    onChange(options.map((o) => o.value).filter((v) => next.includes(v)));
  };

  const summary = selected.length === 0
    ? "Any"
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`;
  const needle = find.trim().toLowerCase();

  // A choice rewrites the button, and a wider button can wrap to the next
  // line: the open list follows it there before the frame is drawn.
  useLayoutEffect(() => { if (ref.current) place(ref.current); }, [summary]);

  return (
    <details ref={ref} className={`picker${selected.length ? " picker-set" : ""}`}
             onToggle={(e) => place(e.currentTarget)}
             onKeyDown={(e) => {
               if (e.key === "Escape" && ref.current?.open) {
                 ref.current.open = false;
                 ref.current.querySelector("summary")?.focus();
               }
             }}>
      {/* A press opens it here, not by default, so the list is placed before
          its first frame; the toggle event comes a frame late, and places it
          however else it opens. */}
      <summary className="picker-sum" aria-label={`${label}: ${summary}`}
               onClick={(e) => {
                 const el = ref.current;
                 if (!el || el.open) return;
                 e.preventDefault();
                 el.open = true;
                 place(el);
               }}>
        <span className="picker-k">{label}</span>
        <span className="picker-v">{summary}</span>
        <Icon name="chevron-down" size={13} />
      </summary>
      <div className="picker-pop" role="group" aria-labelledby={`${id}-l`}>
        <p className="picker-head" id={`${id}-l`}>{label}</p>
        {options.length > FINDABLE && (
          <input className="picker-find" type="search" placeholder="Narrow this list…"
                 aria-label={`Find in ${label}`} value={find} onChange={(e) => setFind(e.target.value)} />
        )}
        <div className="picker-list">
          {groups.map((g) => {
            const shown = g.options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
            if (shown.length === 0) return null;
            return (
              <fieldset key={g.label}>
                {groups.length > 1 && <legend>{g.label}</legend>}
                {shown.map((o) => (
                  <label key={o.value}>
                    <input type="checkbox" name={name} value={o.value}
                           {...(onChange
                             ? { checked: chosen.has(o.value), onChange: (e) => toggle(o.value, e.target.checked) }
                             : { defaultChecked: chosen.has(o.value) })} />
                    <span>{o.label}</span>
                    {o.count !== undefined && <span className="picker-n">{o.count}</span>}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        {onChange && selected.length > 0 && (
          <button type="button" className="btn sm quiet picker-clear" onClick={() => onChange([])}>
            Clear {label.toLowerCase()}
          </button>
        )}
      </div>
    </details>
  );
}
