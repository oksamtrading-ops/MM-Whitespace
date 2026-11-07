"use client";

import { useState } from "react";
import Popover from "./Popover.tsx";

export type PickerOption = { value: string; label: string; count?: number };
export type PickerGroup = { label: string; options: PickerOption[] };

/** Above this many options the list gets a box to narrow it: the property list runs to eighty. */
const FINDABLE = 12;

/**
 * Choose any number of values from a list, grouped, with how many rows hold each.
 *
 * Built on <details> (Popover) and real checkboxes named `name`, so it is
 * keyboard- and screen-reader-operable with no script of its own, and in a
 * plain GET form it submits exactly the repeated parameters the companies
 * table reads (?tier=1&tier=2). With `onChange` it is controlled, and the
 * table narrows as each box is ticked; without, it is an ordinary form control.
 */
export default function MultiSelect({ name, label, groups, selected, onChange, summary: summaryText, autoOpen, dataKey }: {
  name: string;
  label: string;
  groups: PickerGroup[];
  selected: string[];
  onChange?: (next: string[]) => void;
  /** What the button says, where "Any" / "3 selected" would mislead (the column chooser). */
  summary?: string;
  autoOpen?: boolean;
  dataKey?: string;
}) {
  const [find, setFind] = useState("");
  const options = groups.flatMap((g) => g.options);
  const chosen = new Set(selected);

  const toggle = (value: string, on: boolean) => {
    if (!onChange) return;
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    onChange(options.map((o) => o.value).filter((v) => next.includes(v)));
  };

  const summary = summaryText ?? (selected.length === 0
    ? "Any"
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`);
  const needle = find.trim().toLowerCase();

  return (
    <Popover label={label} summary={summary} set={summaryText === undefined && selected.length > 0}
             autoOpen={autoOpen} dataKey={dataKey ?? name}>
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
      {onChange && summaryText === undefined && selected.length > 0 && (
        <button type="button" className="btn sm quiet picker-clear" onClick={() => onChange([])}>
          Clear {label.toLowerCase()}
        </button>
      )}
    </Popover>
  );
}
