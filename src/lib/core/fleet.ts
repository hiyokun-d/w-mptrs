// Every scheduled vehicle on the network, placed from the timetable. There is
// no public live feed for TransJakarta, KRL, MRT or LRT, so a vehicle is where
// its trip's schedule says it is: trips start one headway apart (or at their
// timetable departures) and move between stops along the pattern's shape.
// Positions are estimates and are labelled as such in the UI.
//
// Cost: decoding a pattern is done once and cached; a tick only touches the
// patterns whose bounding box is in view, with two binary searches per vehicle.

import { wib } from "./eta";
import type { NetworkFile, Pattern } from "./network";
import { decodePolyline } from "./polyline";

export interface FleetVehicle {
  /** stable across ticks: pattern and first-stop departure */
  id: string;
  pattern: number;
  route: number;
  lat: number;
  lng: number;
  /** degrees clockwise from north */
  bearing: number;
  /** position in the pattern of the next stop */
  next: number;
  /** first-stop departure, seconds after midnight */
  dep: number;
}

interface Geo {
  lat: Float64Array;
  lng: Float64Array;
  /** cumulative metres along the shape */
  cum: Float64Array;
  bbox: [number, number, number, number]; // minLng, minLat, maxLng, maxLat
  dur: number;
}

export type BBox = [number, number, number, number];

const R = 6_371_000;

export class Fleet {
  private geos: (Geo | null)[];
  constructor(readonly net: NetworkFile) {
    this.geos = new Array(net.patterns.length).fill(null);
  }

  geo(pi: number): Geo {
    let g = this.geos[pi];
    if (g) return g;
    const p = this.net.patterns[pi];
    const pts = decodePolyline(p.shape);
    const n = pts.length;
    const lat = new Float64Array(n);
    const lng = new Float64Array(n);
    const cum = new Float64Array(n);
    let minLat = 90;
    let minLng = 180;
    let maxLat = -90;
    let maxLng = -180;
    for (let i = 0; i < n; i++) {
      lat[i] = pts[i][0];
      lng[i] = pts[i][1];
      if (lat[i] < minLat) minLat = lat[i];
      if (lat[i] > maxLat) maxLat = lat[i];
      if (lng[i] < minLng) minLng = lng[i];
      if (lng[i] > maxLng) maxLng = lng[i];
      if (i) {
        const dLat = ((lat[i] - lat[i - 1]) * Math.PI) / 180;
        const dLng =
          ((lng[i] - lng[i - 1]) *
            Math.PI *
            Math.cos((lat[i] * Math.PI) / 180)) /
          180;
        cum[i] = cum[i - 1] + R * Math.hypot(dLat, dLng);
      }
    }
    g = {
      lat,
      lng,
      cum,
      bbox: [minLng, minLat, maxLng, maxLat],
      dur: p.offsets[p.offsets.length - 1] ?? 0,
    };
    this.geos[pi] = g;
    return g;
  }

  /** first-stop departures (sec after midnight) of trips running at `sec` */
  running(p: Pattern, sec: number, dur: number): number[] {
    const out: number[] = [];
    if (p.headways?.length) {
      for (const [a, b, h] of p.headways) {
        if (h <= 0) continue;
        const lo = Math.max(a, sec - dur);
        const hi = Math.min(b - 1, sec);
        if (hi < lo) continue;
        for (let d = a + Math.ceil((lo - a) / h) * h; d <= hi; d += h)
          out.push(d);
      }
    } else if (p.departures) {
      for (const d of p.departures) if (d <= sec && sec - d <= dur) out.push(d);
    }
    return out;
  }

