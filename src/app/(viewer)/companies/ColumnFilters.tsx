"use client";

import { useEffect, useState } from "react";
import Popover from "../../_ui/Popover.tsx";
import Icon from "../../_ui/Icon.tsx";
import {
  amountText, amountText as amountWords, parseAmount, type FacetGroup, type Presence, type RangeFilter as Range, type TextPresence,
} from "../../../lib/profile/roster.ts";

/** One amount box: it narrows as soon as what is typed is an amount, and says so when it is not. */
function AmountField({ label, value, onChange, plain = false }: {
  label: string; value: number | null; onChange: (n: number | null) => void;
  /** A year: written as itself, never 2.01k. */
  plain?: boolean;
}) {
  const show = (n: number | null) => (plain ? (n === null ? "" : String(n)) : amountText(n));
  const [text, setText] = useState(show(value));
  // Cleared from outside (Clear filters, a report opened): follow it.
  useEffect(() => {
    if (parseAmount(text) !== value) setText(show(value));
    // Only an outside change of the value should rewrite the box.
  }, [value]);
  const parsed = parseAmount(text);
  const bad = parsed === undefined;
  return (
    <label className="cf-amount">
      <span>{label}</span>
      <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="e.g. 250k"
             value={text} aria-invalid={bad || undefined}
             onChange={(e) => {
               setText(e.target.value);
               const n = parseAmount(e.target.value);
               if (n !== undefined) onChange(n);
             }} />
      {bad && <small className="cf-bad" role="alert">Not an amount</small>}
    </label>
  );
}

/** Checkboxes, for the currencies and years of a fee: a short list, so no find box. */
function Checks({ legend, name, groups, selected, onChange }: {
  legend: string; name: string; groups: FacetGroup[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const options = groups.flatMap((g) => g.options);
  if (options.length === 0) return null;
  return (
    <fieldset className="cf-set">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="cf-check">
          <input type="checkbox" name={name} value={o.value} checked={selected.includes(o.value)}
                 onChange={(e) => onChange(e.target.checked
                   ? options.map((x) => x.value).filter((v) => v === o.value || selected.includes(v))
                   : selected.filter((v) => v !== o.value))} />
          <span>{o.label}</span>
          <span className="cf-n">{o.count}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Radios<T extends string>({ legend, name, options, value, onChange }: {
  legend: string; name: string; options: Array<[T, string]>; value: T; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="cf-set">
      <legend>{legend}</legend>
      {options.map(([v, word]) => (
        <label key={v || "any"} className="cf-check">
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          <span>{word}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** A filter's name inside a sentence: "company HQ", "SEC registrant", never "company hq". */
export function filterWord(label: string): string {
  return label.split(" ").map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

function RemoveButton({ label, onRemove }: { label: string; onRemove?: () => void }) {
  if (!onRemove) return null;
  return (
    <button type="button" className="btn sm quiet cf-remove" onClick={onRemove}>
      <Icon name="x" size={13} />Remove {filterWord(label)} filter
    </button>
  );
}

/** A text column: contains, and for one that can be empty, whether it is. */
export function TextFilter({ label, name, value, onChange, presence, onPresence, onRemove, autoOpen }: {
  label: string; name: string; value: string; onChange: (v: string) => void;
  presence?: TextPresence; onPresence?: (p: TextPresence) => void;
  onRemove?: () => void; autoOpen?: boolean;
}) {
  const summary = value ? `contains “${value}”`
    : presence === "value" ? "has one" : presence === "empty" ? "none" : "Any";
  return (
    <Popover label={label} summary={summary} set={Boolean(value) || Boolean(presence)} autoOpen={autoOpen} dataKey={name}>
      <label className="cf-amount">
        <span>Contains</span>
        <input type="search" autoComplete="off" spellCheck={false} value={value}
               onChange={(e) => onChange(e.target.value)} />
      </label>
      {onPresence && (
        <Radios legend="Show" name={`${name}_has`} value={presence ?? ""}
                options={[["", "Any"], ["value", `Has a ${label.toLowerCase()}`], ["empty", `No ${label.toLowerCase()}`]]}
                onChange={onPresence} />
      )}
      <RemoveButton label={label} onRemove={onRemove} />
    </Popover>
  );
}

/**
 * A numeric column: from and to, and for a fee its currency, fiscal year and
 * whether research found one. Fees compare in their own currency, so the
 * panel says that rather than let 500k USD and 500k CAD look like one number.
 */
export function RangeFilter({ label, name, value, onChange, currencies, years, presences, onRemove, autoOpen, note, plain = false }: {
  label: string; name: string; value: Range; onChange: (r: Range) => void;
  currencies?: FacetGroup[]; years?: FacetGroup[];
  presences: Array<[Presence, string]>;
  onRemove?: () => void; autoOpen?: boolean; note?: string;
  /** Years, not amounts. */
  plain?: boolean;
}) {
  const amountText = (n: number | null) => (plain ? String(n ?? "") : amountWords(n));
  const set = value.min !== null || value.max !== null || value.cur.length > 0 || value.fy.length > 0 || value.has !== "";
  const parts: string[] = [];
  if (value.min !== null && value.max !== null) parts.push(`${amountText(value.min)}–${amountText(value.max)}`);
  else if (value.min !== null) parts.push(`≥ ${amountText(value.min)}`);
  else if (value.max !== null) parts.push(`≤ ${amountText(value.max)}`);
  if (value.cur.length) parts.push(value.cur.length === 1 ? value.cur[0].replace("~", "no currency") : `${value.cur.length} currencies`);
  if (value.fy.length) parts.push(value.fy.length === 1 ? `FY${value.fy[0]}`.replace("FY~", "no year") : `${value.fy.length} years`);
  if (value.has) parts.push(presences.find(([p]) => p === value.has)?.[1].toLowerCase() ?? value.has);
  return (
    <Popover label={label} summary={parts.length ? parts.join(", ") : "Any"} set={set} autoOpen={autoOpen} dataKey={name}>
      <div className="cf-range">
        <AmountField label="From" value={value.min} plain={plain} onChange={(min) => onChange({ ...value, min })} />
        <AmountField label="To" value={value.max} plain={plain} onChange={(max) => onChange({ ...value, max })} />
      </div>
      {note && <p className="cf-note">{note}</p>}
      {currencies && <Checks legend="Currency" name={`${name}_cur`} groups={currencies} selected={value.cur}
                             onChange={(cur) => onChange({ ...value, cur })} />}
      {years && <Checks legend="Fiscal year" name={`${name}_fy`} groups={years} selected={value.fy}
                        onChange={(fy) => onChange({ ...value, fy })} />}
      <Radios legend="Show" name={`${name}_has`} value={value.has}
              options={[["", "Any"], ...presences]} onChange={(has) => onChange({ ...value, has })} />
      <RemoveButton label={label} onRemove={onRemove} />
    </Popover>
  );
}

/** "More filters": every column, in the table's order, so any of them can narrow the table. */
export function AddFilter({ columns, onPick }: {
  columns: Array<{ key: string; label: string; active: boolean }>;
  onPick: (key: string) => void;
}) {
  return (
    <Popover label="More filters" set={false} dataKey="more-filters">
      <ul className="cf-menu">
        {columns.map((c) => (
          <li key={c.key}>
            <button type="button" className="cf-item" onClick={(e) => {
              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              onPick(c.key);
            }}>
              <span>{c.label}</span>
              {c.active && <span className="cf-on">on</span>}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
