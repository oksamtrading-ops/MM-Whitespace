"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  geoDistance, geoEqualEarthRaw, geoGraticule10, geoInterpolate, geoOrthographicRaw, geoPath,
  geoProjectionMutator, geoRotation, type GeoPermissibleObjects, type GeoProjection,
} from "d3-geo";
import { decodePlaces, type Place } from "../../lib/publish/globe.ts";
import { WORLD } from "../../lib/publish/world.ts";

/**
 * The globe: every place the market holds ground or keeps a head office,
 * drawn as SVG paths re-projected in the browser (doc 19).
 *
 * One projection morphs between two shapes. At `flat` 0 it is an
 * orthographic globe a partner can turn; at 1 it is Equal Earth, the whole
 * world at once with every area true, so nothing the market holds is hidden
 * on the far side. The camera eases between states when the page asks for a
 * new one -- a selection, a frame, a step of the brief -- and stops. Nothing
 * turns on its own and nothing loops.
 *
 * What it draws comes from the page: a step of the ramp per place, discs for
 * head offices (area for the count, a green core for Deloitte's), and arcs
 * from one company's head office to each place it holds ground. No value is
 * drawn by height; an arc's lift depends on its span alone.
 *
 * Paths are re-projected imperatively while the camera moves -- three hundred
 * shapes through React at sixty frames a second is the cost this avoids --
 * and the first frame is rendered on the server, so the map is the first
 * paint and prints without script. The picture itself is hidden from
 * assistive technology: the table beside it says the same in numbers, and
 * every place in it is a button.
 */

export type Camera = {
  /** [longitude, latitude] at the centre of the globe. */
  center: [number, number];
  /** 1 fits the globe to the frame. */
  zoom: number;
  /** 0 is the globe, 1 the flat world; between is the unrolling. */
  flat: number;
  /** Changed to fly back to a camera the globe has been turned away from. */
  nonce?: number;
};

export const CAMERAS = {
  americas: { center: [-84, 26], zoom: 1, flat: 0 },
  canada: { center: [-96, 57], zoom: 2.15, flat: 0 },
  world: { center: [0, 0], zoom: 1, flat: 1 },
} satisfies Record<string, Camera>;

export type Disc = {
  key: string;
  /** The place a click on the disc selects. */
  place: string;
  at: [number, number];
  n: number;
  /** How many of n Deloitte audits: the green core's area. */
  ours: number;
  /** Head offices placed at their region's centre because no city could be. */
  dashed?: boolean;
};
export type Arc = { key: string; from: [number, number]; to: [number, number]; ours: boolean };
export type Label = { key: string; at: [number, number]; text: string; sub?: string };

const W = 1000;
const H = 620;
const RADIUS = 292;
const FLAT_SCALE = 176;
/** The largest disc's radius, in the 1000-wide frame. */
const DISC_MAX = 34;
const PLACES: Place[] = decodePlaces(WORLD);
const BY_KEY = new Map(PLACES.map((p) => [p.key, p]));
const DRAWN = PLACES.filter((p) => p.geometry);
const GRATICULE = geoGraticule10();
const SPHERE = { type: "Sphere" } as const;

// The raw projections are plain functions of (λ, φ) in d3-geo; its type
// declarations describe them as factories, so they are cast to what they are.
type Raw = (lambda: number, phi: number) => [number, number];
const ORTHO = geoOrthographicRaw as unknown as Raw;
const EQUAL_EARTH = geoEqualEarthRaw as unknown as Raw;

const mutate = geoProjectionMutator((t: number) => (x: number, y: number) => {
  const a = ORTHO(x, y);
  const b = EQUAL_EARTH(x, y);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}) as unknown as (t: number) => GeoProjection;

/** Shortest turn from a to b, in degrees. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

function rotationOf(cam: Camera): [number, number] {
  const t = cam.flat;
  const lon = cam.center[0] + turn(cam.center[0], CAMERAS.world.center[0]) * t;
  return [-lon, -cam.center[1] * (1 - t)];
}

/**
 * The scale at a camera. `fit` is the share of the frame's width on screen: a
 * phone's squarer frame crops its sides, so the flat world is drawn smaller to
 * keep every place in it, where the globe, narrower than the crop, is not.
 */
const scaleOf = (cam: Camera, fit = 1) => {
  const t = Math.min(1, Math.max(0, cam.flat));
  return RADIUS * cam.zoom * (1 - t) + FLAT_SCALE * fit * t;
};

