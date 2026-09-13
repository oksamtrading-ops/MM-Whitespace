import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { requireRole } from "../../../lib/auth/context.ts";
import { Forbidden, Unauthenticated } from "../../../lib/auth/session.ts";
import { proofLine, type Bar } from "../../../lib/publish/views.ts";
import Bars, { Footing } from "../../_ui/Bars.tsx";
import Contents from "../../_ui/Contents.tsx";
import Facts from "../../_ui/Facts.tsx";
import FootprintMap from "../../_ui/FootprintMap.tsx";
import Gauge from "../../_ui/Gauge.tsx";
import Ledger from "../../_ui/Ledger.tsx";
import Orb from "../../_ui/Orb.tsx";
import Refusal from "../../_ui/Refusal.tsx";
import Section from "../../_ui/Section.tsx";
import { DashboardSkeleton } from "../../_ui/Skeleton.tsx";
import Replay from "./Replay.tsx";
import Swatches from "./Swatches.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Styleguide" };

/* Every figure on this page is invented. It illustrates a form, never a finding. */
const POP = 259;
const FOOTPRINT: Bar[] = [
  { label: "Canada only", n: 121, pct: 46.7 }, { label: "Canada and abroad", n: 61, pct: 23.6 },
  { label: "Abroad only", n: 24, pct: 9.3 }, { label: "None — no properties", n: 53, pct: 20.5 },
];
const AUDITOR: Bar[] = [
  { label: "Deloitte", n: 17, pct: 6.6, accent: true }, { label: "KPMG", n: 38, pct: 14.7, muted: true },
  { label: "PwC", n: 31, pct: 12.0, muted: true }, { label: "Ernst & Young", n: 22, pct: 8.5, muted: true },
  { label: "Other firms", n: 35, pct: 13.5, muted: true },
  { label: "Auditor not yet known", n: 116, pct: 44.8, muted: true, terminal: true },
];
const TIERS: Bar[] = [
  { label: "Tier 1", n: 14, pct: 5.4 }, { label: "Tier 2", n: 9, pct: 3.5 }, { label: "Tier 3", n: 6, pct: 2.3 },
  { label: "Tier 4", n: 17, pct: 6.6 }, { label: "Tier 5", n: 21, pct: 8.1 }, { label: "Tier 6", n: 50, pct: 19.3 },
  { label: "Unclassified — no stage research", n: 142, pct: 54.8, muted: true },
];
const PROVINCES = [
  { code: "BC", n: 27 }, { code: "ON", n: 25 }, { code: "QC", n: 17 }, { code: "YT", n: 12 }, { code: "SK", n: 8 },
  { code: "NT", n: 7 }, { code: "NL", n: 6 }, { code: "MB", n: 3 }, { code: "NU", n: 3 }, { code: "AB", n: 2 },
  { code: "NB", n: 1 }, { code: "NS", n: 1 },
];

const PRIMITIVES = [
  "dtt-black", "dtt-white", "dtt-green", "dtt-green-1", "dtt-green-2", "dtt-green-3", "dtt-green-4", "dtt-green-6", "dtt-green-7",
  "dtt-blue-1", "dtt-blue-2", "dtt-blue-3", "dtt-blue-4", "dtt-blue-5", "dtt-blue-6", "dtt-blue-7",
  "dtt-teal-1", "dtt-teal-2", "dtt-teal-3", "dtt-teal-4", "dtt-teal-5", "dtt-teal-6", "dtt-teal-7",
  "dtt-grey-2", "dtt-grey-4", "dtt-grey-6", "dtt-grey-7", "dtt-grey-9", "dtt-grey-10", "dtt-grey-11",
];
const SEMANTIC_TEXT = ["ink", "ink-2", "ink-3", "demote", "green-text", "green-deep", "alert", "warn", "up", "down", "neutral"];
const SEMANTIC_SURFACE = ["ground", "surface-1", "surface-2", "surface-3", "surface-hover", "green-soft", "alert-soft", "warn-soft"];
const SEMANTIC_MARK = ["brand-fill", "green-line", "green-mark", "focus", "rule", "rule-raised", "gridline"];
const CHART = ["seq-1", "seq-2", "seq-3", "seq-4", "seq-5", "cat-1", "cat-2", "cat-3"];

