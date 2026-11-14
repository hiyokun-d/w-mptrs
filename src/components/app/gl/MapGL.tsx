"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed, Minus, Navigation2, Plus, X } from "lucide-react";
import {
  type GeoJSONSource,
  type Map as GLMap,
  type ImageSource,
  Map as MapLibre,
  Marker,
  setWorkerUrl,
} from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { positionAt } from "@/lib/core/alerts";
import { wib } from "@/lib/core/eta";
import { Fleet, type FleetVehicle } from "@/lib/core/fleet";
import { RainField, type RainGrid } from "@/lib/core/rainfield";
import type { Itinerary, Leg } from "@/lib/core/router";
import { localNetwork } from "@/lib/local/planner";
import { chosen, useApp } from "@/lib/store/app";
import { clock } from "../format";
import { rainRGBA } from "../rain-colors";
import {
  EMPTY,
  type FC,
  firstSymbol,
  geo,
  layer,
  ll,
  sliceLines,
  smartBearing,
  THEME,
  themeBase,
  travelBearing,
} from "./layers";
import { Card, Leader, Leaders } from "./leaders";
import { useGL } from "./store";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const JAKARTA: [number, number] = [106.83, -6.2];
// rain overlay extent (matches the forecast grid bbox): TL, TR, BR, BL
const RAIN_COORDS: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [106.4, -5.95],
  [107.2, -5.95],
  [107.2, -6.7],
  [106.4, -6.7],
];

function el(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}
// markers in the theme: a diamond for the start, a gold diamond for the goal
const diamond = (fill: string, ring: string, size = 14) =>
  `<div style="width:${size}px;height:${size}px;transform:rotate(45deg);background:${fill};border:3px solid ${ring};box-shadow:3px 3px 0 ${THEME.blue}"></div>`;
const meHtml = `<div style="position:relative;width:20px;height:20px"><div class="w-ping" style="position:absolute;inset:-8px;border-radius:50%;background:rgba(51,214,255,.35)"></div><div style="position:absolute;inset:0;border-radius:50%;background:${THEME.cyan};border:3px solid #fff;box-shadow:2px 2px 0 ${THEME.blue}"></div></div>`;

function routeFC(it: Itinerary | null, f = 1): FC {
  if (!it) return EMPTY;
  const lines = it.legs.map((g) => g.path.map(ll));
  const cut = sliceLines(lines, f);
  return {
    type: "FeatureCollection",
    features: it.legs.flatMap((g, i) =>
      cut[i].length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: {
                k: g.kind,
                c:
                  g.kind === "walk"
                    ? g.rain >= 5
                      ? "#db2777"
                      : THEME.ink
                    : g.kind === "moto"
                      ? "#f97316"
                      : (g.route?.color ?? THEME.blue),
              },
              geometry: { type: "LineString" as const, coordinates: cut[i] },
            },
          ]
        : [],
    ),
  };
}

