"use client";

// The presentation, scene by scene. Every number comes from the live plan,
// the forecast grid, the network file or the router's own search trace.
// Things that are not real data (the demo storm, the hazard concepts) say so.
//
// Explaining = pointing: every fact is a callout tied by a leader line to the
// place on the map it is about. Layers fade between scenes (never pop), and
// map data is only rewritten when it changes (quantised), to keep 60 fps.

import type { Map as GLMap } from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { BRAND } from "@/lib/brand";
import { phi, routingExposure, W } from "@/lib/core/dp";
import { wib } from "@/lib/core/eta";
import type { Fleet } from "@/lib/core/fleet";
import { arrivalRange, exposedChances } from "@/lib/core/predict";
import type { RainField, RainGrid, StormCell } from "@/lib/core/rainfield";
import {
  costOf,
  headwayAt,
  type Itinerary,
  type Leg,
  type SearchTrace,
  TRANSFER_PENALTY_MIN,
} from "@/lib/core/router";
import type { Lang } from "@/lib/i18n";
import type { PlanResponse } from "@/lib/local/planner";
import { JAKARTA_STATIONS } from "@/lib/weather/bmkg";
import { clock, legTitle } from "../format";
import {
  EMPTY,
  type FC,
  fade,
  geo,
  layer,
  ll,
  smartBearing,
  travelBearing,
} from "../gl/layers";
import { Card, Leader, type Leaders, Tether } from "../gl/leaders";
import { useGL } from "../gl/store";
import { rainRGBA } from "../rain-colors";
import type { FxMode, Src } from "./fx";

export interface Ctx {
  map: GLMap;
  r: PlanResponse;
  it: Itinerary;
  alt: Itinerary | null;
  fleet: Fleet | null;
  grid: RainGrid | null;
  field: RainField;
  lang: Lang;
  trace: { trace: SearchTrace; ms: number; relaxed: number } | null;
  pace: number;
  leaders: Leaders;
  /** per-show scratch: memoised data, last-written values */
  cache: Map<string, unknown>;
}

export interface Scene {
  id: string;
  /** seconds at 1× */
  dur: (c: Ctx) => number;
  title: (c: Ctx) => string;
  /** caption lines */
  lines: (c: Ctx) => string[];
  /** when each line starts (scene seconds); default: spread evenly */
  cues?: (c: Ctx) => number[];
  /** show layers on screen in this scene and their opacity; others fade out */
  layers?: Record<string, number>;
  /** a slow cinematic orbit (°/s) once the camera has landed */
  orbit?: number;
  enter?: (c: Ctx) => void;
  /** every animation frame; t = seconds into the scene (already paced) */
  frame?: (c: Ctx, t: number) => void;
  Hud?: (p: { c: Ctx; t: number }) => ReactNode;
  more?: (c: Ctx) => ReactNode;
  /** where the pointer goes, [lng, lat] */
  cursor?: (c: Ctx, t: number) => [number, number] | null;
  fx?: (c: Ctx, t: number) => FxMode;
}

/** layers the presentation adds; all removed at the end */
export const SHOW_LAYERS = [
  "s-bld",
  "s-net",
  "s-src",
  "s-src-label",
  "s-heat",
  "s-cols",
  "s-trace",
  "s-edges",
  "s-edge-lbl",
  "s-done",
  "s-done-lbl",
  "s-best",
  "s-alt",
  "s-leg",
  "s-sample",
  "s-cells",
  "s-hazard",
];

/** Fade every show layer to what the scene wants (absent = 0). */
export function stageLayers(c: Ctx, want: Record<string, number> = {}) {
  for (const id of SHOW_LAYERS) {
    if (id === "s-bld" || !c.map.getLayer(id)) continue;
    fade(c.map, id, want[id] ?? 0, 700);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** add a layer once, starting transparent; stageLayers fades it in */
function showLayer(c: Ctx, spec: Parameters<typeof layer>[1], before?: string) {
  const had = !!c.map.getLayer(spec.id);
  layer(c.map, spec, before);
  if (!had) fade(c.map, spec.id, 0, 0);
}

const id = (c: Ctx, en: string, idn: string) => (c.lang === "id" ? idn : en);
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (v: number) => 1 - (1 - clamp(v)) ** 3;

function memo<T>(c: Ctx, key: string, fn: () => T): T {
  if (!c.cache.has(key)) c.cache.set(key, fn());
  return c.cache.get(key) as T;
}
/** true when `v` differs from the last value stored under `key` */
function changed(c: Ctx, key: string, v: unknown): boolean {
  const k = `~${key}`;
  if (c.cache.get(k) === v) return false;
  c.cache.set(k, v);
  return true;
}

export function project(c: Ctx, p: [number, number]): [number, number] {
  const q = c.map.project(p);
  return [q.x, q.y];
}

/** slow in, slow out: every camera move starts and lands softly */
const inOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

function camTo(
  c: Ctx,
  o: {
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
    ms?: number;
  },
) {
  c.map.flyTo({
    center: o.center,
    zoom: o.zoom,
    pitch: o.pitch ?? 0,
    bearing: o.bearing ?? 0,
    duration: (o.ms ?? 2400) / c.pace,
    easing: inOut,
    // a far move arcs out and back in (anticipation); a near one glides
    curve: 1.5,
    essential: true,
  });
}

function bounds(pts: [number, number][]) {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ] as [[number, number], [number, number]];
}

function frameOn(
  c: Ctx,
  pts: [number, number][],
  o: {
    pitch?: number;
    bearing?: number;
    ms?: number;
    pad?: number;
    /** room kept free at the top (a panel lives there) */
    top?: number;
    maxZoom?: number;
  } = {},
) {
  if (pts.length < 2) return;
  const pad = o.pad ?? 80;
  const cam = c.map.cameraForBounds(bounds(pts), {
    padding: {
      top: o.top ?? pad + 60,
      bottom: pad + 170,
      left: pad,
      right: pad,
    },
    bearing: o.bearing ?? 0,
    maxZoom: o.maxZoom ?? 16,
  });
  if (!cam) return;
  c.map.flyTo({
    ...cam,
    pitch: o.pitch ?? 0,
    duration: (o.ms ?? 2200) / c.pace,
    easing: inOut,
    curve: 1.5,
    essential: true,
  });
}

function itPts(it: Itinerary | null): [number, number][] {
  return (it?.legs ?? []).flatMap((g) => g.path.map(ll));
}

function bearingOf(g: Leg): number {
  const a = g.path[0];
  const b = g.path[g.path.length - 1];
  if (!a || !b) return 0;
  return (
    (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) *
      180) /
    Math.PI
  );
}

function mid(g: Leg): [number, number] {
  const p = g.path[Math.floor(g.path.length / 2)] ?? [g.from.lat, g.from.lng];
  return [p[1], p[0]];
}
function midOf(it: Itinerary): [number, number] {
  const pts = itPts(it);
  return pts[Math.floor(pts.length / 2)] ?? [106.83, -6.2];
}

function gridPoints(c: Ctx): [number, number][] {
  return memo(c, "gridPts", () => {
    const g = c.grid;
    const out: [number, number][] = [];
    if (!g) return out;
    for (let i = 0; i < g.nLat; i++)
      for (let j = 0; j < g.nLng; j++)
        out.push([g.lng0 + j * g.dLng, g.lat0 + i * g.dLat]);
    return out;
  });
}

function nearest(pts: [number, number][], to: [number, number]) {
  let best = pts[0];
  let d = Number.POSITIVE_INFINITY;
  for (const p of pts) {
    const e = (p[0] - to[0]) ** 2 + (p[1] - to[1]) ** 2;
    if (e < d) {
      d = e;
      best = p;
    }
  }
  return best;
}

/** legs worth explaining, in travel order */
function scoreLegs(it: Itinerary): Leg[] {
  return it.legs.filter((g) => g.minutes >= 0.3).slice(0, 6);
}
const LEG_S = 4.4;
const LEG_T0 = 1.4;

function legCostOf(g: Leg, c: Ctx) {
  const p = c.r.params;
  const w = W[g.kind];
  const E = routingExposure(g.kind);
  const ph = phi(g.rain, p.r0, p.k);
  return { w, E, ph, cost: g.minutes * w * (1 + p.beta * E * ph) };
}

function timePart(it: Itinerary) {
  return (
    it.legs.reduce((a, g) => a + g.minutes * W[g.kind], 0) +
    TRANSFER_PENALTY_MIN * it.transfers
  );
}

const start = (c: Ctx): [number, number] => {
  const a = c.it.legs[0]?.from ?? { lat: -6.2, lng: 106.83 };
  return [a.lng, a.lat];
};
const goal = (c: Ctx): [number, number] => {
  const b = c.it.legs.at(-1)?.to ?? { lat: -6.2, lng: 106.83 };
  return [b.lng, b.lat];
};

let netCache: { v: string; fc: FC } | null = null;
function networkFC(f: Fleet): FC {
  const v = `${f.net.version}`;
  if (netCache?.v === v) return netCache.fc;
  const features: GeoJSON.Feature[] = [];
  f.net.patterns.forEach((p, pi) => {
    const r = f.net.routes[p.route];
    // trunk lines only: rail and the BRT corridors. Feeders and microbuses
    // would bury the picture under thousands of thin lines.
    if (r.mode === "transjakarta" && r.cat !== "BRT") return;
    const g = f.geo(pi);
    const coords: [number, number][] = [];
    // every other point is plenty at city scale
    for (let i = 0; i < g.lat.length; i += 2) coords.push([g.lng[i], g.lat[i]]);
    features.push({
      type: "Feature",
      properties: {
        c: r.color,
        rail: r.mode === "transjakarta" ? 0 : 1,
        // reveal order: rail first, then the corridors one by one
        o: r.mode === "transjakarta" ? 0.2 + ((pi * 7919) % 1000) / 1250 : 0.05,
      },
      geometry: { type: "LineString", coordinates: coords },
    });
  });
  const fc: FC = { type: "FeatureCollection", features };
  netCache = { v, fc };
  return fc;
}

function trunkPatterns(c: Ctx): number[] {
  return memo(c, "trunk", () => {
    const f = c.fleet;
    if (!f) return [];
    return [...f.net.patterns.keys()].filter((pi) => {
      const r = f.net.routes[f.net.patterns[pi].route];
      return r.mode !== "transjakarta" || r.cat === "BRT";
    });
  });
}

/** the longest pattern of a kind of line, and a point in its middle */
function showcaseLine(
  c: Ctx,
  pred: (r: Fleet["net"]["routes"][number]) => boolean,
) {
  const f = c.fleet;
  if (!f) return null;
  let best = -1;
  let len = 0;
  f.net.patterns.forEach((p, pi) => {
    if (!pred(f.net.routes[p.route])) return;
    const d = p.offsets[p.offsets.length - 1] ?? 0;
    if (d > len) {
      len = d;
      best = pi;
    }
  });
  if (best < 0) return null;
  const g = f.geo(best);
  const k = Math.floor(g.lat.length * 0.42);
  const p = f.net.patterns[best];
  return {
    pi: best,
    at: [g.lng[k], g.lat[k]] as [number, number],
    route: f.net.routes[p.route],
    stops: p.stops.length,
    headMin: Math.round(headwayAt(p, Date.now()) / 60),
  };
}

function circle(
  lng: number,
  lat: number,
  km: number,
  n = 48,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([
      lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a),
      lat + (km / 111.32) * Math.sin(a),
    ]);
  }
  return out;
}

/** a storm to show when the user is on live weather (labelled as a demo) */
function demoCell(c: Ctx): StormCell {
  const a = c.it.legs[0]?.from ?? { lat: -6.2, lng: 106.82 };
  return {
    lat: a.lat + 0.02,
    lng: a.lng - 0.12,
    peak: 24,
    radiusKm: 4,
    vEast: 18,
    vNorth: -4,
  };
}

function cellAt(cell: StormCell, minutes: number): [number, number] {
  const h = minutes / 60;
  return [
    cell.lng +
      (cell.vEast * h) / (111.32 * Math.cos((cell.lat * Math.PI) / 180)),
    cell.lat + (cell.vNorth * h) / 111.32,
  ];
}

/** rain falls with the storm's wind: km/h east → px/s on screen */
const windOf = (c: Ctx) => {
  const cell = c.r.cells[0];
  return cell ? clamp(cell.vEast * 9, -260, 260) : 90;
};

// ── small HUD pieces ────────────────────────────────────────────────────────

// The look: deep water. Ink and electric blue with white panels, one cyan
// for structure and one gold for the thing that matters (the rain cost).
// Panels are skewed; the text inside them stays straight to stay readable.
const glass =
  "border-l-4 border-[#33d6ff] bg-[#050b2e]/90 text-white shadow-[8px_8px_0_rgba(21,70,255,.55)] backdrop-blur-sm";

/** entrances wipe in along the diagonal and settle with a small overshoot */
const wipeIn = {
  initial: {
    opacity: 0,
    x: -36,
    clipPath: "polygon(0 0, 0 0, -20% 100%, -20% 100%)",
  },
  animate: {
    opacity: 1,
    x: 0,
    clipPath: "polygon(0 0, 120% 0, 100% 100%, -20% 100%)",
  },
  exit: {
    opacity: 0,
    x: 28,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const },
  },
};

