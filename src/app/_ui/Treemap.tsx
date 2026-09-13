import { formatMoney } from "../../lib/format/fields.ts";
import { UNKNOWN, type CompanyMark } from "../../lib/publish/crosstabs.ts";

/**
 * The whole market as one picture: every company a rectangle, area is market
 * capitalisation, fill is the incumbent auditor.
 *
 * This is the only chart on the dashboard where the answer arrives before the
 * reader has read anything — a wall of grey with a few green tiles in it. It
 * is also the only one where the encoding is area rather than length, which
 * is why the four largest tiles carry their own labels and everything is in
 * the table twin underneath: area is read badly and the numbers must not
 * depend on it.
 *
 * Squarified layout (Bruls, Huizing and van Wijk): rows are packed to keep
 * each rectangle as close to square as the data allows, because a sliver is
 * unhoverable and unreadable.
 */
type Rect = { m: CompanyMark; x: number; y: number; w: number; h: number };

function squarify(marks: CompanyMark[], W: number, H: number): Rect[] {
  const total = marks.reduce((a, b) => a + b.cap, 0);
  if (total <= 0) return [];
  let rest = marks.map((m) => ({ m, a: (m.cap / total) * W * H }));
  let x = 0, y = 0, w = W, h = H;
  const out: Rect[] = [];
  const worst = (row: Array<{ a: number }>, len: number) => {
    const s = row.reduce((acc, r) => acc + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a));
    const mn = Math.min(...row.map((r) => r.a));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (rest.length > 0) {
    const len = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], len) <= worst(row, len)) { row.push(rest[i]); i++; }
    const s = row.reduce((acc, r) => acc + r.a, 0);
    if (w >= h) {
      const rw = s / h;
      let cy = y;
      for (const r of row) { const rh = r.a / rw; out.push({ m: r.m, x, y: cy, w: rw, h: rh }); cy += rh; }
      x += rw; w -= rw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const r of row) { const rw = r.a / rh; out.push({ m: r.m, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

/** Deloitte is the accent; every other firm is the market, in one grey each. */
const FILL: Record<string, string> = {
  Deloitte: "var(--brand-fill)",
  PwC: "var(--tm-1)",
  KPMG: "var(--tm-2)",
  "Ernst & Young": "var(--tm-3)",
  "Other firms": "var(--tm-4)",
};

export default function Treemap({ marks, total, unsized, currency, ours = "Deloitte" }: {
  marks: CompanyMark[]; total: number; unsized: number; currency: string; ours?: string;
}) {
  const W = 1000, H = 420;
  const rects = squarify(marks, W, H);
  const money = (n: number) => formatMoney(n, currency, { compact: true });
  const oursCap = marks.filter((m) => m.firm === ours).reduce((a, b) => a + b.cap, 0);
  const oursN = marks.filter((m) => m.firm === ours).length;
  const unknownN = marks.filter((m) => m.firm === UNKNOWN).length;

  return (
    <div className="treemap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           role="img"
           aria-label={`${marks.length} companies sized by market capitalisation. ${ours} audits ${oursN}, worth ${money(oursCap)} of ${money(total)}. The table below the chart carries every value.`}>
        <defs>
          {/* The research gap is not a firm, so it takes no hue. */}
          <pattern id="tm-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--tm-gap-a)" />
            <rect width="3" height="6" fill="var(--tm-gap-b)" />
          </pattern>
        </defs>
        {rects.map((r) => {
          const isOurs = r.m.firm === ours;
          const fill = r.m.firm === UNKNOWN ? "url(#tm-hatch)" : (FILL[r.m.firm] ?? "var(--tm-4)");
          const wide = r.w > 62 && r.h > 26;
          return (
            <g key={`${r.m.ticker}-${r.x.toFixed(1)}-${r.y.toFixed(1)}`}>
              <rect x={r.x.toFixed(1)} y={r.y.toFixed(1)}
                    width={Math.max(0, r.w - 1.5).toFixed(1)} height={Math.max(0, r.h - 1.5).toFixed(1)}
                    rx="1.5" fill={fill} className={isOurs ? "ours" : undefined}>
                <title>{`${r.m.name} — ${money(r.m.cap)} — ${r.m.firm === UNKNOWN ? "auditor not yet researched" : r.m.firm}`}</title>
              </rect>
              {wide && (
                <text x={r.x + 8} y={r.y + 20} className={`tm-t${isOurs ? " on-brand" : ""}`}
                      style={{ fontSize: r.w > 116 ? 15 : 12 }}>{r.m.ticker || r.m.name}</text>
              )}
              {wide && r.h > 46 && (
                <text x={r.x + 8} y={r.y + 37} className={`tm-s${isOurs ? " on-brand" : ""}`}>{money(r.m.cap)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="tm-legend">
        <span><i className="sw ours" />{ours} · {oursN} companies · {money(oursCap)}</span>
        <span><i className="sw other" />another firm · {marks.length - oursN - unknownN}</span>
        <span><i className="sw gap" />auditor not yet researched · {unknownN}</span>
        <span className="meta">
          {money(total)} in all{unsized > 0 && `, and ${unsized} ${unsized === 1 ? "company has" : "companies have"} no market cap on file`}
        </span>
      </p>
    </div>
  );
}
