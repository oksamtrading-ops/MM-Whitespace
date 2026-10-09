"use client";

import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon.tsx";

export type PickerOption = { value: string; label: string; count?: number };
export type PickerGroup = { label: string; options: PickerOption[] };

/** Above this many options the list gets a box to narrow it: the property list runs to eighty. */
const FINDABLE = 12;

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
 * rows it is narrowing.
 */
export default function MultiSelect({ name, label, groups, selected, onChange, align = "start" }: {
  name: string;
  label: string;
  groups: PickerGroup[];
  selected: string[];
  onChange?: (next: string[]) => void;
  align?: "start" | "end";
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
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
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

  return (
    <details ref={ref} className={`picker${selected.length ? " picker-set" : ""}`}
             onKeyDown={(e) => {
               if (e.key === "Escape" && ref.current?.open) {
                 ref.current.open = false;
                 ref.current.querySelector("summary")?.focus();
               }
             }}>
      <summary className="picker-sum" aria-label={`${label}: ${summary}`}>
        <span className="picker-k">{label}</span>
        <span className="picker-v">{summary}</span>
        <Icon name="chevron-down" size={13} />
      </summary>
      <div className={`picker-pop${align === "end" ? " picker-end" : ""}`} role="group" aria-labelledby={`${id}-l`}>
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