const TYPE: Array<[string, string, string]> = [
  ["display", "t-display", "Deloitte audits 17 of 259."],
  ["headline", "t-headline", "Review one field down the column"],
  ["title", "t-title", "Enrichment coverage"],
  ["subtitle", "t-subtitle", "Agnico Eagle Mines Limited"],
  ["body", "t-body", "A confident answer with no source is a hallucination with good posture."],
  ["body-sm", "t-body-sm", "Sorted by evidence ascending, so the worst work comes first."],
  ["caption", "t-caption", "found near its label"],
  ["label", "t-label", "On this page"],
];
const FIGURES: Array<[string, string]> = [["figure-xl", "fig-xl"], ["figure-lg", "fig-lg"], ["figure-md", "fig-md"], ["figure", "fig"], ["figure-sm", "fig-sm"]];

const SECTIONS = [
  { id: "tokens", label: "Tokens" }, { id: "type", label: "Type" }, { id: "space", label: "Space and shape" },
  { id: "themes", label: "Both themes" }, { id: "depth", label: "Depth" }, { id: "components", label: "Components" },
  { id: "charts", label: "Charts" }, { id: "map", label: "The map" }, { id: "objects", label: "Objects" },
  { id: "motion", label: "Motion" },
];

export default async function Styleguide() {
  try {
    await requireRole(["admin"]);
  } catch (err) {
    return err instanceof Forbidden
      ? <Refusal title="Not permitted" body="The styleguide is an Admin screen." action={{ href: "/dashboard", label: "Go to the dashboard" }} />
      : <Refusal title="Sign in" body={(err as Unauthenticated).message} action={{ href: "/signin", label: "Sign in" }} />;
  }

  return (
    <div className="withrail sg">
      <aside className="rail rise" aria-label="About this page">
        <p className="k">Living styleguide</p>
        <Facts items={[
          { label: "Built from", value: "the real tokens and components" },
          { label: "Figures", value: "invented, to show a form" },
          { label: "Guide", value: <code>docs/design/18</code> },
        ]} />
        <Contents items={SECTIONS} />
      </aside>
      <div className="reading wide">
        <h1 className="rise">Styleguide</h1>
        <p className="sub rise">
          Every token, the type scale, both themes, every component in its states, every chart form
          with its footing and its meter, the map flat and tilted, the objects, and the choreography.
          Nothing here is a screenshot, so nothing here can drift from the build.
        </p>

        <Section id="tokens" title="Tokens" index={1}
                 caption="Three layers. Primitives are Deloitte's values and the validator's derived steps; semantic tokens are what a component asks for; component aliases are owned by one component. Ratios are computed here against the surface they sit on, the same arithmetic the build gate runs.">
          <h3>Primitives</h3>
          <Swatches tokens={PRIMITIVES} against="ground" />
          <h3 style={{ marginTop: 28 }}>Text, on surface-3</h3>
          <Swatches tokens={SEMANTIC_TEXT} against="surface-3" />
          <h3 style={{ marginTop: 28 }}>Surfaces</h3>
          <Swatches tokens={SEMANTIC_SURFACE} against="ink" />
          <h3 style={{ marginTop: 28 }}>Marks and boundaries, on the surface</h3>
          <Swatches tokens={SEMANTIC_MARK} against="surface" />
          <h3 style={{ marginTop: 28 }}>Chart colour: the sequential ramp and the categorical slots</h3>
          <Swatches tokens={CHART} against="surface" />
        </Section>

        <Section id="type" title="Type" index={2}
                 caption="Open Sans for everything you read. Archivo, width axis and tabular figures, for every number that measures something. Fourteen named sizes; nothing else is legal.">
          <ul className="scale">
            {TYPE.map(([name, cls, sample]) => (
              <li key={name}><code>{name}</code><span className={cls}>{sample}</span><code>.{cls}</code></li>
            ))}
            {FIGURES.map(([name, cls]) => (
              <li key={name}><code>{name}</code><span className={cls}>259 · 17 · 6.6%</span><code>.{cls}</code></li>
            ))}
            <li><code>mono</code><span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-mono)" }}>province_footprint</span><code>--mono</code></li>
          </ul>
        </Section>

        <Section id="space" title="Space and shape" index={3}
                 caption="A 4-based spacing scale, six radii, and the fixed measures: a 56px top bar, an 880px reading measure, a 232px rail, 44px rows in the grid and 36px in the roster.">
          <div className="spaces" aria-label="Spacing scale">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} style={{ width: `var(--space-${i})`, height: `var(--space-${i})` }} title={`--space-${i}`} />
            ))}
          </div>
          <p className="meta" style={{ marginTop: 8 }}>4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64</p>
          <div className="row" style={{ marginTop: 20 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ width: 56, height: 40, border: "1px solid var(--rule-raised)", borderRadius: `var(--radius-${i})`, display: "grid", placeItems: "center", fontSize: 11 }}>r{i}</div>
            ))}
            <div style={{ width: 72, height: 40, border: "1px solid var(--rule-raised)", borderRadius: "var(--radius-pill)", display: "grid", placeItems: "center", fontSize: 11 }}>pill</div>
          </div>
        </Section>

        <Section id="themes" title="Both themes, side by side" index={4}
                 caption="Designed, not flipped: every dark token is its own step, validated against the dark surface. The top-bar switch changes the whole page; these two panes are pinned so the pair can be compared.">
          <div className="both">
            <div className="pane" data-theme="dark"><h3>Dark — the product's theme</h3><Sample /></div>
            <div className="pane" data-theme="light"><h3>Light — one press away, and what prints</h3><Sample /></div>
          </div>
        </Section>

        <Section id="depth" title="Depth and material" index={5}
                 caption="Four tiers. The ground and surface-1 are where work happens and carry no shadow; surface-2 is tracks and hover; surface-3 is the only tier with a shadow and a lift, and it is reserved for dialogs, menus, tooltips and toasts. Blur is legal on a dialog backdrop and nowhere else.">
          <div className="tiers">
            <div className="tier t0"><b>0 · ground</b><br />the page; hero, sections, tables</div>
            <div className="tier t1"><b>1 · surface-1</b><br />the grid, the evidence panel, the roster</div>
            <div className="tier t2"><b>2 · surface-2</b><br />tracks, header rows, hover, pills</div>
            <div className="tier t3"><b>3 · surface-3</b><br />dialogs, menus, tooltips, toasts</div>
          </div>
        </Section>

        <Section id="components" title="Components and their states" index={6}
                 caption="Default, hover, focus-visible, pressed, selected, disabled, loading, error. Hover and focus are the browser's to show; move the pointer or tab through.">
          <h3>Buttons</h3>
          <div className="row">
            <button type="button" className="btn primary">Publish</button>
            <button type="button" className="btn">Accept <kbd>A</kbd></button>
            <button type="button" className="btn quiet">Undo</button>
            <button type="button" className="btn" aria-pressed="true">Whitespace only</button>
            <button type="button" className="btn primary" disabled>Publish</button>
            <button type="button" className="btn primary loading" aria-busy="true">Publishing…</button>
            <button type="button" className="btn loading" aria-busy="true">Accept</button>
          </div>
          <h3>Pills and tags</h3>
          <div className="row">
            <span className="pill ok">Deloitte</span><span className="pill no">blocked</span><span className="pill warn">draft</span><span className="pill quiet">Unclassified</span>
            <span className="tag">High</span><span className="tag ok">2 sources</span><span className="tag warn">not anchored</span><span className="tag conflict">conflict</span><span className="tag done">accept</span><span className="tag retired">Won — retired</span>
          </div>
          <h3>Notices</h3>
          <div className="states">
            <div className="notice"><b>Not yet published</b><span>This page shows revision 8, which is what a Viewer sees.</span></div>
            <div className="notice alert"><b>Not published</b><span>The gate is blocked for two reasons. Publish needs an Admin and a reason.</span></div>
            <div className="notice ok"><b>Published</b><span>Revision 9 is frozen. The dashboard reads it now.</span></div>
          </div>
          <h3>Evidence strip, numeral and word</h3>
          <div className="row">
            {(["low", "medium", "high", "very high"] as const).map((band, i) => (
              <span className="ev" key={band}>
                <span aria-hidden="true" className={`strip b-${band.replace(" ", "-")}`}>
                  {[1, 2, 3, 4].map((c) => <i key={c} className={c <= i + 1 ? "on" : ""} />)}
                </span>
                <span className="num">{[0.31, 0.52, 0.81, 0.94][i].toFixed(2)}</span>
                <span className="bandword">{band}</span>
              </span>
            ))}
          </div>
          <h3>The conflict diff</h3>
          <div className="evidence" style={{ position: "static", paddingLeft: 0, borderLeft: 0, minHeight: 0, maxWidth: 480 }}>
            <div className="diff">
              <div><span className="k">Extract</span><p className="v">(empty)</p><span className="s">what the workbook says</span></div>
              <div><span className="k">AI proposal</span><p className="v">BC</p><span className="s">1 source</span></div>
            </div>
            <div className="acts">
              <button type="button" className="btn">Keep extract <kbd>K</kbd></button>
              <button type="button" className="btn">Use AI <kbd>A</kbd></button>
              <button type="button" className="btn">Enter my own <kbd>O</kbd></button>
            </div>
          </div>
          <h3>Find, inputs, switch, segmented, tabs, breadcrumb</h3>
          <div className="row">
            <div className="find"><input type="search" placeholder="Find a company…" aria-label="Find a company" /></div>
            <button type="button" className="switch" role="switch" aria-checked="true"><span className="track" aria-hidden="true" /><span>Whitespace only</span></button>
            <button type="button" className="switch" role="switch" aria-checked="false" disabled><span className="track" aria-hidden="true" /><span>Include closed</span></button>
            <div className="segmented" role="group" aria-label="View"><button type="button" aria-pressed="true">By field</button><button type="button" aria-pressed="false">By company</button></div>
          </div>
          <div className="tabs" role="tablist" aria-label="Sample tabs">
            <button type="button" role="tab" aria-selected="true">Values</button>
            <button type="button" role="tab" aria-selected="false">Evidence</button>
            <button type="button" role="tab" aria-selected="false">Since last period</button>
          </div>
          <ol className="breadcrumb"><li><a href="#components">Companies</a></li><li className="sep" aria-hidden="true">/</li><li aria-current="page">Northco Mining Corp.</li></ol>
          <h3>Menu, tooltip, toast</h3>
          <div className="row" style={{ alignItems: "flex-start", minHeight: 200 }}>
            <div className="menu-wrap">
              <button type="button" className="btn" aria-haspopup="menu" aria-expanded="true">Export ▾</button>
              <ul className="menu" role="menu" aria-label="Export">
                <li><button type="button" role="menuitem">Workbook (.xlsx)</button></li>
                <li><button type="button" role="menuitem">Flat file (.csv)</button></li>
                <li className="sep" role="separator" />
                <li><button type="button" role="menuitem">Print this page <kbd>⌘P</kbd></button></li>
              </ul>
            </div>
            <span className="has-tip" style={{ marginLeft: 200 }}>
              <button type="button" className="btn" aria-describedby="tip-1">Hover me</button>
              <span className="tooltip" role="tooltip" id="tip-1" style={{ opacity: 1 }}><b>27</b> companies hold a property in British Columbia</span>
            </span>
            <div className="toast" role="status" style={{ marginLeft: "auto" }}>Published. Revision 9 is live. <button type="button" className="btn">Open the dashboard</button></div>
          </div>
          <h3>Progress for publish</h3>
          <div className="progress" aria-label="Publishing">
            <div className="track" aria-hidden="true"><span className="done" /><span className="done" /><span className="now" /><span /><span /></div>
            <p className="stage"><b>Writing the resolved snapshot</b><span className="fig-sm">3 of 5</span></p>
          </div>
          <h3>Dialog</h3>
          <dialog open style={{ position: "static", margin: 0 }} aria-labelledby="sg-dialog-h">
            <h2 id="sg-dialog-h">Accept in bulk</h2>
            <p>Accept 1,847 values of Auditor at evidence 0.80 or above? This can be undone.</p>
            <div className="acts"><button type="button" className="btn">Cancel</button><button type="button" className="btn primary">Accept 1,847 values</button></div>
          </dialog>
          <h3>Queue tiles, gate list, state bar, drop zone</h3>
          <ul className="queue" style={{ maxWidth: 640 }}>
            <li className="here"><a href="#components"><span className="fig-lg">187</span><span className="lab">extract disagrees with AI</span><span className="start"><span className="dot" aria-hidden="true" />start here</span></a></li>
            <li><a href="#components"><span className="fig-lg">512</span><span className="lab">need review</span></a></li>
            <li><span className="cell"><span className="fig-lg">0</span><span className="lab">above threshold — bulk-acceptable</span></span></li>
          </ul>
          <ul className="gatelist" style={{ maxWidth: 640, marginTop: 16 }}>
            <li className="gateline no"><span className="mark" aria-hidden="true">✗</span><span className="what">Stage coverage 6.6% — floor is 95%</span><span className="fig-sm">17 of 259</span></li>
            <li className="gateline ok"><span className="mark" aria-hidden="true">✓</span><span className="what">No unresolved conflicts</span></li>
          </ul>
          <div className="statebar" style={{ maxWidth: 640, marginTop: 20 }} aria-label="Jobs by state">
            {["completed", "completed", "completed", "researching", "awaiting_batch", "queued", "queued", "halted"].map((s, i) => <span key={i} className={`seg ${s}`} style={{ flex: 1 }} />)}
          </div>
          <label className="drop"><span className="lab">Workbook</span><input type="file" accept=".xlsx" /><span className="hint">One .xlsx; parsed before anything is stored.</span></label>
          <h3>Skeleton</h3>
          <div style={{ maxWidth: 560 }}><DashboardSkeleton /></div>
        </Section>

        <Section id="charts" title="Charts, with their footing and their meter" index={7}
                 caption="Every population chart foots to its total. Below its coverage floor a chart renders its meter in the same footprint, so nothing jumps when coverage crosses the line.">
          <h3>Population bars, one hue, with the footing</h3>
          <Bars bars={FOOTPRINT} proof={proofLine(FOOTPRINT, POP)} />
          <h3 style={{ marginTop: 32 }}>Emphasis: Deloitte accented, the rest grey, unknown last and longest</h3>
          <Bars bars={AUDITOR} proof={proofLine(AUDITOR, POP)} />
          <h3 style={{ marginTop: 32 }}>Ordinal, with Unclassified as a gap</h3>
          <Bars bars={TIERS} proof={proofLine(TIERS, POP)} mutedStyle="gap" />
          <h3 style={{ marginTop: 32 }}>The same chart below its floor: the meter, same footprint</h3>
          <div className="meter">
            <Gauge label="Researched" resolved={17} population={259} floorPct={95} />
            <p className="msg"><span className="fig">17</span> of <span className="fig">259</span> researched. This view unlocks at 95%.</p>
            <p className="why">A chart drawn at this coverage would be well formed and wrong.</p>
          </div>
          <h3 style={{ marginTop: 32 }}>Gauges: coverage, and spend against a cap</h3>
          <div className="gauges">
            <Gauge label="Footprint" resolved={247} population={259} floorPct={95} index={0} />
            <Gauge label="Auditor cross-tab" resolved={142} population={259} floorPct={90} index={1} />
            <div className="gauge warn"><span className="lab">Spent</span><span className="track" role="img" aria-label="84 percent of the cap"><span className="fill" style={{ width: "84%" }} /><span className="floor" style={{ left: "80%" }} aria-hidden="true"><span>80%</span></span></span><span className="figs"><span className="fig">US$21.00</span><span className="of fig-sm">of US$25.00</span></span></div>
          </div>
          <h3 style={{ marginTop: 32 }}>Migration: polarity with icon and word, never light and dark green</h3>
          <table className="matrix" style={{ maxWidth: 560 }}>
            <thead><tr><th>From → to</th><th className="n">Companies</th><th>Direction</th></tr></thead>
            <tbody>
              <tr><td>Tier 6 → Tier 5</td><td className="n">4</td><td className="up">▲ improved</td></tr>
              <tr><td>Tier 2 → Tier 3</td><td className="n">1</td><td className="down">▼ declined</td></tr>
              <tr><td>Unclassified → Tier 1</td><td className="n">12</td><td className="research">● research completed</td></tr>
              <tr><td>Tier 4 → Tier 4</td><td className="n">17</td><td className="diag">— unchanged</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 32 }}>The hero sentence and the ledger line</h3>
          <p className="hero">Deloitte audits <span className="fig-xl">17</span> of <span className="fig-xl">259</span><span className="stop" aria-hidden="true" /></p>
          <Ledger items={[{ value: 259, label: "Companies" }, { value: 144, label: "TSX" }, { value: 115, label: "TSXV" }, { value: 12, label: "Unresolved values", quiet: true }]} />
        </Section>

        <Section id="map" title="The map, tilted and flat" index={8}
                 caption="The same choropleth twice. The tilted form is the hero on first load and settles on scroll or touch; height never encodes anything. Its footing is the footprint proof, because provinces count a company once each and do not add to the population.">
          <h3>Hero, tilted until touched</h3>
          <FootprintMap rows={PROVINCES} hero twinHref="#map-bars" />
          <Footing proof={proofLine(FOOTPRINT, POP)} />
          <h3 style={{ marginTop: 32 }}>Canonical, flat</h3>
          <FootprintMap rows={PROVINCES} twinHref="#map-bars" />
          <h3 id="map-bars" style={{ marginTop: 32 }}>The accessible twin, and what prints</h3>
          <Bars bars={PROVINCES.map((p) => ({ label: p.code, n: p.n, pct: Math.round((1000 * p.n) / 27) / 10 }))} />
        </Section>

        <Section id="objects" title="The object family" index={9}
                 caption="The full stop first, then three drawn from the subject's world. Each has a rendering brief in public/brand/objects and a flat fallback; none may appear inside a working grid.">
          <div className="objects">
            <figure><div style={{ background: "var(--ground)", borderRadius: 10, padding: 8 }}><Orb size={200} /></div><figcaption>The full stop. Matte satin, lit upper-left, contact shadow. Rendered.</figcaption></figure>
            <figure><img src="/brand/full-stop-flat.svg" alt="" width={200} height={200} /><figcaption>Its flat fallback: forced colours, print, reduced motion.</figcaption></figure>
            <figure><ObjectPlaceholder label="Drill core" /><figcaption>Brief 02. A split core in a black tray, one green band. Not yet rendered.</figcaption></figure>
            <figure><ObjectPlaceholder label="Claim grid" /><figcaption>Brief 03. A tilted claim lattice, one cell green. Not yet rendered.</figcaption></figure>
            <figure><ObjectPlaceholder label="Ore body" /><figcaption>Brief 04. A block model with the body in the green ramp. Not yet rendered.</figcaption></figure>
          </div>
        </Section>

        <Section id="motion" title="Motion, with a play control" index={10}
                 caption="Durations 120 / 180 / 260 / 400 / 600ms; one ease-out for entrances, one ease-in-out for state changes. First load: sections rise in a 60ms stagger, bars grow from the left, the footing's addends arrive in order and the total lands last. Nothing on grid rows. Nothing loops.">
          <Replay>
            <div className="section rise" style={{ "--i": 0, paddingTop: 0 } as CSSProperties}>
              <p className="hero rise" style={{ "--i": 1 } as CSSProperties}>Deloitte audits <span className="fig-xl">17</span> of <span className="fig-xl">259</span><span className="stop" aria-hidden="true" /></p>
              <div className="rise" style={{ "--i": 2, marginTop: 24 } as CSSProperties}><Bars bars={FOOTPRINT} proof={proofLine(FOOTPRINT, POP)} /></div>
            </div>
          </Replay>
        </Section>
      </div>
    </div>
  );
}