/** The air around the globe: a ring of light just past the limb, gone once it starts to unroll. */
const airOf = (cam: Camera, fit = 1) => ({ r: (scaleOf(cam, fit) * 1.1).toFixed(1), opacity: Math.max(0, 1 - 3 * cam.flat) });

function configure(projection: GeoProjection, cam: Camera, fit = 1): GeoProjection {
  const t = Math.min(1, Math.max(0, cam.flat));
  mutate(t);
  projection
    .scale(scaleOf(cam, fit))
    .translate([W / 2, H / 2])
    .rotate(rotationOf({ ...cam, flat: t }))
    .precision(0.8);
  // Unrolling widens the clip from a hemisphere towards the whole sphere;
  // the last step hands over to the ordinary antimeridian cut.
  projection.clipAngle((t >= 0.999 ? null : 90 + 88 * t) as number);
  return projection;
}

/** Whether a point is on the drawn side at this camera. */
function shows(cam: Camera, at: [number, number]): boolean {
  if (cam.flat >= 0.999) return true;
  const [lon, lat] = rotationOf(cam);
  const limit = ((90 + 88 * cam.flat) * Math.PI) / 180 - 0.03;
  return geoDistance(at, [-lon, -lat]) < limit;
}

/**
 * An arc that leaves the ground: points along the great circle, raised at
 * the middle by a share of the radius that grows with the span alone, and
 * projected by hand so the lift reads in perspective. Segments behind the
 * globe are left out.
 */
function liftedArc(cam: Camera, scale: number, from: [number, number], to: [number, number]): string {
  const rotate = geoRotation(rotationOf(cam));
  const along = geoInterpolate(from, to);
  const span = geoDistance(from, to);
  const lift = Math.min(0.3, 0.05 + span * 0.18);
  const steps = Math.max(12, Math.ceil(span * 48));
  let d = "";
  let open = false;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const [lam, phi] = rotate(along(s)).map((v) => (v * Math.PI) / 180);
    const [x, y] = ORTHO(lam, phi);
    const k = 1 + lift * Math.sin(Math.PI * s);
    const front = Math.cos(phi) * Math.cos(lam) > 0;
    if (!front && k * Math.hypot(x, y) <= 1) { open = false; continue; }
    d += `${open ? "L" : "M"}${(W / 2 + scale * k * x).toFixed(1)},${(H / 2 - scale * k * y).toFixed(1)}`;
    open = true;
  }
  return d;
}

