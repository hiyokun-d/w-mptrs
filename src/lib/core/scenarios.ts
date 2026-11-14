// Demo storms added on top of the live forecast, placed relative to the trip
// so every scenario is reproducible anywhere in the city.

import type { StormCell } from "./rainfield";

export type Scenario =
  | "live"
  | "drizzle"
  | "storm-coming"
  | "storm-over-start"
  | "storm-at-destination"
  | "passing-shower"
  | "sudden-downpour"
  | "storm-leaving"
  | "heavy-everywhere"
  | "extreme";

export const SCENARIOS: Scenario[] = [
  "live",
  "drizzle",
  "storm-coming",
  "storm-over-start",
  "storm-at-destination",
  "passing-shower",
  "sudden-downpour",
  "storm-leaving",
  "heavy-everywhere",
  "extreme",
];

const KM = 111.32;

export function scenarioCells(
  s: Scenario,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): StormCell[] {
  const mLat = (from.lat + to.lat) / 2;
  const mLng = (from.lng + to.lng) / 2;
  const cos = Math.cos((mLat * Math.PI) / 180);
  // unit vector across the trip (perpendicular), so storms cross the route
  const dx = (to.lng - from.lng) * KM * cos;
  const dy = (to.lat - from.lat) * KM;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const at = (lat: number, lng: number, eastKm: number, northKm: number) => ({
    lat: lat + northKm / KM,
    lng: lng + eastKm / (KM * cos),
  });
  switch (s) {
    case "storm-coming": {
      // 12 km to the side, drifting onto the route at 20 km/h → arrives in ~35 min
      const c = at(mLat, mLng, px * 12, py * 12);
      return [
        { ...c, peak: 30, radiusKm: 4, vEast: -px * 20, vNorth: -py * 20 },
      ];
    }
    case "storm-over-start":
      return [
        {
          lat: from.lat,
          lng: from.lng,
          peak: 25,
          radiusKm: 3.5,
          vEast: 0,
          vNorth: 0,
        },
      ];
    case "storm-leaving": {
      const c = at(mLat, mLng, 0, 0);
      return [{ ...c, peak: 30, radiusKm: 4, vEast: px * 25, vNorth: py * 25 }];
    }
    case "storm-at-destination":
      return [
        {
          lat: to.lat,
          lng: to.lng,
          peak: 25,
          radiusKm: 3,
          vEast: 0,
          vNorth: 0,
        },
      ];
    case "passing-shower": {
      // a narrow, fast cell that crosses the middle of the route ~20 min in
      const c = at(mLat, mLng, px * 10, py * 10);
      return [
        { ...c, peak: 20, radiusKm: 2, vEast: -px * 30, vNorth: -py * 30 },
      ];
    }
    case "sudden-downpour": {
      // out of a dry sky: a cell builds over the middle of the trip 8 min
      // after you leave and reaches a downpour 6 min later
      const c = at(mLat, mLng, 0, 0);
      return [
        {
          ...c,
          peak: 35,
          radiusKm: 3,
          vEast: px * 6,
          vNorth: py * 6,
          formsMin: 8,
          growMin: 6,
          unforecast: true,
        },
      ];
    }
    case "drizzle":
      return [
        { lat: mLat, lng: mLng, peak: 2.5, radiusKm: 40, vEast: 0, vNorth: 0 },
      ];
    case "extreme":
      return [
        { lat: mLat, lng: mLng, peak: 40, radiusKm: 40, vEast: 0, vNorth: 0 },
      ];
    case "heavy-everywhere":
      return [
        { lat: mLat, lng: mLng, peak: 15, radiusKm: 40, vEast: 0, vNorth: 0 },
      ];
    default:
      return [];
  }
}

/** "Is it raining where you are?" — a traveller's answer during a trip */
export interface RainReport {
  lat: number;
  lng: number;
  /** when (ms since epoch, trip clock) */
  t: number;
  /** what they said: 0 dry, 3 light, 15 heavy (mm/h) */
  mmh: number;
}

/**
 * Reports that it is raining become rain in the forecast: a 2.5 km cell at
 * that place, from 10 min before the report to 45 min after it. `at0` is
 * the field's reference time (the plan's departure).
 */
export function reportCells(reports: RainReport[], at0: number): StormCell[] {
  return reports
    .filter((r) => r.mmh > 0)
    .map((r) => {
      const m = (r.t - at0) / 60_000;
      return {
        lat: r.lat,
        lng: r.lng,
        peak: r.mmh,
        radiusKm: 2.5,
        vEast: 0,
        vNorth: 0,
        formsMin: m - 12,
        growMin: 2,
        untilMin: m + 45,
        reported: true,
      };
    });
}

/**
 * The same storms seen from a later reference time (a re-plan mid-trip):
 * moved along their tracks and their life times shifted, so the weather
 * carries on instead of starting over around the new start point.
 */
export function shiftCells(cells: StormCell[], dtMs: number): StormCell[] {
  const h = dtMs / 3_600_000;
  const m = dtMs / 60_000;
  return cells.map((c) => ({
    ...c,
    lat: c.lat + (c.vNorth * h) / KM,
    lng: c.lng + (c.vEast * h) / (KM * Math.cos((c.lat * Math.PI) / 180)),
    formsMin: c.formsMin != null ? c.formsMin - m : undefined,
    untilMin: c.untilMin != null ? c.untilMin - m : undefined,
  }));
}

/** storm cells sent by a client: finite numbers and a sane size only */
export function validCells(x: unknown): StormCell[] | null {
  if (!Array.isArray(x)) return null;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const out = x
    .slice(0, 12)
    .filter(
      (c) =>
        c &&
        n(c.lat) &&
        n(c.lng) &&
        n(c.peak) &&
        n(c.radiusKm) &&
        n(c.vEast) &&
        n(c.vNorth),
    )
    .map((c) => ({
      lat: c.lat,
      lng: c.lng,
      peak: Math.min(80, Math.max(0, c.peak)),
      radiusKm: Math.min(60, Math.max(0.5, c.radiusKm)),
      vEast: Math.min(80, Math.max(-80, c.vEast)),
      vNorth: Math.min(80, Math.max(-80, c.vNorth)),
      formsMin: n(c.formsMin) ? c.formsMin : undefined,
      growMin: n(c.growMin) ? c.growMin : undefined,
      untilMin: n(c.untilMin) ? c.untilMin : undefined,
      unforecast: c.unforecast === true || undefined,
    }));
  return out;
}