  /** where a trip that left its first stop at `dep` is at `sec` */
  place(pi: number, dep: number, sec: number): FleetVehicle | null {
    const p = this.net.patterns[pi];
    const g = this.geo(pi);
    const e = sec - dep;
    const off = p.offsets;
    if (e < 0 || e > g.dur || off.length < 2) return null;
    // stop segment: off[i] ≤ e < off[i+1]
    let lo = 0;
    let hi = off.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (off[m] <= e) lo = m;
      else hi = m;
    }
    const span = off[hi] - off[lo] || 1;
    const f = Math.min(1, (e - off[lo]) / span);
    const c0 = g.cum[p.cut[lo]] ?? 0;
    const c1 = g.cum[p.cut[hi]] ?? c0;
    const want = c0 + f * (c1 - c0);
    // shape point: cum[j] ≤ want < cum[j+1]
    let a = p.cut[lo] ?? 0;
    let b = Math.min(p.cut[hi] ?? a, g.cum.length - 1);
    if (b <= a) b = Math.min(a + 1, g.cum.length - 1);
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (g.cum[m] <= want) a = m;
      else b = m;
    }
    const seg = g.cum[b] - g.cum[a] || 1;
    const u = Math.max(0, Math.min(1, (want - g.cum[a]) / seg));
    const lat = g.lat[a] + u * (g.lat[b] - g.lat[a]);
    const lng = g.lng[a] + u * (g.lng[b] - g.lng[a]);
    const bearing =
      (Math.atan2(
        (g.lng[b] - g.lng[a]) * Math.cos((lat * Math.PI) / 180),
        g.lat[b] - g.lat[a],
      ) *
        180) /
      Math.PI;
    return {
      id: `${pi}:${dep}`,
      pattern: pi,
      route: p.route,
      lat,
      lng,
      bearing,
      next: hi,
      dep,
    };
  }

  /**
   * Vehicles at time t (ms). `only` limits the patterns (focus mode);
   * `bbox` skips patterns that do not cross the view.
   */
  at(t: number, opt: { only?: Iterable<number>; bbox?: BBox } = {}) {
    const { secOfDay, day } = wib(t);
    const bit = 1 << day;
    const out: FleetVehicle[] = [];
    const list = opt.only ?? this.net.patterns.keys();
    for (const pi of list) {
      const p = this.net.patterns[pi];
      if (!(p.days & bit)) continue;
      const g = this.geo(pi);
      const bb = opt.bbox;
      if (
        bb &&
        (g.bbox[0] > bb[2] ||
          g.bbox[2] < bb[0] ||
          g.bbox[1] > bb[3] ||
          g.bbox[3] < bb[1])
      )
        continue;
      for (const d of this.running(p, secOfDay, g.dur)) {
        const v = this.place(pi, d, secOfDay);
        if (v) out.push(v);
      }
    }
    return out;
  }

  /** Patterns that call at `board` and later at `alight` (same stretch). */
  serving(
    board: number,
    alight: number,
  ): { pattern: number; from: number; to: number }[] {
    const out: { pattern: number; from: number; to: number }[] = [];
    this.net.patterns.forEach((p, pi) => {
      const i = p.stops.indexOf(board);
      if (i < 0) return;
      const j = p.stops.indexOf(alight, i + 1);
      if (j > i) out.push({ pattern: pi, from: i, to: j });
    });
    return out;
  }

  /**
   * Next vehicles reaching a stop (pattern position `pos`), soonest first:
   * the "who comes first, who comes after" list.
   */
  arrivals(
    t: number,
    stretch: { pattern: number; from: number }[],
    horizonSec = 3600,
    max = 8,
  ): { pattern: number; route: number; id: string; etaSec: number }[] {
    const { secOfDay, day } = wib(t);
    const bit = 1 << day;
    const out: {
      pattern: number;
      route: number;
      id: string;
      etaSec: number;
    }[] = [];
    for (const { pattern: pi, from } of stretch) {
      const p = this.net.patterns[pi];
      if (!(p.days & bit)) continue;
      const off = p.offsets[from];
      // trips reaching the stop in [sec, sec + horizon] left the first stop
      // in [sec − off, sec − off + horizon]
      const deps = this.running(
        p,
        secOfDay - off + horizonSec,
        horizonSec + 20,
      );
      for (const d of deps) {
        const eta = d + off - secOfDay;
        if (eta >= -20 && eta <= horizonSec)
          out.push({
            pattern: pi,
            route: p.route,
            id: `${pi}:${d}`,
            etaSec: eta,
          });
      }
    }
    // patterns of one line often share trips (branches, short turns): the
    // same line within a minute is one vehicle
    out.sort((a, b) => a.etaSec - b.etaSec);
    const kept: typeof out = [];
    for (const a of out)
      if (
        !kept.some(
          (k) => k.route === a.route && Math.abs(k.etaSec - a.etaSec) < 60,
        )
      )
        kept.push(a);
    return kept.slice(0, max);
  }
}