function Pop({
  show,
  children,
  className = "",
  delay = 0,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          {...wipeIn}
          transition={{
            x: { type: "spring", stiffness: 420, damping: 24, delay },
            clipPath: { duration: 0.34, ease: [0.16, 1, 0.3, 1], delay },
            opacity: { duration: 0.12, delay },
          }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** a number that counts up to its value on its own clock (no re-renders) */
function Run({
  v,
  over = 1.2,
  fmt = (x: number) => Math.round(x).toLocaleString(),
}: {
  v: number;
  over?: number;
  fmt?: (x: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fmt is display only
  useEffect(() => {
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const u = ease((now - t0) / (over * 1000));
      const x = a + (v - a) * u;
      if (ref.current) ref.current.textContent = fmt(x);
      from.current = x;
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v, over]);
  return (
    <span ref={ref} className="tabular-nums">
      {fmt(from.current)}
    </span>
  );
}

function Stat({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub?: string;
}) {
  return (
    <div className="slant min-w-36 px-3 py-1 text-[#050b2e] [--sl-sh:5px_5px_0_#1546ff]">
      <div>
        <div className="text-[10px] font-black tracking-[0.2em] text-[#1546ff] uppercase">
          {label}
        </div>
        <div className="text-xl leading-none font-black italic tabular-nums">
          {children}
        </div>
        {sub && (
          <div className="mt-0.5 text-[11px] font-semibold text-[#050b2e]/65">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/** the cost formula, its slots filled by numbers that fly in from the map */
function Equation({
  c,
  g,
  k,
  from,
}: {
  c: Ctx;
  g: Leg;
  k: number;
  from: [number, number];
}) {
  const { w, E, ph, cost } = legCostOf(g, c);
  const terms: [string, string, string][] = [
    ["τ", f1(g.minutes), id(c, "minutes", "menit")],
    ["w", f1(w), id(c, "how long it feels", "terasa")],
    ["β", f1(c.r.params.beta), id(c, "your rain care", "kepedulian")],
    ["E", E.toFixed(0), id(c, "rain reaches you?", "kena hujan?")],
    ["φ", f2(ph), `r = ${f1(g.rain)} mm/h`],
  ];
  const slots = useRef<(HTMLSpanElement | null)[]>([]);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const [origin] = useState(from);
  useEffect(() => {
    setRects(
      slots.current.map((s) => s?.getBoundingClientRect() ?? new DOMRect()),
    );
  }, []);
  const term = (i: number) => (
    <span
      ref={(e) => {
        slots.current[i] = e;
      }}
      className="inline-flex min-w-11 flex-col items-center bg-white/10 px-1.5 py-0.5 whitespace-nowrap ring-1 ring-[#33d6ff]/40"
    >
      <span className="text-[#33d6ff]">{terms[i][0]}</span>
      <span className="text-[9px] leading-tight text-slate-400">
        {terms[i][2]}
      </span>
    </span>
  );
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className={`${glass} pointer-events-none absolute bottom-[176px] left-1/2 flex max-w-[96vw] -translate-x-1/2 items-center gap-1 px-3 py-2.5 font-mono text-base whitespace-nowrap sm:bottom-[156px] sm:gap-1.5 sm:text-lg`}
      >
        <span className="mr-1 text-slate-300">c =</span>
        {term(0)}·{term(1)}·<span>(1 +</span>
        {term(2)}·{term(3)}·{term(4)}
        <span>)</span>
        <span className="mx-1">=</span>
        <motion.span
          key={`cost-${k}`}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: [0.4, 1.25, 1] }}
          transition={{ delay: 1.8 / c.pace, duration: 0.5 }}
          className="slant min-w-14 [--sl-bg:#ffd400] px-2 text-center font-black text-[#050b2e] italic"
        >
          {f1(cost)}
        </motion.span>
      </motion.div>
      {/* numbers lift off the leg on the map and land in their slot */}
      {rects.length === 5 &&
        terms.map(([sym, val], i) => (
          <motion.div
            key={`${k}-${sym}`}
            className="pointer-events-none absolute top-0 left-0 bg-white px-1.5 font-mono text-sm font-black text-[#050b2e] shadow-[3px_3px_0_#1546ff]"
            initial={{ x: origin[0], y: origin[1], scale: 0.2, opacity: 0 }}
            animate={{
              x: [
                origin[0],
                origin[0] + (i - 2) * 30,
                rects[i].left + rects[i].width / 2 - 14,
              ],
              y: [origin[1], origin[1] - 70, rects[i].top - 22],
              scale: [0.2, 1.3, 1],
              opacity: [0, 1, 1],
            }}
            transition={{
              duration: 1.1 / c.pace,
              delay: (0.25 + i * 0.14) / c.pace,
              ease: [0.65, 0, 0.35, 1],
            }}
          >
            {val}
          </motion.div>
        ))}
    </>
  );
}

// ── the search replay ───────────────────────────────────────────────────────

/** detailed steps shown one by one before the fast-forward */
const DETAIL = 6;
const S_A = 3; // first settle
const S_STEP = 2.1; // seconds per detailed step
const S_FAST = S_A + DETAIL * S_STEP; // fast-forward starts
const S_GOAL = S_FAST + 6.5; // goal settled
const S_DUR = S_GOAL + 6;

interface SearchPrep {
  pos: (n: number) => [number, number];
  name: (n: number) => string;
  steps: SearchTrace["steps"];
  detail: number;
  /** the to-do list after k settles: cheapest first */
  queue: (k: number) => { n: number; cost: number }[];
  /** the connections tried at step k (k = 0: from the start) */
  edges: (k: number) => FC;
  goalCost: number;
}

function searchPrep(c: Ctx): SearchPrep | null {
  const T = c.trace?.trace;
  const S = c.fleet?.net.stops;
  if (!T || !S || !T.steps.length) return null;
  return memo(c, "search", () => {
    const g = goal(c);
    const o = start(c);
    const pos = (n: number): [number, number] =>
      n === T.dest ? g : [S.lng[n], S.lat[n]];
    const name = (n: number) =>
      n === T.dest
        ? (c.it.legs.at(-1)?.to.name ?? id(c, "Goal", "Tujuan"))
        : S.name[n];
    const detail = Math.min(DETAIL, T.steps.length - 1);
    const queue = (k: number) => {
      const tent = new Map<number, number>(T.init);
      const done = new Set<number>();
      for (let i = 0; i < k && i < T.steps.length; i++) {
        done.add(T.steps[i].s);
        for (const [n, cost] of T.steps[i].relax ?? []) tent.set(n, cost);
      }
      return [...tent]
        .filter(([n]) => !done.has(n))
        .sort((a, b) => a[1] - b[1])
        .slice(0, 6)
        .map(([n, cost]) => ({ n, cost }));
    };
    const edges = (k: number): FC => {
      const from = k === 0 ? o : pos(T.steps[k - 1].s);
      const list = (k === 0 ? T.init : (T.steps[k - 1].relax ?? []))
        .slice()
        .sort((a, b) => a[1] - b[1])
        .slice(0, 24);
      return {
        type: "FeatureCollection",
        features: list.flatMap(([n, cost]) => [
          {
            type: "Feature" as const,
            properties: { l: "" },
            geometry: {
              type: "LineString" as const,
              coordinates: [from, pos(n)],
            },
          },
          {
            type: "Feature" as const,
            properties: { l: f1(cost) },
            geometry: { type: "Point" as const, coordinates: pos(n) },
          },
        ]),
      };
    };
    const last = T.steps.at(-1);
    return {
      pos,
      name,
      steps: T.steps,
      detail,
      queue,
      edges,
      goalCost: last?.s === T.dest ? last.cost : c.it.cost,
    };
  });
}

/** settled stops shown so far, at scene time t */
function settledAt(p: SearchPrep, t: number): number {
  if (t < S_A) return 0;
  if (t < S_FAST) return Math.min(p.detail, Math.floor((t - S_A) / S_STEP) + 1);
  // fast-forward: the rest, quantised so the map updates ~12× a second
  const u = clamp((t - S_FAST - 0.6) / (S_GOAL - S_FAST - 0.6));
  const q = Math.round(ease(u) * 40) / 40;
  return Math.round(p.detail + (p.steps.length - p.detail) * q);
}

// ── the finale's morph: capture what is on the map, in screen space ─────────

function captureSrc(c: Ctx): Src[] {
  const W0 = innerWidth;
  const H0 = innerHeight;
  const out: Src[] = [];
  const add = (lng: number, lat: number, col: string) => {
    const p = c.map.project([lng, lat]);
    if (p.x >= 0 && p.x <= W0 && p.y >= 0 && p.y <= H0)
      out.push({ x: p.x, y: p.y, c: col });
  };
  // the lines
  if (c.fleet) {
    const fc = networkFC(c.fleet);
    let n = 0;
    for (const f of fc.features)
      if (f.geometry.type === "LineString") n += f.geometry.coordinates.length;
    const stride = Math.max(1, Math.floor(n / 1000));
    let k = 0;
    for (const f of fc.features)
      if (f.geometry.type === "LineString")
        for (const q of f.geometry.coordinates)
          if (k++ % stride === 0)
            add(q[0], q[1], (f.properties?.c as string) ?? "#33d6ff");
    // the vehicles
    for (const v of c.fleet.at(Date.now(), { only: trunkPatterns(c) }))
      add(v.lng, v.lat, c.fleet.net.routes[v.route].color);
  }
  // the heat: the rain grid in its rain colours
  for (const [x, y] of gridPoints(c)) {
    const r = c.field.at(y, x, c.r.depart);
    const [R, G, B] = r > 0.05 ? rainRGBA(Math.max(r, 0.6)) : [51, 214, 255];
    add(x, y, `rgb(${R},${G},${B})`);
  }
  // the search
  const T = c.trace?.trace;
  const S = c.fleet?.net.stops;
  if (T && S) {
    const stride = Math.max(1, Math.floor(T.steps.length / 400));
    T.steps.forEach((s, i) => {
      if (i % stride === 0 && s.s !== T.dest)
        add(
          S.lng[s.s],
          S.lat[s.s],
          i / T.steps.length < 0.5 ? "#7fe7ff" : "#a78bfa",
        );
    });
  }
  // your route, in gold
  const pts = itPts(c.it);
  const stride = Math.max(1, Math.floor(pts.length / 160));
  pts.forEach((q, i) => {
    if (i % stride === 0) add(q[0], q[1], "#ffd400");
  });
  if (out.length > 2600) {
    const s = out.length / 2600;
    return Array.from({ length: 2600 }, (_, i) => out[Math.floor(i * s)]);
  }
  return out;
}

const MORPH_AT = 3.6;
const MORPH_BACK = 10.2;
const APP_LAYERS: [string, number][] = [
  ["w-fleet", 1],
  ["w-fleet-label", 1],
  ["w-route-case", 0.9],
  ["w-route", 1],
  ["w-route-walk", 1],
];
/** the app's own map layers (route, vehicles) back to normal */
export function restoreAppLayers(map: GLMap) {
  for (const [l, v] of APP_LAYERS) fade(map, l, v, 500);
}

/** the other option, dashed white, under the chosen route */
function altLayer(c: Ctx) {
  geo(c.map, "s-alt", {
    type: "FeatureCollection",
    features: c.alt
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: itPts(c.alt) },
          },
        ]
      : [],
  });
  showLayer(
    c,
    {
      id: "s-alt",
      type: "line",
      source: "s-alt",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 3,
        "line-dasharray": [1.5, 1.5],
      },
    },
    "w-route-case",
  );
}

// ── the scenes ──────────────────────────────────────────────────────────────

export const SCENES: Scene[] = [
  {
    id: "intro",
    dur: () => 8,
    title: (c) => id(c, "How the route is chosen", "Cara rute dipilih"),
    lines: (c) => [
      id(
        c,
        "Here's how this app picks a route when it rains.",
        "Begini cara aplikasi ini memilih rute saat hujan.",
      ),
      id(
        c,
        "Everything you'll see is computed from real data, live.",
        "Semua yang kamu lihat dihitung langsung dari data nyata.",
      ),
    ],
    enter: (c) => {
      // the establishing shot: high and turned, settling north as we descend
      c.map.jumpTo({
        center: [106.83, -6.2],
        zoom: 9.4,
        pitch: 0,
        bearing: -35,
      });
      camTo(c, {
        center: [106.83, -6.19],
        zoom: 12.2,
        pitch: 58,
        bearing: 0,
        ms: 7200,
      });
    },
    fx: () => ({ k: "drift" }),
    Hud: ({ c, t }) => (
      <div className="pointer-events-none absolute inset-x-0 top-[18%] flex flex-col items-center text-center text-white">
        <Pop
          show={t > 0.6}
          className="text-xs tracking-[0.4em] text-[#33d6ff] uppercase"
        >
          {BRAND.project} · {BRAND.app}
        </Pop>
        <Pop
          show={t > 1.1}
          delay={0.05}
          className="mt-2 px-6 text-4xl font-black tracking-tight italic drop-shadow-[4px_4px_0_#1546ff] sm:text-6xl"
        >
          {id(c, "Fastest, or driest?", "Tercepat, atau terkering?")}
        </Pop>
        <Pop
          show={t > 2.2}
          className="mt-3 max-w-md px-6 text-sm text-slate-200"
        >
          {id(
            c,
            "Weather-Aware Multimodal Public Transportation Routing, on Jakarta's real network.",
            "Perutean transportasi umum multimoda sadar cuaca, di jaringan nyata Jakarta.",
          )}
        </Pop>
      </div>
    ),
  },
  {
    id: "question",
    dur: () => 9,
    title: (c) => id(c, "Your trip", "Perjalananmu"),
    layers: { "s-alt": 0.85 },
    lines: (c) => [
      id(
        c,
        `From ${c.it.legs[0]?.from.name ?? "here"} to ${c.it.legs.at(-1)?.to.name ?? "there"}, leaving at ${clock(c.r.depart)}.`,
        `Dari ${c.it.legs[0]?.from.name ?? "sini"} ke ${c.it.legs.at(-1)?.to.name ?? "sana"}, berangkat ${clock(c.r.depart)}.`,
      ),
      id(
        c,
        "A normal app asks one thing: which is fastest? We also ask: how wet will you get?",
        "Aplikasi biasa hanya bertanya: mana yang tercepat? Kami juga bertanya: seberapa basah kamu nanti?",
      ),
    ],
    enter: (c) => {
      altLayer(c);
      // the trip reads upward on screen: start at the bottom, goal on top
      frameOn(c, itPts(c.it).concat(itPts(c.alt)), {
        pitch: 45,
        bearing: smartBearing(travelBearing(itPts(c.it))),
        ms: 2600,
      });
    },
    cursor: (c, t) => (t < 2.5 ? start(c) : t < 5 ? goal(c) : midOf(c.it)),
    Hud: ({ c, t }) => {
      const a = c.it.legs[0]?.from;
      const b = c.it.legs.at(-1)?.to;
      if (!a || !b) return null;
      const km = Math.hypot((b.lat - a.lat) * 111.32, (b.lng - a.lng) * 110.6);
      const e = c.r.explain;
      return (
        <>
          <Leader scope={c.leaders} at={start(c)} show={t > 1} dx={-60} dy={30}>
            <Card
              label={id(c, "start", "mulai")}
              sub={`${id(c, "leave", "berangkat")} ${clock(c.r.depart)}`}
            >
              {a.name}
            </Card>
          </Leader>
          <Leader
            scope={c.leaders}
            at={goal(c)}
            show={t > 2.8}
            dx={60}
            dy={-40}
          >
            <Card
              label={id(c, "goal", "tujuan")}
              sub={`${f1(km)} km ${id(c, "as the crow flies", "garis lurus")}`}
            >
              {b.name}
            </Card>
          </Leader>
          <Leader
            scope={c.leaders}
            at={midOf(c.it)}
            show={t > 5}
            dx={70}
            dy={50}
          >
            <Card
              tone="gold"
              label={id(c, "the question", "pertanyaannya")}
              sub={
                c.alt
                  ? id(
                      c,
                      "solid: the pick · dashed: the other option",
                      "garis penuh: pilihan · putus-putus: opsi lain",
                    )
                  : undefined
              }
            >
              {e && c.r.shift
                ? id(
                    c,
                    `+${Math.round(e.extraMin)} min for ${Math.round(e.doseSavedPct)}% less rain?`,
                    `+${Math.round(e.extraMin)} mnt untuk ${Math.round(e.doseSavedPct)}% lebih sedikit hujan?`,
                  )
                : id(c, "Fastest, or driest?", "Tercepat, atau terkering?")}
            </Card>
          </Leader>
        </>
      );
    },
  },
  {
    id: "sky",
    dur: () => 12,
    title: (c) =>
      id(c, "Where the rain data comes from", "Dari mana data hujan"),
    layers: { "s-src": 1, "s-src-label": 1 },
    lines: (c) => [
      id(
        c,
        "First we pull the rain forecast: a grid of points over Jabodetabek, every 15 minutes.",
        "Pertama kami ambil prakiraan hujan: titik-titik grid di Jabodetabek, tiap 15 menit.",
      ),
      id(
        c,
        "Weather models behind it (ECMWF, GFS…) take in satellite observations, like Japan's Himawari-9 over Indonesia.",
        "Model cuaca di baliknya (ECMWF, GFS…) memakai pengamatan satelit, seperti Himawari-9 milik Jepang di atas Indonesia.",
      ),
      id(
        c,
        `BMKG's ${JAKARTA_STATIONS.length} kecamatan forecasts are the check and the fallback.`,
        `${JAKARTA_STATIONS.length} prakiraan kecamatan BMKG jadi pembanding dan cadangan.`,
      ),
    ],
    cues: () => [0, 3.6, 7],
    enter: (c) => {
      camTo(c, {
        center: [106.82, -6.25],
        zoom: 9.7,
        pitch: 35,
        bearing: 0,
        ms: 2600,
      });
      const pts = gridPoints(c);
      geo(c.map, "s-src", {
        type: "FeatureCollection",
        features: [
          ...pts.map((p, i) => ({
            type: "Feature" as const,
            properties: { k: "grid", o: i / Math.max(1, pts.length), n: "" },
            geometry: { type: "Point" as const, coordinates: p },
          })),
          ...JAKARTA_STATIONS.map((s, i) => ({
            type: "Feature" as const,
            properties: {
              k: "bmkg",
              o: 0.5 + i / JAKARTA_STATIONS.length / 2,
              n: s.name,
            },
            geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
          })),
        ],
      });
      showLayer(c, {
        id: "s-src",
        type: "circle",
        source: "s-src",
        paint: {
          "circle-radius": ["case", ["==", ["get", "k"], "bmkg"], 5, 3.5],
          "circle-color": [
            "case",
            ["==", ["get", "k"], "bmkg"],
            "#ffd400",
            "#33d6ff",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#050b2e",
        },
      });
      showLayer(c, {
        id: "s-src-label",
        type: "symbol",
        source: "s-src",
        filter: ["==", ["get", "k"], "bmkg"],
        layout: {
          "text-field": ["get", "n"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.1],
        },
        paint: {
          "text-color": "#fff3b0",
          "text-halo-color": "#050b2e",
          "text-halo-width": 1.2,
        },
      });
      c.map.setFilter("s-src", ["<=", ["get", "o"], 0]);
      changed(c, "sky-o", -1);
    },
    frame: (c, t) => {
      // the grid lights up first, then the BMKG points join (24 steps)
      const o = Math.round(clamp((t - 0.8) / 6.5) * 24) / 24;
      if (changed(c, "sky-o", o) && c.map.getLayer("s-src")) {
        c.map.setFilter("s-src", ["<=", ["get", "o"], o]);
        c.map.setFilter("s-src-label", [
          "all",
          ["==", ["get", "k"], "bmkg"],
          ["<=", ["get", "o"], o],
        ]);
      }
    },
    fx: (c, t) => {
      if (!c.grid || t < 3.2 || t > 7.5) return { k: "drift" };
      const pts = memo(c, "sky-stream", () =>
        gridPoints(c).filter((_, i) => i % 4 === 0),
      );
      return {
        k: "stream",
        from: [window.innerWidth - 90, 80],
        to: pts.map((p) => project(c, p)),
        color: "#33d6ff",
      };
    },
    Hud: ({ c, t }) => {
      const g = c.grid;
      const pts = gridPoints(c);
      const near = pts.length ? nearest(pts, start(c)) : start(c);
      const st = memo(c, "sky-bmkg", () => {
        const [x, y] = goal(c);
        let best = JAKARTA_STATIONS[0];
        let d = Number.POSITIVE_INFINITY;
        for (const s of JAKARTA_STATIONS) {
          const e = (s.lon - x) ** 2 + (s.lat - y) ** 2;
          if (e < d) {
            d = e;
            best = s;
          }
        }
        return best;
      });
      return (
        <>
          <Pop
            show={t > 3}
            className="pointer-events-none absolute top-20 right-4"
          >
            <div
              className={`${glass} flex items-center gap-2 px-3 py-2 text-xs`}
            >
              <motion.span
                className="text-2xl"
                animate={{ rotate: [0, 8, 0, -8, 0] }}
                transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY }}
              >
                🛰️
              </motion.span>
              <div>
                <div className="font-semibold">Himawari-9 (JMA)</div>
                <div className="text-slate-300">
                  {id(
                    c,
                    "geostationary · 140.7°E · ~35,800 km up · every 10 min",
                    "geostasioner · 140,7°BT · ~35.800 km · tiap 10 menit",
                  )}
                </div>
              </div>
            </div>
          </Pop>
          <Leader scope={c.leaders} at={near} show={t > 1.4} dx={-70} dy={-60}>
            <Card
              label={id(c, "forecast grid", "grid prakiraan")}
              sub={
                g
                  ? `${g.nLat} × ${g.nLng} ${id(c, "points, ~4.5 km apart", "titik, jarak ~4,5 km")} × ${g.nt} ${id(c, "steps of 15 min", "langkah 15 mnt")}`
                  : c.r.rain.source
              }
            >
              {g ? <Run v={g.nLat * g.nLng * g.nt} /> : "—"}{" "}
              {id(c, "rain values", "nilai hujan")}
            </Card>
          </Leader>
          <Leader
            scope={c.leaders}
            at={[st.lon, st.lat]}
            show={t > 7.2}
            dx={70}
            dy={40}
          >
            <Card
              label={`BMKG · ${st.name}`}
              sub={id(
                c,
                "one of the kecamatan forecasts: the check and the fallback",
                "salah satu prakiraan kecamatan: pembanding dan cadangan",
              )}
            >
              {JAKARTA_STATIONS.length} {id(c, "stations", "titik")}
            </Card>
          </Leader>
          <Pop
            show={t > 9}
            className="pointer-events-none absolute top-24 left-4"
          >
            <Stat
              label={id(c, "source used now", "sumber saat ini")}
              sub={
                c.r.rain.issuedAt
                  ? `${id(c, "issued", "terbit")} ${clock(c.r.rain.issuedAt)}`
                  : undefined
              }
            >
              <span className="text-sm">{c.r.rain.source}</span>
            </Stat>
          </Pop>
        </>
      );
    },
    more: (c) => (
      <ul className="list-disc space-y-1 pl-4">
        <li>
          {id(
            c,
            "Open-Meteo 15-minute precipitation for a ~4.5 km grid (in Indonesia these are interpolated from hourly model output).",
            "Presipitasi 15 menit Open-Meteo untuk grid ~4,5 km (di Indonesia diinterpolasi dari keluaran model per jam).",
          )}
        </li>
        <li>
          {id(
            c,
            "BMKG public forecasts for one kelurahan per kecamatan: used to check the grid and as the fallback.",
            "Prakiraan publik BMKG untuk satu kelurahan per kecamatan: pembanding dan cadangan.",
          )}
        </li>
        <li>
          {id(
            c,
            "RainViewer radar mosaic is display only; routing never uses it.",
            "Mosaik radar RainViewer hanya tampilan; tidak dipakai untuk perutean.",
          )}
        </li>
      </ul>
    ),
  },
  {
    id: "rainfield",
    dur: () => 11,
    title: (c) =>
      id(c, "Rain in space and time", "Hujan dalam ruang dan waktu"),
    layers: { "s-cols": 0.85 },
    // 3D bars read best from an angle, so this shot turns and keeps turning
    orbit: 2.2,
    lines: (c) => [
      id(
        c,
        "Each column is a forecast point. Its height and colour: the rain there, in mm per hour.",
        "Tiap kolom adalah titik prakiraan. Tinggi dan warnanya: hujan di situ, mm per jam.",
      ),
      id(
        c,
        "Watch the clock: rain moves. We read it at the place AND the minute you'll be there.",
        "Lihat jamnya: hujan bergerak. Kami membacanya di tempat DAN menit kamu ada di sana.",
      ),
      id(
        c,
        "φ turns mm/h into discomfort, 0 to 1: a drizzle barely counts, a downpour counts fully.",
        "φ mengubah mm/jam menjadi ketidaknyamanan, 0 sampai 1: gerimis hampir tak dihitung, hujan deras dihitung penuh.",
      ),
    ],
    cues: () => [0, 3.5, 6.5],
    enter: (c) => {
      camTo(c, {
        center: start(c),
        zoom: 10.3,
        pitch: 55,
        bearing: -25,
        ms: 3000,
      });
      geo(c.map, "s-cols", EMPTY);
      changed(c, "cols", "");
      showLayer(c, {
        id: "s-cols",
        type: "fill-extrusion",
        source: "s-cols",
        paint: {
          "fill-extrusion-color": ["get", "c"],
          "fill-extrusion-height": ["get", "h"],
        },
      });
    },
    frame: (c, t) => {
      // the forecast clock runs from departure to +2 h in 5-minute steps,
      // the columns grow in over the first 1.5 s: ~35 updates, not 600
      const minute = Math.round((clamp((t - 1) / 7.5) * 120) / 5) * 5;
      const grow = Math.round(ease(t / 1.5) * 8) / 8;
      if (!changed(c, "cols", `${minute}|${grow}`)) return;
      const at = c.r.depart + minute * 60_000;
      const g = c.grid;
      const step = g ? g.dLat * 0.3 : 0.013;
      const pts = g
        ? gridPoints(c)
        : memo(c, "lattice", () =>
            Array.from(
              { length: 400 },
              (_, i) =>
                [
                  106.55 + (i % 20) * 0.03,
                  -6.45 + Math.floor(i / 20) * 0.025,
                ] as [number, number],
            ),
          );
      const features = pts.map(([x, y]) => {
        const r = c.field.at(y, x, at);
        const [R, G, B] =
          r > 0.05 ? rainRGBA(Math.max(r, 0.5)) : [51, 214, 255];
        return {
          type: "Feature" as const,
          properties: {
            // 30 mm/h ≈ 2.7 km: tall enough to read, short enough not to
            // wall off the city in a storm
            h: (40 + r * 90) * grow,
            c: `rgb(${R},${G},${B})`,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [x - step, y - step],
                [x + step, y - step],
                [x + step, y + step],
                [x - step, y + step],
                [x - step, y - step],
              ],
            ],
          },
        };
      });
      geo(c.map, "s-cols", { type: "FeatureCollection", features });
    },
    fx: (c, t) => {
      const minute = Math.round((clamp((t - 1) / 7.5) * 120) / 5) * 5;
      const at = c.r.depart + minute * 60_000;
      const [x, y] = start(c);
      // the rain you'd feel standing at the start, at that minute
      const r = c.field.at(y, x, at);
      return { k: "rain", amount: clamp(r / 18), wind: windOf(c) };
    },
    Hud: ({ c, t }) => {
      const minute = Math.round((clamp((t - 1) / 7.5) * 120) / 5) * 5;
      const at = c.r.depart + minute * 60_000;
      const [x, y] = start(c);
      const here = c.field.at(y, x, at);
      const pts = gridPoints(c);
      let top: [number, number] = start(c);
      let topR = 0;
      for (const p of pts) {
        const r = c.field.at(p[1], p[0], at);
        if (r > topR) {
          topR = r;
          top = p;
        }
      }
      const { r0, k } = c.r.params;
      return (
        <>
          <Pop
            show={t > 0.8}
            className="pointer-events-none absolute top-24 left-4"
          >
            <Stat
              label={id(c, "forecast clock", "jam prakiraan")}
              sub={`+${minute} min`}
            >
              {clock(at)}
            </Stat>
          </Pop>
          <Leader
            scope={c.leaders}
            at={start(c)}
            show={t > 1.6}
            dx={-70}
            dy={40}
          >
            <Card
              label={id(c, "rain at your start", "hujan di titik awal")}
              sub={`φ(${f1(here)}) = ${f2(phi(here, r0, k))}`}
            >
              {f1(here)} mm/h · {clock(at)}
            </Card>
          </Leader>
          <Leader
            scope={c.leaders}
            at={top}
            show={t > 3.4 && topR >= 0.5}
            dx={70}
            dy={-50}
          >
            <Card tone="dark" label={id(c, "heaviest now", "terlebat kini")}>
              {f1(topR)} mm/h
            </Card>
          </Leader>
          <Pop
            show={t > 6.3}
            className="pointer-events-none absolute right-4 bottom-[176px]"
          >
            <PhiChart r={here} r0={r0} k={k} lang={c.lang} />
          </Pop>
        </>
      );
    },
    more: (c) => (
      <p>
        {id(
          c,
          "φ(r) turns rain into discomfort: a sigmoid centred on r₀ = 5 mm/h (BMKG's light/moderate boundary), steepness k = 0.74, scaled so φ(0) = 0 and φ(∞) = 1. A threshold would flip on tiny forecast errors; a straight line would explode in a 40 mm/h cell.",
          "φ(r) mengubah hujan menjadi ketidaknyamanan: sigmoid berpusat di r₀ = 5 mm/jam (batas ringan/sedang BMKG), kemiringan k = 0,74, diskalakan agar φ(0) = 0 dan φ(∞) = 1.",
        )}
      </p>
    ),
  },
  {
    id: "network",
    dur: () => 11,
    title: (c) => id(c, "The network", "Jaringannya"),
    layers: { "s-net": 0.75 },
    lines: (c) => [
      id(
        c,
        `Now the network: ${c.fleet?.net.stops.id.length.toLocaleString() ?? "thousands of"} stops of TransJakarta, KRL, MRT and LRT, from official timetables.`,
        `Sekarang jaringannya: ${c.fleet?.net.stops.id.length.toLocaleString() ?? "ribuan"} halte TransJakarta, KRL, MRT dan LRT, dari jadwal resmi.`,
      ),
      id(
        c,
        "Shown: the trunk lines. Each line knows its stops, its travel times and how often it runs.",
        "Yang tampil: jalur utama. Tiap jalur tahu haltenya, waktu tempuhnya, dan seberapa sering lewat.",
      ),
      id(
        c,
        "Every dot is a vehicle, placed where its schedule says it is right now. An estimate, but a useful one.",
        "Setiap titik adalah kendaraan, ditempatkan sesuai jadwalnya saat ini. Perkiraan, tapi berguna.",
      ),
    ],
    cues: () => [0, 3.5, 7.2],
    enter: (c) => {
      useGL.getState().set({ fleetMode: "trunk" });
      camTo(c, {
        center: [106.83, -6.21],
        zoom: 10.9,
        pitch: 50,
        bearing: 0,
        ms: 2600,
      });
      if (!c.fleet) return;
      geo(c.map, "s-net", networkFC(c.fleet));
      showLayer(
        c,
        {
          id: "s-net",
          type: "line",
          source: "s-net",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "c"],
            "line-width": ["case", ["==", ["get", "rail"], 1], 2.6, 1.2],
          },
        },
        "w-fleet",
      );
      c.map.setFilter("s-net", ["<=", ["get", "o"], 0]);
      changed(c, "net-o", -1);
    },
    frame: (c, t) => {
      const o = Math.round(clamp((t - 0.6) / 4) * 20) / 20;
      if (changed(c, "net-o", o) && c.map.getLayer("s-net"))
        c.map.setFilter("s-net", o >= 1 ? null : ["<=", ["get", "o"], o]);
    },
    fx: () => ({ k: "drift" }),
    Hud: ({ c, t }) => {
      const n = c.fleet?.net;
      const krl = memo(c, "net-krl", () =>
        showcaseLine(c, (r) => r.mode === "krl"),
      );
      const brt = memo(c, "net-brt", () =>
        showcaseLine(c, (r) => r.mode === "transjakarta" && r.cat === "BRT"),
      );
      const mrt = memo(c, "net-mrt", () =>
        showcaseLine(c, (r) => r.mode === "mrt" || r.mode === "lrt"),
      );
      const count = memo(
        c,
        "net-count",
        () => c.fleet?.at(Date.now()).length ?? 0,
      );
      // one vehicle we point at, followed live
      const veh = memo(c, "net-veh", () => {
        const f = c.fleet;
        if (!f || !krl) return null;
        const v = f.at(Date.now(), { only: [krl.pi] })[0];
        return v ? { pi: v.pattern, dep: v.dep } : null;
      });
      const vNow =
        veh && c.fleet
          ? c.fleet.place(veh.pi, veh.dep, wib(Date.now()).secOfDay)
          : null;
      const line = (
        x: NonNullable<ReturnType<typeof showcaseLine>>,
        show: boolean,
        dx: number,
        dy: number,
      ) => (
        <Leader scope={c.leaders} at={x.at} show={show} dx={dx} dy={dy}>
          <Card
            label={
              x.route.mode === "krl"
                ? "KRL Commuter Line"
                : x.route.mode === "transjakarta"
                  ? "TransJakarta BRT"
                  : x.route.mode.toUpperCase()
            }
            sub={`${x.stops} ${id(c, "stops", "halte")} · ${id(c, "every", "tiap")} ~${x.headMin} ${id(c, "min now", "mnt kini")}`}
          >
            <span
              className="slant mr-1 inline-block px-1 text-white"
              style={{ "--sl-bg": x.route.color } as CSSProperties}
            >
              {x.route.short}
            </span>
            {x.route.long}
          </Card>
        </Leader>
      );
      return (
        <>
          <div className="pointer-events-none absolute top-24 left-4 flex flex-col gap-2">
            <Pop show={t > 0.6}>
              <Stat label={id(c, "stops", "halte")}>
                {n ? <Run v={n.stops.id.length} /> : "—"}
              </Stat>
            </Pop>
            <Pop show={t > 1.2}>
              <Stat label={id(c, "lines · patterns", "rute · pola")}>
                {n ? <Run v={n.routes.length} /> : "—"} ·{" "}
                {n ? <Run v={n.patterns.length} /> : "—"}
              </Stat>
            </Pop>
            <Pop show={t > 7.2}>
              <Stat
                label={id(c, "vehicles now", "kendaraan kini")}
                sub={id(
                  c,
                  "schedule estimate, all lines",
                  "perkiraan jadwal, semua rute",
                )}
              >
                <Run v={count} />
              </Stat>
            </Pop>
          </div>
          {krl && line(krl, t > 3.6, 70, -50)}
          {brt && line(brt, t > 4.6, -70, 50)}
          {mrt && line(mrt, t > 5.6, 70, 60)}
          {vNow && (
            <Leader
              scope={c.leaders}
              at={[vNow.lng, vNow.lat]}
              show={t > 7.6}
              dx={-60}
              dy={-60}
            >
              <Card
                tone="gold"
                label={id(
                  c,
                  "one dot = one vehicle",
                  "satu titik = satu kendaraan",
                )}
              >
                {c.fleet?.net.routes[vNow.route].short} →{" "}
                {c.fleet?.net.patterns[vNow.pattern].headsign}
              </Card>
            </Leader>
          )}
        </>
      );
    },
  },
  {
    id: "search",
    dur: () => S_DUR,
    title: (c) => id(c, "The search", "Pencariannya"),
    layers: {
      "s-net": 0.12,
      "s-edges": 0.85,
      "s-edge-lbl": 1,
      "s-done": 1,
      "s-done-lbl": 1,
      "s-trace": 0.9,
      "s-best": 0.95,
    },
    lines: (c) => {
      const n = c.trace?.trace.steps.length ?? c.r.stats.settled;
      const ms = Math.round(c.trace?.ms ?? c.r.stats.ms);
      return [
        id(
          c,
          "This is Dijkstra's algorithm. It keeps a to-do list of stops, cheapest first. Cost = perceived minutes, from the formula.",
          "Ini algoritma Dijkstra. Ia menyimpan daftar halte, termurah dulu. Biaya = menit yang terasa, dari rumus.",
        ),
        id(
          c,
          "Step: take the cheapest stop off the list and settle it. Nothing later can reach it cheaper, so its cost is final.",
          "Langkah: ambil halte termurah dari daftar dan tetapkan. Tak ada jalan lain yang lebih murah, jadi biayanya final.",
        ),
        id(
          c,
          "From there, try every walk and every ride. Each reachable stop gets cost-so-far + the new leg, if that's cheaper.",
          "Dari situ, coba setiap jalan kaki dan setiap rute. Tiap halte dapat biaya-sejauh-ini + ruas baru, jika lebih murah.",
        ),
        id(
          c,
          "Repeat. The settled area grows like a ripple, always cheapest first.",
          "Ulangi. Area yang ditetapkan tumbuh seperti riak, selalu termurah dulu.",
        ),
        id(
          c,
          `The goal is settled after ${n.toLocaleString()} stops (${ms} ms). Each stop remembers where it came from: follow that back, and that's your route.`,
          `Tujuan ditetapkan setelah ${n.toLocaleString()} halte (${ms} ms). Tiap halte ingat asalnya: telusuri balik, itulah rutemu.`,
        ),
      ];
    },
    cues: () => [0, S_A, S_A + S_STEP * 1.5, S_FAST, S_GOAL],
    enter: (c) => {
      useGL.getState().set({ fleetMode: "off" });
      camTo(c, {
        center: start(c),
        zoom: 14.6,
        pitch: 30,
        bearing: 0,
        ms: 2200,
      });
      for (const s of ["s-edges", "s-done", "s-trace", "s-best"])
        geo(c.map, s, EMPTY);
      showLayer(c, {
        id: "s-trace",
        type: "circle",
        source: "s-trace",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "o"],
            0,
            "#7fe7ff",
            0.5,
            "#33d6ff",
            1,
            "#a78bfa",
          ],
        },
      });
      showLayer(c, {
        id: "s-edges",
        type: "line",
        source: "s-edges",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#33d6ff",
          "line-width": 1.6,
          "line-dasharray": [2, 1.5],
        },
      });
      showLayer(c, {
        id: "s-edge-lbl",
        type: "symbol",
        source: "s-edges",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "l"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, -1],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#050b2e",
          "text-halo-color": "#33d6ff",
          "text-halo-width": 2,
        },
      });
      showLayer(c, {
        id: "s-done",
        type: "circle",
        source: "s-done",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffd400",
          "circle-stroke-color": "#050b2e",
          "circle-stroke-width": 2,
        },
      });
      showLayer(c, {
        id: "s-done-lbl",
        type: "symbol",
        source: "s-done",
        layout: {
          "text-field": ["get", "l"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, 1.3],
        },
        paint: {
          "text-color": "#ffd400",
          "text-halo-color": "#050b2e",
          "text-halo-width": 1.5,
        },
      });
      showLayer(c, {
        id: "s-best",
        type: "line",
        source: "s-best",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#ffd400", "line-width": 7 },
      });
      changed(c, "srch-k", -1);
      changed(c, "srch-cam", -1);
      changed(c, "srch-best", -1);
    },
    frame: (c, t) => {
      const p = searchPrep(c);
      if (!p) return;
      const k = settledAt(p, t);
      // the first connections (from the start) appear once the camera lands
      const lit = k > 0 || t > 1.2;
      if (changed(c, "srch-k", `${k}|${lit}`)) {
        // detailed phase: the connections tried from the stop just settled
        geo(
          c.map,
          "s-edges",
          t < S_FAST && lit ? p.edges(Math.min(k, p.detail)) : EMPTY,
        );
        const shown = p.steps.slice(0, Math.min(k, p.detail));
        geo(c.map, "s-done", {
          type: "FeatureCollection",
          features: shown.map((s, i) => ({
            type: "Feature" as const,
            properties: { l: `${i + 1}. ${f1(s.cost)}` },
            geometry: { type: "Point" as const, coordinates: p.pos(s.s) },
          })),
        });
        geo(c.map, "s-trace", {
          type: "FeatureCollection",
          features: p.steps.slice(p.detail, k).map((s, i, a) => ({
            type: "Feature" as const,
            properties: { o: i / Math.max(1, a.length) },
            geometry: { type: "Point" as const, coordinates: p.pos(s.s) },
          })),
        });
      }
      // camera: the neighbourhood for the slow steps, the city for the rest
      const shot = t < S_A ? 0 : t < S_FAST ? 1 : t < S_GOAL + 1 ? 2 : 3;
      if (changed(c, "srch-cam", shot)) {
        if (shot === 1)
          frameOn(
            c,
            [
              start(c),
              ...p.steps.slice(0, p.detail + 1).map((s) => p.pos(s.s)),
            ],
            { pitch: 35, bearing: 0, ms: 1600, pad: 150, maxZoom: 15.2 },
          );
        else if (shot === 2)
          frameOn(c, itPts(c.it), {
            pitch: 45,
            bearing: smartBearing(travelBearing(itPts(c.it))),
            ms: 2600,
            pad: 110,
          });
      }
      // trace back from the goal to the start
      if (t > S_GOAL + 1) {
        const u = Math.round(ease((t - S_GOAL - 1) / 2.6) * 30) / 30;
        if (changed(c, "srch-best", u)) {
          const pts = itPts(c.it).slice().reverse();
          geo(c.map, "s-best", {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: pts.slice(
                    0,
                    Math.max(2, Math.ceil(pts.length * u)),
                  ),
                },
              },
            ],
          });
        }
      }
    },
    fx: (c, t) =>
      t > S_GOAL + 3.8 && t < S_GOAL + 4.6
        ? { k: "burst", at: project(c, start(c)) }
        : t > S_GOAL + 4.6
          ? { k: "drift" }
          : { k: "off" },
    cursor: (c, t) => {
      const p = searchPrep(c);
      if (!p) return start(c);
      const k = settledAt(p, t);
      if (t < S_A) return start(c);
      if (t >= S_GOAL) return goal(c);
      const s = p.steps[Math.max(0, k - 1)];
      return s ? p.pos(s.s) : start(c);
    },
    Hud: ({ c, t }) => <SearchHud c={c} t={t} />,
    more: (c) => (
      <p>
        {id(
          c,
          "Time-dependent Dijkstra over (stop, arrival time). Boarding waits for the next vehicle (half a headway for frequent lines, the next departure for KRL). Rain is looked up at each segment's midpoint at the minute you arrive there. It runs twice: β = 0 (today's fastest) and your β. Costs never go down along a path, which is why the first time the goal is settled it is the cheapest.",
          "Dijkstra bergantung waktu atas (halte, waktu tiba). Naik kendaraan menunggu kendaraan berikutnya. Hujan dibaca di titik tengah tiap ruas pada menit kamu tiba. Dijalankan dua kali: β = 0 (tercepat) dan β milikmu. Biaya tak pernah turun sepanjang jalur, karena itu saat tujuan pertama kali ditetapkan, itulah yang termurah.",
        )}
      </p>
    ),
  },
  {
    id: "score",
    dur: (c) => LEG_T0 + scoreLegs(c.it).length * LEG_S + 1.5,
    title: (c) => id(c, "Pricing every leg", "Menghargai tiap ruas"),
    layers: { "s-leg": 0.95 },
    lines: (c) =>
      scoreLegs(c.it).map((g) => {
        const { ph, cost, E } = legCostOf(g, c);
        return E && g.rain >= 0.5
          ? id(
              c,
              `${legTitle(g, "en")}: ${f1(g.minutes)} min in ${f1(g.rain)} mm/h rain. φ = ${f2(ph)}, so it feels like ${f1(cost)} min.`,
              `${legTitle(g, "id")}: ${f1(g.minutes)} menit di hujan ${f1(g.rain)} mm/jam. φ = ${f2(ph)}, terasa ${f1(cost)} menit.`,
            )
          : E
            ? id(
                c,
                `${legTitle(g, "en")}: dry here, so it costs just its time × w = ${f1(cost)}.`,
                `${legTitle(g, "id")}: kering, jadi biayanya hanya waktu × w = ${f1(cost)}.`,
              )
            : g.kind === "wait"
              ? id(
                  c,
                  `${legTitle(g, "en")}: waits are scored but not priced (the paper's A4 finding), so E = 0 here: ${f1(cost)}.`,
                  `${legTitle(g, "id")}: menunggu dinilai tapi tidak dihargai (temuan A4 di paper), jadi E = 0: ${f1(cost)}.`,
                )
              : id(
                  c,
                  `${legTitle(g, "en")}: inside the vehicle, E = 0. Rain can't reach you: ${f1(cost)}.`,
                  `${legTitle(g, "id")}: di dalam kendaraan, E = 0. Hujan tak mengenaimu: ${f1(cost)}.`,
                );
      }),
    cues: (c) => scoreLegs(c.it).map((_, i) => LEG_T0 + i * LEG_S),
    enter: (c) => {
      geo(c.map, "s-leg", EMPTY);
      showLayer(
        c,
        {
          id: "s-leg",
          type: "line",
          source: "s-leg",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffd400", "line-width": 11, "line-blur": 3 },
        },
        "w-route-case",
      );
      changed(c, "score-k", -1);
    },
    frame: (c, t) => {
      const legs = scoreLegs(c.it);
      const k = Math.floor((t - LEG_T0) / LEG_S);
      if (k < 0 || k >= legs.length || !changed(c, "score-k", k)) return;
      const g = legs[k];
      geo(c.map, "s-leg", {
        type: "FeatureCollection",
        features:
          g.path.length > 1
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: g.path.map(ll) },
                },
              ]
            : [],
      });
      // a leg with a direction turns the map to run up the screen; a wait
      // in place keeps the bearing; close-ups tilt more to show the street
      const pts = g.path.map(ll).concat([mid(g)]);
      frameOn(c, pts, {
        pitch: g.kind === "ride" ? 50 : 62,
        bearing:
          g.path.length > 1 ? smartBearing(bearingOf(g)) : c.map.getBearing(),
        ms: 1700,
        pad: 150,
        maxZoom: g.kind === "wait" ? 16.5 : 16,
      });
    },
    cursor: (c, t) => {
      const legs = scoreLegs(c.it);
      const k = clamp(Math.floor((t - LEG_T0) / LEG_S), 0, legs.length - 1);
      return legs[k] ? mid(legs[k]) : null;
    },
    fx: (c, t) => {
      const legs = scoreLegs(c.it);
      const g =
        legs[clamp(Math.floor((t - LEG_T0) / LEG_S), 0, legs.length - 1)];
      return g && routingExposure(g.kind) && g.rain > 0.3
        ? { k: "rain", amount: clamp(g.rain / 18, 0.08, 1), wind: windOf(c) }
        : { k: "drift" };
    },
    Hud: ({ c, t }) => {
      const legs = scoreLegs(c.it);
      const k = Math.floor((t - LEG_T0) / LEG_S);
      const g = legs[clamp(k, 0, legs.length - 1)];
      const done = legs.slice(
        0,
        clamp(k + (t - LEG_T0 - k * LEG_S > 2.4 ? 1 : 0), 0, legs.length),
      );
      const total = done.reduce((a, x) => a + legCostOf(x, c).cost, 0);
      const live = k >= 0 && k < legs.length && g;
      const E = g ? routingExposure(g.kind) : 0;
      return (
        <>
          {live && (
            <Leader
              key={`leg-${k}`}
              scope={c.leaders}
              at={mid(g)}
              show={t - LEG_T0 - k * LEG_S < LEG_S - 0.3}
              dx={70}
              dy={-60}
            >
              <Card
                label={legTitle(g, c.lang)}
                sub={
                  E
                    ? id(
                        c,
                        "E = 1: rain reaches you here",
                        "E = 1: hujan mengenaimu",
                      )
                    : id(c, "E = 0: under a roof", "E = 0: terlindung")
                }
              >
                τ {f1(g.minutes)} min · {f1(g.rain)} mm/h
              </Card>
            </Leader>
          )}
          {live && (
            <Equation key={k} c={c} g={g} k={k} from={project(c, mid(g))} />
          )}
          <div className="pointer-events-none absolute top-24 left-4 flex w-60 flex-col gap-1">
            <AnimatePresence>
              {done.map((x) => (
                <motion.div
                  key={`${x.t0}-${x.kind}`}
                  layout
                  {...wipeIn}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                  className={`${glass} flex items-center gap-2 px-2.5 py-1 text-xs`}
                >
                  <span className="flex-1 truncate">{legTitle(x, c.lang)}</span>
                  <span className="font-mono font-bold text-[#ffd400]">
                    {f1(legCostOf(x, c).cost)}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {done.length > 0 && (
              <div className="mt-1 flex items-center justify-between px-2.5 font-mono text-sm text-white">
                <span>
                  Σ{" "}
                  {c.it.transfers
                    ? `+ ${c.it.transfers}×${TRANSFER_PENALTY_MIN}`
                    : ""}
                </span>
                <span className="text-lg font-bold">
                  <Run
                    v={
                      total +
                      (done.length === legs.length
                        ? c.it.transfers * TRANSFER_PENALTY_MIN
                        : 0)
                    }
                    over={0.6}
                    fmt={f1}
                  />
                </span>
              </div>
            )}
          </div>
        </>
      );
    },
    more: (c) => (
      <ul className="list-disc space-y-1 pl-4">
        <li>
          τ:{" "}
          {id(
            c,
            "minutes on the leg (schedule × traffic × rain slowdown)",
            "menit di ruas (jadwal × lalu lintas × perlambatan hujan)",
          )}
        </li>
        <li>
          w:{" "}
          {id(
            c,
            "walking and waiting feel 1.5× longer (value-of-time meta-analyses: 1.5–2)",
            "berjalan dan menunggu terasa 1,5× lebih lama (meta-analisis nilai waktu: 1,5–2)",
          )}
        </li>
        <li>
          E:{" "}
          {id(
            c,
            "1 when rain reaches you (walk, motorcycle), 0 inside a vehicle. Waits are scored but not priced (paper ablation A4).",
            "1 bila hujan mengenaimu (jalan, motor), 0 di dalam kendaraan.",
          )}
        </li>
        <li>
          β:{" "}
          {id(
            c,
            "your slider: how much you mind rain",
            "slider-mu: seberapa peduli pada hujan",
          )}
        </li>
      </ul>
    ),
  },
  {
    id: "compare",
    dur: () => 10,
    title: (c) => id(c, "Compare", "Bandingkan"),
    layers: { "s-alt": 0.85 },
    lines: (c) => {
      const e = c.r.explain;
      return [
        id(
          c,
          "Same formula, every candidate: the fastest transit, the rain-aware transit, and the ojek.",
          "Rumus yang sama untuk setiap kandidat: transit tercepat, transit sadar hujan, dan ojek.",
        ),
        c.r.shift && e
          ? id(
              c,
              `The winner is ${Math.round(e.extraMin)} min slower but gets ${Math.round(e.doseSavedPct)}% less rain. Worth it at β = ${c.r.params.beta}.`,
              `Pemenangnya ${Math.round(e.extraMin)} menit lebih lambat tapi ${Math.round(e.doseSavedPct)}% lebih sedikit hujan. Sepadan pada β = ${c.r.params.beta}.`,
            )
          : id(
              c,
              "Here the fastest route is also the cheapest overall, so nothing changes.",
              "Di sini rute tercepat juga termurah secara total, jadi tak ada yang berubah.",
            ),
      ];
    },
    cues: () => [0, 5],
    enter: (c) => {
      altLayer(c);
      frameOn(c, itPts(c.it).concat(itPts(c.alt)), {
        pitch: 35,
        bearing: smartBearing(travelBearing(itPts(c.it))),
        ms: 2200,
        pad: 70,
        // the comparison panel sits on top; the routes go below it
        top: 300,
      });
    },
    Hud: ({ c, t }) => {
      const o = c.r.options;
      const vot = c.r.price.vot;
      const rows = memo(c, "cmp-rows", () =>
        [
          [
            id(c, "Transit · fastest search", "Transit · cari tercepat"),
            o.transit0,
          ],
          [id(c, "Transit · rain-aware", "Transit · sadar hujan"), o.transitB],
          ["Ojek", o.moto],
        ]
          .filter((x): x is [string, Itinerary] => !!x[1])
          .filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i)
          .map(([label, it]) => {
            const cost = costOf(it, c.r.params);
            const time = timePart(it);
            const price = vot > 0 ? it.fare / vot : 0;
            return {
              label,
              it,
              time,
              rain: cost - time,
              price,
              total: cost + price,
              over: it.type === "moto" && c.r.price.motoOverBudget,
            };
          })
          .sort((a, b) => a.total - b.total),
      );
      const max = Math.max(...rows.map((r) => r.total), 1);
      const pick = rows.find((r) => r.it === c.it) ?? rows[0];
      const other = c.alt ? rows.find((r) => r.it === c.alt) : undefined;
      return (
        <>
          <div
            className={`${glass} pointer-events-none absolute top-20 left-1/2 w-[min(92vw,28rem)] -translate-x-1/2 space-y-3 p-4`}
          >
            {rows.map((r, i) => (
              <Pop key={r.label} show={t > 0.6 + i * 0.6}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold">
                    {i === 0 && t > 4 && <span className="mr-1">🏆</span>}
                    {r.label}{" "}
                    {r.over && (
                      <span className="text-rose-300">
                        ({id(c, "over your budget", "melebihi batas")})
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-base font-bold">
                    <Run v={r.total} fmt={f1} />
                  </span>
                </div>
                <div className="flex h-3.5 overflow-hidden bg-white/10">
                  {(
                    [
                      [r.time, "bg-slate-200"],
                      [r.rain, "bg-[#ffd400]"],
                      [r.price, "bg-[#a78bfa]"],
                    ] as const
                  ).map(([v, cls], j) => (
                    <motion.div
                      key={cls}
                      className={`h-full ${cls}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(v / max) * 100}%` }}
                      transition={{
                        duration: 0.7 / c.pace,
                        delay: (0.9 + i * 0.6 + j * 0.5) / c.pace,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    />
                  ))}
                </div>
              </Pop>
            ))}
            <div className="flex gap-3 text-[11px] text-slate-300">
              <span>
                <span className="mr-1 inline-block size-2 bg-slate-200" />
                {id(c, "time τ·w", "waktu τ·w")}
              </span>
              <span>
                <span className="mr-1 inline-block size-2 bg-[#ffd400]" />
                {id(c, "rain τ·w·β·E·φ", "hujan τ·w·β·E·φ")}
              </span>
              {vot > 0 && (
                <span>
                  <span className="mr-1 inline-block size-2 bg-[#a78bfa]" />
                  {id(c, `fare ÷ Rp${vot}/min`, `tarif ÷ Rp${vot}/mnt`)}
                </span>
              )}
            </div>
          </div>
          {pick && (
            <Leader
              scope={c.leaders}
              at={midOf(c.it)}
              show={t > 4.5}
              dx={70}
              dy={40}
            >
              <Card
                tone="gold"
                label={id(c, "picked · this line", "dipilih · garis ini")}
                sub={`${Math.round(c.it.minutes)} min · ${f1(c.it.dose)} mm ${id(c, "rain", "hujan")}`}
              >
                {id(c, "total", "total")} {f1(pick.total)}
              </Card>
            </Leader>
          )}
          {other && c.alt && (
            <Leader
              scope={c.leaders}
              at={midOf(c.alt)}
              show={t > 5.5}
              dx={-70}
              dy={40}
            >
              <Card
                label={id(
                  c,
                  "the other option · dashed",
                  "opsi lain · putus-putus",
                )}
                sub={`${Math.round(c.alt.minutes)} min · ${f1(c.alt.dose)} mm ${id(c, "rain", "hujan")}`}
              >
                {id(c, "total", "total")} {f1(other.total)}
              </Card>
            </Leader>
          )}
        </>
      );
    },
    more: (c) => (
      <p>
        {id(
          c,
          "The paper's model compares time + rain discomfort only. The app can also add the fare, converted to minutes with your value of time (Settings → Price), and drop an ojek above your budget. That part is an app option, not the evaluated model.",
          "Model di paper hanya membandingkan waktu + ketidaknyamanan hujan. Aplikasi bisa menambah tarif, dikonversi ke menit dengan nilai waktumu (Pengaturan → Harga). Itu opsi aplikasi, bukan model yang dievaluasi.",
        )}
      </p>
    ),
  },
  {
    id: "predict",
    dur: () => 12,
    title: (c) => id(c, "Predictions", "Prediksi"),
    layers: { "s-sample": 0.6 },
    lines: (c) => {
      const a = memo(c, "range", () => arrivalRange(c.it));
      return [
        id(
          c,
          `Each leg adds uncertainty: waiting, traffic, walking. Together: you likely arrive ${clock(a.p10)}–${clock(a.p90)}.`,
          `Setiap ruas menambah ketidakpastian: menunggu, lalu lintas, berjalan. Total: kamu kemungkinan tiba ${clock(a.p10)}–${clock(a.p90)}.`,
        ),
        id(
          c,
          "For rain we sample 27 forecasts around you: 9 nearby points × 3 times. The share that's wet is the chance.",
          "Untuk hujan kami ambil 27 sampel di sekitarmu: 9 titik × 3 waktu. Porsi yang basah adalah peluangnya.",
        ),
        id(
          c,
          "And the buses: who reaches your stop first, and who comes after.",
          "Dan busnya: siapa yang sampai di haltemu duluan, dan siapa sesudahnya.",
        ),
      ];
    },
    cues: () => [0, 4, 8],
    enter: (c) => {
      useGL.getState().set({ fleetMode: "auto" });
      const wet = memo(c, "chances", () =>
        exposedChances(c.it, c.field).sort((a, b) => b.c.chance - a.c.chance),
      )[0];
      const g = wet?.leg ?? c.it.legs[0];
      if (!g) return;
      const [x, y] = mid(g);
      camTo(c, {
        center: [x, y],
        zoom: 11.6,
        pitch: 50,
        bearing: smartBearing(bearingOf(g)),
        ms: 2200,
      });
      const t = (g.t0 + g.t1) / 2;
      const D = 0.036;
      const feats = [];
      for (const [k, dt] of [-15, 0, 15].entries())
        for (const di of [-1, 0, 1])
          for (const dj of [-1, 0, 1]) {
            const r = c.field.at(y + di * D, x + dj * D, t + dt * 60_000);
            feats.push({
              type: "Feature" as const,
              properties: { k, wet: r >= 0.5 ? 1 : 0 },
              geometry: {
                type: "Point" as const,
                coordinates: [x + dj * D, y + di * D],
              },
            });
          }
      geo(c.map, "s-sample", { type: "FeatureCollection", features: feats });
      showLayer(c, {
        id: "s-sample",
        type: "circle",
        source: "s-sample",
        paint: {
          "circle-radius": 14,
          "circle-color": [
            "case",
            ["==", ["get", "wet"], 1],
            "#1546ff",
            "#94a3b8",
          ],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });
      c.map.setFilter("s-sample", ["==", ["get", "k"], -1]);
      changed(c, "pred-k", -2);
    },
    frame: (c, t) => {
      // the three sample times pulse in turn
      const k = t < 4 ? -1 : Math.floor((t - 4) / 1.1) % 3;
      if (changed(c, "pred-k", k) && c.map.getLayer("s-sample"))
        c.map.setFilter("s-sample", ["==", ["get", "k"], k]);
    },
    Hud: ({ c, t }) => {
      const a = memo(c, "range", () => arrivalRange(c.it));
      const wet = memo(c, "chances", () =>
        exposedChances(c.it, c.field).sort((x, y) => y.c.chance - x.c.chance),
      )[0];
      const ride = c.it.legs.find((g) => g.kind === "ride" && g.trip);
      const arr = memo(c, "pred-arr", () =>
        c.fleet && ride?.trip
          ? c.fleet.arrivals(
              Date.now(),
              c.fleet.serving(ride.trip.board, ride.trip.alight),
              3600,
              3,
            )
          : [],
      );
      const maxS = Math.max(...a.parts.map((p) => p.sigmaMin), 0.1);
      return (
        <>
          <div className="pointer-events-none absolute top-24 left-4 w-[min(90vw,19rem)]">
            <Pop show={t > 0.5}>
              <div className={`${glass} p-3`}>
                <div className="text-[10px] tracking-wider text-[#33d6ff] uppercase">
                  {id(c, "arrival", "kedatangan")}
                </div>
                <svg viewBox="0 0 200 60" className="mt-1 h-14 w-full">
                  <title>Arrival time distribution</title>
                  <motion.path
                    d={`M0 55 ${Array.from({ length: 41 }, (_, i) => {
                      const x = (i / 40) * 200;
                      const z = (x - 100) / 32;
                      return `L${x} ${55 - 48 * Math.exp((-z * z) / 2)}`;
                    }).join(" ")}`}
                    fill="rgba(51,214,255,.15)"
                    stroke="#33d6ff"
                    strokeWidth="1.5"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2 / c.pace }}
                  />
                  {[59, 100, 141].map((x, i) => (
                    <motion.line
                      key={x}
                      x1={x}
                      x2={x}
                      y1="5"
                      y2="57"
                      stroke={i === 1 ? "#ffd400" : "#94a3b8"}
                      strokeDasharray="2 2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: (1 + i * 0.3) / c.pace }}
                    />
                  ))}
                </svg>
                <div className="flex justify-between font-mono text-xs">
                  <span>P10 {clock(a.p10)}</span>
                  <span className="text-[#ffd400]">{clock(a.p50)}</span>
                  <span>P90 {clock(a.p90)}</span>
                </div>
                <div className="mt-2 space-y-0.5">
                  {a.parts
                    .filter((p) => p.sigmaMin > 0.05)
                    .slice(0, 4)
                    .map((p, i) => (
                      <div
                        key={`${p.leg.t0}-${p.leg.kind}`}
                        className="flex items-center gap-2 text-[11px]"
                      >
                        <span className="w-24 truncate text-slate-300">
                          {legTitle(p.leg, c.lang)}
                        </span>
                        <motion.span
                          className="h-1.5 bg-[#33d6ff]"
                          initial={{ width: 0 }}
                          animate={{ width: `${(p.sigmaMin / maxS) * 60}%` }}
                          transition={{ delay: (1.6 + i * 0.15) / c.pace }}
                        />
                        <span className="font-mono">±{f1(p.sigmaMin)}</span>
                      </div>
                    ))}
                  <div className="pt-1 font-mono text-[11px] text-slate-300">
                    σ = √Σσᵢ² = {f1(a.sigmaMin)} min
                  </div>
                </div>
              </div>
            </Pop>
          </div>
          {wet && (
            <Leader
              scope={c.leaders}
              at={mid(wet.leg)}
              show={t > 4.4}
              dx={80}
              dy={-40}
            >
              <Card
                tone="dark"
                label={id(c, "chance of rain here", "peluang hujan di sini")}
                sub={`${wet.c.wet}/${wet.c.samples} ${id(c, "samples wet (blue)", "sampel basah (biru)")} · ${legTitle(wet.leg, c.lang)}`}
              >
                <span className="text-2xl italic">
                  {Math.round(wet.c.chance * 100)}%
                </span>
              </Card>
            </Leader>
          )}
          {arr.length > 0 && ride && c.fleet && (
            <Leader
              scope={c.leaders}
              at={[ride.from.lng, ride.from.lat]}
              show={t > 8.2}
              dx={-80}
              dy={50}
            >
              <Card
                label={`${id(c, "next at", "berikutnya di")} ${ride.from.name}`}
              >
                <span className="flex flex-col gap-0.5">
                  {arr.map((v, i) => (
                    <span
                      key={v.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="text-[#1546ff]">{i + 1}</span>
                      <span
                        className="slant px-1 text-white"
                        style={
                          {
                            "--sl-bg": c.fleet?.net.routes[v.route].color,
                          } as CSSProperties
                        }
                      >
                        {c.fleet?.net.routes[v.route].short}
                      </span>
                      <span className="ml-auto font-mono">
                        {Math.max(0, Math.round(v.etaSec / 60))} min
                      </span>
                    </span>
                  ))}
                </span>
              </Card>
            </Leader>
          )}
        </>
      );
    },
  },
  {
    id: "simulation",
    dur: () => 10,
    title: (c) => id(c, "Simulation", "Simulasi"),
    layers: { "s-cells": 1 },
    orbit: 1.6,
    lines: (c) => [
      c.r.cells.length
        ? id(
            c,
            "You're running a simulated storm. It has a peak, a size and a speed, and it moves while you travel.",
            "Kamu menjalankan badai simulasi. Ia punya puncak, ukuran dan kecepatan, dan bergerak saat kamu jalan.",
          )
        : id(
            c,
            "Want to test it? Simulate injects a storm cell: a peak, a size and a speed. Here's a demo one.",
            "Mau mencoba? Simulasi menyuntikkan sel badai: puncak, ukuran dan kecepatan. Ini contohnya.",
          ),
      id(
        c,
        "Because rain is read at the minute you arrive, the route bends around where the storm WILL be.",
        "Karena hujan dibaca pada menit kamu tiba, rute menghindari tempat badai AKAN berada.",
      ),
    ],
    cues: () => [0, 5],
    enter: (c) => {
      const cell = c.r.cells[0] ?? demoCell(c);
      frameOn(c, [cellAt(cell, 0), cellAt(cell, 90), ...itPts(c.it)], {
        pitch: 45,
        bearing: 0,
        ms: 2200,
        pad: 90,
        maxZoom: 12,
      });
      geo(c.map, "s-cells", EMPTY);
      changed(c, "cells", -1);
      showLayer(
        c,
        {
          id: "s-cells",
          type: "fill",
          source: "s-cells",
          paint: { "fill-color": ["get", "c"] },
        },
        "w-route-case",
      );
    },
    frame: (c, t) => {
      const cells = c.r.cells.length ? c.r.cells : [demoCell(c)];
      // 2-minute steps of storm time
      const minutes = Math.round((clamp((t - 1) / 7) * 90) / 2) * 2;
      if (!changed(c, "cells", minutes)) return;
      geo(c.map, "s-cells", {
        type: "FeatureCollection",
        features: cells.flatMap((cell) => {
          const [x, y] = cellAt(cell, minutes);
          return [2, 1.3, 0.7].map((m, i) => ({
            type: "Feature" as const,
            properties: {
              c: [
                "rgba(21,70,255,.22)",
                "rgba(124,58,237,.32)",
                "rgba(219,39,119,.45)",
              ][i],
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: [circle(x, y, cell.radiusKm * m)],
            },
          }));
        }),
      });
    },
    cursor: (c, t) => {
      const cell = c.r.cells[0] ?? demoCell(c);
      return cellAt(cell, clamp((t - 1) / 7) * 90);
    },
    fx: (c) => ({ k: "rain", amount: 0.55, wind: windOf(c) || 120 }),
    Hud: ({ c, t }) => {
      const cell = c.r.cells[0] ?? demoCell(c);
      const v = Math.hypot(cell.vEast, cell.vNorth);
      const dir =
        ((Math.atan2(cell.vEast, cell.vNorth) * 180) / Math.PI + 360) % 360;
      const minutes = Math.round(clamp((t - 1) / 7) * 90);
      return (
        <>
          {!c.r.cells.length && (
            <Pop
              show
              className="pointer-events-none absolute top-24 left-4 w-fit slant [--sl-bg:#ffd400] px-2 py-0.5 text-[11px] font-black text-[#050b2e]"
            >
              {id(
                c,
                "DEMO STORM, not the forecast",
                "BADAI CONTOH, bukan prakiraan",
              )}
            </Pop>
          )}
          <Leader
            scope={c.leaders}
            at={cellAt(cell, minutes)}
            show={t > 1}
            dx={80}
            dy={-50}
          >
            <Card
              tone="dark"
              label={`${id(c, "storm cell", "sel badai")} · +${minutes} min`}
              sub={`${id(c, "radius", "jari-jari")} ${f1(cell.radiusKm)} km · ${f1(v)} km/h → ${Math.round(dir)}°`}
            >
              {f1(cell.peak)} mm/h {id(c, "at the core", "di inti")}
            </Card>
          </Leader>
          <Leader scope={c.leaders} at={start(c)} show={t > 3} dx={-70} dy={50}>
            <Card label={id(c, "you leave", "kamu berangkat")}>
              {clock(c.r.depart)}
            </Card>
          </Leader>
        </>
      );
    },
  },
  {
    id: "decision",
    dur: () => 8,
    title: (c) => id(c, "The decision", "Keputusannya"),
    lines: (c) => [
      c.r.shift && c.r.explain
        ? id(
            c,
            `Recommended: ${Math.round(c.r.explain.doseSavedPct)}% less rain for ${Math.round(c.r.explain.extraMin)} extra minutes.`,
            `Rekomendasi: ${Math.round(c.r.explain.doseSavedPct)}% lebih sedikit hujan dengan tambahan ${Math.round(c.r.explain.extraMin)} menit.`,
          )
        : id(
            c,
            "Recommended: the fastest route. In dry weather or at β = 0 we give exactly today's answer.",
            "Rekomendasi: rute tercepat. Saat kering atau β = 0 hasilnya sama persis seperti biasa.",
          ),
      id(
        c,
        "That's it: same router, smarter prices.",
        "Itu saja: router yang sama, harga yang lebih cerdas.",
      ),
    ],
    enter: (c) => {
      // only the answer on screen: this route and the vehicles that serve it
      useGL.getState().set({ fleetMode: "auto" });
      frameOn(c, itPts(c.it), {
        pitch: 55,
        bearing: smartBearing(travelBearing(itPts(c.it))),
        ms: 2000,
      });
    },
    fx: (c, t) =>
      t > 1.6 && t < 2.4
        ? { k: "burst", at: project(c, midOf(c.it)) }
        : { k: "drift" },
    Hud: ({ c, t }) => {
      const ride = c.it.legs.find((g) => g.kind === "ride" && g.trip);
      const next = memo(c, "dec-next", () =>
        c.fleet && ride?.trip
          ? c.fleet.arrivals(
              Date.now(),
              c.fleet.serving(ride.trip.board, ride.trip.alight),
              3600,
              1,
            )[0]
          : undefined,
      );
      return (
        <>
          <Leader
            scope={c.leaders}
            at={midOf(c.it)}
            show={t > 1.2}
            dx={80}
            dy={-30}
          >
            <Card
              tone="gold"
              label={id(c, "recommended", "rekomendasi")}
              sub={`${clock(c.it.depart)} → ${clock(c.it.arrive)}${c.it.fare ? ` · Rp${c.it.fare.toLocaleString("id-ID")}` : ""}`}
            >
              <span className="text-2xl italic">
                {Math.round(c.it.minutes)} min · {c.it.dose.toFixed(1)} mm
              </span>
            </Card>
          </Leader>
          {ride && next && c.fleet && (
            <Leader
              scope={c.leaders}
              at={[ride.from.lng, ride.from.lat]}
              show={t > 2.6}
              dx={-80}
              dy={50}
            >
              <Card label={`${id(c, "board at", "naik di")} ${ride.from.name}`}>
                <span
                  className="slant mr-1 inline-block px-1 text-white"
                  style={
                    {
                      "--sl-bg": c.fleet.net.routes[next.route].color,
                    } as CSSProperties
                  }
                >
                  {c.fleet.net.routes[next.route].short}
                </span>
                {next.etaSec < 45
                  ? id(c, "now", "sekarang")
                  : `${id(c, "in", "dalam")} ${Math.round(next.etaSec / 60)} min`}
              </Card>
            </Leader>
          )}
        </>
      );
    },
  },
  {
    id: "paper",
    dur: () => 11,
    title: (c) => id(c, "The research", "Risetnya"),
    layers: { "s-net": 0.25 },
    orbit: 2,
    lines: (c) => [
      id(
        c,
        "This comes from a paper: 'An Experimental Study on Weather-Aware Multimodal Public Transportation Routing Systems', ICDSG 2026.",
        "Ini berasal dari paper: 'An Experimental Study on Weather-Aware Multimodal Public Transportation Routing Systems', ICDSG 2026.",
      ),
      id(
        c,
        "What it tests: can a router trade a few minutes for a lot less rain, without breaking dry-weather routing?",
        "Yang diuji: bisakah router menukar beberapa menit dengan jauh lebih sedikit hujan, tanpa merusak perutean saat kering?",
      ),
      id(
        c,
        "The app logs every search, then checks the real rain afterwards, the same test as the paper, on real trips.",
        "Aplikasi mencatat setiap pencarian, lalu memeriksa hujan sebenarnya setelahnya, uji yang sama seperti paper, pada perjalanan nyata.",
      ),
    ],
    enter: (c) =>
      camTo(c, {
        center: [106.83, -6.2],
        zoom: 11.4,
        pitch: 60,
        bearing: c.map.getBearing(),
        ms: 3000,
      }),
    fx: () => ({ k: "drift" }),
    Hud: ({ c, t }) => (
      <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4">
        <Pop show={t > 0.6}>
          <div className={`${glass} max-w-lg p-5`}>
            <div className="text-[10px] tracking-widest text-[#33d6ff] uppercase">
              ICDSG {BRAND.year}
            </div>
            <div className="mt-1 text-lg leading-snug font-bold">
              An Experimental Study on Weather-Aware Multimodal Public
              Transportation Routing Systems
            </div>
            <div className="mt-1 text-sm text-slate-300">
              {BRAND.authors.join(", ")}
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              {[
                id(
                  c,
                  "Price each segment: c = τ · w · (1 + β · E · φ(r))",
                  "Hargai tiap ruas: c = τ · w · (1 + β · E · φ(r))",
                ),
                id(
                  c,
                  "Dry weather or β = 0 → exactly today's route (safe by construction)",
                  "Kering atau β = 0 → rute biasa persis (aman sejak desain)",
                ),
                id(
                  c,
                  "Route on the forecast, score on the truth",
                  "Rute dengan prakiraan, nilai dengan kenyataan",
                ),
                id(
                  c,
                  "Read the rain you will meet, not the rain at departure",
                  "Baca hujan yang akan ditemui, bukan saat berangkat",
                ),
              ].map((s, i) => (
                <Pop key={s} show={t > 2 + i * 1.6}>
                  <div className="flex gap-2">
                    <span className="text-[#33d6ff]">✓</span>
                    {s}
                  </div>
                </Pop>
              ))}
            </div>
          </div>
        </Pop>
      </div>
    ),
    more: (c) => (
      <p>
        {id(
          c,
          "The simulator (wmptrs-sim) reruns the paper's experiment live: 400 journeys, five variants (A0 today's router … A3 ours, A4 ablation), forecast errors, moving storms. Its numbers vary by seed and are not the paper's reported figures.",
          "Simulator (wmptrs-sim) menjalankan ulang eksperimen paper secara langsung: 400 perjalanan, lima varian, galat prakiraan, badai bergerak. Angkanya bervariasi per seed.",
        )}
      </p>
    ),
  },
  {
    id: "beyond",
    dur: () => 13,
    title: (c) => id(c, "Beyond rain", "Lebih dari hujan"),
    layers: { "s-net": 0.12, "s-hazard": 0.75 },
    lines: (c) => [
      id(
        c,
        "Here's the fun part: φ doesn't have to be rain. Swap in any hazard you can map.",
        "Bagian serunya: φ tidak harus hujan. Ganti dengan bahaya apa pun yang bisa dipetakan.",
      ),
      id(
        c,
        "Flood depth, smoke from a fire, heat, or rescue boats finding someone in a flooded street. Same router, new φ.",
        "Kedalaman banjir, asap kebakaran, panas, atau perahu penyelamat mencari orang di jalan banjir. Router sama, φ baru.",
      ),
    ],
    enter: (c) => {
      camTo(c, {
        center: [106.84, -6.17],
        zoom: 11.3,
        pitch: 55,
        bearing: 0,
        ms: 2400,
      });
      changed(c, "hz", -1);
      if (c.map.getSource("s-hazard"))
        (
          c.map.getSource("s-hazard") as {
            updateImage?: (o: { url: string }) => void;
          }
        ).updateImage?.({ url: hazardImage(0) });
      else
        c.map.addSource("s-hazard", {
          type: "image",
          url: hazardImage(0),
          coordinates: [
            [106.62, -6.03],
            [107.02, -6.03],
            [107.02, -6.36],
            [106.62, -6.36],
          ],
        });
      showLayer(
        c,
        {
          id: "s-hazard",
          type: "raster",
          source: "s-hazard",
          paint: { "raster-fade-duration": 0 },
        },
        "w-route-case",
      );
    },
    frame: (c, t) => {
      const k = clamp(Math.floor((t - 1) / 3), 0, 3);
      if (!changed(c, "hz", k)) return;
      const src = c.map.getSource("s-hazard") as
        | { updateImage?: (o: { url: string }) => void }
        | undefined;
      // dip, swap the field, come back: a cross-fade, not a cut
      fade(c.map, "s-hazard", 0, 200);
      setTimeout(() => {
        src?.updateImage?.({ url: hazardImage(k) });
        fade(c.map, "s-hazard", 0.75, 400);
      }, 220);
    },
    fx: (c, t) => {
      const k = clamp(Math.floor((t - 1) / 3), 0, 3);
      return k === 0
        ? { k: "rain", amount: 0.4, wind: windOf(c) }
        : { k: "drift" };
    },
    Hud: ({ c, t }) => {
      const k = clamp(Math.floor((t - 1) / 3), 0, 3);
      const H = [
        [
          "🌊",
          id(c, "Flood", "Banjir"),
          "φ(depth)",
          id(
            c,
            "walk & motorcycle E = 1 · roads above 30 cm closed",
            "jalan & motor E = 1 · jalan > 30 cm ditutup",
          ),
        ],
        [
          "🔥",
          id(c, "Fire & smoke", "Kebakaran & asap"),
          "φ(PM2.5)",
          id(
            c,
            "route upwind, away from the plume",
            "rute melawan angin, menjauhi asap",
          ),
        ],
        [
          "🌡️",
          id(c, "Heat", "Panas"),
          "φ(heat index)",
          id(
            c,
            "shade and cooled stations count as cover",
            "teduh dan stasiun ber-AC dihitung terlindung",
          ),
        ],
        [
          "🛟",
          id(c, "Search & rescue", "SAR"),
          "φ(depth) · boats E = 0",
          id(
            c,
            "fastest safe path for rescuers to a person",
            "jalur aman tercepat bagi penyelamat menuju korban",
          ),
        ],
      ] as const;
      // the hottest spot of each concept field, for the callout
      const spots: [number, number][] = [
        [106.74, -6.11],
        [106.95, -6.11],
        [106.82, -6.2],
        [106.86, -6.1],
      ];
      return (
        <>
          <Pop
            show
            className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 slant [--sl-bg:#ffd400] px-3 py-0.5 text-[11px] font-black text-[#050b2e]"
          >
            {id(
              c,
              "CONCEPT: illustrative fields, not live data",
              "KONSEP: bidang ilustrasi, bukan data langsung",
            )}
          </Pop>
          <div className="pointer-events-none absolute top-28 left-1/2 flex -translate-x-1/2 gap-2">
            {H.map(([icon, name], i) => (
              <motion.div
                key={name}
                animate={{
                  scale: i === k ? 1.08 : 0.92,
                  opacity: i === k ? 1 : 0.45,
                  y: i === k ? -3 : 0,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 24 }}
                className={`${glass} flex items-center gap-1.5 px-2.5 py-1.5 text-xs`}
              >
                <span className="text-lg">{icon}</span>
                <span className="hidden sm:inline">{name}</span>
              </motion.div>
            ))}
          </div>
          <Leader
            key={`hz-${k}`}
            scope={c.leaders}
            at={spots[k]}
            show={t > 1.3}
            dx={80}
            dy={60}
          >
            <Card tone="dark" label={H[k][1]} sub={H[k][3]}>
              <span className="font-mono">
                c = τ·w·(1 + β·E·
                <span className="text-[#ffd400]">{H[k][2]}</span>)
              </span>
            </Card>
          </Leader>
        </>
      );
    },
  },
  {
    id: "finale",
    dur: () => 15,
    title: () => BRAND.project,
    layers: { "s-net": 0.55, "s-heat": 0.9, "s-trace": 0.85 },
    lines: (c) => [
      id(
        c,
        "All of it together: the sky, the city, every line and every bus…",
        "Semuanya bersama: langit, kota, setiap jalur dan setiap bus…",
      ),
      id(c, "…is one idea.", "…adalah satu gagasan."),
      id(
        c,
        "Now, back to your trip. Hold on!",
        "Sekarang, kembali ke perjalananmu. Pegangan!",
      ),
    ],
    cues: () => [0, MORPH_AT + 1.2, MORPH_BACK],
    enter: (c) => {
      useGL.getState().set({ fleetMode: "trunk" });
      c.cache.delete("morph-src");
      changed(c, "fin-phase", -1);
      // the heat: the rain grid as glowing points in its rain colours
      geo(c.map, "s-heat", {
        type: "FeatureCollection",
        features: gridPoints(c).map(([x, y]) => {
          const r = c.field.at(y, x, c.r.depart);
          const [R, G, B] =
            r > 0.05 ? rainRGBA(Math.max(r, 0.6)) : [51, 214, 255];
          return {
            type: "Feature" as const,
            properties: { c: `rgb(${R},${G},${B})` },
            geometry: { type: "Point" as const, coordinates: [x, y] },
          };
        }),
      });
      showLayer(c, {
        id: "s-heat",
        type: "circle",
        source: "s-heat",
        paint: {
          "circle-radius": 3,
          "circle-color": ["get", "c"],
          "circle-blur": 0.4,
        },
      });
      if (c.map.getLayer("s-net")) c.map.setFilter("s-net", null);
      if (c.fleet) {
        const T = c.trace?.trace;
        const S = c.fleet.net.stops;
        if (T)
          geo(c.map, "s-trace", {
            type: "FeatureCollection",
            features: T.steps
              .filter((s) => s.s !== T.dest)
              .map((s, i, a) => ({
                type: "Feature" as const,
                properties: { o: i / a.length },
                geometry: {
                  type: "Point" as const,
                  coordinates: [S.lng[s.s], S.lat[s.s]],
                },
              })),
          });
      }
      // straight down over the whole city: the cleanest picture to morph
      camTo(c, {
        center: [106.83, -6.22],
        zoom: 10.2,
        pitch: 0,
        bearing: 0,
        ms: 3200,
      });
    },
    frame: (c, t) => {
      const phase = t < MORPH_AT ? 0 : t < MORPH_BACK + 0.9 ? 1 : 2;
      if (!changed(c, "fin-phase", phase)) return;
      if (phase === 1) {
        // the particles take over exactly where the elements were
        for (const l of ["s-net", "s-heat", "s-trace"]) fade(c.map, l, 0, 250);
        for (const [l] of APP_LAYERS) fade(c.map, l, 0, 250);
      } else if (phase === 2) {
        fade(c.map, "s-net", 0.55, 600);
        fade(c.map, "s-heat", 0.9, 600);
        fade(c.map, "s-trace", 0.85, 600);
        restoreAppLayers(c.map);
      }
    },
    fx: (c, t) => {
      if (t < MORPH_AT) return { k: "drift" };
      const src = memo(c, "morph-src", () => captureSrc(c));
      if (t > MORPH_BACK + 1.6) return { k: "drift" };
      return {
        k: "morph",
        text: "W-MPTRS",
        y: window.innerHeight * 0.36,
        src,
        phase: t < MORPH_BACK ? "gather" : "return",
      };
    },
    Hud: ({ c, t }) => {
      const on = t > MORPH_AT + 1.4 && t < MORPH_BACK;
      return (
        <>
          <motion.div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_50%_at_50%_42%,rgba(5,11,46,.94),rgba(5,11,46,.55)_70%,transparent)]"
            initial={{ opacity: 0 }}
            animate={{
              opacity: t > MORPH_AT - 0.4 && t < MORPH_BACK + 0.4 ? 1 : 0,
            }}
            transition={{ duration: 0.8 }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-[52%] flex flex-col items-center px-6 text-center text-white">
            <Pop show={on}>
              <div className="slant px-4 py-1.5 text-[#050b2e] [--sl-sh:6px_6px_0_#1546ff]">
                <div className="text-base font-black sm:text-xl">
                  Weather-Aware Multimodal Public Transportation Routing System
                </div>
              </div>
            </Pop>
            <Pop
              show={on && t > MORPH_AT + 2}
              className="mt-3 text-sm font-semibold text-white sm:text-base"
            >
              {BRAND.authors.join(" · ")} · ICDSG {BRAND.year}
            </Pop>
            <Pop
              show={on && t > MORPH_AT + 2.6}
              className="mt-1 text-sm text-[#33d6ff]"
            >
              {BRAND.app} — {BRAND.tagline[c.lang]}
            </Pop>
          </div>
        </>
      );
    },
  },
];

// ── the search HUD: the real to-do list, tethered to the map ────────────────

function SearchHud({ c, t }: { c: Ctx; t: number }) {
  const p = searchPrep(c);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  if (!p)
    return (
      <Pop show className="pointer-events-none absolute top-24 left-4">
        <Stat label={id(c, "stops settled", "halte ditetapkan")}>
          <Run v={c.r.stats.settled} over={6} />
        </Stat>
      </Pop>
    );
  const k = settledAt(p, t);
  const detailed = t < S_FAST;
  const q = detailed ? p.queue(Math.min(k, p.detail)) : [];
  const just = k > 0 ? p.steps[Math.min(k, p.steps.length) - 1] : null;
  const top = q[0];
  const n = p.steps.length;
  return (
    <>
      {/* the to-do list (a priority queue), cheapest on top */}
      <div className="pointer-events-none absolute top-24 right-4 w-[min(15rem,46vw)]">
        <Pop show={detailed && t > 1.6}>
          <div className={`${glass} p-2.5`}>
            <div className="text-[10px] font-black tracking-[0.2em] text-[#33d6ff] uppercase">
              {id(c, "to-do list · cheapest first", "daftar · termurah dulu")}
            </div>
            <div className="mt-1 space-y-0.5">
              <AnimatePresence initial={false}>
                {q.map((e, i) => (
                  <motion.div
                    key={e.n}
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{
                      opacity: 0,
                      x: -20,
                      transition: { duration: 0.15 },
                    }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    className={`flex items-center gap-2 px-1.5 py-0.5 text-xs ${i === 0 ? "slant [--sl-bg:#ffd400] font-black text-[#050b2e]" : "text-slate-200"}`}
                  >
                    <span className={"flex-1 truncate"}>{p.name(e.n)}</span>
                    <span className={"font-mono"}>{f1(e.cost)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              {id(
                c,
                "cost = perceived minutes so far",
                "biaya = menit terasa sejauh ini",
              )}
            </div>
          </div>
        </Pop>
      </div>
      {top && (
        <Tether
          scope={c.leaders}
          at={p.pos(top.n)}
          to={() => rows.current[0] ?? null}
          show={detailed && t > 1.8}
        />
      )}
      <Leader
        scope={c.leaders}
        at={start(c)}
        show={t > 0.6 && t < S_A + 0.4}
        dx={-70}
        dy={50}
      >
        <Card
          label={id(c, "start", "mulai")}
          sub={id(c, "the first item on the list", "item pertama di daftar")}
        >
          {id(c, "cost 0", "biaya 0")}
        </Card>
      </Leader>
      {just && detailed && (
        <Leader
          key={`step-${k}`}
          scope={c.leaders}
          at={p.pos(just.s)}
          show
          dx={-80}
          dy={-55}
        >
          <Card
            tone="gold"
            label={`${id(c, "step", "langkah")} ${k} · ${id(c, "settled", "ditetapkan")}`}
            sub={
              k === 1
                ? id(
                    c,
                    "cheapest on the list → its cost is final",
                    "termurah di daftar → biayanya final",
                  )
                : (p.steps[k - 1].relax ?? []).length
                  ? `${id(c, "then tried", "lalu dicoba")} ${(p.steps[k - 1].relax ?? []).length} ${id(c, "new costs (dashed)", "biaya baru (putus-putus)")}`
                  : id(
                      c,
                      "nothing cheaper reachable from here: on to the next",
                      "tak ada yang lebih murah dari sini: lanjut",
                    )
            }
          >
            {p.name(just.s)} · {f1(just.cost)} min
          </Card>
        </Leader>
      )}
      {!detailed && t < S_GOAL && just && (
        <Leader scope={c.leaders} at={p.pos(just.s)} show dx={70} dy={-50}>
          <Card
            tone="dark"
            label={`${id(c, "settled", "ditetapkan")} ${k.toLocaleString()} / ${n.toLocaleString()}`}
            sub={id(
              c,
              "every stop cheaper than this is done",
              "semua halte yang lebih murah sudah selesai",
            )}
          >
            {id(c, "cost now", "biaya kini")} {f1(just.cost)} min
          </Card>
        </Leader>
      )}
      <Leader
        scope={c.leaders}
        at={goal(c)}
        show={t >= S_GOAL}
        dx={70}
        dy={-50}
      >
        <Card
          tone="gold"
          label={id(c, "goal settled", "tujuan ditetapkan")}
          sub={`${n.toLocaleString()} ${id(c, "stops", "halte")} · ${Math.round(c.trace?.ms ?? 0)} ms · ${(c.trace?.relaxed ?? 0).toLocaleString()} ${id(c, "connections tried", "sambungan dicoba")}`}
        >
          {id(c, "cost", "biaya")} {f1(p.goalCost)}
        </Card>
      </Leader>
      <Leader
        scope={c.leaders}
        at={midOf(c.it)}
        show={t > S_GOAL + 1.2}
        dx={-80}
        dy={40}
      >
        <Card label={id(c, "follow the parents back", "telusuri asal-usulnya")}>
          {id(
            c,
            "goal → … → start = your route",
            "tujuan → … → mulai = rutemu",
          )}
        </Card>
      </Leader>
      <div className="pointer-events-none absolute top-24 left-4">
        <Pop show={t > S_FAST}>
          <Stat label={id(c, "stops settled", "halte ditetapkan")}>
            {k.toLocaleString()}
          </Stat>
        </Pop>
      </div>
    </>
  );
}

/** illustrative hazard fields: a few soft blobs in each hazard's palette */
const hazardCache = new Map<number, string>();
function hazardImage(k: number): string {
  const hit = hazardCache.get(k);
  if (hit) return hit;
  const W = 200;
  const H = 165;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  if (!g) return "";
  const blobs: Record<number, [number, number, number][]> = {
    0: [
      [0.3, 0.25, 0.22],
      [0.62, 0.18, 0.16],
      [0.5, 0.55, 0.12],
      [0.8, 0.4, 0.14],
    ],
    1: [
      [0.55, 0.45, 0.1],
      [0.68, 0.36, 0.2],
      [0.82, 0.26, 0.26],
    ],
    2: [[0.5, 0.5, 0.45]],
    3: [
      [0.3, 0.25, 0.22],
      [0.62, 0.18, 0.16],
    ],
  };
  const pal: Record<number, (v: number) => [number, number, number, number]> = {
    0: (v) => [37, 99, 235, 0.85 * v],
    1: (v) => (v > 0.6 ? [239, 68, 68, v] : [120, 113, 108, 0.9 * v]),
    2: (v) => [245, Math.round(158 - v * 100), 11, 0.6 * v],
    3: (v) => [14, 165, 233, 0.8 * v],
  };
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (const [bx, by, r] of blobs[k]) {
        const d = Math.hypot(x / W - bx, (y / H - by) * 0.85);
        v = Math.max(v, Math.exp(-((d / r) ** 2) * 2));
      }
      // ragged edges read as a field, not a circle
      v *= 0.85 + 0.15 * Math.sin(x * 0.31 + y * 0.17) * Math.cos(y * 0.23);
      const m = pal[k](Math.max(0, Math.min(1, v)));
      const i = (y * W + x) * 4;
      img.data[i] = m[0];
      img.data[i + 1] = m[1];
      img.data[i + 2] = m[2];
      img.data[i + 3] = Math.round(m[3] * 255);
    }
  g.putImageData(img, 0, 0);
  if (k === 3) {
    g.font = "18px system-ui";
    g.fillText("🧍", W * 0.58, H * 0.22);
    g.fillText("🚤", W * 0.36, H * 0.32);
  }
  const url = cv.toDataURL();
  hazardCache.set(k, url);
  return url;
}

function PhiChart({
  r,
  r0,
  k,
  lang,
}: {
  r: number;
  r0: number;
  k: number;
  lang: Lang;
}) {
  const R = 30;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const x = (i / 60) * R;
    return `${(x / R) * 100},${40 - phi(x, r0, k) * 36}`;
  }).join(" ");
  return (
    <div className={`${glass} w-56 p-2`}>
      <div className="text-[10px] tracking-wider text-[#33d6ff] uppercase">
        φ(r) · {lang === "id" ? "ketidaknyamanan hujan" : "rain discomfort"}
      </div>
      <svg viewBox="-2 0 106 46" className="h-20 w-full">
        <title>φ(r) curve</title>
        <motion.polyline
          points={pts}
          fill="none"
          stroke="#33d6ff"
          strokeWidth="1.6"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1 }}
        />
        <line
          x1={(r0 / R) * 100}
          x2={(r0 / R) * 100}
          y1="4"
          y2="40"
          stroke="#64748b"
          strokeDasharray="1.5 1.5"
          strokeWidth=".4"
        />
        <motion.circle
          animate={{
            cx: (Math.min(r, R) / R) * 100,
            cy: 40 - phi(r, r0, k) * 36,
          }}
          transition={{ type: "spring", stiffness: 200, damping: 22 }}
          r="2.4"
          fill="#ffd400"
        />
        <text x="0" y="45.5" fontSize="3.6" fill="#94a3b8">
          0
        </text>
        <text
          x={(r0 / R) * 100}
          y="45.5"
          fontSize="3.6"
          fill="#94a3b8"
          textAnchor="middle"
        >
          r₀
        </text>
        <text x="100" y="45.5" fontSize="3.6" fill="#94a3b8" textAnchor="end">
          {R} mm/h
        </text>
      </svg>
    </div>
  );
}
