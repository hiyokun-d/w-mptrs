"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Download, Loader2, RotateCcw, Share2, X } from "lucide-react";
import {
  type GeoJSONSource,
  type Map as GLMap,
  Map as MapLibre,
  setWorkerUrl,
} from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceSays } from "@/app/api/rain/sources/route";
import { BRAND } from "@/lib/brand";
import { RainField, type RainGrid } from "@/lib/core/rainfield";
import type { Itinerary } from "@/lib/core/router";
import type { PlanResponse } from "@/lib/local/planner";
import { chosen, useApp } from "@/lib/store/app";
import { firstSymbol, sliceLines, THEME, themeBase } from "../gl/layers";
import { useGL } from "../gl/store";
import { rainRGBA } from "../rain-colors";
import {
  type Box,
  buildShots,
  type Cam,
  type LngLat,
  type Shot,
} from "./shots";

// A 9:16 video of one trip, for an Instagram story: the camera flies through
// the routes, the forecast and each leg while boxes point at the map. The map
// renders off screen at 1080×1920; every frame is copied onto one canvas
// with the boxes, captions and particles drawn on top, and that canvas is
// recorded in real time.

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** logical size; the output is 2× (1080×1920) */
const W = 540;
const H = 960;
const S = 2;
/** Instagram's own top bar and reply box cover these */
const SAFE = { top: 128, bottom: 200 };

type Phase =
  | { k: "prep"; msg: string; f: number }
  | { k: "rec"; t: number; total: number }
  | { k: "done"; url: string; file: File }
  | { k: "error"; msg: string };

