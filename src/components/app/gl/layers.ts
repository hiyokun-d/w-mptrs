"use client";

import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as GLMap,
  LayerSpecification,
} from "maplibre-gl";

export type FC = GeoJSON.FeatureCollection;
export const EMPTY: FC = { type: "FeatureCollection", features: [] };

/** set a GeoJSON source's data, creating the source the first time */
export function geo(map: GLMap, id: string, data: FC) {
  const s = map.getSource(id) as GeoJSONSource | undefined;
  if (s) s.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/** add a layer once; `before` keeps the app's layers under the labels */
export function layer(map: GLMap, spec: LayerSpecification, before?: string) {
  if (map.getLayer(spec.id)) return;
  map.addLayer(spec, before && map.getLayer(before) ? before : undefined);
}

export function drop(map: GLMap, ids: string[]) {
  for (const id of ids) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ids) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

/** first label layer of the base style: rain and routes go under it */
export function firstSymbol(map: GLMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

/** Direction of travel from the first to the last point ([lng, lat]). */
export function travelBearing(pts: [number, number][]): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (!a || !b) return 0;
  return (
    (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) *
      180) /
    Math.PI
  );
}

/**
 * When to rotate: turn the map so travel reads upward (start near the bottom,
 * goal near the top), but only when the trip really runs off-north. A tilt of
 * 10° is noise, not information, so it stays north-up.
 */
export function smartBearing(b: number): number {
  const n = ((((b + 180) % 360) + 360) % 360) - 180;
  return Math.abs(n) < 20 ? 0 : Math.round(n / 5) * 5;
}

/** [lat, lng] → [lng, lat] */
export const ll = (p: [number, number]): [number, number] => [p[1], p[0]];

/**
 * The first fraction `f` (0…1) of a sequence of lines, by length, so a route
 * can draw itself leg by leg in travel order.
 */
export function sliceLines(lines: [number, number][][], f: number) {
  const lens = lines.map((l) => {
    let d = 0;
    for (let i = 1; i < l.length; i++)
      d += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return d;
  });
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let want = Math.max(0, Math.min(1, f)) * total;
  return lines.map((l, k) => {
    if (want >= lens[k]) {
      want -= lens[k];
      return l;
    }
    if (want <= 0) return [] as [number, number][];
    const out: [number, number][] = [l[0]];
    for (let i = 1; i < l.length; i++) {
      const d = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
      if (want >= d) {
        out.push(l[i]);
        want -= d;
      } else {
        const u = d ? want / d : 0;
        out.push([
          l[i - 1][0] + u * (l[i][0] - l[i - 1][0]),
          l[i - 1][1] + u * (l[i][1] - l[i - 1][1]),
        ]);
        want = 0;
        break;
      }
    }
    return out;
  });
}

// ── the look: "deep water" ──────────────────────────────────────────────────
// A pale blue city on electric-blue water, white roads, ink labels. One family
// of blues so the route colours (and the gold rain cost) are what stands out.
export const THEME = {
  ink: "#050b2e",
  blue: "#1546ff",
  cyan: "#33d6ff",
  gold: "#ffd400",
  land: "#dde7ff",
  block: "#d2ddfd",
  park: "#c3dcf6",
  water: "#2553ff",
  road: "#ffffff",
  casing: "#b2c3f2",
  major: "#7f9bff",
  bld: "#c6d3f8",
} as const;

const BLD_3D: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "render_height"], 0],
  0,
  "#d4defd",
  50,
  "#aebff3",
  150,
  "#7f9bff",
];

/** setPaintProperty for a property name built at run time */
function paint(map: GLMap, id: string, k: string, v: unknown) {
  (map.setPaintProperty as (a: string, b: string, c: unknown) => void).call(
    map,
    id,
    k,
    v,
  );
}

