// Arrival-time estimates. There is no public live position feed for
// TransJakarta, so every time is an estimate:
//
//   scheduled time × traffic(hour, day) × rain slowdown, on the share of the
//   route that runs in mixed traffic.
//
// The constants are stated assumptions (docs/DATA.md), not measurements.

/** Travel-time multiplier over free flow by hour, Jakarta weekday pattern. */
const WEEKDAY = [
  1.05, 1.05, 1.05, 1.05, 1.05, 1.1, 1.3, 1.55, 1.6, 1.4, 1.3, 1.3, 1.3, 1.3,
  1.3, 1.35, 1.5, 1.75, 1.8, 1.55, 1.35, 1.2, 1.1, 1.05,
];
const WEEKEND = [
  1.05, 1.05, 1.05, 1.05, 1.05, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.3, 1.3, 1.3,
  1.3, 1.3, 1.35, 1.4, 1.4, 1.35, 1.3, 1.2, 1.1, 1.05,
];
/** GTFS schedules are taken to describe average daytime traffic */
const SCHEDULE_BASE = 1.35;

/** Jakarta local time parts (UTC+7, no DST) */
export function wib(t: number): {
  hour: number;
  minute: number;
  day: number;
  secOfDay: number;
} {
  const d = new Date(t + 7 * 3_600_000);
  const secOfDay =
    d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  // Mon=0 … Sun=6
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    day: (d.getUTCDay() + 6) % 7,
    secOfDay,
  };
}

export function trafficFactor(t: number): number {
  const { hour, minute, day } = wib(t);
  const p = day >= 5 ? WEEKEND : WEEKDAY;
  const f = minute / 60;
  return p[hour] * (1 - f) + p[(hour + 1) % 24] * f;
}

/** Extra travel time from rain in mixed traffic (share). */
export function rainSlowdown(rainMmh: number): number {
  if (rainMmh < 1) return 0;
  if (rainMmh < 5) return 0.05;
  if (rainMmh < 10) return 0.1;
  if (rainMmh < 20) return 0.15;
  return 0.2;
}

/** Multiplier on a scheduled in-vehicle time. `mixed` = share in mixed traffic. */
export function rideFactor(t: number, mixed: number, rainMmh: number): number {
  const traffic = trafficFactor(t) / SCHEDULE_BASE;
  return Math.max(
    0.8,
    1 + mixed * (traffic - 1) + mixed * rainSlowdown(rainMmh),
  );
}

/**
 * Multiplier on an OSRM (free-flow car) duration for a motorcycle. Riders
 * filter through queues, so they feel about 60 % of the congestion.
 */
export function motoFactor(t: number, rainMmh: number): number {
  return 1 + 0.6 * (trafficFactor(t) - 1) + rainSlowdown(rainMmh);
}

/** Minutes to wait for an ojek pickup (estimate; longer when it rains). */
export function ojekPickupMin(rainMmh: number): number {
  return rainMmh >= 5 ? 8 : 4;
}
