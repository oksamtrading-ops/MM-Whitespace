import Icon from "./Icon.tsx";
import type { MarketRow } from "../../lib/publish/crosstabs.ts";

/**
 * Market penetration as a dot plot: one dot for the market, one for Deloitte's
 * book, and the rule between them is the whitespace.
 *
 * The nested bar this replaces encoded the same two numbers, but the eye had
 * to judge a small filled length against a larger one. Here the gap between
 * two dots is the quantity, and a market with no client at all is a single
 * hollow dot on the left with nothing joined to it — which is the finding.
 */
export default function DotPlot({ rows, unit = "companies" }: {
  rows: MarketRow[]; unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.companies));
  // Inset both ends: a dot at zero is half outside the track otherwise, and a
  // market with no client is exactly the row that must not look clipped.
  const pos = (v: number) => 1.5 + (v / max) * 96;
  return (
    <div className="dotplot">
      {rows.map((r) => {
        const pct = r.companies === 0 ? 0 : Math.round((1000 * r.deloitte) / r.companies) / 10;
        return (
          <div key={r.market} className={`dp-row${r.terminal ? " terminal" : ""}`}>
            <span className="lab">{r.market}</span>
            <span className="track" role="img"
                  aria-label={`${r.market}: ${r.companies} ${unit}, ${r.deloitte} audited by Deloitte, ${pct} percent`}>
              <span className="rule" style={{ left: `${pos(r.deloitte)}%`, width: `${pos(r.companies) - pos(r.deloitte)}%` }} />
              <span className="dot all" style={{ left: `${pos(r.companies)}%` }}>
                <span className="tipbox">{r.companies} in this market</span>
              </span>
              <span className={`dot ours${r.deloitte === 0 ? " none" : ""}`} style={{ left: `${pos(r.deloitte)}%` }}>
                <span className="tipbox">{r.deloitte === 0 ? "No Deloitte audit client" : `${r.deloitte} audited by Deloitte`}</span>
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
      <p className="dp-legend">
        <span><i className="sw all" />companies in the market</span>
        <span><i className="sw ours" />audited by Deloitte</span>
        <span className="meta">the rule between them is the whitespace</span>
      </p>
    </div>
  );
}
