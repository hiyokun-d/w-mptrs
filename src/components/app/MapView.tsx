"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { positionAt } from "@/lib/core/alerts";
import { RainField, type RainGrid } from "@/lib/core/rainfield";
import type { Itinerary, Leg } from "@/lib/core/router";
import { chosen, useApp } from "@/lib/store/app";
import { legKey } from "./format";
import { rainRGBA } from "./rain-colors";
import { VehicleLayer } from "./VehicleLayer";

const JAKARTA: [number, number] = [-6.2, 106.83];
// rain overlay extent (matches the forecast grid bbox)
const BOUNDS: [[number, number], [number, number]] = [
  [-6.7, 106.4],
  [-5.95, 107.2],
];

function dot(color: string, size = 14, ring = "white") {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 1px 6px rgba(0,0,0,.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const raincoatIcon = L.divIcon({
  className: "",
  html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
    <div style="background:#f59e0b;color:#111;font:600 11px system-ui;padding:3px 7px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap">☂ jas hujan</div>
    <div style="width:2px;height:8px;background:#f59e0b"></div></div>`,
  iconSize: [0, 0],
});

function legStyle(g: Leg, active: boolean): L.PathOptions {
  const o = active ? 1 : 0.35;
  if (g.kind === "walk")
    return {
      color: g.rain >= 5 ? "#db2777" : "#475569",
      weight: active ? 5 : 3,
      dashArray: "2 9",
      lineCap: "round",
      opacity: o,
    };
  if (g.kind === "moto")
    return { color: "#f97316", weight: active ? 6 : 3, opacity: o };
  return {
    color: g.route?.color ?? "#0ea5e9",
    weight: active ? 6 : 3,
    opacity: o,
  };
}

function RainOverlay({ field, at }: { field: RainField; at: number }) {
  const url = useMemo(() => {
    if (typeof document === "undefined") return null;
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
      const lat =
        BOUNDS[1][0] - ((y + 0.5) / H) * (BOUNDS[1][0] - BOUNDS[0][0]);
      for (let x = 0; x < W; x++) {
        const lng =
          BOUNDS[0][1] + ((x + 0.5) / W) * (BOUNDS[1][1] - BOUNDS[0][1]);
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
    // grid is part of field; depend on it explicitly so a new forecast redraws
  }, [field, at]);
  if (!url) return null;
  return <ImageOverlay url={url} bounds={BOUNDS} opacity={0.85} zIndex={300} />;
}

function Radar() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => r.json())
      .then((j) => {
        const last = j?.radar?.past?.at(-1);
        if (last) setPath(`${j.host}${last.path}`);
      })
      .catch(() => {});
  }, []);
  if (!path) return null;
  return (
    <TileLayer
      url={`${path}/256/{z}/{x}/{y}/2/1_1.png`}
      opacity={0.55}
      maxNativeZoom={7}
      zIndex={350}
      attribution='Radar <a href="https://www.rainviewer.com">RainViewer</a>'
    />
  );
}

function Clicks() {
  const pick = useApp((s) => s.pickOnMap);
  const setPoint = useApp((s) => s.setPoint);
  const set = useApp((s) => s.set);
  useMapEvents({
    // exploring the map is a cue to get the sheet out of the way
    dragstart() {
      if (!useApp.getState().collapsed) set({ collapsed: true });
    },
    click(e) {
      if (!pick) return;
      setPoint(pick, {
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        name: `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`,
      });
      set({ pickOnMap: null, sheet: "home" });
    },
  });
  return null;
}

function Fit({
  its,
  from,
  to,
}: {
  its: (Itinerary | null)[];
  from: L.LatLngExpression | null;
  to: L.LatLngExpression | null;
}) {
  const map = useMap();
  const collapsed = useApp((s) => s.collapsed);
  // once the user pans, the view is theirs until the next route arrives
  const moved = useRef(false);
  useMapEvents({
    dragstart() {
      moved.current = true;
    },
  });
  const frame = useCallback(() => {
    const pts: L.LatLngExpression[] = [];
    for (const it of its)
      for (const g of it?.legs ?? []) for (const p of g.path) pts.push(p);
    if (from) pts.push(from);
    if (to) pts.push(to);
    // keep at least ~220 px of map for the route, even on short screens
    const bottom = Math.max(
      24,
      Math.min(useApp.getState().sheetPx + 24, map.getSize().y - 150 - 220),
    );
    if (pts.length >= 2)
      map.flyToBounds(L.latLngBounds(pts), {
        paddingTopLeft: [24, 150],
        paddingBottomRight: [24, bottom],
        maxZoom: 15,
        duration: 0.7,
      });
    else if (pts.length === 1) map.flyTo(pts[0], 14, { duration: 0.7 });
  }, [its, from, to, map]);
  // a new route: frame it after the sheet has settled
  useEffect(() => {
    moved.current = false;
    const id = setTimeout(frame, 520);
    return () => clearTimeout(id);
  }, [frame]);
  // the sheet opened or closed by itself (not because the user panned)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reframe only when the sheet toggles
  useEffect(() => {
    if (moved.current) return;
    const id = setTimeout(frame, 520);
    return () => clearTimeout(id);
  }, [collapsed]);
  return null;
}

export default function MapView({
  grid,
  now,
  tripPos,
}: {
  grid: RainGrid | null;
  now: number;
  tripPos: number | null;
}) {
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
  } = useApp();
  // demo storms move relative to the trip's departure
  const field = useMemo(
    () => new RainField(grid, result?.cells ?? [], result?.depart ?? 0),
    [grid, result],
  );
  const shown = trip ? chosen(result, trip.choice) : chosen(result, choice);
  const other = trip
    ? null
    : chosen(
        result,
        choice === "fastest"
          ? result?.shift
            ? "weatherAware"
            : "transit"
          : "fastest",
      );
  const at = tripPos ?? now + rainOffsetMin * 60_000;
  const me = shown && tripPos ? positionAt(shown, tripPos) : null;
  const preps =
    result && (trip?.choice ?? choice) === "weatherAware"
      ? result.alerts.filter((a) => !a.covered)
      : [];
  const fitIts = useMemo(
    () => [result?.fastest ?? null, result?.weatherAware ?? null],
    [result],
  );

  return (
    <MapContainer
      center={JAKARTA}
      zoom={12}
      zoomControl={false}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      {radarLayer && <Radar />}
      {rainLayer && <RainOverlay field={field} at={at} />}
      <Clicks />
      <Fit
        its={fitIts}
        from={from ? [from.lat, from.lng] : null}
        to={to ? [to.lat, to.lng] : null}
      />
      {other?.legs.map((g) => (
        <Polyline
          key={`o${legKey(g)}`}
          positions={g.path}
          pathOptions={legStyle(g, false)}
        />
      ))}
      {shown?.legs.map((g, i) => (
        <Polyline
          key={`s${legKey(g)}`}
          positions={g.path}
          // a new plan draws itself leg by leg, in travel order
          pathOptions={{
            ...legStyle(g, true),
            className: `${g.kind === "walk" ? "route-fade" : "route-draw"} rd${Math.min(i, 9)}`,
          }}
        />
      ))}
      {shown?.legs
        .filter((g) => g.kind === "wait" && g.place !== "none")
        .map((g) => (
          <CircleMarker
            key={`w${legKey(g)}`}
            center={[g.from.lat, g.from.lng]}
            radius={5}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: "#0f172a",
              fillOpacity: 1,
            }}
          />
        ))}
      {preps.map((a) => (
        <Marker
          key={`p${a.issueAt}`}
          position={[a.prep.lat, a.prep.lng]}
          icon={raincoatIcon}
        />
      ))}
      {from && <Marker position={[from.lat, from.lng]} icon={dot("#16a34a")} />}
      {to && <Marker position={[to.lat, to.lng]} icon={dot("#dc2626")} />}
      {shown && <VehicleLayer it={shown} tripPos={tripPos} lang={lang} />}
      {me && <Marker position={[me.lat, me.lng]} icon={dot("#2563eb", 18)} />}
    </MapContainer>
  );
}
