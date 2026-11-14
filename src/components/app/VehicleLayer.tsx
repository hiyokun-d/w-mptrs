"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import { Marker, Tooltip } from "react-leaflet";
import type { Itinerary } from "@/lib/core/router";
import { vehiclesFor } from "@/lib/core/vehicles";
import type { Lang } from "@/lib/i18n";

const icons = new Map<string, L.DivIcon>();
function vehIcon(label: string, color: string, mine: boolean) {
  const key = `${label}|${color}|${mine}`;
  let ic = icons.get(key);
  if (!ic) {
    ic = L.divIcon({
      className: "veh",
      html: `<span class="veh-pill${mine ? " veh-mine" : ""}" style="--c:${color}">${label}</span>`,
      iconSize: [0, 0],
    });
    icons.set(key, ic);
  }
  return ic;
}

/**
 * Estimated buses and trains of the shown trip's lines. There is no live
 * feed, so positions come from the plan (see core/vehicles.ts). They tick
 * every second on the real clock, or follow the trip clock while playing.
 */
export function VehicleLayer({
  it,
  tripPos,
  lang,
}: {
  it: Itinerary;
  tripPos: number | null;
  lang: Lang;
}) {
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (tripPos !== null) return;
    const id = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tripPos]);
  const t = tripPos ?? wall;

  return (
    <>
      {it.legs.flatMap((g) =>
        vehiclesFor(g, t).map((v) => {
          const mins = Math.round(v.etaSec / 60);
          const tip =
            v.phase === "riding"
              ? v.k === 0
                ? lang === "id"
                  ? "Kendaraan Anda"
                  : "Your vehicle"
                : lang === "id"
                  ? "Sudah lewat halte Anda"
                  : "Already past your stop"
              : mins <= 0
                ? lang === "id"
                  ? "Tiba sekarang"
                  : "Arriving now"
                : `~${mins} ${lang === "id" ? "mnt ke halte Anda" : "min to your stop"}`;
          return (
            <Marker
              key={`${g.t0}-${v.k}`}
              position={[v.lat, v.lng]}
              icon={vehIcon(
                g.route?.short ?? "•",
                g.route?.color ?? "#0284c7",
                v.k === 0,
              )}
              zIndexOffset={v.k === 0 ? 500 : 100}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                {g.route?.short} · {tip} (
                {lang === "id" ? "perkiraan" : "estimate"})
              </Tooltip>
            </Marker>
          );
        }),
      )}
    </>
  );
}
