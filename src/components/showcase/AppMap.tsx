"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import {
  MapContainer, TileLayer, Marker, Popup,
  Polyline, Circle, CircleMarker, useMapEvents, useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Coordinates, RouteOption, RainfallIntensity } from "@/types";

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICON_ORIGIN = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
const ICON_DEST = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

function boardIcon(color: string) {
  return L.divIcon({
    html: `
      <div style="
        background:${color};border:2px solid white;border-radius:50%;
        width:16px;height:16px;box-shadow:0 0 0 3px ${color}55;
      "></div>
      <div style="
        position:absolute;top:-18px;left:50%;transform:translateX(-50%);
        background:${color};color:#fff;font-size:9px;font-weight:700;
        padding:1px 5px;border-radius:3px;white-space:nowrap;font-family:monospace;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
      ">BOARD</div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function alightIcon(color: string) {
  return L.divIcon({
    html: `
      <div style="
        background:${color};border:2px solid white;border-radius:50%;
        width:16px;height:16px;box-shadow:0 0 0 3px ${color}55;
      "></div>
      <div style="
        position:absolute;top:-18px;left:50%;transform:translateX(-50%);
        background:${color};color:#fff;font-size:9px;font-weight:700;
        padding:1px 5px;border-radius:3px;white-space:nowrap;font-family:monospace;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
      ">ALIGHT</div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// ── Color maps ────────────────────────────────────────────────────────────────

const INTENSITY_COLORS: Record<RainfallIntensity, string> = {
  none: "#64748b", light: "#38bdf8", moderate: "#3b82f6",
  heavy: "#6366f1", extreme: "#7c3aed",
};

const TRANSIT_SEG_COLOR: Record<string, string> = {
  mrt:          "#ef4444",
  lrt:          "#10b981",
  krl:          "#3b82f6",
  transjakarta: "#f59e0b",
  car:          "#f97316",
  motorcycle:   "#f97316",
  walking:      "#94a3b8",
  bicycle:      "#a3e635",
};

const STOP_COLORS: Record<string, string> = {
  krl: "#3b82f6", mrt: "#ef4444", lrt: "#10b981", transjakarta: "#f59e0b",
};

// ── Utilities ─────────────────────────────────────────────────────────────────

// GH/GeoJSON: [lng, lat] → Leaflet: [lat, lng]
function ghToLatLng(coords: [number, number][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng]);
}

// ── Map helpers ───────────────────────────────────────────────────────────────

function ClickHandler({
  origin, destination, onOriginSet, onDestinationSet,
}: {
  origin: Coordinates | null;
  destination: Coordinates | null;
  onOriginSet: (c: Coordinates) => void;
  onDestinationSet: (c: Coordinates) => void;
}) {
  useMapEvents({
    click(e) {
      const c = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (!origin) onOriginSet(c);
      else if (!destination) onDestinationSet(c);
    },
  });
  return null;
}

function FitBounds({ routes }: { routes: RouteOption[] }) {
  const map = useMap();
  useEffect(() => {
    const allCoords: [number, number][] = [];
    for (const r of routes) {
      for (const seg of r.segments) {
        allCoords.push(...ghToLatLng(seg.geometry as [number, number][]));
      }
    }
    if (allCoords.length > 1) {
      map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
    }
  }, [routes, map]);
  return null;
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface TransitStopDot {
  id: string; name: string; lat: number; lng: number; type: string;
}

export interface NearbyStopDot {
  id: string; name: string; lat: number; lng: number; type: string;
  distanceMeters: number; walkMinutes: number;
}

interface BoardAlightStop { id: string; name: string; lat: number; lng: number; }

interface Props {
  origin: Coordinates | null;
  destination: Coordinates | null;
  routes: RouteOption[];
  selectedRoute: string | null;
  intensity: RainfallIntensity;
  onOriginSet: (c: Coordinates) => void;
  onDestinationSet: (c: Coordinates) => void;
  transitStops?: TransitStopDot[];
  showTransit?: boolean;
  boardStop?: BoardAlightStop | null;
  alightStop?: BoardAlightStop | null;
  nearbyOriginStops?: NearbyStopDot[];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppMap({
  origin, destination, routes, selectedRoute, intensity,
  onOriginSet, onDestinationSet,
  transitStops = [], showTransit = false,
  boardStop = null, alightStop = null,
  nearbyOriginStops = [],
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const rainColor  = INTENSITY_COLORS[intensity];
  const fastest    = routes.find((r) => r.label === "fastest");
  const weatherAware = routes.find((r) => r.label === "weather_aware");
  const waActive   = selectedRoute === "weather_aware";
  const fastActive = selectedRoute === "fastest";

  if (!mounted) return <div className="h-full w-full bg-slate-900/60" />;

  return (
    <MapContainer
      center={[-6.2088, 106.8456]}
      zoom={13}
      style={{ height: "100%", width: "100%" }}
      className="z-0"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      />

      <ClickHandler
        origin={origin} destination={destination}
        onOriginSet={onOriginSet} onDestinationSet={onDestinationSet}
      />

      {routes.length > 0 && <FitBounds routes={routes} />}

      {/* Rain radius overlay */}
      {origin && intensity !== "none" && (
        <Circle
          center={[origin.lat, origin.lng]}
          radius={3000}
          pathOptions={{
            color: rainColor, fillColor: rainColor,
            fillOpacity: 0.07, dashArray: "8 5", weight: 1.5,
          }}
        />
      )}

      {/* ── Fastest route — solid orange (motorcycle/car) ────────────────── */}
      {fastest && fastest.segments.map((seg, i) => (
        <Polyline
          key={`fast-${i}`}
          positions={ghToLatLng(seg.geometry as [number, number][])}
          pathOptions={{
            color: "#f97316",
            weight: fastActive ? 5 : 3,
            opacity: waActive ? 0.3 : 0.85,
            dashArray: waActive ? "6 5" : undefined,
          }}
        />
      ))}

      {/* ── Weather-aware route — per-segment mode rendering ─────────────── */}
      {weatherAware && weatherAware.segments.map((seg, i) => {
        const isWalk    = seg.mode === "walking";
        const segColor  = TRANSIT_SEG_COLOR[seg.mode] ?? "#38bdf8";
        const dimmed    = fastActive;

        if (isWalk) {
          // Walk segment: dashed grey, thinner
          return (
            <Polyline
              key={`wa-${i}`}
              positions={ghToLatLng(seg.geometry as [number, number][])}
              pathOptions={{
                color: "#94a3b8",
                weight: waActive ? 3 : 2,
                opacity: dimmed ? 0.2 : 0.7,
                dashArray: "6 9",
              }}
            />
          );
        }

        // Transit segment: solid, thicker, mode-colored
        return (
          <Polyline
            key={`wa-${i}`}
            positions={ghToLatLng(seg.geometry as [number, number][])}
            pathOptions={{
              color: segColor,
              weight: waActive ? 5 : 3,
              opacity: dimmed ? 0.3 : 0.92,
            }}
          />
        );
      })}

      {/* ── Transit network layer (optional toggle) ───────────────────────── */}
      {showTransit && transitStops.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={4}
          pathOptions={{
            color: STOP_COLORS[s.type] ?? "#94a3b8",
            fillColor: STOP_COLORS[s.type] ?? "#94a3b8",
            fillOpacity: 0.8, weight: 1,
          }}
        >
          <Popup>
            <strong>{s.name}</strong><br />
            <span style={{ textTransform: "uppercase", fontSize: "11px", color: STOP_COLORS[s.type] }}>
              {s.type}
            </span>
          </Popup>
        </CircleMarker>
      ))}

      {/* ── Board / alight stop markers — prominent DivIcon ──────────────── */}
      {boardStop && (
        <Marker
          position={[boardStop.lat, boardStop.lng]}
          icon={boardIcon("#10b981")}
        >
          <Popup>
            <strong>Board here</strong><br />{boardStop.name}
          </Popup>
        </Marker>
      )}
      {alightStop && (
        <Marker
          position={[alightStop.lat, alightStop.lng]}
          icon={alightIcon("#f43f5e")}
        >
          <Popup>
            <strong>Alight here</strong><br />{alightStop.name}
          </Popup>
        </Marker>
      )}

      {/* ── Nearby origin stops — pulsing DivIcon ─────────────────────────── */}
      {nearbyOriginStops.map((s) => {
        const color = STOP_COLORS[s.type] ?? "#94a3b8";
        const icon  = L.divIcon({
          html: `<div class="nearby-stop-pin" style="background:${color};color:${color};box-shadow:0 0 0 2px ${color}44;"></div>`,
          className: "",
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        return (
          <Marker key={`nearby-${s.id}`} position={[s.lat, s.lng]} icon={icon}>
            <Popup>
              <strong>{s.name}</strong><br />
              <span style={{ textTransform: "uppercase", fontSize: "11px", color }}>{s.type}</span><br />
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                {s.distanceMeters}m · ~{s.walkMinutes} min walk
              </span>
            </Popup>
          </Marker>
        );
      })}

      {/* ── Origin / destination markers ─────────────────────────────────── */}
      {origin && (
        <Marker position={[origin.lat, origin.lng]} icon={ICON_ORIGIN}>
          <Popup>
            <strong>Origin</strong><br />
            {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}
          </Popup>
        </Marker>
      )}
      {destination && (
        <Marker position={[destination.lat, destination.lng]} icon={ICON_DEST}>
          <Popup>
            <strong>Destination</strong><br />
            {destination.lat.toFixed(4)}, {destination.lng.toFixed(4)}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
