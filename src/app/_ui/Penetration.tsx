import type { CSSProperties } from "react";
import Icon from "./Icon.tsx";
import type { MarketRow } from "../../lib/publish/crosstabs.ts";

/**
 * Companies by Deloitte market, with the part Deloitte audits inside the bar.
 *
 * The old chart encoded one number, the size of the market. The page's whole
 * question is how much of that is not ours, so the mark carries both: the
 * full length is the market and the inner length is the book. A market with
 * no client at all says so in words, because a zero-length bar is invisible
 * and "no client here" is the finding.
 *
 * One hue and one grey, as doc 09 requires: markets have no natural order, so
 * they are not ramped, and the accent means the same thing it means
 * everywhere else on the page.
 */
export default function Penetration({ rows, unit = "companies" }: {
  rows: MarketRow[]; unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.companies));
  return (
    <div className="pen">
      {rows.map((r, i) => {
        const pct = r.companies === 0 ? 0 : Math.round((1000 * r.deloitte) / r.companies) / 10;
        return (
          <div key={r.market} className={`pen-row${r.terminal ? " terminal" : ""}`}
               style={{ "--i": i } as CSSProperties}>
            <span className="lab">{r.market}</span>
            <span className="track" role="img"
                  aria-label={`${r.market}: ${r.companies} ${unit}, ${r.deloitte} audited by Deloitte, ${pct} percent`}>
              <span className="all" style={{ width: `${(r.companies / max) * 100}%` }}>
                <span className="ours" style={{ width: `${r.companies === 0 ? 0 : (r.deloitte / r.companies) * 100}%` }} />
              </span>
            </span>
            <span className="n fig">{r.companies}</span>
            <span className="ours-n">
              {r.deloitte === 0
                ? <span className="none"><Icon name="circle-dashed" size={12} />no client here</span>
                : <><span className="fig-sm">{r.deloitte}</span> ours · {pct}%</>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