function rainCanvas(field: RainField, at: number): string | null {
  const W = 160;
  const H = 150;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  let any = false;
  for (let y = 0; y < H; y++) {
    const lat = -5.95 - ((y + 0.5) / H) * 0.75;
    for (let x = 0; x < W; x++) {
      const lng = 106.4 + ((x + 0.5) / W) * 0.8;
      const [r, g, b, a] = rainRGBA(field.at(lat, lng, at));
      if (a) any = true;
      const i = (y * W + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** ride legs → the stretch of network every line serving it shares */
function focusOf(fleet: Fleet, it: Itinerary | null) {
  const stretch: { pattern: number; from: number; to: number; leg: number }[] =
    [];
  it?.legs.forEach((g, leg) => {
    if (g.kind !== "ride" || !g.trip) return;
    for (const s of fleet.serving(g.trip.board, g.trip.alight))
      stretch.push({ ...s, leg });
  });
  return stretch;
}

function vehicleFC(
  fleet: Fleet,
  vs: FleetVehicle[],
  rank: Map<string, number>,
  follow: string | null,
): FC {
  const R = fleet.net.routes;
  return {
    type: "FeatureCollection",
    features: vs.map((v) => {
      const r = R[v.route];
      const n = rank.get(v.id) ?? 0;
      return {
        type: "Feature" as const,
        properties: {
          id: v.id,
          c: r.color,
          s: r.short,
          m: r.mode === "transjakarta" ? 0 : 1,
          // 1, 2, 3: the order they reach your stop
          n,
          f: v.id === follow ? 1 : 0,
        },
        geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
      };
    }),
  };
}

const bearingTo = (a: { lat: number; lng: number }, b: typeof a) =>
  (Math.atan2(
    (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180),
    b.lat - a.lat,
  ) *
    180) /
  Math.PI;
const angleDiff = (a: number, b: number) =>
  Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const inOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

export default function MapGL({
  grid,
  now,
  tripPos,
}: {
  grid: RainGrid | null;
  now: number;
  tripPos: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const [ready, setReady] = useState(false);
  const {
    from,
    to,
    result,
    choice,
    rainLayer,
    radarLayer,
    rainOffsetMin,
    trip,
    lang,
    collapsed,
    sheetPx,
    reports,
  } = useApp();
  const { fleet, fleetMode, follow, stage, set: setGL } = useGL();

  const field = useMemo(
    () => new RainField(grid, result?.cells ?? [], result?.depart ?? 0),
    [grid, result],
  );
  const shown = trip ? chosen(result, trip.choice) : chosen(result, choice);
  const at = tripPos ?? now + rainOffsetMin * 60_000;
  // the overlay only changes meaningfully every couple of minutes; redrawing
  // it on every trip tick was the heaviest thing on the main thread
  const rainAt = Math.round(at / 120_000) * 120_000;

  // the callouts: info boxes tied to the route by leader lines
  const leaders = useMemo(() => new Leaders(), []);
  useEffect(() => {
    leaders.safe = {
      top: 150,
      bottom: Math.max(24, sheetPx + 16),
      left: 12,
      right: 64,
    };
    leaders.place();
  }, [leaders, sheetPx]);

  // ── map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!box.current) return;
    const map = new MapLibre({
      container: box.current,
      style: STYLE,
      center: JAKARTA,
      zoom: 12,
      maxPitch: 75,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      // fewer tiles kept around: less memory on phones
      maxTileCacheZoomLevels: 3,
    });
    mapRef.current = map;
    if (process.env.NODE_ENV === "development")
      (window as unknown as { __map: GLMap }).__map = map;
    map.on("error", (e) => console.warn("[map]", e.error?.message ?? e));
    map.on("load", () => {
      themeBase(map);
      const before = firstSymbol(map);
      map.addSource("w-rain", {
        type: "image",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        coordinates: RAIN_COORDS,
      });
      layer(
        map,
        {
          id: "w-rain",
          type: "raster",
          source: "w-rain",
          paint: {
            "raster-opacity": 0,
            "raster-fade-duration": 0,
            "raster-opacity-transition": { duration: 500 },
          },
        },
        before,
      );
      for (const id of ["w-other", "w-route", "w-stops"]) geo(map, id, EMPTY);
      // vehicles change every tick: a lean source (no buffer, no
      // simplification, tiled only to z14) keeps the worker's re-tiling cheap
      map.addSource("w-fleet", {
        type: "geojson",
        data: EMPTY,
        buffer: 0,
        tolerance: 0,
        maxzoom: 14,
      });
      layer(map, {
        id: "w-other",
        type: "line",
        source: "w-other",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "c"],
          "line-width": 3,
          "line-opacity": 0.35,
        },
      });
      layer(map, {
        id: "w-route-case",
        type: "line",
        source: "w-route",
        filter: ["!=", ["get", "k"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": THEME.ink,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 13],
          "line-opacity": 0.9,
        },
      });
      layer(map, {
        id: "w-route",
        type: "line",
        source: "w-route",
        filter: ["!=", ["get", "k"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "c"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
        },
      });
      layer(map, {
        id: "w-route-walk",
        type: "line",
        source: "w-route",
        filter: ["==", ["get", "k"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "c"],
          "line-width": 5,
          "line-dasharray": [0.1, 1.8],
        },
      });
      layer(map, {
        id: "w-stops",
        type: "circle",
        source: "w-stops",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": THEME.ink,
          "circle-stroke-width": 2.5,
        },
      });
      layer(map, {
        id: "w-fleet",
        type: "circle",
        source: "w-fleet",
        paint: {
          "circle-color": ["get", "c"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            [
              "case",
              [">", ["get", "n"], 0],
              6.5,
              ["==", ["get", "m"], 1],
              4.5,
              3,
            ],
            15,
            [
              "case",
              [">", ["get", "n"], 0],
              13,
              ["==", ["get", "m"], 1],
              11,
              9,
            ],
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "f"], 1],
            THEME.gold,
            [">", ["get", "n"], 0],
            THEME.ink,
            "#ffffff",
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "f"], 1],
            3.5,
            [">", ["get", "n"], 0],
            2.5,
            1,
          ],
        },
      });
      layer(map, {
        id: "w-fleet-label",
        type: "symbol",
        source: "w-fleet",
        filter: ["any", [">", ["get", "n"], 0], [">=", ["zoom"], 14.5]],
        layout: {
          "text-field": [
            "case",
            [">", ["get", "n"], 0],
            ["concat", ["get", "s"], " · ", ["to-string", ["get", "n"]]],
            ["get", "s"],
          ],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, -1.5],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": THEME.ink,
          "text-halo-color": "#fff",
          "text-halo-width": 1.8,
        },
      });
      map.on("click", "w-fleet", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) useGL.getState().set({ follow: id });
      });
      map.on("mouseenter", "w-fleet", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "w-fleet", () => {
        map.getCanvas().style.cursor = "";
      });
      leaders.attach(map);
      setReady(true);
      useGL.getState().set({ map });
    });
    map.on("dragstart", () => {
      moved.current = true;
      if (useGL.getState().follow) useGL.getState().set({ follow: null });
      if (!useApp.getState().collapsed && !useGL.getState().stage)
        useApp.getState().set({ collapsed: true });
    });
    map.on("click", (e) => {
      const pick = useApp.getState().pickOnMap;
      if (!pick) return;
      useApp.getState().setPoint(pick, {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        name: `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`,
      });
      useApp.getState().set({ pickOnMap: null, sheet: "home" });
    });
    // the compass needle follows the map, without re-rendering React
    map.on("rotate", () => {
      if (needle.current)
        needle.current.style.transform = `rotate(${-map.getBearing()}deg)`;
    });
    return () => {
      leaders.detach();
      useGL.getState().set({ map: null });
      map.remove();
      mapRef.current = null;
    };
  }, [leaders]);

  // ── fleet: load the network once ──────────────────────────────────────────
  useEffect(() => {
    if (fleet) return;
    let live = true;
    localNetwork().then((net) => {
      if (live && net) setGL({ fleet: new Fleet(net.file) });
    });
    return () => {
      live = false;
    };
  }, [fleet, setGL]);

  // ── rain + radar ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const url = rainLayer ? rainCanvas(field, rainAt) : null;
    const apply = () => {
      const src = map.getSource("w-rain") as ImageSource | undefined;
      if (!src || !map.getLayer("w-rain")) return;
      if (url) src.updateImage({ url, coordinates: RAIN_COORDS });
      map.setPaintProperty("w-rain", "raster-opacity", url ? 0.75 : 0);
    };
    // the style can still be (re)loading, e.g. right after a hot reload
    if (map.isStyleLoaded()) apply();
    else {
      map.once("idle", apply);
      return () => {
        map.off("idle", apply);
      };
    }
  }, [ready, field, rainAt, rainLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!radarLayer) {
      if (map.getLayer("w-radar")) map.removeLayer("w-radar");
      if (map.getSource("w-radar")) map.removeSource("w-radar");
      return;
    }
    let live = true;
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => r.json())
      .then((j) => {
        const last = j?.radar?.past?.at(-1);
        if (!live || !last || map.getSource("w-radar")) return;
        map.addSource("w-radar", {
          type: "raster",
          tiles: [`${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`],
          tileSize: 256,
          maxzoom: 7,
          attribution: '<a href="https://www.rainviewer.com">RainViewer</a>',
        });
        layer(
          map,
          {
            id: "w-radar",
            type: "raster",
            source: "w-radar",
            paint: { "raster-opacity": 0.55 },
          },
          "w-rain",
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, radarLayer]);

  // ── routes: a new plan draws itself leg by leg ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || stage) return;
    // only the chosen route is drawn; the alternative lives in the cards
    geo(map, "w-other", EMPTY);
    geo(map, "w-stops", {
      type: "FeatureCollection",
      features: (shown?.legs ?? [])
        .filter((g) => g.kind === "wait" && g.place !== "none")
        .map((g) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [g.from.lng, g.from.lat] },
        })),
    });
    if (!shown) {
      geo(map, "w-route", EMPTY);
      return;
    }
    const t0 = performance.now();
    const D = 1100;
    let raf = 0;
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / D);
      // ease out: fast start, gentle landing
      geo(map, "w-route", routeFC(shown, outCubic(f)));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready, shown, stage]);

  // ── markers ─────────────────────────────────────────────────────────────
  const me = shown && tripPos ? positionAt(shown, tripPos) : null;
  const markerKey = JSON.stringify([
    from && [from.lat, from.lng],
    to && [to.lat, to.lng],
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: markerKey captures the positions
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ms: Marker[] = [];
    if (from)
      ms.push(
        new Marker({ element: el(diamond(THEME.cyan, "#fff")) }).setLngLat([
          from.lng,
          from.lat,
        ]),
      );
    if (to)
      ms.push(
        new Marker({
          element: el(diamond(THEME.gold, THEME.ink, 16)),
        }).setLngLat([to.lng, to.lat]),
      );
    for (const m of ms) m.addTo(map);
    return () => {
      for (const m of ms) m.remove();
    };
  }, [ready, markerKey]);

  // "raining here" reports from this session: a pin where each was made
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ms = reports
      .filter((r) => r.mmh > 0)
      .map((r) =>
        new Marker({
          anchor: "bottom",
          element: el(
            `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
              <div style="background:${THEME.ink};color:#fff;font:800 11px system-ui;padding:3px 8px;transform:skewX(-10deg);box-shadow:3px 3px 0 ${THEME.blue};white-space:nowrap">
                <span style="display:inline-block;transform:skewX(10deg)">🌧 ${r.mmh >= 10 ? (lang === "id" ? "Deras" : "Heavy rain") : lang === "id" ? "Gerimis" : "Light rain"} · ${clock(r.t)}</span>
              </div>
              <div style="width:2px;height:10px;background:${THEME.ink}"></div>
              <div style="width:10px;height:10px;transform:rotate(45deg);background:${THEME.cyan};border:2px solid ${THEME.ink}"></div>
            </div>`,
          ),
        })
          .setLngLat([r.lng, r.lat])
          .addTo(map),
      );
    return () => {
      for (const m of ms) m.remove();
    };
  }, [ready, reports, lang]);

  const meMarker = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current)
      meMarker.current = new Marker({ element: el(meHtml) })
        .setLngLat([me.lng, me.lat])
        .addTo(map);
    else meMarker.current.setLngLat([me.lng, me.lat]);
  }, [ready, me]);

  // ── the camera: when to rotate, tilt and zoom ────────────────────────────
  //
  // · nothing planned: north-up and flat, a normal map
  // · a plan: the whole route, turned so you travel up the screen (only if
  //   it runs well off north), flat for long trips, tilted for short ones
  //   where the 3D buildings say something
  // · a trip: heading-up and tilted, close in when something is about to
  //   happen (boarding, getting off), further out on a long ride
  // · following a vehicle: behind it, facing where it goes
  //
  // The compass resets to north-up; tap it again to let the map turn.
  const moved = useRef(false);
  const needle = useRef<HTMLSpanElement>(null);
  const [northUp, setNorthUp] = useState(false);
  const northRef = useRef(northUp);
  useEffect(() => {
    northRef.current = northUp;
  }, [northUp]);
  // auto-focus: after you pan, the camera comes back to your route on its own
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(auto);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);
  const frameRef = useRef<(ms?: number) => void>(() => {});
  useEffect(() => {
    frameRef.current = (ms = 1100) => {
      const map = mapRef.current;
      if (!map || useGL.getState().stage) return;
      const st = useApp.getState();
      const it = st.trip
        ? chosen(st.result, st.trip.choice)
        : chosen(st.result, st.choice);
      const route: [number, number][] = [];
      for (const g of it?.legs ?? []) for (const p of g.path) route.push(ll(p));
      const pts = route.slice();
      if (st.from) pts.push([st.from.lng, st.from.lat]);
      if (st.to) pts.push([st.to.lng, st.to.lat]);
      const h = map.getContainer().clientHeight;
      const bottom = Math.max(24, Math.min(st.sheetPx + 24, h - 150 - 220));
      moved.current = false;
      if (pts.length >= 2) {
        let [w, s, e, n] = [180, 90, -180, -90];
        for (const [x, y] of pts) {
          w = Math.min(w, x);
          e = Math.max(e, x);
          s = Math.min(s, y);
          n = Math.max(n, y);
        }
        const km = Math.hypot((e - w) * 110.6, (n - s) * 111.3);
        const bearing =
          northRef.current || route.length < 2
            ? 0
            : smartBearing(travelBearing(route));
        // short trips get a tilt: up close the 3D city is information
        const pitch = !it ? 0 : km > 9 ? 0 : km > 4 ? 30 : 45;
        const cam = map.cameraForBounds(
          [
            [w, s],
            [e, n],
          ],
          {
            padding: { top: 160, bottom, left: 40, right: 72 },
            bearing,
            maxZoom: 15.5,
          },
        );
        if (cam)
          map.flyTo({
            ...cam,
            pitch,
            duration: ms,
            easing: inOut,
            curve: 1.3,
          });
      } else if (pts.length === 1)
        map.flyTo({
          center: pts[0],
          zoom: 14,
          pitch: 0,
          bearing: 0,
          duration: ms,
          easing: inOut,
        });
    };
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reframe on a new plan or when the sheet toggles
  useEffect(() => {
    if (!ready || stage || trip) return;
    if (result) moved.current = false;
    // coming back from the presentation onto a followed vehicle: stay there
    if (moved.current || useGL.getState().follow) return;
    const id = setTimeout(() => frameRef.current(), 520);
    return () => clearTimeout(id);
  }, [ready, result, from, to, collapsed, stage, shown, northUp]);

  // a new plan always takes the camera, even from a followed vehicle
  const lastResult = useRef(result);
  useEffect(() => {
    if (!result || result === lastResult.current) return;
    lastResult.current = result;
    if (useGL.getState().follow && !useGL.getState().stage) {
      setGL({ follow: null });
      const id = setTimeout(() => frameRef.current(), 520);
      return () => clearTimeout(id);
    }
  }, [result, setGL]);

  // after a manual pan or zoom, wait until you have looked, then come back
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return; // camera moves we made ourselves
      moved.current = true;
      clearTimeout(timer);
    };
    const end = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent || !autoRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useGL.getState();
        if (st.stage || st.follow) return;
        // a trip resumes following; a plan stays where you put it (the
        // focus button frames it again)
        if (useApp.getState().trip) moved.current = false;
      }, 6000);
    };
    map.on("movestart", start);
    map.on("moveend", end);
    return () => {
      clearTimeout(timer);
      map.off("movestart", start);
      map.off("moveend", end);
    };
  }, [ready]);

  // during a trip: a navigation camera
  const heading = useRef(0);
  const nextEvent: { leg: Leg; inMin: number } | null = useMemo(() => {
    if (!shown || tripPos == null) return null;
    const g = shown.legs.find(
      (x) => x.t0 > tripPos && x.kind !== "walk" && x.t0 - tripPos < 5 * 60_000,
    );
    const off = shown.legs.find(
      (x, i) =>
        i > 0 &&
        shown.legs[i - 1].kind === "ride" &&
        x.t0 > tripPos &&
        x.t0 - tripPos < 5 * 60_000,
    );
    const e = [g, off]
      .filter((x): x is Leg => !!x)
      .sort((a, b) => a.t0 - b.t0)[0];
    return e ? { leg: e, inMin: (e.t0 - tripPos) / 60_000 } : null;
  }, [shown, tripPos]);
  // The camera eases toward a target every frame instead of starting a new
  // easeTo on every clock tick: a tick used to cut the last zoom animation
  // short, which made the zoom stutter. The zoom target only changes when the
  // situation does (walk / wait / long ride / about to board), and your own
  // zoom is kept as an offset on top of it.
  const camGoal = useRef<{
    lng: number;
    lat: number;
    zoom: number;
    pitch: number;
    bearing: number;
  } | null>(null);
  const zoomBias = useRef(0);
  useEffect(() => {
    if (!me || !shown || tripPos == null) {
      camGoal.current = null;
      return;
    }
    const ahead = positionAt(shown, tripPos + 30_000);
    const d = Math.hypot(ahead.lat - me.lat, ahead.lng - me.lng);
    if (d > 2e-5) {
      const h = bearingTo(me, ahead);
      // turn only for a real change of direction, not every wiggle of the path
      if (angleDiff(h, heading.current) > 14) heading.current = h;
    }
    const leg =
      shown.legs.find((g) => tripPos >= g.t0 && tripPos < g.t1) ??
      shown.legs.at(-1);
    const soon = nextEvent && nextEvent.inMin < 2;
    let zoom = 16.4;
    let pitch = 55;
    if (soon) {
      zoom = 17.2;
      pitch = 62;
    } else if (leg?.kind === "ride" && leg.t1 - tripPos > 4 * 60_000) {
      zoom = 14.6;
      pitch = 45;
    } else if (leg?.kind === "wait") {
      zoom = 17;
      pitch = 50;
    }
    camGoal.current = {
      lng: me.lng,
      lat: me.lat,
      zoom,
      pitch,
      bearing: heading.current,
    };
  }, [me, shown, tripPos, nextEvent]);
  const tripOn = !!trip;
  // during a trip the follower owns the zoom: the buttons shift its offset
  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (!map) return;
    const following =
      tripOn &&
      autoRef.current &&
      !moved.current &&
      !useGL.getState().follow &&
      camGoal.current;
    if (following)
      zoomBias.current = Math.max(-6, Math.min(3, zoomBias.current + d));
    else if (d > 0) map.zoomIn({ duration: 320 });
    else map.zoomOut({ duration: 320 });
  };
  useEffect(() => {
    if (!tripOn) zoomBias.current = 0;
  }, [tripOn]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !tripOn) return;
    // your zoom (wheel, pinch, buttons) becomes the offset from the target
    let zooming = false;
    const zs = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) zooming = true;
    };
    const ze = () => {
      if (!zooming) return;
      zooming = false;
      const g = camGoal.current;
      if (g)
        zoomBias.current = Math.max(-6, Math.min(3, map.getZoom() - g.zoom));
    };
    map.on("zoomstart", zs);
    map.on("zoomend", ze);
    let raf = 0;
    let last = performance.now();
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      const g = camGoal.current;
      const st = useGL.getState();
      if (!g || !autoRef.current || st.stage || st.follow || moved.current)
        return;
      if (zooming || map.isMoving()) return;
      // time constants: position follows closely, zoom and tilt settle slowly
      const k = (tau: number) => 1 - Math.exp(-dt / tau);
      const c = map.getCenter();
      const z = map.getZoom();
      const p = map.getPitch();
      const b = map.getBearing();
      const tz = Math.max(3, Math.min(19, g.zoom + zoomBias.current));
      const tb = northRef.current ? 0 : g.bearing;
      const db = ((((tb - b + 180) % 360) + 360) % 360) - 180;
      const next = {
        center: [
          c.lng + (g.lng - c.lng) * k(0.35),
          c.lat + (g.lat - c.lat) * k(0.35),
        ] as [number, number],
        zoom: z + (tz - z) * k(0.9),
        pitch: p + ((northRef.current ? 0 : g.pitch) - p) * k(0.9),
        bearing: b + db * k(0.8),
      };
      // settled: don't redraw the map for nothing
      if (
        Math.abs(next.zoom - z) < 1e-3 &&
        Math.abs(db) < 0.05 &&
        Math.abs(next.pitch - p) < 0.05 &&
        Math.hypot(g.lng - c.lng, g.lat - c.lat) < 1e-7
      )
        return;
      map.jumpTo(next);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      map.off("zoomstart", zs);
      map.off("zoomend", ze);
    };
  }, [ready, tripOn]);

  // ── vehicles: trunk lines in the city view, your route's lines in focus ──
  const tRef = useRef(0);
  useEffect(() => {
    tRef.current = tripPos ?? 0;
  }, [tripPos]);
  const stretch = useMemo(
    () => (fleet ? focusOf(fleet, shown) : []),
    [fleet, shown],
  );
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  const hasPlan = !!shown;
  const [board, setBoard] = useState<
    { id: string; route: number; etaSec: number; pattern: number }[]
  >([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasPlan switches between city view and route focus
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !fleet) return;
    const src = () => map.getSource("w-fleet") as GeoJSONSource | undefined;
    if (fleetMode === "off") {
      src()?.setData(EMPTY);
      return;
    }
    // with a plan on screen only that route's lines matter: its own buses
    // and trains, or none at all for an ojek or walking route
    const planned = fleetMode === "auto" && !!shownRef.current;
    const R = fleet.net.routes;
    const trunkList = [...fleet.net.patterns.keys()].filter((pi) => {
      const r = R[fleet.net.patterns[pi].route];
      return r.mode !== "transjakarta" || r.cat === "BRT";
    });
    const focus = planned
      ? [...new Set(stretch.map((s) => s.pattern))]
      : undefined;
    const firstLeg = stretch.length ? stretch[0].leg : -1;
    const atStop = stretch.filter((s) => s.leg === firstLeg);
    let rank = new Map<string, number>();
    let lastRank = 0;
    let last = 0;
    // the vehicle we already zoomed in on, and until when that move runs
    let folZoomed: string | null = null;
    let folBusy = 0;
    let raf = 0;
    // a pan or zoom asks for a fresh picture as soon as it ends
    const kick = () => {
      last = 0;
    };
    map.on("moveend", kick);
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const fol = useGL.getState().follow;
      const fast = (useApp.getState().trip?.speed ?? 1) > 1;
      const z = map.getZoom();
      // how often to move the dots: far out a vehicle moves less than a
      // pixel a second, so once every 2 s is plenty; up close, 2.5× a second
      const every = fast
        ? 80
        : fol
          ? 250
          : z < 11.5
            ? 2000
            : z < 13.5
              ? 1000
              : 400;
      if (ts - last < every || ts < folBusy) return;
      // while you drag, leave the worker alone (unless following)
      if (!fol && map.isMoving() && !useGL.getState().stage) return;
      last = ts;
      const t = tRef.current || Date.now();
      if (atStop.length && ts - lastRank > 2000) {
        lastRank = ts;
        const arr = fleet.arrivals(t, atStop, 3600, 6);
        rank = new Map(arr.slice(0, 3).map((a, i) => [a.id, i + 1]));
        setBoard(arr);
      }
      if (planned && !focus?.length) {
        src()?.setData(EMPTY);
        return;
      }
      // the city view: trunk lines (rail + BRT) until you zoom into a street,
      // then every bus in view
      const only =
        focus ?? (fleetMode === "trunk" || z < 13.5 ? trunkList : undefined);
      const b = map.getBounds();
      const vs = fleet.at(t, {
        only,
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      });
      src()?.setData(vehicleFC(fleet, vs, rank, fol));
      if (fol && !useGL.getState().stage) {
        const v = vs.find((x) => x.id === fol);
        // the vehicle finished its run or is not on this route: let go
        if (!v) useGL.getState().set({ follow: null });
        else {
          const bb = map.getBearing();
          const first = folZoomed !== fol;
          folZoomed = fol;
          if (first) folBusy = ts + 720;
          map.easeTo({
            center: [v.lng, v.lat],
            zoom:
              folZoomed === fol ? map.getZoom() : Math.max(map.getZoom(), 15.5),
            pitch: 50,
            bearing:
              northRef.current || angleDiff(v.bearing, bb) < 20
                ? bb
                : v.bearing,
            duration: first ? 700 : fast ? 80 : 250,
            easing: (x) => x,
          });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      map.off("moveend", kick);
    };
  }, [ready, fleet, fleetMode, stretch, hasPlan]);
  useEffect(() => {
    if (!stretch.length) setBoard([]);
  }, [stretch]);

  // the vehicle being followed: line, direction, next stop
  const [fv, setFv] = useState<FleetVehicle | null>(null);
  useEffect(() => {
    if (!follow || !fleet) {
      setFv(null);
      return;
    }
    const upd = () => {
      const [pi, dep] = follow.split(":").map(Number);
      const t = tRef.current || Date.now();
      setFv(fleet.place(pi, dep, wib(t).secOfDay));
    };
    upd();
    const id = setInterval(upd, 1000);
    return () => clearInterval(id);
  }, [follow, fleet]);

  const id = (en: string, idn: string) => (lang === "id" ? idn : en);
  const net = fleet?.net;
  const firstRide = shown?.legs.find((g) => g.kind === "ride");
  const rides = shown?.legs.filter((g) => g.kind === "ride") ?? [];
  const preps =
    result && (trip?.choice ?? choice) === "weatherAware"
      ? result.alerts.filter((a) => !a.covered).slice(0, 1)
      : [];
  const arriveRain = shown && to ? field.at(to.lat, to.lng, shown.arrive) : 0;
  const callouts = ready && !stage && !!shown && !follow;
  const nextRide = board[0];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={box} className="h-full w-full" />

      {/* callouts: the route explains itself on the map */}
      <div className="pointer-events-none absolute inset-0 z-[4]">
        {shown && to && (
          <Leader
            scope={leaders}
            at={[to.lng, to.lat]}
            show={callouts && (!trip || (nextEvent?.leg ?? null) === null)}
            dx={58}
            dy={-44}
          >
            <Card
              label={id("destination", "tujuan")}
              sub={`${id("arrive", "tiba")} ~${clock(shown.arrive)}${arriveRain >= 0.5 ? ` · ☂ ${arriveRain.toFixed(1)} mm/h` : ` · ${id("dry", "kering")}`}`}
            >
              {to.name}
            </Card>
          </Leader>
        )}
        {firstRide && !trip && (
          <Leader
            scope={leaders}
            at={[firstRide.from.lng, firstRide.from.lat]}
            show={callouts}
            delay={0.15}
            dx={-58}
            dy={40}
          >
            <Card
              label={`${id("board", "naik")} ${firstRide.route?.short ?? ""}`}
              sub={
                nextRide && net
                  ? `${id("next", "berikut")} ${net.routes[nextRide.route].short} · ${nextRide.etaSec < 45 ? id("now", "sekarang") : `${Math.round(nextRide.etaSec / 60)} ${id("min", "mnt")}`}`
                  : firstRide.route?.headsign
                    ? `→ ${firstRide.route.headsign}`
                    : undefined
              }
            >
              {firstRide.from.name}
            </Card>
          </Leader>
        )}
        {rides[1] && !trip && (
          <Leader
            scope={leaders}
            at={[rides[1].from.lng, rides[1].from.lat]}
            show={callouts}
            delay={0.3}
            dx={58}
            dy={44}
          >
            <Card
              tone="dark"
              label={`${id("transfer", "transit")} → ${rides[1].route?.short ?? ""}`}
            >
              {rides[1].from.name}
            </Card>
          </Leader>
        )}
        {preps.map((a) => (
          <Leader
            key={`prep-${a.meetAt}`}
            scope={leaders}
            at={[a.prep.lng, a.prep.lat]}
            show={callouts}
            delay={0.45}
            dx={-58}
            dy={-48}
          >
            <Card
              tone="gold"
              label={`☂ ${id("raincoat here", "jas hujan di sini")}`}
              sub={`${id("rain from", "hujan mulai")} ${clock(a.meetAt)} · ${id("up to", "hingga")} ${a.peak.toFixed(0)} mm/h`}
            >
              {a.prep.name ?? id("before you go out", "sebelum keluar")}
            </Card>
          </Leader>
        ))}
        {trip && nextEvent && (
          <Leader
            key={`ev-${nextEvent.leg.t0}`}
            scope={leaders}
            at={[nextEvent.leg.from.lng, nextEvent.leg.from.lat]}
            show={!stage}
            dx={60}
            dy={-56}
          >
            <Card
              tone={nextEvent.inMin < 2 ? "gold" : "light"}
              label={
                nextEvent.leg.kind === "ride"
                  ? `${id("board", "naik")} ${nextEvent.leg.route?.short ?? ""}`
                  : nextEvent.leg.kind === "wait"
                    ? id("wait here", "tunggu di sini")
                    : id("get off here", "turun di sini")
              }
              sub={
                nextEvent.inMin < 0.5
                  ? id("now", "sekarang")
                  : `${id("in", "dalam")} ${Math.ceil(nextEvent.inMin)} ${id("min", "mnt")}`
              }
            >
              {nextEvent.leg.from.name ?? ""}
            </Card>
          </Leader>
        )}
      </div>

      {/* zoom, compass, focus */}
      {!stage && (
        <div
          className="absolute right-3 bottom-[max(45%,220px)] z-[5] flex flex-col border-2 border-white text-white"
          // solid ink with a hard blue shadow: readable on the pale map, the
          // blue water and the night presentation alike
          style={{
            background: THEME.ink,
            boxShadow: `4px 4px 0 ${THEME.blue}`,
          }}
        >
          {(
            [
              ["in", Plus, () => zoomBy(1)],
              ["out", Minus, () => zoomBy(-1)],
            ] as const
          ).map(([k, Icon, fn]) => (
            <motion.button
              key={k}
              type="button"
              whileTap={{ scale: 0.85 }}
              aria-label={
                k === "in"
                  ? id("Zoom in", "Perbesar")
                  : id("Zoom out", "Perkecil")
              }
              onClick={fn}
              className="flex size-10 items-center justify-center border-b border-white/15 hover:bg-white/10"
            >
              <Icon className="size-4.5" />
            </motion.button>
          ))}
          <motion.button
            type="button"
            whileTap={{ scale: 0.85 }}
            aria-pressed={northUp}
            aria-label={id(
              "North up / let the map turn",
              "Utara di atas / biarkan peta berputar",
            )}
            title={
              northUp
                ? id(
                    "North up · tap to let the map turn",
                    "Utara di atas · ketuk agar peta berputar",
                  )
                : id(
                    "Map turns with the route · tap for north up",
                    "Peta mengikuti rute · ketuk untuk utara di atas",
                  )
            }
            onClick={() => {
              const map = mapRef.current;
              const n = !northUp;
              setNorthUp(n);
              if (n && map)
                map.easeTo({
                  bearing: 0,
                  pitch: 0,
                  duration: 600,
                  easing: inOut,
                });
            }}
            className={`flex size-10 items-center justify-center border-b border-white/15 hover:bg-white/10 ${northUp ? "text-[#ffd400]" : "text-[#33d6ff]"}`}
          >
            <span ref={needle} className="block transition-none">
              <Navigation2 className="size-4.5" />
            </span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.85 }}
            aria-pressed={auto}
            aria-label={id(
              "Focus on the route (auto-focus)",
              "Fokus ke rute (fokus otomatis)",
            )}
            title={
              auto
                ? id("Auto-focus on", "Fokus otomatis aktif")
                : id("Auto-focus off", "Fokus otomatis mati")
            }
            onClick={() => {
              setGL({ follow: null });
              // tap: frame the route now; tap again while framed: auto-focus off/on
              if (moved.current || !auto) {
                setAuto(true);
                moved.current = false;
                if (!trip) frameRef.current();
              } else setAuto(false);
            }}
            className={`flex size-10 items-center justify-center hover:bg-white/10 ${auto ? "text-[#33d6ff]" : "text-white/40"}`}
          >
            <motion.span animate={{ rotate: auto ? 0 : 45 }}>
              <LocateFixed className="size-4.5" />
            </motion.span>
          </motion.button>
        </div>
      )}
      {/* who reaches your stop first, and who comes after */}
      <AnimatePresence>
        {!stage && net && board.length > 0 && firstRide && (
          <motion.div
            key="board"
            initial={{
              opacity: 0,
              x: 40,
              clipPath: "polygon(100% 0, 100% 0, 100% 100%, 100% 100%)",
            }}
            animate={{
              opacity: 1,
              x: 0,
              clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
            }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto absolute top-[150px] right-[68px] z-[5] w-44 border-l-4 border-[#33d6ff] bg-[#050b2e]/92 p-2 text-xs text-white shadow-[5px_5px_0_rgba(21,70,255,.7)]"
          >
            <p className="mb-1 truncate text-[10px] font-black tracking-[0.16em] text-[#33d6ff] uppercase">
              {id("Coming to", "Menuju")} {firstRide.from.name}
            </p>
            <ul className="space-y-0.5">
              <AnimatePresence initial={false}>
                {board.slice(0, 4).map((a, i) => {
                  const r = net.routes[a.route];
                  return (
                    <motion.li
                      layout
                      key={a.id}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <span className="w-3 font-black text-[#33d6ff] italic tabular-nums">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => setGL({ follow: a.id })}
                        className="slant px-1 font-bold text-white"
                        style={{ "--sl-bg": r.color } as CSSProperties}
                      >
                        {r.short}
                      </button>
                      <span className="ml-auto font-bold tabular-nums">
                        {a.etaSec < 45
                          ? id("now", "tiba")
                          : `${Math.round(a.etaSec / 60)} ${id("min", "mnt")}`}
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <p className="mt-1 text-[10px] text-slate-400">
              {id(
                "schedule estimate · tap to follow",
                "perkiraan jadwal · ketuk untuk ikuti",
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {fv && net && (
          <motion.div
            key="follow"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-auto absolute top-[150px] left-1/2 z-[5] flex -translate-x-1/2 slant items-center gap-2 py-1.5 pr-1.5 pl-3 text-xs text-[#050b2e] [--sl-sh:5px_5px_0_#1546ff]"
          >
            <span className="flex items-center gap-2">
              <span
                className="slant px-1 font-bold text-white"
                style={
                  { "--sl-bg": net.routes[fv.route].color } as CSSProperties
                }
              >
                {net.routes[fv.route].short}
              </span>
              <span className="max-w-52 truncate font-semibold">
                → {net.patterns[fv.pattern].headsign} · {id("next", "berikut")}{" "}
                {net.stops.name[net.patterns[fv.pattern].stops[fv.next]]}
              </span>
              <button
                type="button"
                aria-label={id("Stop following", "Berhenti mengikuti")}
                onClick={() => setGL({ follow: null })}
                className="p-1 hover:bg-[#050b2e]/10"
              >
                <X className="size-3.5" />
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
