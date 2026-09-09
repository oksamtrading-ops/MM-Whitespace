"use client";

import { useState, type CSSProperties } from "react";
import type { Bar, Proof } from "../../lib/publish/views.ts";

/**
 * A horizontal bar chart drawn as one SVG per bar, and the footing beneath it.
 *
 * Every green fill on white obliges a relief channel, so the value is always a
 * direct label; hovering or focusing a row lights the same value in the
 * footing, which is how the chart and its proof are shown to be one thing.
 */
export default function Bars({ bars, proof, mutedStyle = "grey", unit = "companies" }: {
  bars: Bar[]; proof?: Proof; mutedStyle?: "grey" | "gap"; unit?: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.n));
  const note = bars.find((b) => b.note)?.note;

  return (
    <>
      <div className="bars" onMouseLeave={() => setHot(null)}>
        {bars.map((b, i) => {
          const cls = ["bar-row"];
          if (b.muted) cls.push(mutedStyle === "gap" ? "muted" : "grey");
          if (b.accent) cls.push("accent");
          if (b.terminal) cls.push("terminal");
          if (hot === i) cls.push("hot");
          const w = Math.max(0.6, (b.n / max) * 100);
          return (
            <div key={b.label} className={cls.join(" ")} style={{ "--i": i } as CSSProperties}
                 onMouseEnter={() => setHot(i)}>
              <span className="lab">{b.label}</span>
              <svg role="img" aria-label={`${b.n} ${unit}`} height="14">
                {b.muted && mutedStyle === "gap"
                  ? <rect className="fill" x="0.5" y="0.5" width={`${w}%`} height="13" rx="1.5" />
                  : <rect className="fill" x="0" y="0" width={`${w}%`} height="14" rx="2" />}
              </svg>
              <span className="n fig">{b.n}</span>
            </div>
          );
        })}
      </div>
      {note && <p className="note">{note}</p>}
      {proof && <Footing proof={proof} hot={hot} />}
    </>
  );
}

/**
 * The proof line set as an auditor's foot: addends, a rule, the total under a
 * double rule. The `= N ✓` text is one string on purpose -- it is what the
 * journeys assert, and React would otherwise split it into several text nodes.
 */
export function Footing({ proof, hot = null }: { proof: Proof; hot?: number | null }) {
  const total = proof.ties ? `= ${proof.total} ✓` : `= ${proof.total} ✗ expected ${proof.population}`;
  return (
    <p className={`footing${proof.ties ? "" : " fail"}`}
       aria-label={`Proof: ${proof.text}`}>
      {proof.parts.map((n, i) => (
        <span key={i}>
          {i > 0 && <span className="op" aria-hidden="true">+</span>}
          <span className={`addend${hot === i ? " hot" : ""}`}>{n}</span>
        </span>
      ))}
      <span className="total">{total}</span>
    </p>
  );
}