interface Resolved {
  shot: Shot;
  start: number;
  /** camera when the move ends */
  to: { center: LngLat; zoom: number; pitch: number; bearing: number };
}
type Camera = Resolved["to"];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const ease = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const out3 = (x: number) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const ll = (p: [number, number]): LngLat => [p[1], p[0]];
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export default function StoryStudio({ grid }: { grid: RainGrid | null }) {
  const app = useApp();
  const close = () => useGL.getState().set({ story: false });
  const r = app.result as PlanResponse | null;
  const it = r ? chosen(r, app.choice) : null;
  const other = r
    ? chosen(r, app.choice === "fastest" ? "weatherAware" : "fastest")
    : null;
  const alt = r?.shift && other && other !== it ? other : null;
  const L = (en: string, id: string) => (app.lang === "en" ? en : id);

  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>({
    k: "prep",
    msg: L("Reading the forecasts…", "Membaca prakiraan…"),
    f: 0,
  });
  const [run, setRun] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one recording per run
  useEffect(() => {
    if (!box.current || !canvas.current || !r || !it) return;
    let dead = false;
    let raf = 0;
    let rec: MediaRecorder | null = null;
    const map = new MapLibre({
      container: box.current,
      style: STYLE,
      center: [it.legs[0].from.lng, it.legs[0].from.lat],
      zoom: 12,
      interactive: false,
      attributionControl: false,
      pixelRatio: S,
      maxPitch: 75,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
    });
    if (process.env.NODE_ENV === "development")
      (window as unknown as { __story: GLMap }).__story = map;
    const go = async () => {
      // what BMKG and Open-Meteo say where the trip gets wettest
      const wet = [...it.legs, ...(alt?.legs ?? [])]
        .filter((g) => g.kind === "walk" || g.kind === "moto")
        .sort((a, b) => b.rain - a.rain)[0];
      const p = wet?.path[Math.floor(wet.path.length / 2)] ?? [
        it.legs[0].from.lat,
        it.legs[0].from.lng,
      ];
      const says: SourceSays[] = await fetch("/api/rain/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pts: [
            {
              lat: p[0],
              lng: p[1],
              t: wet ? (wet.t0 + wet.t1) / 2 : it.depart,
            },
          ],
        }),
      })
        .then((x) => (x.ok ? x.json() : []))
        .catch(() => []);
      if (dead) return;
      const shots = buildShots({
        r,
        it,
        alt,
        lang: app.lang,
        says,
      });
      await new Promise<void>((ok) =>
        map.loaded() ? ok() : map.once("load", () => ok()),
      );
      if (dead) return;
      setup(map, it, alt);
      const plan = resolve(map, shots);
      const total = plan.reduce((a, x) => a + x.shot.dur, 0);
      const field = new RainField(grid, r.cells, r.depart);

      // warm the tile cache at every place the camera stops
      const stops: Camera[] = [];
      plan.forEach((x, i) => {
        stops.push(camAt(plan, i, x.shot.move));
        stops.push(camAt(plan, i, x.shot.dur));
        if (i) {
          const a = camAt(plan, i - 1, plan[i - 1].shot.dur);
          stops.push(fly(a, x.to, 0.5));
        }
      });
      for (let i = 0; i < stops.length; i++) {
        if (dead) return;
        setPhase({
          k: "prep",
          msg: L("Loading the map…", "Memuat peta…"),
          f: i / stops.length,
        });
        const c = stops[i];
        map.jumpTo(c);
        await idle(map, 3500);
      }
      if (dead) return;

      // record
      const cv = canvas.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const stream = cv.captureStream(30);
      const mime =
        [
          "video/mp4;codecs=avc1.42E01E",
          "video/mp4",
          "video/webm;codecs=vp9",
          "video/webm",
        ].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      rec = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: 8_000_000,
      });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        if (dead) return;
        const type = rec?.mimeType || "video/webm";
        const blob = new Blob(chunks, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const name = `dryline-${slug(it.legs[0].from.name)}-${slug(it.legs.at(-1)?.to.name)}.${ext}`;
        const file = new File([blob], name, { type });
        setPhase({ k: "done", url: URL.createObjectURL(blob), file });
      };
      const fx = new Fx();
      let shotIx = -1;
      let lastHud = 0;
      let t0 = 0;
      let prev = 0;
      const frame = (now: number) => {
        if (dead) return;
        if (!t0) {
          t0 = now;
          prev = now;
          rec?.start(500);
        }
        const t = (now - t0) / 1000;
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (t >= total) {
          rec?.stop();
          return;
        }
        let i = plan.findIndex((x) => t < x.start + x.shot.dur);
        if (i < 0) i = plan.length - 1;
        const x = plan[i];
        const st = t - x.start;
        if (i !== shotIx) {
          shotIx = i;
          onShot(map, x.shot, field, it);
        }
        if (x.shot.drawIn) drawIn(map, it, alt, out3(st / (x.shot.dur * 0.7)));
        map.jumpTo(camAt(plan, i, st));
        map.redraw();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(map.getCanvas(), 0, 0, W * S, H * S);
        ctx.setTransform(S, 0, 0, S, 0, 0);
        paint(
          ctx,
          map,
          x.shot,
          st,
          t,
          total,
          dt,
          fx,
          it,
          alt,
          r,
          app.lang,
          i + 1,
        );
        if (now - lastHud > 200) {
          lastHud = now;
          setPhase({ k: "rec", t, total });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    go().catch((e) => {
      console.warn("[story]", e);
      if (!dead) setPhase({ k: "error", msg: String(e?.message ?? e) });
    });
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      if (rec && rec.state !== "inactive") rec.stop();
      map.remove();
    };
  }, [run]);

  // free the video when it is replaced or the studio closes
  const url = phase.k === "done" ? phase.url : null;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const share = useCallback(async () => {
    if (phase.k !== "done") return;
    const f = phase.file;
    try {
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({
          files: [f],
          title: `${BRAND.app}: ${it?.legs[0]?.from.name ?? ""} → ${it?.legs.at(-1)?.to.name ?? ""}`,
        });
        return;
      }
    } catch {
      // share sheet dismissed
      return;
    }
    save(f);
  }, [phase, it]);

  if (!r || !it) return null;
  const busy = phase.k === "prep" || phase.k === "rec";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-[#050b2e]/95 p-4 text-white"
    >
      {/* the map renders here, unseen; the canvas shows the composed frame */}
      {/* MapLibre makes its container position: relative, so the fixed,
          unseen frame is a wrapper around it */}
      <div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 -z-10 opacity-0"
      >
        <div ref={box} style={{ width: W, height: H }} />
      </div>
      <div className="flex w-full max-w-sm items-center justify-between">
        <p className="text-xs font-black tracking-[0.2em] text-[#33d6ff] uppercase">
          {L("Trip video · story 9:16", "Video perjalanan · story 9:16")}
        </p>
        <button
          type="button"
          aria-label={L("Close", "Tutup")}
          onClick={close}
          className="p-2 hover:bg-white/10"
        >
          <X className="size-5" />
        </button>
      </div>
      <div
        className="relative shrink-0 overflow-hidden bg-black shadow-[8px_8px_0_#1546ff]"
        style={{
          height: "min(72dvh, calc((100vw - 2rem) * 16 / 9))",
          aspectRatio: "9 / 16",
        }}
      >
        <canvas
          ref={canvas}
          width={W * S}
          height={H * S}
          className={`h-full w-full ${phase.k === "done" ? "hidden" : ""}`}
        />
        {phase.k === "done" && (
          <video
            src={phase.url}
            autoPlay
            loop
            muted
            playsInline
            controls
            className="h-full w-full"
          />
        )}
        <AnimatePresence>
          {phase.k === "prep" && (
            <motion.div
              key="prep"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#050b2e]"
            >
              <Loader2 className="size-6 animate-spin text-[#33d6ff]" />
              <p className="text-sm font-semibold">{phase.msg}</p>
              <div className="h-1.5 w-40 -skew-x-12 bg-white/15">
                <div
                  className="h-full bg-[#33d6ff] transition-[width] duration-300"
                  style={{ width: `${Math.round(phase.f * 100)}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex h-12 w-full max-w-sm items-center gap-2">
        {phase.k === "rec" && (
          <p className="flex-1 text-center text-sm font-semibold">
            <span className="mr-2 inline-block size-2.5 animate-pulse rounded-full bg-red-500" />
            {L("Recording", "Merekam")} {Math.floor(phase.t)} /{" "}
            {Math.round(phase.total)} s
          </p>
        )}
        {phase.k === "prep" && (
          <p className="flex-1 text-center text-xs text-slate-300">
            {L(
              "Keep this tab open while the video records.",
              "Biarkan tab ini terbuka selama video direkam.",
            )}
          </p>
        )}
        {phase.k === "error" && (
          <p className="flex-1 text-center text-sm text-red-300">{phase.msg}</p>
        )}
        {(phase.k === "done" || phase.k === "error") && (
          <button
            type="button"
            onClick={() => {
              setPhase({ k: "prep", msg: L("Starting…", "Memulai…"), f: 0 });
              setRun((n) => n + 1);
            }}
            className="flex h-11 items-center gap-2 px-3 text-sm font-bold hover:bg-white/10"
          >
            <RotateCcw className="size-4" /> {L("Again", "Ulang")}
          </button>
        )}
        {phase.k === "done" && (
          <>
            <button
              type="button"
              onClick={() => save(phase.file)}
              className="flex h-11 flex-1 items-center justify-center gap-2 border-2 border-white text-sm font-bold hover:bg-white/10"
            >
              <Download className="size-4" /> {L("Save", "Simpan")}
            </button>
            <button
              type="button"
              onClick={share}
              className="slant flex h-11 flex-1 items-center justify-center gap-2 text-sm font-black text-[#050b2e] italic [--sl-sh:5px_5px_0_#1546ff]"
            >
              <Share2 className="size-4" /> {L("Share", "Bagikan")}
            </button>
          </>
        )}
      </div>
      {busy && (
        <p className="max-w-sm text-center text-[11px] text-slate-400">
          {L(
            "Rain: BMKG and Open-Meteo forecasts · Map © OpenStreetMap contributors, OpenMapTiles",
            "Hujan: prakiraan BMKG dan Open-Meteo · Peta © kontributor OpenStreetMap, OpenMapTiles",
          )}
        </p>
      )}
    </motion.div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function slug(s?: string) {
  return (s ?? "x")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function save(f: File) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function idle(map: GLMap, ms: number) {
  return new Promise<void>((ok) => {
    const done = () => {
      clearTimeout(id);
      ok();
    };
    const id = setTimeout(() => {
      map.off("idle", done);
      ok();
    }, ms);
    map.once("idle", done);
    map.triggerRepaint();
  });
}

/** camera for a shot's framing, computed on the real 540×960 viewport */
function frame(map: GLMap, c: Cam): Camera {
  if (c.fit && c.fit.length >= 2) {
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [x, y] of c.fit) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    const cam = map.cameraForBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding: {
          top: SAFE.top + 90,
          bottom: SAFE.bottom + 110,
          left: 50,
          right: 50,
        },
        bearing: c.bearing,
        maxZoom: 16,
      },
    );
    if (cam?.center && cam.zoom != null) {
      const ctr = cam.center as { lng: number; lat: number };
      return {
        center: [ctr.lng, ctr.lat],
        // the fit is computed flat; tilted, the far end recedes
        zoom: cam.zoom - (c.pitch / 60) * 0.7,
        pitch: c.pitch,
        bearing: c.bearing,
      };
    }
  }
  const p = c.fit?.[0] ?? c.center ?? [106.83, -6.2];
  return { center: p, zoom: c.zoom ?? 14, pitch: c.pitch, bearing: c.bearing };
}

function resolve(map: GLMap, shots: Shot[]): Resolved[] {
  let start = 0;
  return shots.map((shot) => {
    const x = { shot, start, to: frame(map, shot.cam) };
    start += shot.dur;
    return x;
  });
}

/** the camera `st` seconds into shot i: a flight there, then a slow drift */
function camAt(plan: Resolved[], i: number, st: number): Camera {
  const x = plan[i];
  const drift = Math.max(0, st - x.shot.move);
  const base =
    i === 0 || st >= x.shot.move
      ? x.to
      : fly(
          camAt(plan, i - 1, plan[i - 1].shot.dur),
          x.to,
          ease(st / x.shot.move),
        );
  return {
    center: base.center,
    zoom: base.zoom + x.shot.push * drift,
    pitch: base.pitch,
    bearing: base.bearing + x.shot.orbit * drift,
  };
}

/** between two cameras, rising out when they are far apart (like flyTo) */
function fly(a: Camera, b: Camera, e: number): Camera {
  const lat = (a.center[1] + b.center[1]) / 2;
  const km = Math.hypot(
    (b.center[0] - a.center[0]) * 111.3 * Math.cos((lat * Math.PI) / 180),
    (b.center[1] - a.center[1]) * 110.6,
  );
  const zMin = Math.min(a.zoom, b.zoom);
  const span =
    (40075 * Math.cos((lat * Math.PI) / 180) * W) / (512 * 2 ** zMin);
  const bump =
    km > span * 0.45 ? Math.min(3, Math.log2(km / (span * 0.45)) + 0.4) : 0;
  return {
    center: [
      a.center[0] + (b.center[0] - a.center[0]) * e,
      a.center[1] + (b.center[1] - a.center[1]) * e,
    ],
    zoom: a.zoom + (b.zoom - a.zoom) * e - bump * Math.sin(Math.PI * e),
    pitch: a.pitch + (b.pitch - a.pitch) * e,
    bearing: a.bearing + wrapDeg(b.bearing - a.bearing) * e,
  };
}

// ── map layers ──────────────────────────────────────────────────────────────

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({
  type: "FeatureCollection",
  features,
});
const line = (
  coords: LngLat[],
  props: Record<string, unknown>,
): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: coords },
});

function legLines(it: Itinerary | null) {
  return (it?.legs ?? [])
    .filter((g) => g.kind !== "wait" && g.path.length >= 2)
    .map((g) => ({ g, coords: g.path.map(ll) }));
}

function setup(map: GLMap, it: Itinerary, alt: Itinerary | null) {
  themeBase(map);
  const before = firstSymbol(map);
  const src = (id: string) =>
    map.addSource(id, { type: "geojson", data: fc([]) });
  for (const id of ["v-rain", "v-alt", "v-route", "v-focus", "v-stops"])
    src(id);
  map.addLayer(
    {
      id: "v-rain",
      type: "fill",
      source: "v-rain",
      paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "a"] },
    },
    before,
  );
  map.addLayer(
    {
      id: "v-alt-case",
      type: "line",
      source: "v-alt",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": THEME.ink, "line-width": 9, "line-opacity": 0.55 },
    },
    before,
  );
  map.addLayer(
    {
      id: "v-alt",
      type: "line",
      source: "v-alt",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#94a3b8", "line-width": 5 },
    },
    before,
  );
  map.addLayer({
    id: "v-route-case",
    type: "line",
    source: "v-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": THEME.ink, "line-width": 11 },
  });
  map.addLayer({
    id: "v-route",
    type: "line",
    source: "v-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "c"],
      "line-width": ["case", ["get", "walk"], 5, 7],
      "line-dasharray": [
        "case",
        ["get", "walk"],
        ["literal", [1, 1.4]],
        ["literal", [1, 0]],
      ],
    },
  });
  map.addLayer({
    id: "v-focus",
    type: "line",
    source: "v-focus",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": THEME.gold,
      "line-width": 16,
      "line-opacity": 0.55,
      "line-blur": 2,
    },
  });
  map.moveLayer("v-focus", "v-route-case");
  map.addLayer({
    id: "v-stops",
    type: "circle",
    source: "v-stops",
    paint: {
      "circle-radius": ["case", ["get", "end"], 9, 6],
      "circle-color": ["case", ["get", "end"], THEME.gold, "#ffffff"],
      "circle-stroke-color": THEME.ink,
      "circle-stroke-width": 3,
    },
  });
  const stops: GeoJSON.Feature[] = [];
  it.legs.forEach((g, i) => {
    stops.push({
      type: "Feature",
      properties: { end: i === 0 },
      geometry: { type: "Point", coordinates: [g.from.lng, g.from.lat] },
    });
  });
  const last = it.legs.at(-1);
  if (last)
    stops.push({
      type: "Feature",
      properties: { end: true },
      geometry: { type: "Point", coordinates: [last.to.lng, last.to.lat] },
    });
  (map.getSource("v-stops") as GeoJSONSource).setData(fc(stops));
  drawIn(map, it, alt, 1);
}

/** draw the routes in travel order up to fraction f */
function drawIn(map: GLMap, it: Itinerary, alt: Itinerary | null, f: number) {
  const a = legLines(alt);
  const b = legLines(it);
  const cut = (xs: typeof b) =>
    sliceLines(
      xs.map((x) => x.coords),
      f,
    );
  const as = cut(a);
  const bs = cut(b);
  (map.getSource("v-alt") as GeoJSONSource | undefined)?.setData(
    fc(as.filter((c) => c.length >= 2).map((c) => line(c, {}))),
  );
  (map.getSource("v-route") as GeoJSONSource | undefined)?.setData(
    fc(
      bs
        .map((c, k) => ({ c, g: b[k].g }))
        .filter((x) => x.c.length >= 2)
        .map((x) =>
          line(x.c, {
            walk: x.g.kind === "walk",
            c:
              x.g.kind === "walk"
                ? "#ffffff"
                : x.g.kind === "moto"
                  ? "#16a34a"
                  : (x.g.route?.color ?? THEME.blue),
          }),
        ),
    ),
  );
}

/** a new shot: the rain layer at its time, the leg it is about */
function onShot(map: GLMap, s: Shot, field: RainField, it: Itinerary) {
  const g = s.focus != null ? it.legs[s.focus] : null;
  (map.getSource("v-focus") as GeoJSONSource).setData(
    fc(g && g.path.length >= 2 ? [line(g.path.map(ll), {})] : []),
  );
  // rain cells around the trip, at the shot's moment
  const pts = it.legs.flatMap((x) => x.path);
  let [s0, n0, w0, e0] = [90, -90, 180, -180];
  for (const [lat, lng] of pts) {
    s0 = Math.min(s0, lat);
    n0 = Math.max(n0, lat);
    w0 = Math.min(w0, lng);
    e0 = Math.max(e0, lng);
  }
  const pad = 0.12;
  const n = 34;
  const dLat = (n0 - s0 + 2 * pad) / n;
  const dLng = (e0 - w0 + 2 * pad) / n;
  const cells: GeoJSON.Feature[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const lat = s0 - pad + (i + 0.5) * dLat;
      const lng = w0 - pad + (j + 0.5) * dLng;
      const v = field.at(lat, lng, s.rainAt);
      const [r, gg, b, a] = rainRGBA(v);
      if (!a) continue;
      cells.push({
        type: "Feature",
        properties: { c: `rgb(${r},${gg},${b})`, a: (a / 255) * 0.8 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng - dLng / 2, lat - dLat / 2],
              [lng + dLng / 2, lat - dLat / 2],
              [lng + dLng / 2, lat + dLat / 2],
              [lng - dLng / 2, lat + dLat / 2],
              [lng - dLng / 2, lat - dLat / 2],
            ],
          ],
        },
      });
    }
  (map.getSource("v-rain") as GeoJSONSource).setData(fc(cells));
}

// ── particles: rain, people, vehicles ───────────────────────────────────────

interface Drop {
  x: number;
  y: number;
  ground: number;
  len: number;
  v: number;
  w: number;
}
interface Splash {
  x: number;
  y: number;
  age: number;
}

class Fx {
  drops: Drop[] = [];
  splashes: Splash[] = [];
  level = 0;
  flash = 0;
  rain(ctx: CanvasRenderingContext2D, mmh: number, dt: number) {
    // ease the amount so shots don't snap from dry to a downpour
    const want = mmh < 0.3 ? 0 : clamp(0.2 + mmh / 18, 0, 1);
    this.level += (want - this.level) * (1 - Math.exp(-dt / 0.5));
    const n = Math.round(this.level * 340);
    while (this.drops.length < n) this.drops.push(this.drop(true));
    if (this.drops.length > n) this.drops.length = n;
    const wind = 70;
    ctx.lineCap = "round";
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x += wind * dt;
      if (d.y > d.ground) {
        if (this.splashes.length < 160)
          this.splashes.push({ x: d.x, y: d.ground, age: 0 });
        Object.assign(d, this.drop(false));
      }
      const k = d.len / d.v;
      ctx.strokeStyle = `rgba(220,235,255,${0.35 + d.w * 0.15})`;
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(d.x - wind * k, d.y - d.len);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.lineWidth = 1.6;
    this.splashes = this.splashes.filter((s) => {
      s.age += dt;
      const a = 1 - s.age / 0.35;
      if (a <= 0) return false;
      const rr = 3 + s.age * 40;
      ctx.strokeStyle = `rgba(230,240,255,${0.6 * a})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rr, rr * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
      return true;
    });
    // heavy rain: now and then the sky lights up
    if (mmh > 12 && Math.random() < dt * 0.25) this.flash = 1;
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      this.flash *= Math.exp(-dt / 0.12);
    }
  }
  drop(top: boolean): Drop {
    const w = 1.6 + Math.random() * 1.8;
    return {
      x: Math.random() * (W + 100) - 100,
      y: top ? Math.random() * H : -Math.random() * 120,
      ground: H * (0.3 + Math.random() * 0.7),
      len: 26 + w * 14,
      v: 900 + w * 260,
      w,
    };
  }
}

