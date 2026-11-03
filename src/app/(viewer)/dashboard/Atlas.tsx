"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { geoDistance } from "d3-geo";
import { useSearchParams } from "next/navigation";
import type { MarketRow } from "../../../lib/publish/crosstabs.ts";
import { cityPoint } from "../../../lib/publish/cities.ts";
import {
  applyLens, BAND_EDGES, bandLabel, bandOf, DELOITTE, firmLabel, firmParts, fmtCap, headline, lensIsEmpty, moves,
  NO_LENS, pct, plural, propertyCounts, tierKey,
  type Atlas as AtlasData, type AtlasCompany, type Lens,
} from "../../../lib/publish/lens.ts";
import Globe, { anchorOf, besideCard, cameraAround, cameraFor, CAMERAS, type Arc, type Camera, type Label } from "../../_ui/Globe.tsx";
import Composition from "../../_ui/Composition.tsx";
import Icon from "../../_ui/Icon.tsx";
import Memo, { type CoverageRow } from "./Memo.tsx";
import { officesOf } from "./offices.ts";
import Find from "./Find.tsx";
import Brief from "./Brief.tsx";
import {
  baseOf, chipsOf, dayLabel, legendWords, nameOf, paramsOfView, proofOf, rosterParams, scopeWords, STEP_LABELS, stepOf,
  subjectWords, TIER_RULE, viewOfQuery, type Frame, type MapMode, type View,
} from "./words.ts";

/**
 * The dashboard. One list of published companies, one set of filters, and
 * everything drawn from what the filters leave: the sentence, the globe and
 * every point of the memo. The filters live in the URL, written the way the
 * Companies page reads them, so a view can be sent and opens as it was.
 */

const FRAMES: Array<{ key: Frame; label: string }> = [
  { key: "americas", label: "Americas" }, { key: "canada", label: "Canada" }, { key: "world", label: "World" },
];
const TIERS = ["1", "2", "3", "4", "5", "6", "unclassified"];

/** Wider than a phone, the card sits over the globe's lower left, so a flight turns to clear it, keeping `keep` in view. */
const clearOfCard = (cam: Camera, keep: Array<[number, number]> = []): Camera =>
  typeof matchMedia === "function" && matchMedia("(min-width: 761px)").matches ? besideCard(cam, keep) : cam;

