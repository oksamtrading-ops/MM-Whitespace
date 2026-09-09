import type { CSSProperties } from "react";

/**
 * A coverage gauge. The floor is drawn as a tick on the track, so "how far to
 * go" is read from the same line as "how far we are". Below the floor the fill
 * is grey: a green fill would read as good news.
 */
export default function Gauge({ label, resolved, population, floorPct, index = 0, compact = false }: {
  label: string; resolved: number; population: number; floorPct: number | null;
  index?: number; compact?: boolean;
}) {
  const pct = population === 0 ? 0 : Math.round((1000 * resolved) / population) / 10;
  const below = floorPct !== null && pct < floorPct;
  return (
    <div className={`gauge${below ? " below" : ""}${compact ? " compact" : ""}`}
         style={{ "--i": index } as CSSProperties}>
      <span className="lab">{label}</span>
      <span className="track" role="img"
            aria-label={`${pct} percent researched${floorPct !== null ? `, floor ${floorPct} percent` : ""}`}>
        <span className="fill" style={{ width: `${Math.max(0.5, pct)}%` }} />
        {floorPct !== null && (
          <span className="floor" style={{ left: `${floorPct}%` }} aria-hidden="true">
            <span>{floorPct}%</span>
          </span>
        )}
      </span>
      <span className="figs">
        <span className="fig">{pct}%</span>
        <span className="of fig-sm">{resolved} of {population}</span>
      </span>
    </div>
  );
}