/** Recolour the base style into the app theme. Unknown layers are left. */
export function themeBase(map: GLMap) {
  const T = THEME;
  const set = (id: string, k: string, v: unknown) => {
    try {
      paint(map, id, k, v);
    } catch {
      // a property this layer does not have
    }
  };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (id.startsWith("w-") || id.startsWith("s-")) continue;
    if (l.type === "background") set(id, "background-color", T.land);
    else if (l.type === "raster") {
      set(id, "raster-opacity", 0.18);
      set(id, "raster-saturation", -0.7);
    } else if (l.type === "fill") {
      if (id === "water") set(id, "fill-color", T.water);
      else if (id === "building") {
        set(id, "fill-color", T.bld);
        set(id, "fill-outline-color", "#b3c4f3");
      } else if (/park|wood|grass|wetland|pitch|cemetery/.test(id))
        set(id, "fill-color", T.park);
      else if (/sand|ice/.test(id)) set(id, "fill-color", "#e7edff");
      else if (/landuse|aeroway/.test(id)) set(id, "fill-color", T.block);
    } else if (l.type === "fill-extrusion" && id === "building-3d") {
      set(id, "fill-extrusion-color", BLD_3D);
      set(id, "fill-extrusion-opacity", 0.8);
    } else if (l.type === "line") {
      if (id.startsWith("waterway")) set(id, "line-color", T.water);
      else if (id.startsWith("boundary")) set(id, "line-color", T.blue);
      else if (id === "park_outline") set(id, "line-color", "#a9c6f0");
      else if (/rail/.test(id)) {
        set(id, "line-color", T.ink);
        set(id, "line-opacity", 0.32);
      } else if (/casing/.test(id))
        set(
          id,
          "line-color",
          /motorway|trunk_primary/.test(id) ? T.major : T.casing,
        );
      else if (/aeroway|road|tunnel|bridge/.test(id))
        set(id, "line-color", T.road);
    } else if (l.type === "symbol") {
      const water = /water/.test(id);
      set(id, "text-color", water ? "#ffffff" : T.ink);
      set(id, "text-halo-color", water ? T.blue : "#ffffff");
      set(id, "text-halo-width", 1.4);
    }
  }
}

/** Fade a layer's opacity (instead of switching it off, which pops). */
export function fade(map: GLMap, id: string, to: number, ms = 600) {
  const l = map.getLayer(id);
  if (!l) return;
  const props: Record<string, string[]> = {
    line: ["line-opacity"],
    circle: ["circle-opacity", "circle-stroke-opacity"],
    fill: ["fill-opacity"],
    "fill-extrusion": ["fill-extrusion-opacity"],
    symbol: ["text-opacity", "icon-opacity"],
    raster: ["raster-opacity"],
    background: ["background-opacity"],
  };
  if (to > 0) map.setLayoutProperty(id, "visibility", "visible");
  for (const k of props[l.type] ?? []) {
    paint(map, id, `${k}-transition`, { duration: ms, delay: 0 });
    paint(map, id, k, to);
  }
}

/**
 * Night mode for the presentation: a dark veil over the base map (under the
 * app's layers) and dark, lit-from-within 3D buildings. 0 = day, 1 = night.
 */
export function setNight(map: GLMap, v: number) {
  const veil = "w-veil";
  if (!map.getLayer(veil)) {
    // a background layer placed mid-stack paints over everything below it
    const at = map.getLayer("building-3d") ? "building-3d" : firstSymbol(map);
    map.addLayer(
      {
        id: veil,
        type: "background",
        paint: {
          "background-color": THEME.ink,
          "background-opacity": 0,
          "background-opacity-transition": { duration: 900 },
        },
      },
      at,
    );
  }
  map.setPaintProperty(veil, "background-opacity", 0.82 * v);
  if (map.getLayer("building-3d")) {
    map.setPaintProperty(
      "building-3d",
      "fill-extrusion-color",
      v > 0.5 ? "#12307a" : BLD_3D,
    );
    map.setPaintProperty(
      "building-3d",
      "fill-extrusion-opacity",
      v > 0.5 ? 0.85 : 0.8,
    );
  }
}
