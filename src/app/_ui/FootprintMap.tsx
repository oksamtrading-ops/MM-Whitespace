"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CANADA_LABELS, CANADA_PATHS, CANADA_VIEWBOX } from "../../lib/publish/canada.ts";
import type { TierProvinces } from "../../lib/publish/crosstabs.ts";
import { provinceName } from "../../lib/publish/jurisdictions.ts";
import {
  companiesHref, companiesOf, groupRows, MAP_TIER_GROUPS, provinceMix,
} from "../../lib/publish/maptiers.ts";

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
 *
 * Given `tiers`, a dropdown above the map redraws it for one tier at a time,
 * rescaling the ramp to that tier, and hovering a province on the full map
 * gives its split by tier. In a tier view the bars below no longer match the
 * map, so the same numbers are written under it instead, as its twin.
 */
export default function FootprintMap({ rows, tiers, hero = false, twinHref = "#province" }: {
  rows: MapRow[]; tiers?: TierProvinces[]; hero?: boolean; twinHref?: string;
}) {
  const [view, setView] = useState("all");
  const group = tiers && view !== "all" ? MAP_TIER_GROUPS.find((g) => g.key === view) ?? null : null;
  const shown = group && tiers ? groupRows(tiers, group) : null;
  const active = shown ? shown.rows : rows;
  const counts = new Map(active.map((r) => [r.code, r.n]));
  const max = Math.max(1, ...active.map((r) => r.n));
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

  const ordered = [...active].sort((a, b) => b.n - a.n);
  const hotN = hot === null ? null : (counts.get(hot) ?? 0);
  const mix = tiers && !group && hot !== null && hotN ? provinceMix(tiers, hot) : [];
  const choose = (key: string) => { setView(key); setHot(null); };
  // The legend names the counts each shade actually covers, read off the same
  // bin() that fills the map: a tier whose largest province holds one company
  // shows one shade for "1", not five shades each labelled 1.
  const steps: Array<{ q: number; lo: number; hi: number }> = [];
  for (let n = 1; n <= max; n++) {
    const q = bin(n);
    const step = steps.find((x) => x.q === q);
    if (step) step.hi = n; else steps.push({ q, lo: n, hi: n });
  }

  return (
    <div className={`map-hero${tilted ? " tilted" : ""}`} onMouseMove={onMove}
         onMouseLeave={() => setHot(null)} onPointerDown={() => setTilted(false)}>
      {tiers && (
        <div className="map-switch">
          <label htmlFor="map-view">Show</label>
          <select id="map-view" value={view} onChange={(e) => choose(e.target.value)}>
            {/* Each label is one string, so the markup reads "Tier 4 (1)" whole. */}
            <option value="all">
              {`All companies (${MAP_TIER_GROUPS.reduce((a, g) => a + groupRows(tiers, g).companies, 0)})`}
            </option>
            {MAP_TIER_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>{`${g.label} (${groupRows(tiers, g).companies})`}</option>
            ))}
          </select>
        </div>
      )}
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
        {group && shown
          ? hot === null
            ? <><b>{companiesOf(group, shown.companies)}</b> {shown.companies === 1 ? "holds" : "hold"} a property in Canada.
                Hover a province; the line under the map is the same numbers.</>
            : hotN === 0
              ? <><b>{provinceName(hot)}</b> — no {companiesOf(group, 1).replace(/^1 /, "")} holds a property here.</>
              : <><b>{provinceName(hot)}</b> — <b>{companiesOf(group, hotN ?? 0)}</b> {hotN === 1 ? "holds" : "hold"} a property here.{" "}
                  <Link href={companiesHref(hot, group) as Route} prefetch={false}>See them →</Link></>
          : hot === null
            ? <>Companies with a property in each province or territory.
                {tiers ? " Hover a province for its tiers;" : " Hover a province;"} the bars below are the same numbers.</>
            : hotN === 0
              ? <><b>{provinceName(hot)}</b> — no company in the population holds a property here.</>
              : <><b>{provinceName(hot)}</b> — <b>{hotN}</b> {hotN === 1 ? "company holds" : "companies hold"} a property here.{" "}
                  {mix.length > 0 && <span className="map-mix">By tier: {mix.map((m) => `${m.label} · ${m.n}`).join(", ")}. </span>}
                  <Link href={companiesHref(hot, null) as Route} prefetch={false}>See them →</Link></>}
      </p>
      <div className="map-legend" aria-hidden="true">
        <span className="step q0" /><span>none</span>
        {steps.map((s) => (
          <span key={s.q} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span className={`step q${s.q}`} /><span className="fig-sm">{s.lo === s.hi ? s.lo : `${s.lo}–${s.hi}`}</span>
          </span>
        ))}
        {!group && <a href={twinHref} style={{ marginLeft: "auto" }}>As bars ↓</a>}
      </div>
      {group && shown && (
        <p className="map-twin">
          {shown.rows.length === 0
            ? <>No {companiesOf(group, 1).replace(/^1 /, "")} holds a property in Canada.</>
            : <><b>{group.label}</b>, companies with a property in each:{" "}
                {shown.rows.map((r) => `${provinceName(r.code)} ${r.n}`).join(" · ")}</>}
        </p>
      )}
    </div>
  );
}

/** Nudges for the three small maritime labels, which otherwise overlap. */
const LABEL_OFFSET: Record<string, [number, number]> = { PE: [48, -22], NS: [56, 16], NB: [-8, 30] };