/** a point a fraction f along a path ([lat, lng] points) */
function along(path: [number, number][], f: number): LngLat | null {
  if (path.length < 2) return path[0] ? ll(path[0]) : null;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(
      path[i][0] - path[i - 1][0],
      path[i][1] - path[i - 1][1],
    );
    seg.push(d);
    total += d;
  }
  let want = (((f % 1) + 1) % 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]) {
      const u = seg[i] ? want / seg[i] : 0;
      return [
        path[i][1] + u * (path[i + 1][1] - path[i][1]),
        path[i][0] + u * (path[i + 1][0] - path[i][0]),
      ];
    }
    want -= seg[i];
  }
  return ll(path[path.length - 1]);
}

function person(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  c: string,
  step: number,
) {
  ctx.fillStyle = c;
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 2;
  // legs swing as they walk
  const sw = Math.sin(step) * 3 * s;
  ctx.beginPath();
  ctx.moveTo(x, y - 6 * s);
  ctx.lineTo(x - sw, y);
  ctx.moveTo(x, y - 6 * s);
  ctx.lineTo(x + sw, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x - 4 * s, y - 15 * s, 8 * s, 10 * s, 3 * s);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - 19 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function vehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: string,
  label: string,
) {
  ctx.font = "900 italic 12px system-ui, sans-serif";
  const w = Math.max(30, ctx.measureText(label).width + 14);
  ctx.fillStyle = THEME.ink;
  ctx.fillRect(x - w / 2 + 3, y - 9 + 3, w, 18);
  ctx.fillStyle = c;
  ctx.fillRect(x - w / 2, y - 9, w, 18);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function movers(
  ctx: CanvasRenderingContext2D,
  map: GLMap,
  it: Itinerary,
  alt: Itinerary | null,
  t: number,
  focus?: number,
) {
  const draw = (x: Itinerary, mine: boolean) =>
    x.legs.forEach((g, i) => {
      if (focus != null && mine && i !== focus && g.kind === "walk") return;
      if (g.kind === "walk") {
        const n = mine ? 4 : 2;
        for (let k = 0; k < n; k++) {
          const p = along(g.path, t / 9 + k / n);
          if (!p) continue;
          const q = map.project(p);
          if (q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) continue;
          person(
            ctx,
            q.x,
            q.y,
            mine ? 1.25 : 0.9,
            mine ? "#ffffff" : "#cbd5e1",
            t * 9 + k,
          );
        }
      } else if (g.kind === "ride" || g.kind === "moto") {
        const p = along(g.path, t / 7 + i * 0.3);
        if (!p) return;
        const q = map.project(p);
        if (q.x < -40 || q.x > W + 40 || q.y < -20 || q.y > H + 20) return;
        vehicle(
          ctx,
          q.x,
          q.y,
          g.kind === "moto" ? "#16a34a" : (g.route?.color ?? THEME.blue),
          g.kind === "moto" ? "OJEK" : (g.route?.short ?? ""),
        );
      }
    });
  if (alt) draw(alt, false);
  draw(it, true);
}

// ── boxes, captions, cards ──────────────────────────────────────────────────

const SK = Math.tan((10 * Math.PI) / 180);

function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadow: string | null,
) {
  const k = h * SK;
  const path = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(x + k + dx, y + dy);
    ctx.lineTo(x + w + k + dx, y + dy);
    ctx.lineTo(x + w + dx, y + h + dy);
    ctx.lineTo(x + dx, y + h + dy);
    ctx.closePath();
  };
  if (shadow) {
    ctx.fillStyle = shadow;
    path(5, 5);
    ctx.fill();
  }
  ctx.fillStyle = fill;
  path(0, 0);
  ctx.fill();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const TONES = {
  light: { bg: "#ffffff", fg: THEME.ink, label: THEME.blue, sh: THEME.blue },
  dark: {
    bg: "rgba(5,11,46,.94)",
    fg: "#ffffff",
    label: THEME.cyan,
    sh: "rgba(21,70,255,.8)",
  },
  gold: {
    bg: THEME.gold,
    fg: THEME.ink,
    label: "rgba(5,11,46,.7)",
    sh: THEME.ink,
  },
} as const;

