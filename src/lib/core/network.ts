// The routing network: real Jakarta transit built by scripts/build-network.ts.
// Pure data + geometry helpers, shared by the server (/api/plan) and the
// browser (offline routing from the Dexie cache).

export type TransitMode = "transjakarta" | "krl" | "mrt" | "lrt";

/** 0 BRT halte (roofed, open sides) · 1 roadside bus stop · 2 KRL · 3 MRT · 4 LRT */
export type StopKind = 0 | 1 | 2 | 3 | 4;

export interface RouteInfo {
  id: string;
  short: string;
  long: string;
  mode: TransitMode;
  /** GTFS route_desc for TJ (BRT, Mikrotrans, …) or the rail line name */
  cat: string;
  color: string;
  /** flat fare in IDR, or the base fare for distance-based systems */
  fare: number;
  /** share of the route running in mixed traffic (0 = dedicated lane / rail) */
  mixed: number;
}

export interface Pattern {
  route: number;
  headsign: string;
  /** bitmask Mon=1 … Sun=64 */
  days: number;
  stops: number[];
  /** seconds from the first stop's departure to each stop */
  offsets: number[];
  /** encoded polyline of the whole pattern */
  shape: string;
  /** index into the decoded shape at each stop */
  cut: number[];
  /** frequency service: [startSec, endSec, headwaySec] */
  headways?: [number, number, number][];
  /** timetable service: departure times (sec after midnight) at the first stop */
  departures?: number[];
}

export interface Source {
  name: string;
  url: string;
  fetchedAt: string;
  note: string;
}

export interface NetworkFile {
  version: string;
  builtAt: string;
  sources: Source[];
  stops: {
    id: string[];
    name: string[];
    lat: number[];
    lng: number[];
    kind: StopKind[];
    /** index of the parent station (BRT halte complex), −1 if none */
    parent: number[];
  };
  routes: RouteInfo[];
  patterns: Pattern[];
  /** explicit transfers [stopA, stopB, seconds, sheltered 0/1] */
  transfers: [number, number, number, number][];
}

export const WALK_MPS = 5 / 3.6;
/** street walking is longer than the straight line */
export const WALK_DETOUR = 1.3;
export const FOOTPATH_MAX_M = 400;

export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function walkSeconds(meters: number): number {
  return (meters * WALK_DETOUR) / WALK_MPS;
}

/** Footpath between two stops: walking seconds and whether it is sheltered. */
export interface Footpath {
  to: number;
  sec: number;
  sheltered: boolean;
}

/** Patterns calling at a stop, with the stop's position in each pattern. */
export interface StopPattern {
  pattern: number;
  pos: number;
}

const CELL = 0.005; // ≈ 550 m grid for nearest-stop lookups

export class Network {
  readonly file: NetworkFile;
  readonly n: number;
  readonly foot: Footpath[][];
  readonly at: StopPattern[][];
  private grid = new Map<string, number[]>();

  constructor(file: NetworkFile) {
    this.file = file;
    const s = file.stops;
    this.n = s.id.length;
    for (let i = 0; i < this.n; i++) {
      const k = this.key(s.lat[i], s.lng[i]);
      const cell = this.grid.get(k);
      if (cell) cell.push(i);
      else this.grid.set(k, [i]);
    }
    this.at = Array.from({ length: this.n }, () => []);
    file.patterns.forEach((p, pi) => {
      p.stops.forEach((st, pos) => {
        if (pos < p.stops.length - 1) this.at[st].push({ pattern: pi, pos });
      });
    });
    this.foot = Array.from({ length: this.n }, () => []);
    for (let i = 0; i < this.n; i++) {
      for (const j of this.near(s.lat[i], s.lng[i], FOOTPATH_MAX_M)) {
        if (j.stop === i) continue;
        const sameHalte = s.parent[i] >= 0 && s.parent[i] === s.parent[j.stop];
        this.foot[i].push({
          to: j.stop,
          // moving between platforms of one halte is a short, roofed walk
          sec: sameHalte ? 60 : walkSeconds(j.meters),
          sheltered: sameHalte,
        });
      }
    }
    for (const [a, b, sec, sh] of file.transfers) {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const e = this.foot[x].find((f) => f.to === y);
        if (e) {
          e.sec = Math.min(e.sec, sec);
          e.sheltered ||= sh === 1;
        } else this.foot[x].push({ to: y, sec, sheltered: sh === 1 });
      }
    }
  }

  private key(lat: number, lng: number): string {
    return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
  }

  /** Stops within `radiusM` of a point, nearest first. */
  near(
    lat: number,
    lng: number,
    radiusM: number,
  ): { stop: number; meters: number }[] {
    const s = this.file.stops;
    const r = Math.ceil(radiusM / (CELL * 111_000)) + 1;
    const ci = Math.floor(lat / CELL);
    const cj = Math.floor(lng / CELL);
    const out: { stop: number; meters: number }[] = [];
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        for (const i of this.grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          const m = haversine(lat, lng, s.lat[i], s.lng[i]);
          if (m <= radiusM) out.push({ stop: i, meters: m });
        }
      }
    }
    return out.sort((a, b) => a.meters - b.meters);
  }

  stopName(i: number): string {
    return this.file.stops.name[i];
  }

  stopLatLng(i: number): [number, number] {
    return [this.file.stops.lat[i], this.file.stops.lng[i]];
  }
}
