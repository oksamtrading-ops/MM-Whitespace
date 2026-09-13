"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CANADA_LABELS, CANADA_PATHS, CANADA_VIEWBOX } from "../../lib/publish/canada.ts";
import { provinceName } from "../../lib/publish/jurisdictions.ts";

export type MapRow = { code: string; n: number };

/**
 * The footprint map: provinces and territories filled by the count of
 * companies with a property there, on the sequential green ramp.
 *
 * Three rules keep it honest. The fill is a bin of the same number the bars
 * twin shows, and the twin is the accessible, keyboard-reachable and printed
 * form, so the SVG itself is decorative to assistive technology. No value is
 * encoded by height: the tilt is a presentation of the same flat choropleth
 * and it settles on scroll or the first interaction. And the footing under
 * it is the footprint proof, because province counts count a company once
 * per province and do not sum to the population -- the caption says so.
 */
export default function FootprintMap({ rows, hero = false, twinHref = "#province" }: {
  rows: MapRow[]; hero?: boolean; twinHref?: string;
}) {
  const counts = new Map(rows.map((r) => [r.code, r.n]));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const bin = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 5)));
  const [hot, setHot] = useState<string | null>(null);
  const [tilted, setTilted] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);

  // The tilt: hero only, on first load, until the reader scrolls or touches
  // it. Off entirely under reduced motion.
  useEffect(() => {
    if (!hero) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTilted(true);
    const settle = () => setTilted(false);
    const onScroll = () => { if (window.scrollY > 40) settle(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hero]);

  // Parallax while tilted: at most 8px, and only the stage moves.
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tilted || !stage.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 16;
    const dy = ((e.clientY - r.top) / r.height - 0.5) * 8;
    stage.current.style.setProperty("--px", `${dx.toFixed(1)}px`);
    stage.current.style.setProperty("--py", `${dy.toFixed(1)}px`);
  };

  const ordered = [...rows].sort((a, b) => b.n - a.n);
  const hotN = hot === null ? null : (counts.get(hot) ?? 0);
  const steps = [1, 2, 3, 4, 5].map((q) => ({
    q, lo: q === 1 ? 1 : Math.floor(((q - 1) / 5) * max) + 1, hi: Math.ceil((q / 5) * max),
  }));

  return (
    <div className={`map-hero${tilted ? " tilted" : ""}`} onMouseMove={onMove}
         onMouseLeave={() => setHot(null)} onPointerDown={() => setTilted(false)}>
      <div className="map-stage" ref={stage}
           style={{ transform: tilted ? undefined : undefined, translate: tilted ? "var(--px, 0) var(--py, 0)" : "0 0" } as CSSProperties}>
        <svg className="map" viewBox={CANADA_VIEWBOX} aria-hidden="true" focusable="false">
          {Object.entries(CANADA_PATHS).map(([code, d], i) => {
            const n = counts.get(code) ?? 0;
            return (
              <path key={code} d={d} className={`prov q${bin(n)}${hot === code ? " hot" : ""}`}
                    style={{ "--i": ordered.findIndex((r) => r.code === code) } as CSSProperties}
                    onMouseEnter={() => setHot(code)} data-code={code} data-n={n} />
            );
          })}
          {Object.entries(CANADA_LABELS).map(([code, [x, y]]) => {
            const n = counts.get(code) ?? 0;
            const [ox, oy] = LABEL_OFFSET[code] ?? [0, 0];
            return (
              <g key={code} className="lab-g">
                <text x={x + ox} y={y + oy - (n ? 6 : 0)} className={`lab${n ? "" : " dim"}`} textAnchor="middle">{code}</text>
                {n > 0 && <text x={x + ox} y={y + oy + 18} className="lab n" textAnchor="middle">{n}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="map-readout" aria-live="polite">
        {hot === null
          ? <>Companies with a property in each province or territory. Hover a province; the bars below are the same numbers.</>
          : hotN === 0
            ? <><b>{provinceName(hot)}</b> — no company in the population holds a property here.</>
            : <><b>{provinceName(hot)}</b> — <b>{hotN}</b> {hotN === 1 ? "company holds" : "companies hold"} a property here.{" "}
                <Link href={`/companies?province=${hot}` as Route} prefetch={false}>See them →</Link></>}
      </p>
      <div className="map-legend" aria-hidden="true">
        <span className="step q0" /><span>none</span>
        {steps.map((s) => (
          <span key={s.q} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span className={`step q${s.q}`} /><span className="fig-sm">{s.lo === s.hi ? s.lo : `${s.lo}–${s.hi}`}</span>
          </span>
        ))}
        <a href={twinHref} style={{ marginLeft: "auto" }}>As bars ↓</a>
      </div>
    </div>
  );
}

/** Nudges for the three small maritime labels, which otherwise overlap. */
const LABEL_OFFSET: Record<string, [number, number]> = { PE: [48, -22], NS: [56, 16], NB: [-8, 30] };
