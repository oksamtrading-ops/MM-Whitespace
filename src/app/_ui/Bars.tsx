"use client";

import { useState, type CSSProperties } from "react";
import type { Bar } from "../../lib/publish/views.ts";

/**
 * A horizontal bar chart drawn as one SVG per bar.
 *
 * Every green fill on white obliges a relief channel, so the value is always a
 * direct label beside the mark.
 *
 * The proof used to live here as an arithmetic footing under the bars. It is a
 * composition bar now (docs/design/18 section 9): the segments are the addends,
 * so the parts are seen to sum to the total rather than read as a sum. Pass a
 * `Composition` after the chart.
 */
export default function Bars({ bars, mutedStyle = "grey", unit = "companies" }: {
  bars: Bar[]; mutedStyle?: "grey" | "gap"; unit?: string;
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
    </>
  );
}