function callout(
  ctx: CanvasRenderingContext2D,
  map: GLMap,
  b: Box,
  a: number,
  taken: number[][],
) {
  if (a <= 0) return;
  const q = map.project(b.at);
  const tone = TONES[b.tone];
  ctx.font = "800 15px system-ui, sans-serif";
  const lines = wrap(ctx, b.text, 220);
  ctx.font = "600 11.5px system-ui, sans-serif";
  const sub = b.sub ? wrap(ctx, b.sub, 220) : [];
  ctx.font = "900 10px system-ui, sans-serif";
  const lw = ctx.measureText(b.label.toUpperCase()).width * 1.18;
  ctx.font = "800 15px system-ui, sans-serif";
  const tw = Math.max(lw, ...lines.map((l) => ctx.measureText(l).width));
  ctx.font = "600 11.5px system-ui, sans-serif";
  const sw = Math.max(0, ...sub.map((l) => ctx.measureText(l).width));
  const w = Math.max(tw, sw) + 26;
  const h = 18 + 14 + lines.length * 19 + sub.length * 15;
  let x = b.side > 0 ? q.x + 46 : q.x - 46 - w;
  let y = q.y + b.dy;
  if (x < 14 || x + w > W - 22) x = b.side > 0 ? q.x - 46 - w : q.x + 46;
  x = clamp(x, 14, W - 22 - w);
  y = clamp(y, SAFE.top + 78, H - SAFE.bottom - 130 - h);
  // keep clear of boxes already drawn this frame
  for (const [ox, oy, ow, oh] of taken)
    if (x < ox + ow && x + w > ox && y < oy + oh + 8 && y + h + 8 > oy)
      y = clamp(oy + oh + 12, SAFE.top + 78, H - SAFE.bottom - 130 - h);
  taken.push([x, y, w, h]);

  // the line from the place to the box, drawn first
  const ex = q.x < x ? x : x + w;
  const ey = y + h / 2;
  const la = clamp(a / 0.45, 0, 1);
  // an elbow: up or down to the box's middle, then across to its edge;
  // an ink casing under the line so it reads on the pale map too
  const kx = q.x + (ex - q.x) * 0.35;
  const u = Math.min(1, la * 2);
  ctx.beginPath();
  ctx.moveTo(q.x, q.y);
  ctx.lineTo(q.x + (kx - q.x) * u, q.y + (ey - q.y) * u);
  if (la > 0.5) ctx.lineTo(kx + (ex - kx) * ((la - 0.5) * 2), ey);
  ctx.lineJoin = "round";
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = b.tone === "gold" ? THEME.gold : "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // the diamond on the place
  ctx.fillStyle = b.tone === "gold" ? THEME.gold : THEME.cyan;
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(q.x, q.y - 8);
  ctx.lineTo(q.x + 8, q.y);
  ctx.lineTo(q.x, q.y + 8);
  ctx.lineTo(q.x - 8, q.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // the box wipes in after the line arrives
  const ba = clamp((a - 0.35) / 0.35, 0, 1);
  if (ba <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 10, y - 10, (w + 30) * out3(ba), h + 20);
  ctx.clip();
  plate(ctx, x, y, w, h, tone.bg, tone.sh);
  const tx = x + 13 + h * SK * 0.5;
  ctx.fillStyle = tone.label;
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.letterSpacing = "1.6px";
  ctx.fillText(b.label.toUpperCase(), tx, y + 18);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = tone.fg;
  ctx.font = "800 15px system-ui, sans-serif";
  lines.forEach((l, i) => {
    ctx.fillText(l, tx, y + 37 + i * 19);
  });
  ctx.globalAlpha = 0.75;
  ctx.font = "600 11.5px system-ui, sans-serif";
  sub.forEach((l, i) => {
    ctx.fillText(l, tx, y + 37 + lines.length * 19 + i * 15);
  });
  ctx.restore();
}

function caption(ctx: CanvasRenderingContext2D, text: string, a: number) {
  if (a <= 0) return;
  ctx.font = "700 17px system-ui, sans-serif";
  const lines = wrap(ctx, text, W - 80);
  const h = 22 + lines.length * 23;
  const y = H - SAFE.bottom - h - 10;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 34;
  const x = 18 - (1 - out3(a)) * 60;
  ctx.globalAlpha = clamp(a * 2, 0, 1);
  plate(ctx, x, y, w, h, "#ffffff", THEME.blue);
  ctx.fillStyle = THEME.ink;
  lines.forEach((l, i) => {
    ctx.fillText(l, x + 17 + h * SK * 0.4, y + 27 + i * 23);
  });
  ctx.globalAlpha = 1;
}

function title(
  ctx: CanvasRenderingContext2D,
  n: number,
  text: string,
  a: number,
) {
  if (a <= 0) return;
  ctx.globalAlpha = clamp(a * 2, 0, 1);
  const y = SAFE.top + 6;
  ctx.font = "900 italic 46px system-ui, sans-serif";
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.cyan;
  ctx.strokeText(String(n).padStart(2, "0"), 18, y + 40);
  ctx.fillStyle = THEME.cyan;
  ctx.fillRect(84, y + 6, 54 * out3(a), 5);
  ctx.font = "900 italic 21px system-ui, sans-serif";
  ctx.fillStyle = THEME.blue;
  ctx.fillText(text.toUpperCase(), 86, y + 38);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text.toUpperCase(), 84, y + 36);
  ctx.globalAlpha = 1;
}

