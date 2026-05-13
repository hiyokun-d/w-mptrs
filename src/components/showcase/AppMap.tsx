"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import {
  MapContainer, TileLayer, Marker, Popup,
  Polyline, Circle, useMapEvents, useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Coordinates, RouteOption, RainfallIntensity } from "@/types";

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

const INTENSITY_COLORS: Record<RainfallIntensity, string> = {
  none: "#64748b", light: "#38bdf8", moderate: "#3b82f6",
  heavy: "#6366f1", extreme: "#7c3aed",
};

// GH returns [lng, lat] — Leaflet needs [lat, lng]
function ghToLatLng(coords: [number, number][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng]);
}

function ClickHandler({
  origin, destination,
  onOriginSet, onDestinationSet,
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
      map.fitBounds(L.latLngBounds(allCoords), { padding: [40, 40] });
    }
  }, [routes, map]);
  return null;
}

interface Props {
  origin: Coordinates | null;
  destination: Coordinates | null;
  routes: RouteOption[];
  selectedRoute: string | null;
  intensity: RainfallIntensity;
  onOriginSet: (c: Coordinates) => void;
  onDestinationSet: (c: Coordinates) => void;
}

export default function AppMap({
  origin, destination, routes, selectedRoute, intensity,
  onOriginSet, onDestinationSet,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const rainColor = INTENSITY_COLORS[intensity];
  const fastest = routes.find((r) => r.label === "fastest");
  const weatherAware = routes.find((r) => r.label === "weather_aware");

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
        origin={origin}
        destination={destination}
        onOriginSet={onOriginSet}
        onDestinationSet={onDestinationSet}
      />

      {routes.length > 0 && <FitBounds routes={routes} />}

      {/* Rain overlay — pulses with intensity */}
      {origin && intensity !== "none" && (
        <Circle
          center={[origin.lat, origin.lng]}
          radius={3000}
          pathOptions={{
            color: rainColor, fillColor: rainColor,
            fillOpacity: 0.08, dashArray: "8 4", weight: 1.5,
          }}
        />
      )}

      {/* Fastest route — always show dimmed, brighten when selected */}
      {fastest && fastest.segments.map((seg, i) => (
        <Polyline
          key={`fast-${i}`}
          positions={ghToLatLng(seg.geometry as [number, number][])}
          pathOptions={{
            color: "#f97316",
            weight: selectedRoute === "fastest" ? 5 : 3,
            opacity: selectedRoute === "weather_aware" ? 0.35 : 0.85,
            dashArray: selectedRoute === "weather_aware" ? "6 4" : undefined,
          }}
        />
      ))}

      {/* Weather-aware route — blue */}
      {weatherAware && weatherAware.segments.map((seg, i) => (
        <Polyline
          key={`wa-${i}`}
          positions={ghToLatLng(seg.geometry as [number, number][])}
          pathOptions={{
            color: "#38bdf8",
            weight: selectedRoute === "weather_aware" ? 5 : 3,
            opacity: selectedRoute === "fastest" ? 0.35 : 0.85,
            dashArray: selectedRoute === "fastest" ? "6 4" : undefined,
          }}
        />
      ))}

      {/* Markers */}
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
