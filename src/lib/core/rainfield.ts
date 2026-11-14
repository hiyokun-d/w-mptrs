// Forecast rain field r_f(lat, lng, t): a regular grid of mm/h values at
// 15-minute steps, sampled bilinearly in space and linearly in time.

export interface RainGrid {
  /** when the forecast was issued (ms since epoch) */
  issuedAt: number;
  source: string;
  lat0: number;
  lng0: number;
  dLat: number;
  dLng: number;
  nLat: number;
  nLng: number;
  /** time of the first step (ms since epoch) */
  t0: number;
  /** step length (ms) */
  dt: number;
  nt: number;
  /** mm/h, index [t][i][j] → t * nLat * nLng + i * nLng + j */
  values: number[];
}

export interface StormCell {
  lat: number;
  lng: number;
  /** peak intensity mm/h */
  peak: number;
  /** Gaussian radius in km */
  radiusKm: number;
  /** motion in km per hour, east and north */
  vEast: number;
  vNorth: number;
  /**
   * a cell that forms during the trip: no rain before `formsMin` minutes
   * after the reference time, then it builds to its peak over `growMin`
   */
  formsMin?: number;
  growMin?: number;
  /** and dies away after `untilMin` minutes (over `growMin`) */
  untilMin?: number;
  /**
   * the forecast did not see it coming (a sudden downpour): it rains for
   * real, but routing, alerts and the forecast layer don't know about it
   * until someone reports it
   */
  unforecast?: boolean;
  /** made from a traveller's "it's raining here" report */
  reported?: boolean;
}

export class RainField {
  readonly cells: StormCell[];
  constructor(
    readonly grid: RainGrid | null,
    cells: StormCell[] = [],
    /** shift the whole field in time, for replaying a forecast (ms) */
    readonly at0: number = 0,
    /** true: the weather that really happens, unforecast cells included */
    truth = false,
  ) {
    this.cells = truth ? cells : cells.filter((c) => !c.unforecast);
  }

  /** rain in mm/h at a place and time (ms since epoch) */
  at(lat: number, lng: number, t: number): number {
    let r = this.grid ? sampleGrid(this.grid, lat, lng, t) : 0;
    for (const c of this.cells) r += sampleCell(c, lat, lng, t - this.at0);
    return r;
  }

  /** mean rain along a straight leg, sampled at its midpoint at mid-time */
  leg(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
    t1: number,
    t2: number,
  ): number {
    return this.at((lat1 + lat2) / 2, (lng1 + lng2) / 2, (t1 + t2) / 2);
  }
}

export function sampleGrid(
  g: RainGrid,
  lat: number,
  lng: number,
  t: number,
): number {
  const fi = (lat - g.lat0) / g.dLat;
  const fj = (lng - g.lng0) / g.dLng;
  if (fi < -0.5 || fj < -0.5 || fi > g.nLat - 0.5 || fj > g.nLng - 0.5)
    return 0;
  const ft = Math.max(0, Math.min(g.nt - 1, (t - g.t0) / g.dt));
  const t0 = Math.floor(ft);
  const t1 = Math.min(g.nt - 1, t0 + 1);
  const wt = ft - t0;
  const space = (k: number) => {
    const i = Math.max(0, Math.min(g.nLat - 1, fi));
    const j = Math.max(0, Math.min(g.nLng - 1, fj));
    const i0 = Math.floor(i);
    const j0 = Math.floor(j);
    const i1 = Math.min(g.nLat - 1, i0 + 1);
    const j1 = Math.min(g.nLng - 1, j0 + 1);
    const wi = i - i0;
    const wj = j - j0;
    const v = (a: number, b: number) =>
      g.values[k * g.nLat * g.nLng + a * g.nLng + b];
    return (
      v(i0, j0) * (1 - wi) * (1 - wj) +
      v(i1, j0) * wi * (1 - wj) +
      v(i0, j1) * (1 - wi) * wj +
      v(i1, j1) * wi * wj
    );
  };
  return space(t0) * (1 - wt) + space(t1) * wt;
}

const KM_PER_DEG = 111.32;

export function sampleCell(
  c: StormCell,
  lat: number,
  lng: number,
  dtMs: number,
): number {
  const h = dtMs / 3_600_000;
  const cLat = c.lat + (c.vNorth * h) / KM_PER_DEG;
  const cLng =
    c.lng + (c.vEast * h) / (KM_PER_DEG * Math.cos((c.lat * Math.PI) / 180));
  const dy = (lat - cLat) * KM_PER_DEG;
  const dx = (lng - cLng) * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const min = dtMs / 60_000;
  const g = Math.max(0.1, c.growMin ?? 5);
  let grow = 1;
  if (c.formsMin != null) grow = ease((min - c.formsMin) / g);
  if (c.untilMin != null) grow *= ease((c.untilMin - min) / g);
  return (
    grow *
    c.peak *
    Math.exp(-(dx * dx + dy * dy) / (2 * c.radiusKm * c.radiusKm))
  );
}