export default function Atlas({ atlas, periodTitle, initial, markets, coverage, frozen, publisher }: {
  atlas: AtlasData;
  periodTitle: string;
  initial: View;
  markets: { rows: MarketRow[]; population: number } | null;
  coverage: CoverageRow[];
  frozen: { population: number; deloitte: number };
  publisher: string | null;
}) {
  const [view, setView] = useState<View>(initial);
  const [camera, setCamera] = useState<Camera>(CAMERAS[initial.frame]);
  const [focus, setFocus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const { lens, mode } = view;
  const { threshold, currency, asOf } = atlas.period;
  const money = (n: number) => fmtCap(n, currency);

  // The URL follows the reader: a view they choose is written to the address
  // bar. A null state lets the router copy its own and take the new address
  // as current, so Back and a link to the dashboard both know where the page
  // was. Nothing else is written: not the view the page first rendered, which
  // the address may have moved past, and not a view taken from the address,
  // which already says it.
  const atlasNow = useRef(atlas);
  atlasNow.current = atlas;
  const seen = useRef(view);
  const taken = useRef<View | null>(null);
  useEffect(() => {
    if (view === seen.current) return;
    seen.current = view;
    if (view === taken.current) return;
    const q = paramsOfView(view, atlasNow.current).toString();
    if (q === new URLSearchParams(window.location.search).toString()) return;
    window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
  }, [view]);
  const follow = (there: View) => {
    taken.current = there;
    setView(there);
  };

  // The page can come back from the router's cache with the view it first
  // rendered while the address bar names a later one: the address bar wins.
  const viewNow = useRef(view);
  viewNow.current = view;
  useLayoutEffect(() => {
    const there = viewOfQuery(window.location.search, atlas);
    if (JSON.stringify(there) === JSON.stringify(initial)) return;
    follow(there);
    setCamera(CAMERAS[there.frame]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A link to the dashboard, Back and Forward move the router to another
  // address while this page stays mounted, and the router can hand it the
  // view it rendered before, unchanged, even after the reader has filtered
  // the page since: the address is the signal, not the view. An address the
  // view would write itself is the page's own, reported back.
  const query = useSearchParams().toString();
  const queryNow = useRef(query);
  useEffect(() => {
    if (query === queryNow.current) return;
    queryNow.current = query;
    if (query === paramsOfView(viewNow.current, atlasNow.current).toString()) return;
    const there = viewOfQuery(query, atlasNow.current);
    if (JSON.stringify(there) === JSON.stringify(viewNow.current)) return;
    follow(there);
    setFocus(null);
    setCamera({ ...CAMERAS[there.frame], nonce: Math.random() });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // A choice made from a list turns the globe to it, even when the reader has
  // turned it away from the same place since; one made on the globe leaves it
  // where the reader put it. The flat world needs no turning.
  const frameNow = useRef(view.frame);
  frameNow.current = view.frame;
  const fly = useCallback((key: string) => {
    if (frameNow.current !== "world") setCamera({ ...clearOfCard(cameraFor(key)), nonce: Math.random() });
  }, []);

  const pick = useCallback((patch: Partial<Lens>, opts: { mode?: MapMode; fly?: string } = {}) => {
    setView((v) => ({ ...v, mode: opts.mode ?? v.mode, lens: { ...v.lens, ...patch } }));
    if (opts.fly) fly(opts.fly);
  }, [fly]);

  const frameTo = (frame: Frame) => {
    setView((v) => ({ ...v, frame }));
    setCamera({ ...CAMERAS[frame], nonce: Math.random() });
  };

  // The filter bar wraps on a laptop, so it says how tall it is: the globe
  // sticks below it, and the page keeps what the keyboard focuses clear of it.
  const root = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const html = document.documentElement;
    const ro = new ResizeObserver(() => {
      root.current?.style.setProperty("--lens-h", `${el.offsetHeight}px`);
      html.style.setProperty("--lens-h", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => { ro.disconnect(); html.style.removeProperty("--lens-h"); };
  }, []);

  // A control that removes itself hands the keyboard on: to the control that
  // took its place, else to the filters' first one, never to the page body.
  const refocus = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const next = refocus.current;
    if (!next) return;
    refocus.current = null;
    (next() ?? bar.current?.querySelector<HTMLElement>("#map-view"))?.focus();
  });
  const toGlobe = () => root.current?.querySelector<HTMLElement>(".globe[tabindex]");

  // ⌘K, Ctrl-K or "/" finds a company or a place, unless the reader is typing
  // or presenting the brief.
  const briefOpen = useRef(false);
  briefOpen.current = briefing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (briefOpen.current) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setFinding(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => applyLens(atlas.companies, lens), [atlas, lens]);
  const base = useMemo(() => applyLens(atlas.companies, baseOf(lens)), [atlas, lens]);
  const ground = useMemo(() => propertyCounts(shown), [shown]);
  const groundAt = useMemo(() => new Map(ground.map((p) => [p.key, p])), [ground]);
  const offices = useMemo(() => officesOf(shown), [shown]);
  const discMax = useMemo(() => Math.max(1, ...officesOf(atlas.companies).map((o) => o.n)), [atlas]);
  const hqAt = useMemo(() => {
    const m = new Map<string, { n: number; ours: number }>();
    for (const c of shown) if (c.hq) {
      const e = m.get(c.hq) ?? { n: 0, ours: 0 };
      e.n++;
      if (c.auditor === DELOITTE) e.ours++;
      m.set(c.hq, e);
    }
    return m;
  }, [shown]);
  const rank = useMemo(() => Object.fromEntries(propertyCounts(atlas.companies).map((p, i) => [p.key, i])), [atlas]);

  // The filter menus count what each choice would show, the other filters held.
  const count = (patch: Partial<Lens>) => applyLens(atlas.companies, { ...lens, ...patch }).length;
  const tierCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of applyLens(atlas.companies, { ...lens, tier: null })) m.set(tierKey(c), (m.get(tierKey(c)) ?? 0) + 1);
    return m;
  }, [atlas, lens]);
  const commodities = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of applyLens(atlas.companies, { ...lens, commodity: null })) for (const k of c.commodities) m.set(k, (m.get(k) ?? 0) + 1);
    if (lens.commodity && !m.has(lens.commodity)) m.set(lens.commodity, 0);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [atlas, lens]);
  const bandCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of applyLens(atlas.companies, { ...lens, band: null })) { const b = bandOf(c.cap); if (b) m.set(b, (m.get(b) ?? 0) + 1); }
    return m;
  }, [atlas, lens]);

  /* The sentence: Deloitte's share of everything the filters leave, the firm aside. */
  const h = headline(base);
  const parts = firmParts(base);
  const scope = scopeWords(lens, threshold, currency, h.companies);
  const subject = subjectWords(lens, shown.length);
  const m24 = useMemo(() => moves(base, asOf), [base, asOf]);
  const few = base.length > 0 && base.length < 10;

  // What changed, said once to a screen reader: the sentence the page now opens with.
  const sentence = `Deloitte audits ${h.deloitte} of ${h.companies} ${scope}.` +
    (subject ? ` ${subject[0]} ${shown.length} ${subject[1]}` : "");
  const [said, setSaid] = useState("");
  const spoke = useRef(false);
  useEffect(() => {
    if (!spoke.current) { spoke.current = true; return; }
    setSaid(sentence);
  }, [sentence]);

  /* The globe: green for Deloitte's companies or everyone's, grey for any set that is not Deloitte's. */
  const tone = lens.firm === "whitespace" || (lens.auditor !== null && lens.auditor !== DELOITTE) ? "grey" : "green";
  const fillOf = legendWords(lens);
  const steps = mode === "ground" ? Object.fromEntries(ground.map((p) => [p.key, stepOf(p.n)])) : {};
  const selected = mode === "ground" ? lens.place : lens.hq;
  const focused = focus ? atlas.companies.find((c) => c.id === focus) ?? null : null;
  const focusHome = focused?.hq ? cityPoint(focused.hqCity, focused.hq)?.at ?? anchorOf(focused.hq) : null;
  const arcs: Arc[] = focused && focusHome
    ? focused.places.flatMap((k) => {
        const to = anchorOf(k);
        // Keyed by company too, so the next company's arc to a shared place draws out afresh.
        return to && geoDistance(focusHome, to) > 0.012 ? [{ key: `${focused.id}:${k}`, from: focusHome, to, ours: focused.auditor === DELOITTE }] : [];
      })
    : [];
  const labels: Label[] = mode === "ground"
    ? ground.slice(0, 6).concat(lens.place && !ground.slice(0, 6).some((p) => p.key === lens.place) && groundAt.get(lens.place) ? [groundAt.get(lens.place)!] : [])
        .map((p) => ({ key: p.key, at: anchorOf(p.key)!, text: nameOf(p.key), sub: String(p.n) })).filter((l) => l.at)
    : offices.filter((o) => !o.dashed).slice(0, 6).map((o) => ({ key: o.key, at: o.at, text: o.label, sub: String(o.n) }));
  const globeTitle = mode === "ground"
    ? `Globe: the ${plural(shown.length, "company", "companies")} in view by where they hold ground, ${plural(ground.length, "place")} shaded by count.`
    : `Globe: the ${plural(shown.length, "company", "companies")} in view by where their head offices are, one disc per city.`;

  const tooltip = (key: string) => {
    if (key.startsWith("city:") || key.startsWith("rest:")) {
      const o = offices.find((x) => x.key === key);
      if (!o) return null;
      return (
        <>
          <b>{o.dashed ? `${o.label}, no city the globe can place` : o.label}</b>
          <span>{plural(o.n, "head office")}{o.dashed ? "" : ` · ${nameOf(o.place)}`}</span>
          <span className={o.ours ? "ours" : undefined}>Deloitte audits {o.ours}</span>
        </>
      );
    }
    const name = nameOf(key);
    if (mode === "ground") {
      const p = groundAt.get(key);
      return (
        <>
          <b>{name}</b>
          <span>{p ? `${plural(p.n, "company holds", "companies hold")} ground here` : "No company in view holds ground here"}</span>
          {p && <span className={p.deloitte ? "ours" : undefined}>Deloitte audits {p.deloitte}</span>}
        </>
      );
    }
    const e = hqAt.get(key);
    return (
      <>
        <b>{name}</b>
        <span>{e ? `${plural(e.n, "head office")} in view` : "No head office in view"}</span>
        {e && <span className={e.ours ? "ours" : undefined}>Deloitte audits {e.ours}</span>}
      </>
    );
  };

  const chips = chipsOf(lens, threshold, currency);
  const roster = `/companies${(() => { const q = rosterParams(lens, atlas).toString(); return q ? `?${q}` : ""; })()}`;
  const firmChoice = lens.auditor === "unknown" ? "unknown" : lens.auditor ? null : lens.firm;
  const setFirm = (choice: "all" | "deloitte" | "whitespace" | "unknown") =>
    pick(choice === "unknown" ? { firm: "all", auditor: "unknown" } : { firm: choice, auditor: null });
  const selectedCount = selected ? (mode === "ground" ? groundAt.get(selected) : hqAt.get(selected)) : null;
  // Land that no company in view could be narrowed to: a click there clears
  // the selection instead of emptying the page.
  const pickable = useMemo(() => {
    const free = applyLens(atlas.companies, mode === "ground" ? { ...lens, place: null } : { ...lens, hq: null });
    return new Set(mode === "ground" ? free.flatMap((c) => c.places) : free.flatMap((c) => (c.hq ? [c.hq] : [])));
  }, [atlas, lens, mode]);
  const cardRef = useRef<HTMLElement | null>(null);

  return (
    <div className="atlas" ref={root}>
      <div className="lensbar" role="region" aria-label="Filters" ref={bar}>
        <div className="map-switch">
          <label htmlFor="map-view">Tier</label>
          <select id="map-view" value={lens.tier ?? "all"}
                  onChange={(e) => pick({ tier: e.target.value === "all" ? null : e.target.value })}>
            <option value="all">{`All companies (${count({ tier: null })})`}</option>
            {TIERS.map((t) => (
              <option key={t} value={t} title={TIER_RULE[t]}>
                {t === "unclassified" ? `Unclassified (${tierCounts.get(t) ?? 0})` : `Tier ${t} (${tierCounts.get(t) ?? 0}) · ${TIER_RULE[t]}`}
              </option>
            ))}
          </select>
        </div>
        <div className="segs" role="group" aria-label="Auditor">
          {([["all", "All"], ["deloitte", "Deloitte"], ["whitespace", "Another firm"], ["unknown", "Not yet known"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={firmChoice === k} onClick={() => setFirm(k)}>{label}</button>
          ))}
        </div>
        <label className="sel">
          <span className="sr-only">Commodity</span>
          <select value={lens.commodity ?? ""} onChange={(e) => pick({ commodity: e.target.value || null })}>
            <option value="">{`Any commodity (${count({ commodity: null })})`}</option>
            {commodities.map(([k, n]) => <option key={k} value={k}>{`${k} (${n})`}</option>)}
          </select>
        </label>
        <label className="sel">
          <span className="sr-only">Market value</span>
          <select value={lens.band ?? ""} onChange={(e) => pick({ band: (e.target.value || null) as Lens["band"] })}>
            <option value="">{`Any size (${count({ band: null })})`}</option>
            {BAND_EDGES.map((b) => <option key={b.key} value={b.key}>{`${bandLabel(b.key, threshold, currency)} (${bandCounts.get(b.key) ?? 0})`}</option>)}
          </select>
        </label>
        <div className="lb-acts">
          <button type="button" className="btn sm secondary" onClick={() => setFinding(true)} aria-keyshortcuts="Meta+K Control+K /">
            <Icon name="search" size={13} />Find<kbd>⌘K</kbd>
          </button>
          <button type="button" className="btn sm primary" onClick={() => setBriefing(true)}>
            <Icon name="play" size={13} />Brief me
          </button>
        </div>
        {/* The filters in use take a row of their own under the controls, so
            choosing one never moves Find and Brief me. */}
        {chips.length > 0 && (
          <ul className="chips" aria-label="Filters in use">
            {chips.map((c, i) => (
              <li key={c.key}>
                <button type="button" className="chip" aria-label={`Remove: ${c.label}`}
                        onClick={() => {
                          refocus.current = () => bar.current?.querySelectorAll<HTMLElement>(".chips .chip")[i] ?? bar.current?.querySelector<HTMLElement>(".chips .btn");
                          pick({ [c.key]: c.key === "firm" ? "all" : null });
                        }}>
                  {c.label}<Icon name="x" size={12} />
                </button>
              </li>
            ))}
            <li><button type="button" className="btn quiet sm" onClick={() => { refocus.current = () => null; pick(NO_LENS); }}>Clear all</button></li>
          </ul>
        )}
      </div>

      <div className="stage">
        <section className="mast" aria-label="The answer">
          <p className="mast-k">
            <span>{periodTitle}</span><span>revision {atlas.publication.revision}</span>
            <span className="asof">market values as of {dayLabel(asOf)}</span>
            {atlas.publication.overrideReason && <span className="pill warn">through a blocked gate</span>}
          </p>
          <p className="mast-hero">
            Deloitte audits <b className="fig-xl">{h.deloitte}</b> of <b className="fig-xl">{h.companies}</b>{" "}
            <span className="scope">{scope}</span>
          </p>
          {few ? (
            <p className="mast-sub">
              {base.map((c, i) => (
                <span key={c.id}>{i ? " · " : ""}<a href={`/companies/${c.id}`}>{c.name}</a> <span className="who">{firmLabel(c.auditor)}</span></span>
              ))}
            </p>
          ) : (
            <p className="mast-sub">
              <b className="fig">{pct(h.deloitteCap, h.cap)}</b> of their market value: {money(h.deloitteCap)} of {money(h.cap)}.
              {h.auditorUnknown > 0 && <> The auditor of <b className="fig">{h.auditorUnknown}</b> is not yet known.</>}
              {subject && <> {subject[0]} <b className="fig">{shown.length}</b> {subject[1]}</>}
            </p>
          )}
          <div className="mast-proof">
            <ul className="mast-key">
              {parts.filter((p) => p.n > 0).map((p) => (
                <li key={p.key} className={p.key === "deloitte" ? "ours" : undefined}>
                  <span className={`sw ${p.key === "deloitte" ? "ours" : "all"}`} aria-hidden="true" />{p.label} <b className="fig-sm">{p.n}</b>
                </li>
              ))}
            </ul>
            <Composition parts={parts.map((p) => ({ label: p.label, n: p.n, slot: p.key === "deloitte" ? 1 : "quiet" }))}
                         proof={proofOf(parts.map((p) => p.n), base.length)} variant="emphasis" />
          </div>
          <dl className="kpis">
            <div><dt>Market value</dt><dd className="fig">{money(h.cap)}</dd>
              <dd className="aux">{h.capUnknown ? `${plural(h.capUnknown, "company", "companies")} without one` : `${plural(h.companies, "company", "companies")}`}</dd></div>
            <div className="ours"><dt>Audited by Deloitte</dt><dd className="fig">{pct(h.deloitteCap, h.cap)}</dd><dd className="aux">of the value · {pct(h.deloitte, h.companies)} of the companies</dd></div>
            <div><dt>Auditor not yet known</dt><dd className="fig">{h.auditorUnknown}</dd><dd className="aux">{pct(h.auditorUnknown, h.companies)} of the companies</dd></div>
            <div><dt>Changed auditor, two years</dt><dd className="fig">{m24.moves.length}</dd><dd className="aux">at least, of {m24.looked} with a known history</dd></div>
          </dl>
          {shown.length > 0 && (
            <p className="mast-act">
              <a className="btn sm secondary" href={roster} title={lens.band ? "Companies does not filter by size; sort it by market value" : undefined}>
                <Icon name="external-link" size={13} />{`Open the ${plural(shown.length, "company", "companies")} in Companies`}
              </a>
            </p>
          )}
          <p className="sr-only" role="status">{said}</p>
        </section>

        <div className="globe-col">
          <div className="globe-tools">
            <div className="segs" role="group" aria-label="The globe shows">
              <button type="button" aria-pressed={mode === "ground"} onClick={() => setView((v) => ({ ...v, mode: "ground" }))}>
                <Icon name="pickaxe" size={13} />Where they dig
              </button>
              <button type="button" aria-pressed={mode === "hq"} onClick={() => setView((v) => ({ ...v, mode: "hq" }))}>
                <Icon name="building-2" size={13} />Where they are run from
              </button>
            </div>
            <div className="segs" role="group" aria-label="Frame">
              {FRAMES.map((f) => (
                <button key={f.key} type="button" aria-pressed={view.frame === f.key} onClick={() => frameTo(f.key)}>{f.label}</button>
              ))}
            </div>
          </div>

          <Globe steps={steps} tone={tone} selected={selected} marked={focused?.places ?? []}
                 discs={mode === "hq" ? offices : []} discMax={discMax} arcs={arcs} labels={labels} camera={camera}
                 onSelect={(place) => {
                   const kept = place && pickable.has(place) ? place : null;
                   pick(mode === "ground" ? { place: kept } : { hq: kept });
                 }}
                 tooltip={tooltip} title={globeTitle} keysId="globe-keys" first rank={rank} />

          {focused ? (
            <aside className="card focus" aria-label={`In focus: ${focused.name}`} tabIndex={-1} ref={cardRef}>
              <button type="button" className="x" aria-label="Close"
                      onClick={() => { refocus.current = toGlobe; setFocus(null); frameTo(view.frame); }}><Icon name="x" size={14} /></button>
              <p className="k">{[focused.ticker, focused.exchange].filter(Boolean).join(" · ") || "Company"}</p>
              <p className="t">{focused.name}</p>
              <dl>
                <div><dt>Auditor</dt><dd className={focused.auditor === DELOITTE ? "ours" : undefined}>{firmLabel(focused.auditor)}</dd></div>
                <div><dt>Market value</dt><dd>{focused.cap === null ? "Not published" : money(focused.cap)}</dd></div>
                <div><dt>Tier</dt><dd>{focused.tier === null ? "Unclassified" : `Tier ${focused.tier}`}</dd></div>
                <div><dt>Run from</dt><dd>{[focused.hqCity?.split(",")[0], focused.hq ? nameOf(focused.hq) : focused.hqRegion].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
                <div><dt>Ground in</dt><dd>{focused.places.length ? focused.places.map(nameOf).join(", ") : "No properties"}</dd></div>
              </dl>
              <a className="btn sm secondary" href={`/companies/${focused.id}`}>Open the profile<Icon name="arrow-right" size={13} /></a>
            </aside>
          ) : selected && (
            <aside className="card place" aria-label={`Selected: ${nameOf(selected)}`} tabIndex={-1} ref={cardRef}>
              <button type="button" className="x" aria-label="Clear the selection"
                      onClick={() => { refocus.current = toGlobe; pick(mode === "ground" ? { place: null } : { hq: null }); }}><Icon name="x" size={14} /></button>
              <p className="k">{mode === "ground" ? "Ground in" : "Run from"}</p>
              <p className="t">{nameOf(selected)}</p>
              <p className="d">
                <b className="fig">{selectedCount?.n ?? 0}</b> {mode === "ground" ? "with ground here" : "head offices"} ·
                Deloitte audits <b className="fig">{mode === "ground" ? (groundAt.get(selected)?.deloitte ?? 0) : (hqAt.get(selected)?.ours ?? 0)}</b>
              </p>
              <p className="d">
                {mode === "ground"
                  ? "The globe now shows where these companies also hold ground."
                  : "The page now counts only the companies run from here."}
              </p>
            </aside>
          )}

          <div className={`legend tone-${tone}`} aria-hidden="true">
            {mode === "ground" ? (
              <>
                <span className="lg-t">Companies with ground here, {fillOf}</span>
                <span className="lg-steps">
                  <span className="step q0" /><span className="lg-n">0</span>
                  {STEP_LABELS.map((l, i) => (
                    <span key={l} className="lg-step"><span className={`step q${i + 1}`} /><span className="lg-n">{l}</span></span>
                  ))}
                </span>
              </>
            ) : (
              <>
                <span className="lg-t">One disc per city, its area the head offices there</span>
                <span className="lg-discs">
                  <svg width="74" height="30" viewBox="0 0 74 30"><circle className="all" cx="15" cy="15" r="13" /><circle className="ours" cx="15" cy="15" r="6" /><circle className="all dashed" cx="52" cy="15" r="9" /></svg>
                  <span className="lg-n">green core: Deloitte&rsquo;s · dashed: no city the globe can place</span>
                </span>
              </>
            )}
          </div>
          <p id="globe-keys" className="sr-only">
            Drag, or use the arrow keys, to turn the globe; plus and minus zoom; Escape clears the selection.
            Every place is listed with its numbers in the table under Where they dig.
          </p>
        </div>

        <Memo atlas={atlas} shown={shown} lens={lens} mode={mode} pick={pick} offices={offices} markets={markets}
              coverage={coverage} frozen={frozen} publisher={publisher} periodTitle={periodTitle} roster={roster} />
      </div>

      {finding && (
        <Find atlas={atlas} onClose={() => setFinding(false)}
              onCompany={(c) => {
                setFinding(false);
                setFocus(c.id);
                refocus.current = () => cardRef.current;
                const home = c.hq ? cityPoint(c.hqCity, c.hq)?.at ?? anchorOf(c.hq) : null;
                const pts = [home, ...c.places.map(anchorOf)].filter((p): p is [number, number] => Boolean(p));
                // Ground spread too wide for one side of the globe is shown on the flat world, and the frame says so.
                const cam = cameraAround(pts);
                setView((v) => ({ ...v, frame: cam.flat ? "world" : v.frame === "world" ? "americas" : v.frame }));
                setCamera({ ...clearOfCard(cam, pts), nonce: Math.random() });
              }}
              onPlace={(key) => {
                setFinding(false);
                setFocus(null);
                refocus.current = () => cardRef.current;
                pick({ place: key }, { mode: "ground", fly: key });
              }} />
      )}
      {briefing && <Brief atlas={atlas} periodTitle={periodTitle} onClose={() => setBriefing(false)} />}
    </div>
  );
}
