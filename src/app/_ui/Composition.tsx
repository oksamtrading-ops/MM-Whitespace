"use client";

import { useState } from "react";
import Icon from "./Icon.tsx";
import type { Proof } from "../../lib/publish/views.ts";

export type Part = {
  label: string;
  n: number;
  /** Which categorical slot, or "quiet" for a terminal bucket. Identity only. */
  slot?: 1 | 2 | 3 | "quiet";
};

/**
 * Three jobs, because a composition bar is not always doing the same one.
 *
 *   identity  the bar IS the chart: each part takes a categorical slot and
 *             the key names it. Only legal while the parts fit the four
 *             validated slots — past that a hue would have to repeat, and
 *             two entities sharing a colour in one chart is a lie.
 *   emphasis  one part is the subject and the rest are the market: accent
 *             and grey, no key, because the chart above already named them.
 *   mono      pure proof: one hue, gaps between the parts, no key.
 */
export type Variant = "identity" | "emphasis" | "mono";

/**
 * The proof, drawn instead of written.
 *
 * `121 + 61 + 12 + 7 + 5 + 53 = 259 ✓` is the right guarantee and the wrong
 * object: an arithmetic string under every chart reads as a footnote nobody
 * checks. Here the same assertion is a bar whose segments ARE the addends —
 * they sum to the width by construction, so the eye verifies the total the
 * way the arithmetic did, and the total still carries its tick.
 *
 * The arithmetic has not gone anywhere. It is the bar's accessible name, it
 * is one press away under "show the arithmetic", and the `= N ✓` string is
 * still one text node, because a failing proof has to be quotable.
 */
export default function Composition({ parts, proof, unit = "companies", variant = "identity" }: {
  parts: Part[]; proof: Proof; unit?: string; variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const total = proof.total || 1;
  const shown = parts.filter((p) => p.n > 0);
  const totalText = proof.ties ? `= ${proof.total} ✓` : `= ${proof.total} ✗ expected ${proof.population}`;

  const slotOf = (p: Part) =>
    variant === "identity" ? (p.slot ?? 1)
    : variant === "emphasis" ? (p.slot === 1 ? "accent" : "quiet")
    : (p.slot === "quiet" ? "quiet" : "mono");

  return (
    <div className={`composition v-${variant}${proof.ties ? "" : " fail"}`}>
      <div className="track" role="img"
           aria-label={`${shown.map((p) => `${p.label} ${p.n}`).join(", ")}. ${proof.text}`}>
        {shown.map((p) => (
          <span key={p.label} className={`seg s${slotOf(p)}`}
                style={{ flexGrow: p.n }} title={`${p.label} — ${p.n} ${unit}`} />
        ))}
      </div>

      {variant === "identity" && (
      <ul className="key">
        {shown.map((p) => (
          <li key={p.label}>
            <span className={`sw s${slotOf(p)}`} aria-hidden="true" />
            <span className="lab">{p.label}</span>
            <span className="fig-sm">{p.n}</span>
            <span className="pct">{Math.round((1000 * p.n) / total) / 10}%</span>
          </li>
        ))}
      </ul>
      )}

      <p className="sums">
        <button type="button" className="btn quiet sm" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}>
          <Icon name={proof.ties ? "circle-check" : "octagon-alert"} size={13} />
          {open ? "Hide the arithmetic" : "Show the arithmetic"}
        </button>
        <span className="total">{totalText}</span>
      </p>
      {open && (
        <p className="arith">
          {proof.parts.map((n, i) => (
            <span key={i}>
              {i > 0 && <span className="op" aria-hidden="true">+</span>}
              <span className="addend">{n}</span>
            </span>
          ))}
          <span className="eq">{totalText}</span>
        </p>
      )}
    </div>
  );
}
