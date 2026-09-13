import { UNKNOWN } from "../../lib/publish/crosstabs.ts";

export type Slice = { label: string; n: number; kind: "ours" | "other" | "gap" };

/**
 * A donut, used only where a donut is honest: two or three parts with a large
 * difference between them, and a hole big enough to carry the headline.
 *
 * Doc 09 banned pies for the tier distribution — five or six near-equal
 * segments where the whole point was that two tables disagreed — and that ban
 * holds. This is the other shape: "ours, everyone else's, and the part nobody
 * has looked at yet". The third slice is the reason it is legal below the
 * auditor coverage floor: the gap is drawn as a gap, hatched and named, so no
 * reader can mistake unresearched for held by somebody else.
 */
export default function Donut({ slices, headline, caption, title }: {
  slices: Slice[];
  /** The number in the hole. */
  headline: string;
  /** The line under it. */
  caption: string;
  title: string;
}) {
  const total = slices.reduce((a, s) => a + s.n, 0) || 1;
  const R = 82, TH = 26, C = 100;
  let angle = -90;
  const arcs = slices.filter((s) => s.n > 0).map((s) => {
    const sweep = (s.n / total) * 360;
    const d = ring(C, C, R, TH, angle, angle + sweep - (sweep > 3 ? 1.2 : 0));
    angle += sweep;
    return { ...s, d, pct: Math.round((1000 * s.n) / total) / 10 };
  });

  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label={`${title}. ${arcs.map((a) => `${a.label} ${a.n}, ${a.pct} percent`).join(". ")}`}>
        <defs>
          <pattern id={`dn-${slug(title)}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--hatch-a)" />
            <rect width="3" height="6" fill="var(--hatch-b)" />
          </pattern>
        </defs>
        {arcs.map((a) => (
          <path key={a.label} d={a.d} className={`sl ${a.kind}`}
                fill={a.kind === "gap" ? `url(#dn-${slug(title)})` : undefined}>
            <title>{`${a.label} — ${a.n} (${a.pct}%)`}</title>
          </path>
        ))}
        {/* Only the headline goes in the hole. A caption long enough to be
            useful does not fit inside a 112px circle, and clipping it against
            the ring is worse than putting it underneath. */}
        <text x={C} y={C + 11} className="dn-big" textAnchor="middle">{headline}</text>
      </svg>
      <p className="dn-cap">{caption}</p>
      <ul className="dn-key">
        {arcs.map((a) => (
          <li key={a.label}>
            <i className={`sw ${a.kind}`} aria-hidden="true" />
            <span className="lab">{a.label === UNKNOWN ? "Not yet researched" : a.label}</span>
            <span className="pct fig-sm">{a.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** One ring segment as a path, from a0 to a1 in degrees, clockwise. */
function ring(cx: number, cy: number, r: number, thick: number, a0: number, a1: number): string {
  const p = Math.PI / 180, ri = r - thick;
  const x0 = cx + r * Math.cos(a0 * p), y0 = cy + r * Math.sin(a0 * p);
  const x1 = cx + r * Math.cos(a1 * p), y1 = cy + r * Math.sin(a1 * p);
  const xi1 = cx + ri * Math.cos(a1 * p), yi1 = cy + ri * Math.sin(a1 * p);
  const xi0 = cx + ri * Math.cos(a0 * p), yi0 = cy + ri * Math.sin(a0 * p);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` +
         `L${xi1.toFixed(2)} ${yi1.toFixed(2)}A${ri} ${ri} 0 ${big} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)}Z`;
}
