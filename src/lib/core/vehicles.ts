// Estimated vehicle positions. There is no public live feed for TransJakarta,
// so vehicles are placed from the plan itself: the one you board reaches your
// stop exactly when the plan says (leg.t0), the others run one headway apart,
// and each moves at the traffic-scaled speed the router used. Positions are
// estimates and are labelled as such in the UI.

import type { LatLng } from "./polyline";
import type { Leg } from "./router";

export interface Vehicle {
  /** 0 = the one you board; −1 the one before; +1 the one after */
  k: number;
  lat: number;
  lng: number;
  /** seconds until it reaches your boarding stop (negative = already left) */
  etaSec: number;
  phase: "approaching" | "riding";
}

const R = 6371000;
function dist(a: LatLng, b: LatLng): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x = dLng * Math.cos(((a[0] + b[0]) * Math.PI) / 360);
  return R * Math.hypot(dLat, x);
}

/** point at fraction f (0…1) of the path's length */
export function along(path: LatLng[], f: number): LatLng {
  if (path.length === 1) return path[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    seg.push(d);
    total += d;
  }
  let want = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? Math.min(1, want / seg[i]) : 0;
      return [
        path[i][0] + u * (path[i + 1][0] - path[i][0]),
        path[i][1] + u * (path[i + 1][1] - path[i][1]),
      ];
    }
    want -= seg[i];
  }
  return path[path.length - 1];
}

/** Vehicles of this ride leg's line near your trip at time t (ms). */
export function vehiclesFor(
  g: Leg,
  t: number,
  ahead = 2,
  behind = 3,
): Vehicle[] {
  if (g.kind !== "ride" || !g.trip) return [];
  const H = g.trip.headwaySec * 1000;
  const up = g.trip.upSec * 1000;
  const ride = g.t1 - g.t0;
  const out: Vehicle[] = [];
  for (let k = -ahead; k <= behind; k++) {
    const Tk = g.t0 + k * H; // when vehicle k reaches your stop
    let p: LatLng | null = null;
    let phase: Vehicle["phase"] = "approaching";
    if (t < Tk && t >= Tk - up && up > 0)
      p = along(g.trip.upPath, 1 - (Tk - t) / up);
    else if (t >= Tk && t <= Tk + ride) {
      p = along(g.path, (t - Tk) / (ride || 1));
      phase = "riding";
    }
    if (p)
      out.push({ k, lat: p[0], lng: p[1], etaSec: (Tk - t) / 1000, phase });
  }
  return out;
}

/** Seconds until the next vehicle of this leg's line reaches your stop. */
export function nextArrivalSec(g: Leg, t: number): number | null {
  if (g.kind !== "ride" || !g.trip) return null;
  const H = g.trip.headwaySec * 1000;
  const k = Math.ceil((t - g.t0) / H);
  return (g.t0 + k * H - t) / 1000;
}
