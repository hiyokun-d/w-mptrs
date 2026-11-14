// Short-range predictions shown in the app, each with the numbers that made
// it, so the UI can explain itself. None of these feed the router.
//
//   arrival range  every leg gets a spread (σ) from what makes it uncertain;
//                  independent legs add in quadrature → P10 / P90 = ±1.28 σ
//   rain chance    "neighbourhood probability": the forecast is sampled on a
//                  3×3 grid of nearby points (±4 km) at three times (±15 min);
//                  the chance is the share of samples with r ≥ 0.5 mm/h

import type { RainField } from "./rainfield";
import type { Itinerary, Leg } from "./router";

export interface LegSpread {
  leg: Leg;
  sigmaMin: number;
  why:
    | "walk"
    | "wait-headway"
    | "wait-timetable"
    | "ride-traffic"
    | "moto-traffic"
    | "ojek-pickup";
}

export interface ArrivalRange {
  p10: number;
  p50: number;
  p90: number;
  sigmaMin: number;
  parts: LegSpread[];
}

const Z90 = 1.2816;

function headwayMin(g: Leg): number | null {
  const m = g.service?.match(/every ~?(\d+)/);
  return m ? Number(m[1]) : null;
}

export function legSpread(g: Leg): LegSpread {
  switch (g.kind) {
    case "walk":
      return { leg: g, sigmaMin: g.minutes * 0.08, why: "walk" };
    case "wait": {
      if (g.place === "none")
        return { leg: g, sigmaMin: g.minutes * 0.35, why: "ojek-pickup" };
      const h = headwayMin(g);
      // a random arrival within a headway is uniform: σ = H / √12
      if (h)
        return { leg: g, sigmaMin: h / Math.sqrt(12), why: "wait-headway" };
      return { leg: g, sigmaMin: 1.5, why: "wait-timetable" };
    }
    case "ride": {
      const mixed = g.route?.mixed ?? 1;
      return {
        leg: g,
        sigmaMin: g.minutes * (0.05 + 0.15 * mixed),
        why: "ride-traffic",
      };
    }
    case "moto":
      return { leg: g, sigmaMin: g.minutes * 0.15, why: "moto-traffic" };
  }
}

export function arrivalRange(it: Itinerary): ArrivalRange {
  const parts = it.legs.map(legSpread);
  const sigmaMin = Math.sqrt(parts.reduce((a, p) => a + p.sigmaMin ** 2, 0));
  const d = sigmaMin * Z90 * 60_000;
  return {
    p10: it.arrive - d * 0.6,
    p50: it.arrive,
    p90: it.arrive + d,
    sigmaMin,
    parts,
  };
}

export interface RainChance {
  chance: number;
  samples: number;
  wet: number;
  /** strongest rain among the samples */
  maxMmh: number;
}

export function rainChance(
  field: RainField,
  lat: number,
  lng: number,
  t: number,
): RainChance {
  const D = 0.036; // ≈ 4 km
  let wet = 0;
  let n = 0;
  let maxMmh = 0;
  for (const dt of [-15, 0, 15])
    for (const di of [-1, 0, 1])
      for (const dj of [-1, 0, 1]) {
        const r = field.at(lat + di * D, lng + dj * D, t + dt * 60_000);
        n++;
        if (r >= 0.5) wet++;
        if (r > maxMmh) maxMmh = r;
      }
  return { chance: wet / n, samples: n, wet, maxMmh };
}

/** Chance of rain on each leg where rain reaches you, at its midpoint. */
export function exposedChances(
  it: Itinerary,
  field: RainField,
): { leg: Leg; c: RainChance }[] {
  return it.legs
    .filter(
      (g) =>
        g.kind === "walk" ||
        g.kind === "moto" ||
        (g.kind === "wait" && g.place !== "station" && g.place !== "none"),
    )
    .filter((g) => g.minutes >= 0.5)
    .map((g) => ({
      leg: g,
      c: rainChance(
        field,
        (g.from.lat + g.to.lat) / 2,
        (g.from.lng + g.to.lng) / 2,
        (g.t0 + g.t1) / 2,
      ),
    }));
}