/** A themed sample of the parts a partner sees, for the side-by-side panes. */
function Sample() {
  return (
    <>
      <p className="hero">Deloitte audits <span className="fig-xl" style={{ fontSize: 44 }}>17</span> of <span className="fig-xl" style={{ fontSize: 44 }}>259</span><span className="stop" aria-hidden="true" /></p>
      <Ledger items={[{ value: 259, label: "Companies" }, { value: 144, label: "TSX" }, { value: 115, label: "TSXV" }]} />
      <Bars bars={AUDITOR.slice(0, 3).concat(AUDITOR.slice(-1))} proof={proofLine(AUDITOR, POP)} />
      <div className="gauges" style={{ marginTop: 20 }}><Gauge label="Stage" resolved={17} population={259} floorPct={95} compact /></div>
      <div className="row" style={{ marginTop: 20 }}>
        <button type="button" className="btn primary">Publish</button>
        <button type="button" className="btn">Accept <kbd>A</kbd></button>
        <span className="pill ok">Deloitte</span><span className="tag conflict">conflict</span><span className="tag warn">not anchored</span>
        <a href="#themes">A link</a>
      </div>
      <p className="notice" style={{ marginTop: 16, marginBottom: 0 }}><b>Published through a blocked gate</b><span>Stage coverage 6.6% against a 95% floor; day-one baseline.</span></p>
    </>
  );
}

function ObjectPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ aspectRatio: "1", borderRadius: 10, border: "1px dashed var(--rule-raised)", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 }}>
      {label}
    </div>
  );
}