function big(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  color = "#ffffff",
) {
  ctx.font = `900 italic ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = THEME.blue;
  ctx.fillText(text, (W - w) / 2 + 4, y + 4);
  ctx.fillStyle = color;
  ctx.fillText(text, (W - w) / 2, y);
}

function card(
  ctx: CanvasRenderingContext2D,
  kind: Shot["card"],
  a: number,
  it: Itinerary,
  alt: Itinerary | null,
  r: PlanResponse,
  lang: "en" | "id",
) {
  if (!kind || a <= 0) return;
  const L = (en: string, id: string) => (lang === "en" ? en : id);
  ctx.globalAlpha = clamp(a * 2, 0, 1);
  // a soft veil so the words read over any map
  const g = ctx.createLinearGradient(0, H * 0.25, 0, H * 0.75);
  g.addColorStop(0, "rgba(5,11,46,0)");
  g.addColorStop(0.5, "rgba(5,11,46,.55)");
  g.addColorStop(1, "rgba(5,11,46,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.25, W, H * 0.5);
  const lift = (1 - out3(a)) * 30;
  if (kind === "intro") {
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.letterSpacing = "4px";
    ctx.fillStyle = THEME.cyan;
    const k = `${BRAND.project} · ${BRAND.app}`.toUpperCase();
    ctx.fillText(k, (W - ctx.measureText(k).width) / 2, H * 0.42 + lift);
    ctx.letterSpacing = "0px";
    big(ctx, L("Fastest,", "Tercepat,"), H * 0.42 + 56 + lift, 50);
    big(
      ctx,
      L("or driest?", "atau terkering?"),
      H * 0.42 + 112 + lift,
      50,
      THEME.gold,
    );
  } else if (kind === "compare") {
    const ex = r.explain;
    const col = (x: number, head: string, i: Itinerary, hi: boolean) => {
      plate(
        ctx,
        x,
        H * 0.36 + lift,
        200,
        150,
        hi ? "#ffffff" : "rgba(5,11,46,.94)",
        hi ? THEME.blue : "rgba(21,70,255,.8)",
      );
      ctx.fillStyle = hi ? THEME.blue : THEME.cyan;
      ctx.font = "900 11px system-ui, sans-serif";
      ctx.fillText(head.toUpperCase(), x + 22, H * 0.36 + 26 + lift);
      ctx.fillStyle = hi ? THEME.ink : "#ffffff";
      ctx.font = "900 italic 40px system-ui, sans-serif";
      ctx.fillText(`${Math.round(i.minutes)}′`, x + 20, H * 0.36 + 74 + lift);
      ctx.font = "800 17px system-ui, sans-serif";
      ctx.fillText(
        `${i.dose < 0.05 ? "0" : i.dose.toFixed(i.dose < 1 ? 2 : 1)} mm ${L("rain", "hujan")}`,
        x + 16,
        H * 0.36 + 104 + lift,
      );
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.globalAlpha *= 0.75;
      ctx.fillText(
        `${Math.round(i.exposedMin)} ${L("min in rain", "mnt kena hujan")}`,
        x + 14,
        H * 0.36 + 128 + lift,
      );
      ctx.globalAlpha = clamp(a * 2, 0, 1);
    };
    if (alt) {
      col(40, L("Fastest", "Tercepat"), alt, false);
      const drier = !!ex && ex.doseSavedPct >= 1;
      col(
        W / 2 + 8,
        drier ? L("Driest", "Terkering") : L("Recommended", "Disarankan"),
        it,
        true,
      );
      if (ex && r.shift && drier)
        big(
          ctx,
          L(
            `${Math.round(ex.doseSavedPct)}% less rain`,
            `${Math.round(ex.doseSavedPct)}% lebih kering`,
          ),
          H * 0.36 + 210 + lift,
          34,
          THEME.gold,
        );
    } else {
      col(W / 2 - 100, L("Fastest = driest", "Tercepat = terkering"), it, true);
    }
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.fillStyle = "#e2e8f0";
    const f = "cost = τ · w · (1 + β · E · φ(rain))";
    const fw = ctx.measureText(f).width;
    plate(
      ctx,
      (W - fw) / 2 - 16,
      H * 0.36 + 232 + lift,
      fw + 26,
      26,
      "rgba(5,11,46,.9)",
      null,
    );
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(f, (W - fw) / 2, H * 0.36 + 250 + lift);
  } else {
    big(ctx, BRAND.app, H * 0.45 + lift, 54);
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = THEME.cyan;
    const k = L(
      "WEATHER-AWARE TRANSIT · JAKARTA",
      "TRANSIT SADAR CUACA · JAKARTA",
    );
    ctx.fillText(k, (W - ctx.measureText(k).width) / 2, H * 0.45 + 34 + lift);
    ctx.letterSpacing = "0px";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    for (const [i, s] of [
      L(
        "Rain: BMKG · Open-Meteo forecasts",
        "Hujan: prakiraan BMKG · Open-Meteo",
      ),
      "Map © OpenStreetMap contributors · OpenMapTiles",
      `${BRAND.project} · ${BRAND.by} ${BRAND.year}`,
    ].entries())
      ctx.fillText(
        s,
        (W - ctx.measureText(s).width) / 2,
        H * 0.45 + 70 + i * 17 + lift,
      );
  }
  ctx.globalAlpha = 1;
}

function paint(
  ctx: CanvasRenderingContext2D,
  map: GLMap,
  s: Shot,
  st: number,
  t: number,
  total: number,
  dt: number,
  fx: Fx,
  it: Itinerary,
  alt: Itinerary | null,
  r: PlanResponse,
  lang: "en" | "id",
  n: number,
) {
  // fade every shot's words out just before the next one
  const outA = clamp((s.dur - st) / 0.3, 0, 1);
  if (s.card !== "intro" && s.card !== "outro")
    movers(ctx, map, it, alt, t, s.focus);
  fx.rain(ctx, s.rain, dt);
  // a band at the top so the title reads over a pale map
  const top = ctx.createLinearGradient(0, 0, 0, SAFE.top + 90);
  top.addColorStop(0, "rgba(5,11,46,.7)");
  top.addColorStop(1, "rgba(5,11,46,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, SAFE.top + 90);
  const taken: number[][] = [];
  s.boxes.forEach((b, i) => {
    callout(ctx, map, b, Math.min((st - 0.5 - i * 0.45) / 0.8, outA), taken);
  });
  card(ctx, s.card, Math.min(st / 0.6, outA), it, alt, r, lang);
  caption(ctx, s.caption, Math.min((st - 0.2) / 0.45, outA));
  // a band at the bottom so the footer reads too
  const bot = ctx.createLinearGradient(0, H - SAFE.bottom - 10, 0, H);
  bot.addColorStop(0, "rgba(5,11,46,0)");
  bot.addColorStop(0.35, "rgba(5,11,46,.65)");
  bot.addColorStop(1, "rgba(5,11,46,.8)");
  ctx.fillStyle = bot;
  ctx.fillRect(0, H - SAFE.bottom - 10, W, SAFE.bottom + 10);
  // progress, like a story's own bar
  ctx.fillStyle = "rgba(255,255,255,.25)";
  ctx.fillRect(16, H - SAFE.bottom + 26, W - 32, 3);
  ctx.fillStyle = THEME.cyan;
  ctx.fillRect(16, H - SAFE.bottom + 26, (W - 32) * (t / total), 3);
  ctx.font = "900 italic 12px system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`${BRAND.app} · ${BRAND.project}`, 16, H - SAFE.bottom + 48);
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.7)";
  const c = "© OpenStreetMap · OpenMapTiles";
  ctx.fillText(c, W - 16 - ctx.measureText(c).width, H - SAFE.bottom + 48);
  title(ctx, n, s.title, Math.min(st / 0.5, outA));
}