const same = (a: Camera, b: Camera) =>
  a.center[0] === b.center[0] && a.center[1] === b.center[1] && a.zoom === b.zoom && a.flat === b.flat;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Globe({
  steps, tone = "green", selected, marked = [], discs, discMax, arcs, labels, camera, onSelect, tooltip,
  title, keysId, first = false, rank, interactive = true,
}: {
  /** Place key to a step of the ramp, 1 to 5. A place not here is land with no companies. */
  steps: Record<string, number>;
  /** Grey when the companies lit are not Deloitte's (another firm's, or not yet known): green is Deloitte's or everyone's, never a rival's. */
  tone?: "green" | "grey";
  selected: string | null;
  /** Places to outline: the ground of a company in focus. */
  marked?: readonly string[];
  discs: Disc[];
  /** The count the largest disc stands for. Fixed per publication, so a filter never rescales a disc. */
  discMax: number;
  arcs: Arc[];
  labels: Label[];
  /** Where the globe should be. A new value is flown to. */
  camera: Camera;
  onSelect: (place: string | null) => void;
  tooltip?: (key: string) => ReactNode;
  /** The accessible name: what the picture shows, in a sentence. */
  title: string;
  /** The id of the text that says which keys turn it. */
  keysId?: string;
  /** Light places in rank order on the first paint. */
  first?: boolean;
  /** Place key to its order in the first paint's lighting. */
  rank?: Record<string, number>;
  /**
   * False for a picture that only follows the camera, as in the brief: it
   * takes no focus and no pointer, and is hidden from assistive technology
   * because the words beside it carry what it shows.
   */
  interactive?: boolean;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  // Two globes can share a page (the brief opens over the dashboard), so the
  // gradients are named per globe.
  const id = `globe${useId().replace(/[^\w-]/g, "")}`;
  const box = useRef<HTMLDivElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const current = useRef<Camera>(camera);
  const projection = useMemo(() => mutate(0), []);
  const [hover, setHover] = useState<string | null>(null);
  const [settled, setSettled] = useState(!first);
  const markedSet = new Set(marked);
  // Each label's size, measured once per commit rather than every frame of a
  // flight; and the frame's width over its height, as laid out.
  const boxes = useRef(new WeakMap<SVGGElement, DOMRect>());
  const aspect = useRef(W / H);
  const fit = () => Math.min(1, (H * aspect.current) / W);

  // The first frame, computed once: the server renders it and the browser
  // hydrates onto the same strings.
  const initial = useMemo(() => {
    const path = geoPath(configure(projection, camera)).digits(1);
    return {
      air: airOf(camera),
      sphere: path(SPHERE) ?? "",
      graticule: path(GRATICULE) ?? "",
      lands: Object.fromEntries(DRAWN.map((pl) => [pl.key, path(pl.geometry as GeoPermissibleObjects) ?? ""])),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-project. `all` redraws the land too; marks alone follow a commit. */
  const draw = (cam: Camera, all = true) => {
    const root = svg.current;
    if (!root) return;
    const p = configure(projection, cam, fit());
    const path = geoPath(p).digits(1);
    const shape = (key: string | undefined) => {
      const place = key ? BY_KEY.get(key) : undefined;
      return place?.geometry ? path(place.geometry as GeoPermissibleObjects) ?? "" : "";
    };
    if (all) {
      const sphere = path(SPHERE) ?? "";
      const air = root.querySelector<SVGCircleElement>(".air");
      if (air) { const a = airOf(cam, fit()); air.setAttribute("r", a.r); air.style.opacity = String(a.opacity); }
      root.querySelector(".sphere")?.setAttribute("d", sphere);
      root.querySelector(".limb")?.setAttribute("d", sphere);
      root.querySelector(".graticule")?.setAttribute("d", path(GRATICULE) ?? "");
      for (const el of root.querySelectorAll<SVGPathElement>("path.land")) el.setAttribute("d", shape(el.dataset.key));
    }
    for (const el of root.querySelectorAll<SVGPathElement>("path.ring")) el.setAttribute("d", shape(el.dataset.ring));
    const spots = new Map<SVGGElement, [number, number]>();
    for (const el of root.querySelectorAll<SVGGElement>("g.disc, g.lab")) {
      const at = JSON.parse(el.dataset.at ?? "null") as [number, number] | null;
      const xy = at && p(at);
      const seen = Boolean(xy && shows(cam, at!));
      if (xy) el.setAttribute("transform", `translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)})`);
      el.style.visibility = seen ? "" : "hidden";
      if (seen && el.classList.contains("lab")) spots.set(el, xy!);
    }
    // Labels come most important first. Each takes the first spot that is
    // clear of those already placed and inside the frame's unfaded middle --
    // under its disc, else over it -- or is hidden, so no two ever overlap
    // and none is cut by the edge. A phone's narrower frame crops the sides.
    // The bounds are the edge fade's (4% across, 3.5% down) and the halo's 2.
    const seenW = Math.min(W, H * aspect.current);
    const [left, right] = [(W - seenW) / 2 + 0.04 * seenW + 2, (W + seenW) / 2 - 0.04 * seenW - 2];
    const [top, bottom] = [0.035 * H + 2, 0.965 * H - 2];
    const taken: Array<[number, number, number, number]> = [];
    for (const [el, [x, y]] of spots) {
      let measured = boxes.current.get(el);
      if (!measured) {
        try { measured = el.getBBox(); } catch { continue; }
        boxes.current.set(el, measured);
      }
      const b = measured;
      const shifts = el.dataset.hang ? [0, -(2 * b.y + b.height)] : [0];
      const dy = shifts.find((s) => {
        const l = x + b.x, t = y + s + b.y, r = l + b.width, u = t + b.height;
        return l >= left && r <= right && t >= top && u <= bottom &&
          !taken.some((k) => l < k[2] && k[0] < r && t < k[3] && k[1] < u);
      });
      if (dy === undefined) { el.style.visibility = "hidden"; continue; }
      if (dy) el.setAttribute("transform", `translate(${x.toFixed(1)},${(y + dy).toFixed(1)})`);
      taken.push([x + b.x - 3, y + dy + b.y - 1, x + b.x + b.width + 3, y + dy + b.y + b.height + 1]);
    }
    const scale = p.scale();
    for (const el of root.querySelectorAll<SVGPathElement>("path.arc")) {
      const from = JSON.parse(el.dataset.from ?? "null") as [number, number];
      const to = JSON.parse(el.dataset.to ?? "null") as [number, number];
      el.setAttribute("d", cam.flat < 0.02
        ? liftedArc(cam, scale, from, to)
        : path({ type: "LineString", coordinates: [from, to] }) ?? "");
    }
    current.current = cam;
  };

  // The frame's shape as laid out, before the first placement: a phone's is
  // squarer, which crops the sides labels and the flat world must keep clear of.
  const measure = () => {
    const r = svg.current?.getBoundingClientRect();
    const was = aspect.current;
    if (r?.width && r.height) aspect.current = r.width / r.height;
    return Math.abs(aspect.current - was) > 0.01;
  };
  useLayoutEffect(() => {
    if (measure() && current.current.flat > 0) draw(current.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A commit can add discs, labels, rings or arcs drawn at no camera at all:
  // put them where the globe is now, before the browser paints. Its labels
  // may say something new, so they are measured again.
  useLayoutEffect(() => { boxes.current = new WeakMap(); draw(current.current, false); });

  // The frame's shape changes with the layout, and a web font arriving late
  // changes every label's size: place them again, and redraw a flat world
  // that no longer fits.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const redo = () => {
      const reshaped = measure();
      boxes.current = new WeakMap();
      draw(current.current, reshaped && current.current.flat > 0);
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redo);
    ro?.observe(el);
    document.fonts?.ready.then(redo).catch(() => {});
    return () => ro?.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to a new camera. Under reduced motion, cut.
  const flight = useRef<number | null>(null);
  const spin = useRef<number | null>(null);
  useEffect(() => {
    const from = current.current;
    if (same(from, camera)) return;
    if (spin.current) { cancelAnimationFrame(spin.current); spin.current = null; }
    if (reduced()) { draw(camera); return; }
    const along = geoInterpolate(from.center, camera.center);
    const ms = Math.min(1700, 520 + geoDistance(from.center, camera.center) * 360 +
      Math.abs(Math.log(camera.zoom / from.zoom)) * 300 + Math.abs(camera.flat - from.flat) * 700);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = ease(t);
      draw({
        center: along(e) as [number, number],
        zoom: from.zoom * (camera.zoom / from.zoom) ** e,
        flat: from.flat + (camera.flat - from.flat) * e,
      });
      flight.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    flight.current = requestAnimationFrame(step);
    return () => { if (flight.current) cancelAnimationFrame(flight.current); flight.current = null; };
  }, [camera.center[0], camera.center[1], camera.zoom, camera.flat, camera.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (spin.current) cancelAnimationFrame(spin.current); }, []);

  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => setSettled(true), 2400);
    return () => clearTimeout(t);
  }, [settled]);

  // Turning the globe by hand: a drag, a little inertia that runs out, and a
  // two-finger pinch that zooms. Each pointer is tracked by its id, so a second
  // finger never takes over the first one's drag.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean; vx: number; vy: number; t: number; place: string | null } | null>(null);
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const turnBy = (dx: number, dy: number) => {
    const cam = current.current;
    if (cam.flat > 0.5) return;
    const k = 0.3 / cam.zoom;
    draw({ ...cam, center: [cam.center[0] - dx * k, Math.max(-80, Math.min(80, cam.center[1] + dy * k))] });
  };
  const zoomTo = (zoom: number) => draw({ ...current.current, zoom: Math.max(0.8, Math.min(3.6, zoom)) });
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // A press while the globe unrolls into the world, or rolls back up, would
    // leave it halfway between the two: the change finishes first.
    if (flight.current && current.current.flat > 0 && current.current.flat < 1) return;
    if (spin.current) { cancelAnimationFrame(spin.current); spin.current = null; }
    if (flight.current) { cancelAnimationFrame(flight.current); flight.current = null; }
    // Captured from the start, so letting go anywhere ends the drag.
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      if (current.current.flat > 0.5) return;
      pinch.current = { d0: spread(), z0: current.current.zoom };
      if (drag.current) drag.current.moved = true;
      setHover(null);
      return;
    }
    if (pointers.current.size > 2) return;
    const place = (e.target as Element).closest<SVGElement>("[data-place]")?.dataset.place || null;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, vx: 0, vy: 0, t: performance.now(), place };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (tip.current && box.current) {
      const r = box.current.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const flip = x > r.width - 260;
      tip.current.style.transform = `translate(${Math.round(x + (flip ? -16 : 16))}px, ${Math.round(y + 16)}px)`;
      tip.current.classList.toggle("flip", flip);
    }
    const at = pointers.current.get(e.pointerId);
    if (!at) return;
    at.x = e.clientX; at.y = e.clientY;
    if (pinch.current) {
      if (pointers.current.size === 2) zoomTo(pinch.current.z0 * spread() / pinch.current.d0);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; setHover(null); }
    const now = performance.now();
    const dt = Math.max(1, now - d.t);
    d.vx = dx / dt; d.vy = dy / dt;
    d.x = e.clientX; d.y = e.clientY; d.t = now;
    turnBy(dx, dy);
  };
  const release = (e: React.PointerEvent, cancelled: boolean) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pinch.current) {
      // The finger left on the glass carries on turning from where it is.
      const [rest] = pointers.current.values();
      if (pointers.current.size === 1) {
        pinch.current = null;
        drag.current = { x: rest.x, y: rest.y, moved: true, vx: 0, vy: 0, t: performance.now(), place: null };
      } else if (pointers.current.size === 0) {
        pinch.current = null;
        drag.current = null;
      }
      return;
    }
    if (pointers.current.size) return;
    const d = drag.current;
    drag.current = null;
    if (!d || cancelled) return;
    if (!d.moved) { onSelect(d.place && d.place === selected ? null : d.place); return; }
    // A pointer held still before it lets go has no speed left to coast on.
    if (reduced() || performance.now() - d.t > 80) return;
    let vx = d.vx * 16, vy = d.vy * 16;
    const coast = () => {
      vx *= 0.92; vy *= 0.92;
      if (Math.hypot(vx, vy) < 0.15) { spin.current = null; return; }
      turnBy(vx, vy);
      spin.current = requestAnimationFrame(coast);
    };
    spin.current = requestAnimationFrame(coast);
  };
  // A trackpad pinch arrives as a wheel with ctrlKey; a plain wheel scrolls the
  // page. React listens for wheel passively, where preventDefault is ignored
  // and the browser zooms the whole page as well, so the svg listens itself.
  useEffect(() => {
    const el = svg.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      if ((!e.ctrlKey && !e.metaKey) || current.current.flat > 0.5) return;
      e.preventDefault();
      zoomTo(current.current.zoom * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && selected) { onSelect(null); e.preventDefault(); return; }
    // The browser keeps its own shortcuts: zoom the page, go Back.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cam = current.current;
    if (cam.flat > 0.5) return;
    const step = 10 / cam.zoom;
    const [lon, lat] = cam.center;
    const next: Record<string, Camera> = {
      ArrowLeft: { ...cam, center: [lon - step, lat] },
      ArrowRight: { ...cam, center: [lon + step, lat] },
      ArrowUp: { ...cam, center: [lon, Math.min(80, lat + step)] },
      ArrowDown: { ...cam, center: [lon, Math.max(-80, lat - step)] },
      "+": { ...cam, zoom: Math.min(3.6, cam.zoom * 1.25) },
      "=": { ...cam, zoom: Math.min(3.6, cam.zoom * 1.25) },
      "-": { ...cam, zoom: Math.max(0.8, cam.zoom / 1.25) },
    };
    if (!next[e.key]) return;
    e.preventDefault();
    draw(next[e.key]);
  };

  const ordered = [...discs].sort((a, b) => b.n - a.n);
  const radius = (n: number) => DISC_MAX * Math.sqrt(n / Math.max(1, discMax));
  const discR = new Map(discs.map((d) => [d.key, radius(d.n)]));
  // Discs and rings start where the camera last drawn puts them, so the
  // server's frame has them in place before any effect has run.
  const now = configure(projection, current.current, fit());
  const spot = (at: [number, number]) => {
    const xy = now(at);
    return {
      transform: xy ? `translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)})` : undefined,
      style: xy && shows(current.current, at) ? undefined : { visibility: "hidden" as const },
    };
  };
  const ringOf = (key: string) => {
    const g = BY_KEY.get(key)?.geometry;
    return g ? geoPath(now).digits(1)(g as GeoPermissibleObjects) ?? "" : "";
  };
  // A label waits to be shown until the browser has placed it clear of the
  // others and the edge, so the first paint never draws two over each other;
  // printed without script, the table beside the globe names every place.
  const unplaced = { visibility: "hidden" as const };

  return (
    <div className={`globe tone-${tone}${settled ? "" : " first"}${interactive ? "" : " still"}`} ref={box}
         {...(interactive
           ? { role: "group", "aria-roledescription": "globe", "aria-label": title, "aria-describedby": keysId,
               tabIndex: 0, onKeyDown, onPointerLeave: () => setHover(null) }
           : { "aria-hidden": true })}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"
           {...(interactive ? {
             onPointerDown, onPointerMove,
             onPointerUp: (e: React.PointerEvent) => release(e, false),
             onPointerCancel: (e: React.PointerEvent) => release(e, true),
             onLostPointerCapture: (e: React.PointerEvent) => release(e, true),
             onPointerOver: (e: React.PointerEvent) => {
               if (!drag.current?.moved && !pinch.current) setHover((e.target as Element).closest<SVGElement>("[data-key]")?.dataset.key ?? null);
             },
           } : {})}>
        <defs>
          <radialGradient id={`${id}-shade`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" className="shade-lit" />
            <stop offset="100%" className="shade-dark" />
          </radialGradient>
          <radialGradient id={`${id}-air`}>
            <stop offset="90%" className="air-in" />
            <stop offset="100%" className="air-out" />
          </radialGradient>
        </defs>
        <circle className="air" cx={W / 2} cy={H / 2} r={initial.air.r} fill={`url(#${id}-air)`} style={{ opacity: initial.air.opacity }} />
        <path className="sphere" d={initial.sphere} fill={`url(#${id}-shade)`} />
        <path className="graticule" d={initial.graticule} />
        <g className="lands">
          {DRAWN.map((pl) => {
            const order = rank?.[pl.key];
            return (
              <path key={pl.key} data-key={pl.key} data-place={pl.key} d={initial.lands[pl.key]}
                    className={`land q${steps[pl.key] ?? 0}${pl.key === hover ? " hot" : ""}`}
                    style={order === undefined ? undefined : { "--i": order } as CSSProperties} />
            );
          })}
        </g>
        {[...markedSet].filter((k) => k !== selected).map((k) => (
          <path key={`m-${k}`} className="ring marked" data-ring={k} d={ringOf(k)} />
        ))}
        {selected && <path className="ring chosen" data-ring={selected} d={ringOf(selected)} />}
        <g className="arcs">
          {arcs.map((a, i) => (
            <path key={a.key} className={`arc${a.ours ? " ours" : ""}`} data-from={JSON.stringify(a.from)}
                  data-to={JSON.stringify(a.to)} d="" pathLength={1} style={{ "--i": i } as CSSProperties} />
          ))}
        </g>
        <g className="discs">
          {ordered.map((d) => {
            const r = radius(d.n);
            return (
              <g key={d.key} className={`disc${d.dashed ? " dashed" : ""}${d.place === selected ? " on" : ""}${d.key === hover ? " hot" : ""}`}
                 data-key={d.key} data-place={d.place} data-at={JSON.stringify(d.at)} {...spot(d.at)}>
                <circle className="hit" r={Math.max(r, 7)} />
                <circle className="all" r={r} />
                {d.ours > 0 && !d.dashed && <circle className="ours" r={r * Math.sqrt(d.ours / d.n)} />}
              </g>
            );
          })}
        </g>
        <g className="labels">
          {labels.map((l) => {
            // A label on a disc hangs under it, so it never covers the green core.
            const below = discR.get(l.key);
            const y = below === undefined ? undefined : below + 3;
            return (
              <g key={l.key} className="lab" data-at={JSON.stringify(l.at)} data-hang={below === undefined ? undefined : "1"}
                 transform={spot(l.at).transform} style={unplaced}>
                <text className="name" y={y} dy={below !== undefined ? ".95em" : l.sub ? "-.2em" : ".35em"}>{l.text}</text>
                {l.sub && <text className="n" y={y} dy={below !== undefined ? "2.15em" : "1.05em"}>{l.sub}</text>}
              </g>
            );
          })}
        </g>
        <path className="limb" d={initial.sphere} />
      </svg>
      <div className="globe-tip" ref={tip} aria-hidden="true">
        {hover && tooltip ? <div className="bubble">{tooltip(hover)}</div> : null}
      </div>
    </div>
  );
}
