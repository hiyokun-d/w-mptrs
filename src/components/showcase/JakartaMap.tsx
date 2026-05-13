"use client";

import "leaflet/dist/leaflet.css";
import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";

const ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const JAKARTA: [number, number] = [-6.2088, 106.8456];

const TRANSIT_STOPS = [
  { name: "Bundaran HI (MRT)", pos: [-6.1944, 106.8229] as [number, number], mode: "MRT" },
  { name: "Dukuh Atas (Hub)", pos: [-6.2014, 106.8229] as [number, number], mode: "HUB" },
  { name: "TransJakarta Blok M", pos: [-6.2442, 106.7973] as [number, number], mode: "TJ" },
  { name: "Monas (Landmark)", pos: [-6.1753, 106.8272] as [number, number], mode: "POI" },
  { name: "Sudirman Station", pos: [-6.2087, 106.8182] as [number, number], mode: "KRL" },
];

const MODE_COLORS: Record<string, string> = {
  MRT: "#3b82f6",
  HUB: "#8b5cf6",
  TJ: "#f59e0b",
  KRL: "#10b981",
  POI: "#ef4444",
};

function MapControls({
  showBoundary,
  onToggleBoundary,
  boundaryLoading,
  confirmed,
}: {
  showBoundary: boolean;
  onToggleBoundary: () => void;
  boundaryLoading: boolean;
  confirmed: boolean;
}) {
  const map = useMap();
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex gap-2">
      <button
        onClick={() => map.setView(JAKARTA, 13)}
        className="bg-slate-900/90 text-white text-xs px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-800 transition-colors backdrop-blur-sm"
      >
        Jakarta
      </button>
      <button
        onClick={() => { map.setView([0, 118], 4); }}
        className="bg-slate-900/90 text-white text-xs px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-800 transition-colors backdrop-blur-sm"
      >
        Indonesia
      </button>
      <button
        onClick={onToggleBoundary}
        disabled={boundaryLoading}
        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors backdrop-blur-sm ${
          showBoundary
            ? "bg-blue-600/80 border-blue-500 text-white"
            : "bg-slate-900/90 border-slate-600 text-white hover:bg-slate-800"
        } disabled:opacity-50`}
      >
        {boundaryLoading ? "Loading…" : showBoundary ? "Hide Border" : "Show OSM Border (R304751)"}
      </button>
      {confirmed && (
        <span className="bg-emerald-900/80 text-emerald-300 text-xs px-3 py-1.5 rounded-lg border border-emerald-700 backdrop-blur-sm">
          ✓ Indonesia confirmed
        </span>
      )}
    </div>
  );
}

export default function JakartaMap() {
  const [showBoundary, setShowBoundary] = useState(false);
  const [boundaryGeoJson, setBoundaryGeoJson] = useState<object | null>(null);
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function toggleBoundary() {
    if (showBoundary) {
      setShowBoundary(false);
      return;
    }

    if (boundaryGeoJson) {
      setShowBoundary(true);
      setConfirmed(true);
      return;
    }

    setBoundaryLoading(true);
    try {
      const res = await fetch("/api/boundary");
      if (res.ok) {
        const data = await res.json();
        setBoundaryGeoJson(data);
        setShowBoundary(true);
        setConfirmed(true);
      }
    } finally {
      setBoundaryLoading(false);
    }
  }

  return (
    <div className="relative w-full h-[420px] rounded-xl overflow-hidden border border-slate-700">
      <MapContainer
        center={JAKARTA}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        className="z-0"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors · OSM relation <a href="https://www.openstreetmap.org/relation/304751">R304751</a>'
        />

        {/* Simulated rain zone */}
        <Circle
          center={JAKARTA}
          radius={2000}
          pathOptions={{
            color: "#3b82f6",
            fillColor: "#3b82f6",
            fillOpacity: 0.08,
            dashArray: "6",
            weight: 1.5,
          }}
        />

        {/* Indonesia national boundary overlay */}
        {showBoundary && boundaryGeoJson && (
          <GeoJSON
            key="indonesia-boundary"
            data={boundaryGeoJson as GeoJSON.GeoJsonObject}
            style={{
              color: "#f59e0b",
              weight: 2,
              fillOpacity: 0,
              dashArray: "8 4",
            }}
          />
        )}

        {TRANSIT_STOPS.map((stop) => (
          <Marker key={stop.name} position={stop.pos} icon={ICON}>
            <Popup>
              <div className="text-xs font-medium">{stop.name}</div>
              <div
                className="text-xs mt-0.5 font-mono px-1.5 py-0.5 rounded inline-block"
                style={{
                  background: MODE_COLORS[stop.mode] + "33",
                  color: MODE_COLORS[stop.mode],
                }}
              >
                {stop.mode}
              </div>
            </Popup>
          </Marker>
        ))}

        <MapControls
          showBoundary={showBoundary}
          onToggleBoundary={toggleBoundary}
          boundaryLoading={boundaryLoading}
          confirmed={confirmed}
        />
      </MapContainer>
    </div>
  );
}
